"""Local expense store and explicit, repeatable imports. No bank access."""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sqlite3
import unicodedata
import categorias
from collections import Counter
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DEFAULT_DB = ROOT / 'datos' / 'cuentas.sqlite3'
SCALE = 1_000_000

SCHEMA = '''
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT OR IGNORE INTO meta VALUES ('schema_version','1');
CREATE TABLE IF NOT EXISTS batches(
 id INTEGER PRIMARY KEY, kind TEXT NOT NULL, fingerprint TEXT NOT NULL UNIQUE,
 name TEXT NOT NULL, period TEXT, imported_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS files(
 id INTEGER PRIMARY KEY, batch_id INTEGER NOT NULL REFERENCES batches(id),
 name TEXT NOT NULL, sha256 TEXT NOT NULL, archive_path TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS movements(
 id INTEGER PRIMARY KEY, batch_id INTEGER NOT NULL REFERENCES batches(id),
 source_key TEXT NOT NULL UNIQUE, purchase_date TEXT NOT NULL, period TEXT NOT NULL,
 description TEXT NOT NULL, normalized_description TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('gasto','devolucion','pago_tarjeta','ingreso')),
 amount INTEGER NOT NULL, purchase_amount INTEGER,
 installments_pending INTEGER, installment INTEGER NOT NULL DEFAULT 0,
 holder TEXT, currency TEXT NOT NULL DEFAULT 'CLP' CHECK(currency='CLP'),
 category TEXT, mi INTEGER, amor INTEGER,
 state TEXT NOT NULL CHECK(state IN ('pendiente','aceptado','duplicado','excluido_gasto')),
 duplicate_of INTEGER REFERENCES movements(id),
 CHECK(state != 'duplicado' OR duplicate_of IS NOT NULL));
CREATE TABLE IF NOT EXISTS observations(
 id INTEGER PRIMARY KEY, batch_id INTEGER NOT NULL REFERENCES batches(id),
 source_key TEXT NOT NULL, movement_id INTEGER REFERENCES movements(id),
 sheet TEXT NOT NULL, row_number INTEGER NOT NULL, raw_json TEXT NOT NULL,
 UNIQUE(batch_id,source_key));
CREATE TABLE IF NOT EXISTS issues(
 id INTEGER PRIMARY KEY, movement_id INTEGER REFERENCES movements(id),
 observation_id INTEGER REFERENCES observations(id), code TEXT NOT NULL,
 detail TEXT NOT NULL, resolved INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS candidates(
 movement_id INTEGER NOT NULL REFERENCES movements(id),
 other_id INTEGER NOT NULL REFERENCES movements(id), reason TEXT NOT NULL,
 PRIMARY KEY(movement_id,other_id), CHECK(movement_id != other_id));
CREATE TABLE IF NOT EXISTS decisions(
 id INTEGER PRIMARY KEY, movement_id INTEGER NOT NULL REFERENCES movements(id),
 created_at TEXT NOT NULL, action TEXT NOT NULL, before_json TEXT NOT NULL,
 after_json TEXT NOT NULL, note TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_match ON movements(purchase_date,normalized_description,amount,period);
CREATE INDEX IF NOT EXISTS idx_period ON movements(period,state,kind);
CREATE VIEW IF NOT EXISTS v_powerbi AS
 SELECT id, purchase_date AS fecha_compra, period AS periodo, description AS descripcion,
 kind AS tipo, amount/1000000.0 AS monto_clp, mi/1000000.0 AS mi_clp,
 amor/1000000.0 AS amor_clp, category AS categoria, state AS estado,
 batch_id AS lote, installment AS es_cuota, duplicate_of AS duplicado_de
 FROM movements;
CREATE VIEW IF NOT EXISTS v_gastos_confirmados AS
 SELECT * FROM v_powerbi WHERE estado='aceptado' AND tipo IN ('gasto','devolucion');
'''


def now():
    return datetime.now(timezone.utc).isoformat()


