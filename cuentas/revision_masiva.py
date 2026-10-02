"""Filtered review over all pages, with an atomic preview/commit contract."""
import hashlib
import json
import re
from datetime import date

import gestor as g
import repartos


def where(filters, pending=False):
    clauses=[];values=[]
    if filters.get('state')!='excluido_gasto':
        clauses.append("NOT (m.state='excluido_gasto' AND m.kind!='pago_tarjeta')")
    else:
        clauses.append("m.kind!='pago_tarjeta'")
    if str(filters.get('show_duplicates','0'))!='1':
        clauses.append("m.state!='duplicado'")
    for key,pattern,expression in [
        ('month',r'0[1-9]|1[0-2]','substr(m.period,6,2)'),
        ('year',r'[0-9]{4}','substr(m.period,1,4)')]:
        value=filters.get(key)
        if value:
            if not re.fullmatch(pattern,str(value)):raise ValueError('Mes o anio invalido')
            clauses.append(expression+'=?');values.append(str(value))
    start=filters.get('date_from');end=filters.get('date_to')
    for value,operator in [(start,'>='),(end,'<=')]:
        if value:
            if date.fromisoformat(value).isoformat()!=value:raise ValueError('Fecha invalida')
            clauses.append('m.purchase_date'+operator+'?');values.append(value)
    if start and end and start>end:raise ValueError('La fecha inicial no puede ser posterior a la final')
    if filters.get('batch'):
        clauses.append('(m.batch_id=? OR EXISTS(SELECT 1 FROM observations o WHERE o.movement_id=m.id AND o.batch_id=?))')
        values.extend([filters['batch'],filters['batch']])
    for key,col in [('period','period'),('state','state'),('kind','kind'),('category','category')]:
        value='pendiente' if key=='state' and pending else filters.get(key)
        if value:
            clauses.append(f'm.{col}=?');values.append(value)
    if filters.get('q'):
        clauses.append('(m.normalized_description LIKE ? OR m.category LIKE ?)')
        values.extend(['%'+g.norm(filters['q'])+'%','%'+filters['q']+'%'])
    return (' WHERE '+' AND '.join(clauses) if clauses else ''),values


def plan(db,filters):
    clause,args=where(filters,pending=True)
    rows=[dict(r) for r in db.execute('SELECT m.* FROM movements m'+clause+' ORDER BY id',args)]
    eligible=[];skipped=[]
    for r in rows:
        if repartos.people(db):r['allocations']=repartos.get(db,r['id'])
        reasons=[]
        if r['kind']=='pago_tarjeta':reasons.append('Pago de tarjeta')
        if not (r['category'] or '').strip():reasons.append('Sin categoria')
        if r['mi'] is None or r['amor'] is None:reasons.append('Reparto incompleto')
        elif not r['special_case'] and r['mi']+r['amor']!=r['amount']:reasons.append('Reparto no coincide con monto')
        if reasons:skipped.append({'id':r['id'],'reasons':reasons})
        else:eligible.append(r)
    expenses=[r for r in rows if r['kind'] in ('gasto','devolucion')]
    return dict(token=hashlib.sha256(json.dumps(rows,sort_keys=True).encode()).hexdigest(),
                selected=len(rows),eligible=len(eligible),skipped=skipped,
                mi=g.decimal(sum(r['mi'] or 0 for r in expenses)),
                amor=g.decimal(sum(r['amor'] or 0 for r in expenses)),
                allocations=repartos.totals(db,expenses),
                incomplete=sum(r['mi'] is None or r['amor'] is None for r in expenses),
                unbalanced=sum(not r['special_case'] and r['mi'] is not None and r['amor'] is not None and r['mi']+r['amor']!=r['amount'] for r in expenses)),eligible


def confirm(db,filters,token):
    # One transaction also protects against simultaneous CLI edits.
    db.execute('BEGIN IMMEDIATE')
    try:
        info,rows=plan(db,filters)
        if info['token']!=token:raise ValueError('Los pendientes cambiaron. Vuelva a preparar la confirmacion.')
        stamp=g.now()
        for before in rows:
            after={**before,'state':'aceptado','duplicate_of':None}
            db.execute("UPDATE movements SET state='aceptado',duplicate_of=NULL WHERE id=?",(before['id'],))
            db.execute('UPDATE issues SET resolved=1 WHERE movement_id=?',(before['id'],))
            g.insert(db,'decisions',dict(movement_id=before['id'],created_at=stamp,action='aceptar',before_json=json.dumps(before,ensure_ascii=False),after_json=json.dumps(after,ensure_ascii=False),note='Confirmacion masiva de pendientes filtrados; se conservan como compras independientes.'))
        db.commit()
        return dict(confirmed=len(rows),skipped=info['skipped'])
    except Exception:
        db.rollback();raise
