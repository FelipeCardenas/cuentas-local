"""Read-only monthly statistics over confirmed expenses."""
import re
import calendar
from datetime import date

import gestor as g
import repartos


def weekly(db):
    members = repartos.people(db)
    keys = ['total', 'mi', 'amor'] + [p['id'] for p in members]
    years = {}
    allocations = {}
    if members:
        for row in db.execute("""SELECT a.movement_id,a.person_id,a.amount FROM allocations a
                JOIN movements m ON m.id=a.movement_id
                WHERE m.state='aceptado' AND m.kind IN ('gasto','devolucion')"""):
            allocations.setdefault(row['movement_id'], {})[row['person_id']] = row['amount']
    for row in db.execute("""SELECT rowid AS id,purchase_date,amount,mi,amor FROM movements
            WHERE state='aceptado' AND kind IN ('gasto','devolucion') ORDER BY purchase_date"""):
        day = date.fromisoformat(row['purchase_date'])
        year, month = str(day.year), f'{day.month:02}'
        periods = years.setdefault(year, {})
        if month not in periods:
            periods[month] = [dict(start=days[0].isoformat(), end=days[-1].isoformat(),
                                  count=0, **{key: 0 for key in keys})
                             for week in calendar.Calendar().monthdatescalendar(day.year, day.month)
                             if (days := [d for d in week if d.month == day.month])]
        bucket = next(w for w in periods[month] if w['start'] <= day.isoformat() <= w['end'])
        bucket['count'] += 1
        for key in keys:
            value = row['amount'] if key == 'total' else row[key] if key in ('mi', 'amor') else allocations.get(row['id'], {}).get(key, 0)
            bucket[key] += value or 0
    for periods in years.values():
        for weeks in periods.values():
            for bucket in weeks:
                for key in keys:
                    bucket[key] = float(g.decimal(bucket[key]))
    return dict(years=years, people=members)


def explanation(db, query):
    current = g.period(query.get('current'))
    reference = g.period(query.get('reference'))
    if current[5:] != reference[5:] or current == reference:
        raise ValueError('Compare el mismo mes de dos anios distintos.')
    person = query.get('person', 'total')
    members=repartos.people(db)
    if person not in (['total']+[p['id'] for p in members] if members else ('total','mi','amor')):
        raise ValueError('Seleccione una persona del hogar.')
    column = 'amount' if person == 'total' else person if person in ('mi','amor') else 'person_amount'
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
        rows = db.execute("""SELECT rowid AS id,description,category,kind,amount,mi,amor FROM movements
            WHERE period=? AND state='aceptado' AND kind IN ('gasto','devolucion')""", (period,)).fetchall()
        missing = 0
        for row in rows:
            if column=='person_amount':
                row=dict(row,person_amount=repartos.get(db,row['id']).get(person,0))
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
    members=repartos.people(db)
    for year,months in years.items():
        for i,bucket in enumerate(months):
            if bucket is not None:
                for p in members:
                    total=db.execute('''SELECT COALESCE(SUM(a.amount),0) FROM allocations a JOIN movements m ON m.id=a.movement_id
                        WHERE a.person_id=? AND m.period=? AND m.state='aceptado' AND m.kind IN ('gasto','devolucion')''',
                        (p['id'],f'{year}-{i+1:02}')).fetchone()[0]
                    bucket[p['id']]=float(g.decimal(total))
    return {'years': years,**({'people':members} if members else {})}