def norm(value):
    s = unicodedata.normalize('NFKD', str(value or '').replace('*', ''))
    return ' '.join(''.join(c for c in s if not unicodedata.combining(c)).lower().split())


def money(value, optional=False):
    if value is None or str(value).strip() in ('', '-', '$'):
        if optional: return None
        raise ValueError('Importe obligatorio ausente')
    try:
        n = Decimal(str(value))
    except InvalidOperation:
        raise ValueError(f'Importe no numerico: {value!r}') from None
    if not n.is_finite():
        raise ValueError(f'Importe invalido: {value!r}')
    return int((n * SCALE).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def decimal(value):
    return None if value is None else format(Decimal(value) / SCALE, 'f')


def day(value):
    if isinstance(value, (datetime,date)): return value.isoformat()[:10]
    # Archived Excel datetimes are serialized by json.dumps(default=str).
    for fmt in ('%Y-%m-%d','%d/%m/%Y','%d-%m-%Y',
                '%Y-%m-%d %H:%M:%S','%Y-%m-%d %H:%M:%S.%f',
                '%Y-%m-%dT%H:%M:%S','%Y-%m-%dT%H:%M:%S.%f'):
        try: return datetime.strptime(str(value).strip(),fmt).date().isoformat()
        except ValueError: pass
    raise ValueError(f'Fecha no interpretable: {value!r}')


def period(value):
    if not value or not re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])',value):
        raise ValueError('Indique el mes de las cuotas como YYYY-MM, por ejemplo 2026-09')
    return value


def connect(path):
    path = Path(path)
    path.parent.mkdir(parents=True,exist_ok=True)
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    db.executescript(SCHEMA)
    if db.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()[0] not in ('1','2','3'):
        raise ValueError('Version de base no compatible')
    if 'special_case' not in {r[1] for r in db.execute('PRAGMA table_info(movements)')}:
        with db:
            db.execute('ALTER TABLE movements ADD COLUMN special_case INTEGER NOT NULL DEFAULT 0 CHECK(special_case IN (0,1))')
            db.execute('DROP VIEW v_gastos_confirmados')
            db.execute('DROP VIEW v_powerbi')
            db.execute('''CREATE VIEW v_powerbi AS SELECT id, purchase_date AS fecha_compra,
                period AS periodo, description AS descripcion, kind AS tipo,
                amount/1000000.0 AS monto_clp, mi/1000000.0 AS mi_clp,
                amor/1000000.0 AS amor_clp, category AS categoria, state AS estado,
                batch_id AS lote, installment AS es_cuota, duplicate_of AS duplicado_de,
                special_case AS caso_especial FROM movements''')
            db.execute("CREATE VIEW v_gastos_confirmados AS SELECT * FROM v_powerbi WHERE estado='aceptado' AND tipo IN ('gasto','devolucion')")
            db.execute("UPDATE meta SET value='2' WHERE key='schema_version'")
    categorias.migrate(db)
    import cortes
    cortes.migrate(db)
    import repartos
    repartos.migrate(db)
    return db


def insert(db, table, values):
    if table == 'movements' and values.get('category') is not None:
        values = dict(values, category=categorias.ensure(db, values['category']))
    fields = ','.join(values)
    return db.execute(f'INSERT INTO {table} ({fields}) VALUES ({",".join("?" for _ in values)})',list(values.values())).lastrowid


def issue(db, mid, code, detail, oid=None):
    insert(db,'issues',dict(movement_id=mid,observation_id=oid,code=code,detail=detail))


def archive(db, dbpath, batch, path, content):
    digest=hashlib.sha256(content).hexdigest()
    target=Path(dbpath).parent / 'originales' / digest / path.name
    target.parent.mkdir(parents=True,exist_ok=True)
    if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest()!=digest:
        raise ValueError('La copia de origen existente no coincide con su hash')
    if not target.exists(): target.write_bytes(content)
    insert(db,'files',dict(batch_id=batch,name=path.name,sha256=digest,archive_path=str(target.resolve())))


