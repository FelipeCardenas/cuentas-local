"""One-to-one overlap matching against previous bank exports."""
from collections import defaultdict
import json
import re
from difflib import SequenceMatcher
import gestor as g


def signature(r):
    return tuple(r[k] for k in ('purchase_date','normalized_description','amount','purchase_amount',
                               'period','kind','installment'))+(str(r['holder'] or '').strip().casefold(),)


def similar_name(a, b, threshold=.9):
    def clean(value):
        return re.sub(r'^compra\s+', '', g.norm(value)).strip()
    a, b = clean(a), clean(b)
    # Short generic labels are not sufficient evidence for automatic matching.
    return a == b or (min(len(a),len(b)) >= 10 and
                     min(SequenceMatcher(None,a,b,autojunk=False).ratio(),
                         SequenceMatcher(None,b,a,autojunk=False).ratio()) >= threshold)


def compatible(a, b):
    return a[:1]+a[2:] == b[:1]+b[2:] and similar_name(a[1], b[1])


def recognized(db, rows, before_batch=None):
    incoming=defaultdict(list)
    for index,row in enumerate(rows):incoming[signature(row)].append(index)
    result={}
    batches=db.execute("SELECT id FROM batches WHERE kind='banco' AND (? IS NULL OR id<?) ORDER BY id DESC",
                       (before_batch,before_batch)).fetchall()
    unresolved=set(incoming)
    for batch in batches:
        groups=defaultdict(list)
        for row in db.execute("""SELECT m.*,o.raw_json,b.period AS source_period FROM observations o JOIN movements m ON m.id=o.movement_id JOIN batches b ON b.id=o.batch_id
            WHERE o.batch_id=? ORDER BY o.id""",(batch[0],)):
            raw=json.loads(row['raw_json'])
            identity=dict(row)
            if all(k in raw for k in ('fecha','descripcion','valor cuota','monto','cuotas pendientes','titular/adicional')):
                identity.update(purchase_date=g.day(raw['fecha']),normalized_description=g.norm(raw['descripcion']),
                                amount=g.money(raw['valor cuota']),purchase_amount=g.money(raw['monto']),
                                holder=raw['titular/adicional'])
                identity['kind']='pago_tarjeta' if identity['normalized_description']=='pago tarjeta cmr' else 'devolucion' if identity['amount']<0 else 'gasto'
                identity['installment']=int(identity['kind']=='gasto' and (int(raw['cuotas pendientes'])>0 or abs(identity['amount'])!=abs(identity['purchase_amount'])))
                identity['period']=row['source_period'] if identity['installment'] else identity['purchase_date'][:7]
            groups[signature(identity)].append(row)
        for key in list(unresolved):
            matches=groups.get(key)
            if not matches:
                possible=[old for old in groups if compatible(key,old)]
                if not possible:continue
                # Never fall back to an older batch when the latest evidence is ambiguous.
                unresolved.remove(key)
                if len(possible)!=1 or len(incoming[key])!=1:continue
                old=possible[0]
                if len(groups[old])!=1:continue
                if sum(compatible(other,old) for other in incoming)!=1:continue
                matches=groups[old]
            if not matches:continue
            # Changed multiplicity or differing allocations cannot be paired by row order.
            unresolved.discard(key)
            targets=[]
            for row in matches:
                if row['state']=='duplicado':
                    row=db.execute('SELECT * FROM movements WHERE id=?',(row['duplicate_of'],)).fetchone()
                targets.append(row)
            if len(matches)!=len(incoming[key]) or any(r is None for r in targets):continue
            if len({r['id'] for r in targets})!=len(targets):continue
            if any(r['id'] in result.values() for r in targets):continue
            allocations={(r['category'],r['mi'],r['amor'],r['special_case'],r['state']) for r in targets}
            if len(targets)>1 and len(allocations)>1:continue
            for index,row in zip(incoming[key],targets):result[index]=row['id']
    return result
