"""Canonical category catalog with durable aliases and audited reassignment."""
import json
import unicodedata
from datetime import datetime, timezone


def key(name):
    return ' '.join(''.join(c for c in unicodedata.normalize('NFKD', name)
                           if not unicodedata.combining(c)).casefold().split())


def clean(name):
    if not isinstance(name, str) or not name.strip() or len(name.strip()) > 100:
        raise ValueError('Indique una categoria de 1 a 100 caracteres')
    return ' '.join(name.split())


def ensure(db, name):
    if name is None or not name.strip():
        return None
    name = clean(name)
    row = db.execute('SELECT c.name FROM category_aliases a JOIN categories c ON c.id=a.category_id WHERE a.key=?', (key(name),)).fetchone()
    if row:
        return row[0]
    cid = db.execute('INSERT INTO categories(name) VALUES (?)', (name,)).lastrowid
    db.execute('INSERT INTO category_aliases VALUES (?,?)', (key(name), cid))
    return name


def reassign(db, old, new, action):
    for row in db.execute('SELECT * FROM movements WHERE category=?', (old,)).fetchall():
        before = dict(row)
        after = dict(before, category=new)
        db.execute('UPDATE movements SET category=? WHERE id=?', (new, row['id']))
        db.execute('INSERT INTO decisions(movement_id,created_at,action,before_json,after_json,note) VALUES (?,?,?,?,?,?)',
                   (row['id'], datetime.now(timezone.utc).isoformat(), action,
                    json.dumps(before), json.dumps(after), f'{old} -> {new}'))


def migrate(db):
    if db.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()[0] == '3':
        return
    with db:
        db.execute('CREATE TABLE categories(id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE)')
        db.execute('CREATE TABLE category_aliases(key TEXT PRIMARY KEY, category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE)')
        preferred = {'comida rapida': 'Comida r\u00e1pida', 'automovil': 'Autom\u00f3vil',
                     'automivil': 'Autom\u00f3vil', 'servicio': 'Servicios', 'servicios': 'Servicios'}
        names = [r[0] for r in db.execute('SELECT DISTINCT category FROM movements WHERE category IS NOT NULL ORDER BY category')]
        for name in names:
            target = ensure(db, preferred.get(key(name), name.strip()))
            if target:
                cid = db.execute('SELECT id FROM categories WHERE name=?', (target,)).fetchone()[0]
                db.execute('INSERT OR IGNORE INTO category_aliases VALUES (?,?)', (key(name), cid))
            if name != target:
                reassign(db, name, target, 'estandarizar_categoria')
        # Restrict category removal, never cascade to financial movements.
        db.execute('''CREATE TRIGGER category_delete_guard BEFORE DELETE ON categories
            WHEN EXISTS(SELECT 1 FROM movements WHERE category=OLD.name)
            BEGIN SELECT RAISE(ABORT,'Categoria con movimientos: reasigne antes de eliminar'); END''')
        for event in ('INSERT', 'UPDATE OF category'):
            suffix = 'insert' if event == 'INSERT' else 'update'
            db.execute(f'''CREATE TRIGGER category_{suffix}_guard BEFORE {event} ON movements
                WHEN NEW.category IS NOT NULL AND NOT EXISTS(SELECT 1 FROM categories WHERE name=NEW.category)
                BEGIN SELECT RAISE(ABORT,'Categoria inexistente en el maestro'); END''')
        db.execute("UPDATE meta SET value='3' WHERE key='schema_version'")


def catalog(db):
    return [dict(r) for r in db.execute('''SELECT c.id,c.name,COUNT(m.id) count
        FROM categories c LEFT JOIN movements m ON m.category=c.name GROUP BY c.id ORDER BY c.name COLLATE NOCASE''')]


def change(db, data):
    with db:
        db.execute('BEGIN IMMEDIATE')
        action = data.get('action')
        if action == 'add':
            name = clean(data.get('name'))
            if db.execute('SELECT 1 FROM category_aliases WHERE key=?', (key(name),)).fetchone():
                raise ValueError('La categoria o una variante ya existe')
            ensure(db, name)
        else:
            source = db.execute('SELECT * FROM categories WHERE id=?', (data.get('id'),)).fetchone()
            if not source or source['name'] != data.get('original'):
                raise ValueError('La categoria cambio. Actualice el maestro')
            if action == 'rename':
                name = clean(data.get('name'))
                alias = db.execute('SELECT category_id FROM category_aliases WHERE key=?', (key(name),)).fetchone()
                if alias and alias[0] != source['id']:
                    raise ValueError('Ese nombre ya pertenece a otra categoria. Use Fusionar')
                db.execute('UPDATE categories SET name=? WHERE id=?', (name, source['id']))
                reassign(db, source['name'], name, 'renombrar_categoria')
                db.execute('INSERT OR IGNORE INTO category_aliases VALUES (?,?)', (key(name), source['id']))
            elif action == 'merge':
                target = db.execute('SELECT * FROM categories WHERE id=?', (data.get('target'),)).fetchone()
                if not target or target['id'] == source['id']:
                    raise ValueError('Seleccione otra categoria de destino')
                reassign(db, source['name'], target['name'], 'fusionar_categoria')
                db.execute('UPDATE category_aliases SET category_id=? WHERE category_id=?', (target['id'], source['id']))
                db.execute('DELETE FROM categories WHERE id=?', (source['id'],))
            elif action == 'delete':
                db.execute('DELETE FROM categories WHERE id=?', (source['id'],))
            else:
                raise ValueError('Accion no valida')
    return {'ok': True}