def add_observation(db,batch,key,mid,sheet,row,raw):
    return insert(db,'observations',dict(batch_id=batch,source_key=key,movement_id=mid,sheet=sheet,row_number=row,raw_json=json.dumps(raw,ensure_ascii=False,default=str)))


def assess(db,mid):
    r=db.execute('SELECT * FROM movements WHERE id=?',(mid,)).fetchone()
    if r['kind'] not in ('gasto','devolucion'): return
    if not r['category']: issue(db,mid,'categoria','Falta categoria')
    if r['mi'] is None or r['amor'] is None:
        issue(db,mid,'reparto','Reparto con blanco o marcador de texto; no se asume cero')
    elif r['mi']+r['amor']!=r['amount'] and not r['special_case']:
        issue(db,mid,'reparto','Mi + Amor no coincide con el importe')
    if r['period']!=r['purchase_date'][:7]:
        issue(db,mid,'periodo','Mes asignado distinto de fecha original; conservar y revisar')


def import_history(db,dbpath,folder):
    folder=Path(folder)
    names=['preconsolidado_revision.csv','fuentes_normalizadas.csv','comparacion_coincidencias.csv','grupos_ambiguos.csv']
    contents={name:(folder/name).read_bytes() for name in names}
    fingerprint=hashlib.sha256(b''.join(name.encode()+contents[name] for name in names)).hexdigest()
    existing=db.execute("SELECT id FROM batches WHERE kind='historico'").fetchone()
    if existing:
        match=db.execute('SELECT id FROM batches WHERE fingerprint=?',(fingerprint,)).fetchone()
        if match:return dict(lote=match[0],reutilizado=True)
        raise ValueError('Ya hay un historico distinto. Requiere conciliacion explicita; no se sobreescribe.')
    def rows(name): return list(csv.DictReader(contents[name].decode('utf-8-sig').splitlines()))
    prepared=rows(names[0]); originals=rows(names[1]); comparisons=rows(names[2]); groups=rows(names[3])
    with db:
        batch=insert(db,'batches',dict(kind='historico',fingerprint=fingerprint,name=folder.name,period=None,imported_at=now()))
        for name,content in contents.items():archive(db,dbpath,batch,folder/name,content)
        links={}
        for r in prepared:
            amount=money(r['monto']); kind='ingreso' if norm(r['descripcion'])=='sueldo' else 'pago_tarjeta' if norm(r['descripcion'])=='pago tarjeta cmr' else 'devolucion' if amount<0 else 'gasto'
            dt=day(r['fecha']); p=period(r['periodo_hoja'] or dt[:7])
            mid=insert(db,'movements',dict(batch_id=batch,source_key=r['id'],purchase_date=dt,period=p,description=r['descripcion'],normalized_description=norm(r['descripcion']),kind=kind,amount=amount,category=r['categoria'] or None,mi=money(r['mi'],True),amor=money(r['amor'],True),state='excluido_gasto' if kind=='pago_tarjeta' else 'pendiente'))
            links[r['id']]=mid
            if r['id_google'] and ';' not in r['id_google']:links[r['id_google']]=mid
            assess(db,mid)
        observation_ids={}
        for r in originals:
            oid=add_observation(db,batch,r['id'],links.get(r['id']),r['hoja'],int(r['fila']),r)
            observation_ids[r['id']]=oid
        for r in comparisons:
            if r['diferencias'] not in ('Sin diferencias','descripcion_formato'):
                issue(db,links[r['id_excel']],'conflicto_historico',json.dumps(r,ensure_ascii=False))
        for r in groups:
            for key in r['ids_google'].split(';'):
                issue(db,None,'enlace_historico_ambiguo',json.dumps(r,ensure_ascii=False),observation_ids[key])
        assert db.execute('SELECT COUNT(*) FROM movements WHERE batch_id=?',(batch,)).fetchone()[0]==len(prepared)
        assert db.execute('SELECT COUNT(*) FROM observations WHERE batch_id=?',(batch,)).fetchone()[0]==len(originals)
    return dict(lote=batch,reutilizado=False,movimientos=len(prepared),observaciones=len(originals))


