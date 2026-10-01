from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import mimetypes
import secrets
import sqlite3
import tempfile
import threading
from contextlib import closing
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import gestor as g
import revision_masiva as bulk
import categorias
import cortes
import exportacion
import estadisticas

STATIC=Path(__file__).parent/'web'
LOCK=threading.Lock()


def version(row):
    return hashlib.sha256(json.dumps(dict(row),sort_keys=True).encode()).hexdigest()


def movement(row):
    d=dict(row);d['version']=version(row)
    for k in ('amount','purchase_amount','mi','amor'):
        if k in d:d[k]=g.decimal(d[k])
    return d


class Handler(BaseHTTPRequestHandler):
    def log_message(self,fmt,*args):pass

    def send(self,data,status=200,mime='application/json; charset=utf-8',download=None):
        body=json.dumps(data,ensure_ascii=False).encode() if mime.startswith('application/json') else data
        self.send_response(status)
        self.send_header('Content-Type',mime);self.send_header('Content-Length',str(len(body)))
        self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'")
        if download:self.send_header('Content-Disposition',f'attachment; filename="{download}"')
        self.end_headers();self.wfile.write(body)

    def db(self):
        db=sqlite3.connect(self.server.dbpath,timeout=15)
        db.row_factory=sqlite3.Row;db.execute('PRAGMA foreign_keys=ON')
        return db

    def valid_host(self):
        return self.headers.get('Host') in (f'127.0.0.1:{self.server.server_port}',f'localhost:{self.server.server_port}')

    def do_GET(self):
        if not self.valid_host():return self.send({'error':'Host no permitido'},403)
        try:
            url=urlparse(self.path);q={k:v[0] for k,v in parse_qs(url.query).items()}
            if not url.path.startswith('/api/'):
                filename={'/':'index.html','/app.js':'app.js','/cortes.js':'cortes.js','/estadisticas.js':'estadisticas.js','/style.css':'style.css','/lucide.js':'lucide.js'}.get(url.path)
                if not filename:return self.send({'error':'No encontrado'},404)
                file=STATIC/filename
                return self.send(file.read_bytes(),mime=mimetypes.guess_type(file.name)[0]+'; charset=utf-8')
            with closing(self.db()) as db:
                if url.path=='/api/config':
                    return self.send(dict(app='cuentas-local',token=self.server.token,batches=[dict(r) for r in db.execute('SELECT b.*,COUNT(m.id) count FROM batches b LEFT JOIN movements m ON (m.batch_id=b.id OR EXISTS(SELECT 1 FROM observations o WHERE o.batch_id=b.id AND o.movement_id=m.id)) GROUP BY b.id ORDER BY b.id DESC')],periods=[r[0] for r in db.execute('SELECT DISTINCT period FROM movements ORDER BY period DESC')],categories=[r[0] for r in db.execute("SELECT name FROM categories ORDER BY name")]))
                if url.path=='/api/categories':
                    return self.send(categorias.catalog(db))
                if url.path=='/api/statistics':
                    return self.send(estadisticas.monthly(db))
                if url.path=='/api/statistics-explanation':
                    return self.send(estadisticas.explanation(db,q))
                if url.path=='/api/cuts':
                    return self.send(dict(defaults=cortes.defaults(db),history=[cortes.public(r) for r in cortes.history(db)]))
                if url.path.startswith('/api/cuts/'):
                    return self.send(cortes.public(cortes.detail(db,int(url.path.rsplit('/',1)[1]))))
                if url.path=='/api/movements':
                    where,values=bulk.where(q)
                    page=max(1,int(q.get('page','1')));limit=35
                    count=db.execute('SELECT COUNT(*) FROM movements m'+where,values).fetchone()[0]
                    rows=db.execute('SELECT m.*,(SELECT COUNT(*) FROM issues i WHERE i.movement_id=m.id AND i.resolved=0) issue_count FROM movements m'+where+' ORDER BY purchase_date DESC,id DESC LIMIT ? OFFSET ?',values+[limit,(page-1)*limit]).fetchall()
                    # Aggregate the same filtered set as the table, before pagination.
                    totals=g.summary(db,filters=q)
                    totals['pendientes_globales']=db.execute("SELECT COUNT(*) FROM movements WHERE state='pendiente' AND kind IN ('gasto','devolucion')").fetchone()[0]
                    pending,_=bulk.plan(db,q)
                    return self.send(dict(rows=[movement(r) for r in rows],count=count,page=page,pages=max(1,(count+limit-1)//limit),summary=totals,pending=pending))
                if url.path.startswith('/api/detail/'):
                    mid=int(url.path.rsplit('/',1)[1]);r=db.execute('SELECT * FROM movements WHERE id=?',(mid,)).fetchone()
                    if not r:return self.send({'error':'Movimiento inexistente'},404)
                    matches=db.execute('SELECT DISTINCT m.* FROM movements m JOIN candidates c ON (c.other_id=m.id AND c.movement_id=?) OR (c.movement_id=m.id AND c.other_id=?) ORDER BY m.id',(mid,mid)).fetchall()
                    issues=[dict(i) for i in db.execute('SELECT * FROM issues WHERE movement_id=? AND resolved=0',(mid,))]
                    observations=[dict(o) for o in db.execute('SELECT sheet,row_number,source_key,raw_json FROM observations WHERE movement_id=?',(mid,))]
                    decisions=[dict(d) for d in db.execute('SELECT created_at,action,note FROM decisions WHERE movement_id=? ORDER BY id DESC',(mid,))]
                    return self.send(dict(row=movement(r),candidates=[movement(m) for m in matches],issues=issues,observations=observations,decisions=decisions))
                if url.path=='/api/export':
                    view='v_gastos_confirmados' if q.get('confirmed')=='1' else 'v_powerbi'
                    cur=db.execute(f'SELECT * FROM {view} ORDER BY id');out=io.StringIO();writer=csv.writer(out)
                    writer.writerow([c[0] for c in cur.description])
                    # Prevent spreadsheet formulas in user-editable text exports.
                    for row in cur:writer.writerow(["'"+v if isinstance(v,str) and v.startswith(('=','+','-','@')) else v for v in row])
                    return self.send(out.getvalue().encode('utf-8-sig'),mime='text/csv; charset=utf-8',download=view+'.csv')
                if url.path=='/api/export-filtered':
                    content=exportacion.filtered_excel(db,q)
                    suffix='-'.join(q[k] for k in ('year','month') if q.get(k))
                    return self.send(content,mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                                     download='movimientos_filtrados'+('-'+suffix if suffix else '')+'.xlsx')
                return self.send({'error':'No encontrado'},404)
        except (ValueError,sqlite3.Error) as e:self.send({'error':str(e)},400)

    def do_POST(self):
        origin=self.headers.get('Origin')
        if not self.valid_host() or self.headers.get('X-Cuentas-Token')!=self.server.token or (origin and origin not in (f'http://127.0.0.1:{self.server.server_port}',f'http://localhost:{self.server.server_port}')):
            return self.send({'error':'Solicitud no autorizada'},403)
        try:
            length=int(self.headers.get('Content-Length','0'))
            if not 0<length<=12*1024*1024:return self.send({'error':'Archivo vacio o superior a 12 MB'},400)
            body=self.rfile.read(length);url=urlparse(self.path);q={k:v[0] for k,v in parse_qs(url.query).items()}
            with LOCK,closing(self.db()) as db:
                if url.path in ('/api/preview','/api/import'):
                    name=q.get('name','archivo.xlsx')
                    if '/' in name or '\\' in name or ':' in name or not name.lower().endswith('.xlsx'):raise ValueError('Seleccione un archivo .xlsx')
                    month=q.get('period') or None
                    if month:g.period(month)
                    if url.path=='/api/preview':
                        rows=g.bank_rows(body,month)
                        old=db.execute('SELECT id,period FROM batches WHERE fingerprint=?',(hashlib.sha256(body).hexdigest(),)).fetchone()
                        return self.send(dict(count=len(rows),payments=sum(r['kind']=='pago_tarjeta' for r in rows),installments=sum(r['installment'] for r in rows),gross=g.decimal(sum(r['amount'] for r in rows if r['kind']!='pago_tarjeta')),existing=old['id'] if old else None,existing_period=old['period'] if old else None,rows=[{k:g.decimal(v) if k=='amount' else v for k,v in r.items() if k in ('purchase_date','period','description','amount','kind')} for r in rows[:8]]))
                    with tempfile.TemporaryDirectory() as folder:
                        file=Path(folder)/name;file.write_bytes(body)
                        return self.send(g.import_bank(db,self.server.dbpath,file,month))
                if url.path in ('/api/bulk-preview','/api/bulk-confirm'):
                    data=json.loads(body);filters=data.get('filters',{})
                    if url.path=='/api/bulk-preview':return self.send(bulk.plan(db,filters)[0])
                    return self.send(bulk.confirm(db,filters,data.get('token')))
                if url.path=='/api/categories':
                    return self.send(categorias.change(db,json.loads(body)))
                if url.path in ('/api/cut-preview','/api/cut-save','/api/cut-cancel'):
                    data=json.loads(body)
                    if url.path=='/api/cut-preview':
                        with db:
                            db.execute('BEGIN')
                            result=cortes.public(cortes.plan(db,data))
                        return self.send(result)
                    if url.path=='/api/cut-save':return self.send(cortes.save(db,data))
                    return self.send(cortes.cancel(db,int(data['id'])))
                if url.path=='/api/review':
                    data=json.loads(body);mid=int(data['id'])
                    if data.get('category') and not db.execute('SELECT 1 FROM categories WHERE name=?',(data['category'],)).fetchone():
                        raise ValueError('Seleccione una categoria del maestro actualizado')
                    row=db.execute('SELECT * FROM movements WHERE id=?',(mid,)).fetchone()
                    if not row:raise ValueError('Movimiento inexistente')
                    if data.get('version')!=version(row):return self.send({'error':'El movimiento cambio. Vuelva a abrirlo antes de guardar.'},409)
                    result=g.review(db,mid,data['action'],data.get('category'),data.get('mi'),data.get('amor'),data.get('period'),data.get('duplicate_of'),data.get('note',''),data.get('special_case'))
                    return self.send(result)
                return self.send({'error':'No encontrado'},404)
        except Exception as e:
            self.send({'error':str(e) or 'No se pudo procesar la solicitud'},400)


def main():
    p=argparse.ArgumentParser();p.add_argument('--db',type=Path,default=g.DEFAULT_DB);p.add_argument('--port',type=int,default=8765);p.add_argument('--auto-port',action='store_true');args=p.parse_args()
    with closing(g.connect(args.db)):pass
    for port in range(args.port,args.port+(20 if args.auto_port else 1)):
        try:server=ThreadingHTTPServer(('127.0.0.1',port),Handler);break
        except OSError:
            if port==args.port+(19 if args.auto_port else 0):raise
    server.dbpath=args.db;server.token=secrets.token_urlsafe(32)
    print(f'http://127.0.0.1:{server.server_port}',flush=True)
    server.serve_forever()


if __name__=='__main__':main()
