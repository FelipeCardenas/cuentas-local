import sqlite3
import tempfile
import unittest
from pathlib import Path

import categorias as c
import gestor as g
from test_revision_masiva import seed


class CategoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db = g.connect(Path(self.temp.name) / 'test.db')
        seed(self.db, 3)

    def tearDown(self):
        self.db.close()
        self.temp.cleanup()

    def change(self, action, **kwargs):
        row = c.catalog(self.db)[0]
        return c.change(self.db, dict(action=action, id=row['id'], original=row['name'], **kwargs))

    def test_rename_preserves_values_and_alias(self):
        before = [tuple(r) for r in self.db.execute('SELECT id,amount,mi,amor,state FROM movements')]
        self.change('rename', name='Alimentos')
        self.assertEqual(c.ensure(self.db, ' COMIDA '), 'Alimentos')
        self.assertEqual(before, [tuple(r) for r in self.db.execute('SELECT id,amount,mi,amor,state FROM movements')])
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM decisions').fetchone()[0], 3)

    def test_protected_delete_merge_and_future_import(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.change('delete')
        c.change(self.db, dict(action='add', name='Otros'))
        target = next(r for r in c.catalog(self.db) if r['name'] == 'Otros')
        self.change('merge', target=target['id'])
        self.assertEqual(c.ensure(self.db, 'comida'), 'Otros')
        self.assertEqual(c.catalog(self.db)[0]['count'], 3)
        self.assertEqual(len(c.catalog(self.db)), 1)

    def test_duplicate_name_and_empty_delete(self):
        with self.assertRaises(ValueError):
            c.change(self.db, dict(action='add', name=' Cómida '))
        c.change(self.db, dict(action='add', name='Libre'))
        row = next(r for r in c.catalog(self.db) if r['name'] == 'Libre')
        c.change(self.db, dict(action='delete', id=row['id'], original=row['name']))
        self.assertEqual(len(c.catalog(self.db)), 1)

    def test_migration_and_repeated_connect(self):
        with self.db:
            for suffix in ('insert', 'update'):
                self.db.execute('DROP TRIGGER category_'+suffix+'_guard')
            self.db.execute('DROP TRIGGER category_delete_guard')
            self.db.execute('DROP TABLE category_aliases')
            self.db.execute('DROP TABLE categories')
            self.db.execute("UPDATE movements SET category=CASE id WHEN 1 THEN 'Servicio' WHEN 2 THEN 'Servicios' ELSE ' servicios ' END")
            self.db.execute("UPDATE meta SET value='2' WHERE key='schema_version'")
        c.migrate(self.db)
        c.migrate(self.db)
        self.assertEqual(c.catalog(self.db), [dict(id=1, name='Servicios', count=3)])
        self.assertEqual(c.ensure(self.db, 'Servicio'), 'Servicios')