def bank_rows(content,month):
    import io
    import openpyxl
    wb=openpyxl.load_workbook(io.BytesIO(content),data_only=True,read_only=True)
    result=[]
    required=['fecha','descripcion','titular/adicional','monto','cuotas pendientes','valor cuota']
    try:
        for ws in wb:
            headers=None
            for index,vals in enumerate(ws.iter_rows(values_only=True),1):
                if headers is None:
                    labels=[norm(v) for v in vals]
                    if all(label in labels for label in required):
                        headers={label:labels.index(label) for label in required}
                        if 'moneda' in labels: headers['moneda']=labels.index('moneda')
                    elif index>=20:break
                    continue
                if not any(v is not None for v in vals):continue
                raw={k:vals[i] if i<len(vals) else None for k,i in headers.items()}
                try:
                    if raw.get('moneda') and norm(raw['moneda']) not in ('clp','peso chileno','pesos chilenos'):
                        raise ValueError('Moneda extranjera: falta proveedor de conversion; no se importa como CLP')
                    desc=str(raw['descripcion'] or '').strip()
                    if not desc:raise ValueError('Descripcion ausente')
                    dt=day(raw['fecha']); amount=money(raw['valor cuota']); total=money(raw['monto'])
                    pending=Decimal(str(raw['cuotas pendientes']))
                    if pending<0 or pending!=pending.to_integral_value():raise ValueError('Cuotas pendientes invalidas')
                    kind='pago_tarjeta' if norm(desc)=='pago tarjeta cmr' else 'devolucion' if amount<0 else 'gasto'
                    installment=kind=='gasto' and (pending>0 or abs(total)!=abs(amount))
                    p=period(month) if installment else dt[:7]
                    # Six-decimal precision preserves historical half-peso splits.
                    mi=amount//2; amor=amount-mi
                    result.append(dict(sheet=ws.title,row=index,raw=raw,purchase_date=dt,period=p,description=desc,normalized_description=norm(desc),kind=kind,amount=amount,purchase_amount=total,installments_pending=int(pending),installment=int(installment),holder=raw['titular/adicional'],mi=None if kind=='pago_tarjeta' else mi,amor=None if kind=='pago_tarjeta' else amor))
                except (ValueError,InvalidOperation) as e:
                    raise ValueError(f'{ws.title}, fila {index}: {e}') from e
        if not result:raise ValueError('No se encontro una tabla bancaria compatible con movimientos')
        return result
    finally:wb.close()


