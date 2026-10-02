"""Exact per-person allocations; legacy two-column totals are compatibility caches."""
import json
import gestor as g


def migrate(db):
    db.executescript('''
      CREATE TABLE IF NOT EXISTS household_people(
        id TEXT PRIMARY KEY, name TEXT NOT NULL, active INTEGER NOT NULL,
        position INTEGER NOT NULL UNIQUE);
      CREATE TABLE IF NOT EXISTS allocations(
        movement_id INTEGER NOT NULL REFERENCES movements(id),
        person_id TEXT NOT NULL REFERENCES household_people(id), amount INTEGER,
        PRIMARY KEY(movement_id,person_id));
    ''')


def people(db):
    if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='household_people'").fetchone():
        return []
    return [dict(r) for r in db.execute('SELECT * FROM household_people ORDER BY position')]


def sync(db, members):
    with db:
        first=not db.execute('SELECT 1 FROM household_people').fetchone()
        for p in members:
            name=p['alias'] or ' '.join(x for x in (p['name'],p['surname']) if x)
            db.execute('''INSERT INTO household_people VALUES(?,?,?,?) ON CONFLICT(id)
                DO UPDATE SET name=excluded.name,active=excluded.active''', (p['id'],name,p['active'],p['position']))
        if first and members:
            ids=[p['id'] for p in members]
            for r in db.execute('SELECT id,mi,amor FROM movements').fetchall():
                for index, pid in enumerate(ids[:2]):
                    db.execute('INSERT INTO allocations VALUES(?,?,?)',(r['id'],pid,r['mi' if index==0 else 'amor']))
            # Preserve the agreed distributions, not today's edited movements.
            for r in db.execute('SELECT cut_id,movement_id,snapshot FROM cut_items').fetchall():
                snapshot=json.loads(r['snapshot'])
                snapshot['allocations']={pid:snapshot['mi' if i==0 else 'amor'] for i,pid in enumerate(ids[:2])}
                snapshot['people']={p['id']:p['alias'] or p['name'] for p in members[:2]}
                db.execute('UPDATE cut_items SET snapshot=? WHERE cut_id=? AND movement_id=?',
                           (json.dumps(snapshot,ensure_ascii=False),r['cut_id'],r['movement_id']))


def get(db, mid):
    if not people(db):return {}
    return {r['person_id']:r['amount'] for r in db.execute('SELECT * FROM allocations WHERE movement_id=? ORDER BY person_id',(mid,))}


def public(values):
    return {pid:g.decimal(value) for pid,value in values.items()}


def totals(db, rows):
    result={p['id']:0 for p in people(db)}
    for r in rows:
        for pid,value in get(db,r['id']).items():
            result[pid]=result.get(pid,0)+(value or 0)
    return public(result)


def write(db, mid, values):
    db.execute('DELETE FROM allocations WHERE movement_id=?',(mid,))
    db.executemany('INSERT INTO allocations VALUES(?,?,?)',[(mid,pid,value) for pid,value in values.items()])


def default(db, mid, amount):
    members=[p for p in people(db) if p['active']]
    if not members:return
    part,remainder=divmod(amount,len(members))
    values={p['id']:part+(index<remainder) for index,p in enumerate(members)}
    write(db,mid,values)
    a,b=compatibility(db,values)
    db.execute('UPDATE movements SET mi=?,amor=? WHERE id=?',(a,b,mid))


def compatibility(db, values):
    first=people(db)[0]['id']
    return values.get(first,0),sum(v or 0 for p,v in values.items() if p!=first)


def validate(db, mid, raw, amount, special):
    if not isinstance(raw,dict) or len(raw)>500:raise ValueError('Reparto por persona invalido')
    catalog={p['id']:p for p in people(db)}
    before=get(db,mid)
    values={}
    for pid,value in raw.items():
        if pid not in catalog:raise ValueError('La persona no pertenece a este hogar')
        n=g.money(value,optional=True)
        if n is None:raise ValueError('Complete todos los importes del reparto')
        if not catalog[pid]['active'] and n and not (before.get(pid) or 0):
            raise ValueError('No se pueden asignar gastos nuevos a integrantes retirados')
        values[pid]=n
    if not values:raise ValueError('Seleccione al menos una persona')
    if not special and sum(values.values())!=amount:
        raise ValueError('La suma de los repartos debe coincidir exactamente con el importe')
    return values
