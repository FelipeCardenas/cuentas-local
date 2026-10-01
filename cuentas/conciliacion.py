"""Audited consolidation; keep source rows and never alter an agreed cut."""
import json
import gestor as g


def link(db, source_id, target_id):
    source=db.execute('SELECT * FROM movements WHERE id=?',(source_id,)).fetchone()
    target=db.execute('SELECT * FROM movements WHERE id=?',(target_id,)).fetchone()
    if not source or not target or source_id==target_id or target['state']!='aceptado':
        raise ValueError('Destino de conciliacion invalido')
    if source['state']!='aceptado' or source['amount']!=target['amount'] or source['kind']!=target['kind']:
        raise ValueError('Movimiento incompatible')
    if db.execute("""SELECT 1 FROM cut_items i JOIN cuts c ON c.id=i.cut_id
        WHERE c.cancelled_at IS NULL AND i.movement_id IN (?,?)""",(source_id,target_id)).fetchone():
        raise ValueError('Requiere revisar el corte vigente antes de conciliar')
    affected=[source]+db.execute("SELECT * FROM movements WHERE duplicate_of=?",(source_id,)).fetchall()
    for row in affected:
        before=dict(row);after=dict(before,state='duplicado',duplicate_of=target_id)
        db.execute("UPDATE movements SET state='duplicado',duplicate_of=? WHERE id=?",(target_id,row['id']))
        db.execute('UPDATE issues SET resolved=1 WHERE movement_id=?',(row['id'],))
        g.insert(db,'decisions',dict(movement_id=row['id'],created_at=g.now(),action='conciliar_duplicado',
                 before_json=json.dumps(before),after_json=json.dumps(after),
                 note=f'Conciliacion historico/banco; registro vigente #{target_id}. Origen conservado.'))