def import_bank(db,dbpath,path,month=None):
    path=Path(path)
    content=path.read_bytes(); fingerprint=hashlib.sha256(content).hexdigest()
    existing=db.execute('SELECT id,period FROM batches WHERE fingerprint=?',(fingerprint,)).fetchone()
    if existing:
        if month and month!=existing['period']:raise ValueError('Archivo ya importado con otro mes. Corrija el periodo mediante revision.')
        return dict(lote=existing['id'],reutilizado=True)
    data=bank_rows(content,month)
    with db:
        db.execute('BEGIN IMMEDIATE')
        import solapamientos
        recognized=solapamientos.recognized(db,data)
        batch=insert(db,'batches',dict(kind='banco',fingerprint=fingerprint,name=path.name,period=month,imported_at=now()))
        archive(db,dbpath,batch,path,content)
        for index,r in enumerate(data):
            r=dict(r); sheet=r.pop('sheet'); row=r.pop('row'); raw=r.pop('raw')
            if index in recognized:
                add_observation(db,batch,f'{sheet}:{row}',recognized[index],sheet,row,raw)
                continue
            choices=db.execute("SELECT category,COUNT(*) n FROM movements WHERE normalized_description=? AND category IS NOT NULL AND state NOT IN ('duplicado','excluido_gasto') GROUP BY category ORDER BY n DESC, category",(r['normalized_description'],)).fetchall()
            r['category']=choices[0]['category'] if choices else None
            r['state']='excluido_gasto' if r['kind']=='pago_tarjeta' else 'pendiente'
            matches=[m for m in db.execute("SELECT id,normalized_description FROM movements WHERE purchase_date=? AND amount=? AND period=? AND kind=? AND state!='duplicado'",(r['purchase_date'],r['amount'],r['period'],r['kind']))
                     if solapamientos.similar_name(m['normalized_description'],r['normalized_description'])]
            mid=insert(db,'movements',dict(batch_id=batch,source_key=f'banco:{fingerprint}:{sheet}:{row}',**r))
            if r['kind']!='pago_tarjeta':
                import repartos
                repartos.default(db,mid,r['amount'])
            add_observation(db,batch,f'{sheet}:{row}',mid,sheet,row,raw)
            assess(db,mid)
            if len(choices)>1 or any(s in r['normalized_description'] for s in ('shell','copec')):
                issue(db,mid,'categoria_variable','Comercio con categorias variables: confirmar sugerencia')
            for match in matches:
                insert(db,'candidates',dict(movement_id=mid,other_id=match['id'],reason='Misma fecha, importe, tipo y periodo; descripcion igual o similar (90%); puede ser otra compra real'))
            if matches:issue(db,mid,'posible_duplicado','Revisar coincidencias; no se elimina ningun movimiento')
    return dict(lote=batch,reutilizado=False,movimientos=len(data),reconocidos=len(recognized),nuevos=len(data)-len(recognized))


