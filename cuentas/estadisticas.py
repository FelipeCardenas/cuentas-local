"""Read-only monthly statistics over confirmed expenses."""
import re

import gestor as g


def explanation(db, query):
    current = g.period(query.get('current'))
    reference = g.period(query.get('reference'))
    if current[5:] != reference[5:] or current == reference:
        raise ValueError('Compare el mismo mes de dos anios distintos.')
    person = query.get('person', 'total')
    if person not in ('total', 'mi', 'amor'):
        raise ValueError('Seleccione Total, Mi o Amor.')
    column = 'amount' if person == 'total' else person
    summaries = []
    grouped = {'categories': {}, 'merchants': {}}

    def empty():
        return dict(net=0, purchases=0, refunds=0, count=0, records=0)

    def accumulate(bucket, row):
        amount = row[column] or 0
        bucket['net'] += amount
        bucket['records'] += 1
        if row['kind'] == 'devolucion':
            bucket['refunds'] += amount
        else:
            bucket['purchases'] += amount
            # A purchase wholly assigned to the other person is not their purchase.
            bucket['count'] += int(person == 'total' or amount != 0)

    def public(bucket):
        return dict(**{k: float(g.decimal(bucket[k])) for k in ('net', 'purchases', 'refunds')},
                    count=bucket['count'], records=bucket['records'],
                    average=float(g.decimal(bucket['purchases']))/bucket['count'] if bucket['count'] else None)

    for side, period in enumerate((current, reference)):
        summary = empty()
        rows = db.execute("""SELECT description,category,kind,amount,mi,amor FROM movements
            WHERE period=? AND state='aceptado' AND kind IN ('gasto','devolucion')""", (period,)).fetchall()
        missing = 0
        for row in rows:
            missing += int(row[column] is None)
            accumulate(summary, row)
            merchant = re.sub(r'^compra\s+', '', g.norm(row['description'])) or 'Sin comercio'
            keys = {'categories': row['category'] or 'Sin categoria', 'merchants': merchant}
            for group, key in keys.items():
                pair = grouped[group].setdefault(key, [empty(), empty()])
                accumulate(pair[side], row)
        pending = db.execute("""SELECT COUNT(*) FROM movements WHERE period=?
            AND state='pendiente' AND kind IN ('gasto','devolucion')""", (period,)).fetchone()[0]
        summaries.append(dict(public(summary), period=period, pending=pending, missing_allocations=missing))
    comparable = all(s['records'] and not s['missing_allocations'] for s in summaries)
    groups = {}
    for name, items in grouped.items():
        groups[name] = [dict(name=key, current=public(pair[0]), reference=public(pair[1]),
                            delta=float(g.decimal(pair[0]['net']-pair[1]['net'])))
                        for key, pair in items.items()]
        groups[name].sort(key=lambda r: (-abs(r['delta']), r['name']))
    a, b = summaries
    delta = a['net']-b['net'] if comparable else None
    # Symmetric decomposition exactly attributes purchase change to count and average.
    effects = None
    if comparable and a['count'] and b['count']:
        effects = dict(count=(a['count']-b['count'])*(a['average']+b['average'])/2,
                       average=(a['average']-b['average'])*(a['count']+b['count'])/2,
                       refunds=a['refunds']-b['refunds'])
    return dict(current=a, reference=b, comparable=bool(comparable), delta=delta,
                percent=delta/abs(b['net'])*100 if comparable and b['net'] else None,
                effects=effects, **groups)


def monthly(db):
    years = {}
    for row in db.execute("""SELECT period, COUNT(*) count, SUM(amount) total,
            SUM(mi) mi, SUM(amor) amor FROM movements
            WHERE state='aceptado' AND kind IN ('gasto','devolucion')
            GROUP BY period ORDER BY period"""):
        if not re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])', row['period'] or ''):
            continue
        year, month = row['period'].split('-')
        months = years.setdefault(year, [None] * 12)
        months[int(month)-1] = dict(count=row['count'], **{
            key: float(g.decimal(row[key])) if row[key] is not None else None
            for key in ('total', 'mi', 'amor')})
    return {'years': years}
