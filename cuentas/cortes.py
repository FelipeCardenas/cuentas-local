"""Persistent review cuts. Snapshots preserve agreed amounts, never payment records."""
import hashlib
import json
from datetime import date

import gestor as g
import repartos


def migrate(db):
    db.executescript("""
    CREATE TABLE IF NOT EXISTS cuts(
      id INTEGER PRIMARY KEY, created_at TEXT NOT NULL, start_date TEXT NOT NULL,
      end_date TEXT NOT NULL, note TEXT NOT NULL,
      batch_id INTEGER REFERENCES batches(id), include_older INTEGER NOT NULL DEFAULT 0,
      token TEXT NOT NULL UNIQUE, cancelled_at TEXT);
    CREATE TABLE IF NOT EXISTS cut_items(
      cut_id INTEGER NOT NULL REFERENCES cuts(id),
      movement_id INTEGER NOT NULL REFERENCES movements(id),
      mi INTEGER NOT NULL, amor INTEGER NOT NULL, snapshot TEXT NOT NULL,
      PRIMARY KEY(cut_id,movement_id));
    CREATE INDEX IF NOT EXISTS cut_movement ON cut_items(movement_id);
    """)


def effective(row):
    # A bank export supplies the installment month, not a day within that month.
    return row['period']+'-01' if row['installment'] else row['purchase_date']


def history(db):
    result=[dict(r) for r in db.execute("""
        SELECT c.*,COUNT(i.movement_id) count,COALESCE(SUM(i.mi),0) mi,
        COALESCE(SUM(i.amor),0) amor FROM cuts c
        LEFT JOIN cut_items i ON i.cut_id=c.id GROUP BY c.id ORDER BY c.id DESC
    """)]
    for item in result:
        item['allocations']=allocation_total([json.loads(r[0]) for r in db.execute('SELECT snapshot FROM cut_items WHERE cut_id=?',(item['id'],))])
    return result


def allocation_total(rows):
    totals={}
    for row in rows:
        for pid,amount in row.get('allocations',{}).items():
            totals[pid]=totals.get(pid,0)+(amount or 0)
    return totals


def defaults(db):
    last = db.execute('SELECT * FROM cuts WHERE cancelled_at IS NULL ORDER BY id DESC LIMIT 1').fetchone()
    earliest = db.execute("SELECT MIN(CASE WHEN installment=1 THEN period||'-01' ELSE purchase_date END) FROM movements WHERE kind IN ('gasto','devolucion')").fetchone()[0]
    today = date.today().isoformat()
    anchor=None
    if last:
        snapshots=[json.loads(r[0]) for r in db.execute("""
            SELECT i.snapshot FROM cut_items i JOIN cuts c ON c.id=i.cut_id
            WHERE c.cancelled_at IS NULL ORDER BY c.id,i.movement_id""")]
        original=[r for r in snapshots if not r.get('adjustment')]
        if original:anchor=max(r['date'] for r in original)
    return dict(start=anchor or (earliest or today), end=max(today,anchor or today),
                include_older=False, last_id=last['id'] if last else None)