def review(db,mid,action,category=None,mi=None,amor=None,month=None,duplicate_of=None,note='',special_case=None,allocations=None):
    row=db.execute('SELECT * FROM movements WHERE id=?',(mid,)).fetchone()
    if not row:raise ValueError('Movimiento inexistente')
    before=dict(row); after=dict(row)
    import repartos
    values=None
    if repartos.people(db) and action in ('editar','aceptar'):
        values=repartos.validate(db,mid,allocations,row['amount'],special_case if special_case is not None else row['special_case'])
        a,b=repartos.compatibility(db,values)
        mi,amor=decimal(a),decimal(b)
        before['allocations']=repartos.get(db,mid)
        after['allocations']=values
    if action in ('descartar','restaurar'):
        if before['kind']=='pago_tarjeta' or before['state']=='duplicado':
            raise ValueError('Este movimiento no admite descarte o restauracion')
        if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='cut_items'").fetchone():
            if db.execute('SELECT 1 FROM cut_items i JOIN cuts c ON c.id=i.cut_id WHERE i.movement_id=? AND c.cancelled_at IS NULL',(mid,)).fetchone():
                raise ValueError('El movimiento pertenece a un corte vigente; no se puede descartar')
        if action=='restaurar' and before['state']!='excluido_gasto':
            raise ValueError('El movimiento no esta descartado')
        if db.execute('SELECT 1 FROM movements WHERE duplicate_of=?',(mid,)).fetchone():
            raise ValueError('El movimiento tiene copias vinculadas; no se puede descartar')
        if any(value is not None for value in (category,mi,amor,month,special_case,duplicate_of)):
            raise ValueError('Guarde los cambios antes de descartar o restaurar')
    if special_case is not None:
        if type(special_case) is not bool:raise ValueError('Caso especial debe ser verdadero o falso')
        after['special_case']=int(special_case)
    if category is not None:after['category']=categorias.ensure(db, category)
    if mi is not None:after['mi']=money(mi,optional=True)
    if amor is not None:after['amor']=money(amor,optional=True)
    if month is not None:after['period']=period(month)
    if action=='aceptar':
        if after['kind']=='pago_tarjeta':raise ValueError('Pago de tarjeta no se acepta como gasto')
        if not after['category']:raise ValueError('Falta categoria')
        if after['mi'] is None or after['amor'] is None or (not after['special_case'] and after['mi']+after['amor']!=after['amount']):
            raise ValueError('Mi + Amor debe coincidir exactamente con el importe')
        after['state']='aceptado';after['duplicate_of']=None
    elif action=='duplicado':
        target=db.execute('SELECT * FROM movements WHERE id=?',(duplicate_of,)).fetchone()
        if not target or duplicate_of==mid or target['state']!='aceptado':raise ValueError('El destino debe ser otro movimiento aceptado')
        if target['kind']!=after['kind'] or target['amount']!=after['amount']:raise ValueError('Destino con distinto tipo o importe')
        if db.execute('SELECT 1 FROM movements WHERE duplicate_of=?',(mid,)).fetchone():raise ValueError('Hay duplicados vinculados a este movimiento; no se permiten cadenas')
        after['state']='duplicado';after['duplicate_of']=duplicate_of
    elif action=='editar':
        if before['state']=='duplicado':raise ValueError('Acepte primero el movimiento para deshacer su duplicacion')
        if before['state']=='aceptado' and (after['mi'] is None or after['amor'] is None or (not after['special_case'] and after['mi']+after['amor']!=after['amount']) or not after['category']):
            raise ValueError('La edicion invalidaria un movimiento aceptado')
    elif action=='descartar':
        after['state']='excluido_gasto'
    elif action=='restaurar':
        after['state']='pendiente'
    elif action=='conservar':
        if category is not None or mi is not None or amor is not None or month is not None:
            raise ValueError('Conservar solo confirma que la compra es independiente; use editar para otros cambios')
    else:raise ValueError('Accion no soportada')
    with db:
        fields=['category','mi','amor','period','state','duplicate_of','special_case']
        db.execute('UPDATE movements SET '+','.join(f'{f}=?' for f in fields)+' WHERE id=?',[after[f] for f in fields]+[mid])
        if values is not None:repartos.write(db,mid,values)
        if action in ('aceptar','duplicado','descartar'):db.execute('UPDATE issues SET resolved=1 WHERE movement_id=?',(mid,))
        elif action=='restaurar':assess(db,mid)
        elif action=='conservar':db.execute("UPDATE issues SET resolved=1 WHERE movement_id=? AND code='posible_duplicado'",(mid,))
        elif action=='editar':
            db.execute("UPDATE issues SET resolved=1 WHERE movement_id=? AND code IN ('categoria','reparto','periodo')",(mid,))
            if after['state']=='pendiente':assess(db,mid)
        insert(db,'decisions',dict(movement_id=mid,created_at=now(),action=action,before_json=json.dumps(before,ensure_ascii=False),after_json=json.dumps(after,ensure_ascii=False),note=note))
    return dict(id=mid,estado=after['state'])


def summary(db,batch=None,filters=None):
    import revision_masiva
    clause,values=revision_masiva.where(filters if filters is not None else {'batch':batch})
    rows=db.execute('SELECT m.* FROM movements m'+clause,values).fetchall()
    expenses=[r for r in rows if r['kind'] in ('gasto','devolucion') and r['state']!='excluido_gasto']
    groups={}
    for r in expenses:
        k=(r['purchase_date'],r['normalized_description'],r['amount'],r['period'],r['kind'])
        groups.setdefault(k,r['amount'])
    return dict(movimientos=len(rows),estados=dict(Counter(r['state'] for r in rows)),
        bruto_clp=decimal(sum(r['amount'] for r in expenses)),
        deduplicado_propuesto_clp=decimal(sum(groups.values())),
        real_confirmado_clp=decimal(sum(r['amount'] for r in expenses if r['state']=='aceptado')),
        mi_confirmado_clp=decimal(sum(r['mi'] or 0 for r in expenses if r['state']=='aceptado')),
        amor_confirmado_clp=decimal(sum(r['amor'] or 0 for r in expenses if r['state']=='aceptado')),
        pendientes=sum(r['state']=='pendiente' for r in expenses),
        nota='Bruto y propuesta calculados sobre el lote seleccionado o todas las observaciones canonicas; los lotes solapados no son gasto confirmado. Real incluye solo aceptados. La propuesta no elimina compras.')