def plan(db, data):
    start = date.fromisoformat(data.get('start','')).isoformat()
    end = date.fromisoformat(data.get('end','')).isoformat()
    if start > end:
        raise ValueError('La fecha inicial no puede ser posterior a la final')
    excluded = data.get('excluded',[])
    if not isinstance(excluded,list) or any(type(x) is not int for x in excluded):
        raise ValueError('Seleccion de movimientos invalida')
    excluded = set(excluded)
    older = data.get('include_older',False) is True
    batch = int(data['batch']) if data.get('batch') else None
    observed={r[0] for r in db.execute('SELECT movement_id FROM observations WHERE batch_id=?',(batch,))} if batch else set()
    previous = {r['movement_id']:r for r in db.execute("""
        SELECT i.movement_id,SUM(i.mi) mi,SUM(i.amor) amor FROM cut_items i
        JOIN cuts c ON c.id=i.cut_id WHERE c.cancelled_at IS NULL GROUP BY i.movement_id
    """)}
    previous_people={}
    for record in db.execute('SELECT i.movement_id,i.snapshot FROM cut_items i JOIN cuts c ON c.id=i.cut_id WHERE c.cancelled_at IS NULL'):
        totals=previous_people.setdefault(record['movement_id'],{})
        for pid,value in json.loads(record['snapshot']).get('allocations',{}).items():
            totals[pid]=totals.get(pid,0)+(value or 0)
    names={p['id']:p['name'] for p in repartos.people(db)}
    rows=[];pending=0;older_count=0
    for record in db.execute('SELECT * FROM movements ORDER BY purchase_date,id'):
        r=dict(record);mid=r['id'];d=effective(r);prev=previous.get(mid)
        valid=r['state']=='aceptado' and r['kind'] in ('gasto','devolucion') and r['mi'] is not None and r['amor'] is not None
        allocated=repartos.get(db,mid) if names else {}
        if not valid:allocated={pid:0 for pid in allocated}
        if prev:
            # Changes after an agreed cut become explicit deltas, not a second full charge.
            mi=(r['mi'] if valid else 0)-prev['mi']
            amor=(r['amor'] if valid else 0)-prev['amor']
            previous_allocated=previous_people.get(mid,{})
            allocated={pid:(allocated.get(pid) or 0)-previous_allocated.get(pid,0) for pid in set(allocated)|set(previous_allocated)}
            if not mi and not amor and not any(allocated.values()):
                continue
            adjustment=True
        else:
            if batch and r['batch_id'] != batch and mid not in observed:continue
            lower=start[:7]+'-01' if r['installment'] and not data.get('automatic') else start
            if r['kind'] not in ('gasto','devolucion') or d>end:
                continue
            if d<lower:
                if valid:older_count+=1
                if not older:continue
            if not valid:
                if r['state']=='pendiente':pending+=1
                continue
            mi=r['mi'];amor=r['amor'];adjustment=False
        rows.append(dict(id=mid,date=d,purchase_date=r['purchase_date'],period=r['period'],
                         installment=r['installment'],description=r['description'],category=r['category'],
                         batch_id=r['batch_id'],mi=mi,amor=amor,adjustment=adjustment,
                         included=mid not in excluded,snapshot=r,allocations=allocated,people=names))
    selected=[r for r in rows if r['included']]
    relevant=dict(start=start,end=end,batch=batch,include_older=older,automatic=bool(data.get('automatic')),excluded=sorted(excluded),
                  rows=rows,previous={k:dict(v) for k,v in previous.items()},
                  cuts=[tuple(r) for r in db.execute('SELECT id,cancelled_at FROM cuts ORDER BY id')])
    token=hashlib.sha256(json.dumps(relevant,sort_keys=True).encode()).hexdigest()
    return dict(start=start,end=end,token=token,rows=rows,count=len(selected),
                pending=pending,older_count=older_count,mi=sum(r['mi'] for r in selected),
                amor=sum(r['amor'] for r in selected),allocations=allocation_total(selected),adjustments=sum(r['adjustment'] for r in selected))


def save(db, data):
    with db:
        db.execute('BEGIN IMMEDIATE')
        if db.execute('SELECT 1 FROM cuts WHERE token=?',(data.get('token'),)).fetchone():
            raise ValueError('Esta consulta ya fue guardada')
        p=plan(db,data)
        if p['token'] != data.get('token'):
            raise ValueError('Los movimientos cambiaron. Vuelva a consultar antes de guardar el corte')
        if not p['count']:
            raise ValueError('No hay movimientos seleccionados')
        note=data.get('note','')
        if not isinstance(note,str) or len(note)>1000:raise ValueError('Nota invalida')
        cid=g.insert(db,'cuts',dict(created_at=g.now(),start_date=p['start'],end_date=p['end'],
                                   note=note,token=p['token'],batch_id=int(data['batch']) if data.get('batch') else None,
                                   include_older=int(data.get('include_older',False) is True)))
        for r in p['rows']:
            if r['included']:
                g.insert(db,'cut_items',dict(cut_id=cid,movement_id=r['id'],mi=r['mi'],amor=r['amor'],
                                            snapshot=json.dumps(r,ensure_ascii=False)))
    return dict(id=cid,count=p['count'])


def cancel(db, cid):
    with db:
        db.execute('BEGIN IMMEDIATE')
        last=db.execute('SELECT id FROM cuts WHERE cancelled_at IS NULL ORDER BY id DESC LIMIT 1').fetchone()
        if not last or last[0]!=cid:
            raise ValueError('Solo se puede anular el ultimo corte vigente')
        db.execute('UPDATE cuts SET cancelled_at=? WHERE id=?',(g.now(),cid))
    return dict(ok=True)


def detail(db,cid):
    cut=db.execute('SELECT * FROM cuts WHERE id=?',(cid,)).fetchone()
    if not cut:raise ValueError('Corte inexistente')
    rows=[json.loads(r[0]) for r in db.execute('SELECT snapshot FROM cut_items WHERE cut_id=? ORDER BY movement_id',(cid,))]
    return dict(cut=dict(cut),rows=rows,mi=sum(r['mi'] for r in rows),amor=sum(r['amor'] for r in rows),allocations=allocation_total(rows))


def public(data):
    # Keep scaled integers internal and avoid exposing full snapshots in previews.
    result=dict(data)
    if 'allocations' in result:result['allocations']=repartos.public(result['allocations'])
    for field in ('mi','amor'):
        if field in result:result[field]=g.decimal(result[field])
    if 'rows' in result:
        result['rows']=[public({k:v for k,v in r.items() if k!='snapshot'}) for r in result['rows']]
    return result