def export(db,folder):
    folder=Path(folder);folder.mkdir(parents=True,exist_ok=True)
    for view in ('v_powerbi','v_gastos_confirmados'):
        cursor=db.execute(f'SELECT * FROM {view} ORDER BY id')
        with (folder/f'{view}.csv').open('w',encoding='utf-8-sig',newline='') as f:
            writer=csv.writer(f);writer.writerow([c[0] for c in cursor.description]);writer.writerows(cursor)
    for name,query in [('pendientes',"SELECT * FROM movements WHERE state='pendiente'"),('incidencias',"SELECT * FROM issues WHERE resolved=0"),('coincidencias','SELECT * FROM candidates')]:
        cursor=db.execute(query)
        fields=[c[0] for c in cursor.description]
        with (folder/f'{name}.csv').open('w',encoding='utf-8-sig',newline='') as f:
            writer=csv.writer(f);writer.writerow(fields)
            for row in cursor:
                writer.writerow([decimal(v) if fields[i] in ('amount','purchase_amount','mi','amor') else v for i,v in enumerate(row)])
    return dict(carpeta=str(folder.resolve()))


def main():
    p=argparse.ArgumentParser(description='Cuentas locales: importacion y revision explicitas')
    p.add_argument('--db',type=Path,default=DEFAULT_DB)
    sub=p.add_subparsers(dest='cmd',required=True)
    sub.add_parser('iniciar')
    h=sub.add_parser('historico');h.add_argument('carpeta',type=Path)
    b=sub.add_parser('importar');b.add_argument('archivo',type=Path);b.add_argument('--mes-cuotas')
    folder_cmd=sub.add_parser('importar-carpeta');folder_cmd.add_argument('carpeta',type=Path,nargs='?',default=ROOT/'entrada');folder_cmd.add_argument('--mes-cuotas')
    s=sub.add_parser('resumen');s.add_argument('--lote',type=int)
    e=sub.add_parser('exportar');e.add_argument('carpeta',type=Path)
    r=sub.add_parser('revisar');r.add_argument('id',type=int);r.add_argument('accion',choices=['aceptar','editar','duplicado','conservar'])
    for flag in ('categoria','mi','amor','mes','nota'):r.add_argument('--'+flag)
    r.add_argument('--duplicado-de',type=int)
    args=p.parse_args();db=connect(args.db)
    try:
        if args.cmd=='historico':result=import_history(db,args.db,args.carpeta)
        elif args.cmd=='importar':result=import_bank(db,args.db,args.archivo,args.mes_cuotas)
        elif args.cmd=='importar-carpeta':
            if not args.carpeta.is_dir():raise ValueError('Carpeta de entrada inexistente')
            results=[]
            for file in sorted(args.carpeta.glob('*.xlsx')):
                if file.name.startswith('~$'):continue
                try:results.append(dict(archivo=file.name,**import_bank(db,args.db,file,args.mes_cuotas)))
                except (ValueError,sqlite3.IntegrityError) as exc:results.append(dict(archivo=file.name,error=str(exc)))
            result={'archivos':results}
            if any('error' in r for r in results):
                print(json.dumps(result,ensure_ascii=False,indent=2));raise SystemExit(2)
        elif args.cmd=='resumen':result=summary(db,args.lote)
        elif args.cmd=='exportar':result=export(db,args.carpeta)
        elif args.cmd=='revisar':result=review(db,args.id,args.accion,args.categoria,args.mi,args.amor,args.mes,args.duplicado_de,args.nota or '')
        else:
            (ROOT/'entrada').mkdir(exist_ok=True)
            result={'base':str(args.db.resolve()),'entrada':str(ROOT/'entrada')}
        print(json.dumps(result,ensure_ascii=False,indent=2))
    except (ValueError,sqlite3.IntegrityError) as exc:p.exit(2,f'Error: {exc}\n')
    finally:db.close()


if __name__=='__main__':main()
