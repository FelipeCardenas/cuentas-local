import json
from contextlib import closing
from pathlib import Path
import sqlite3
import tempfile
import unittest

import gestor as g
import confirmar_historico as h


class HistoricalConfirmationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name)/'test.sqlite3'
        self.db = g.connect(self.path)
        self.batch = g.insert(self.db, 'batches', dict(kind='historico', fingerprint='test', name='test', imported_at=g.now()))

    def tearDown(self):
        self.db.close()
        self.tmp.cleanup()

    def add(self, key, period='2025-09', category=None, description='COMPRA JUMBO', state='pendiente', mi=50):
        mid = g.insert(self.db, 'movements', dict(batch_id=self.batch, source_key=key,
             purchase_date='2025-09-01', period=period, description=description,
             normalized_description=g.norm(description), kind='gasto', amount=100,
             mi=mi, amor=50, category=category, state=state))
        self.db.commit()
        return mid

    def test_scope_references_and_audit(self):
        ref = self.add('ref', period='2026-09', category='Supermercado', state='aceptado')
        old = self.add('old', description='compra JUMBO*')
        keep = self.add('keep', category='Personal')
        unknown = self.add('unknown', description='SIN REFERENCIA')
        new = self.add('new', period='2026-01')
        rows = h.plan(self.db)
        # Conflicting references must not guess a category.
        self.assertEqual(next(r for r in rows if r['before']['id']==old)['category'], 'Otros')
        self.assertEqual(next(r for r in rows if r['before']['id']==keep)['category'], 'Personal')
        self.assertEqual(len(rows), 3)
        before = dict(self.db.execute('SELECT * FROM movements WHERE id=?', (new,)).fetchone())
        backup = h.apply(self.db, self.path, h.digest(rows))
        self.assertEqual(dict(self.db.execute('SELECT * FROM movements WHERE id=?', (new,)).fetchone()), before)
        self.assertEqual(self.db.execute('SELECT count(*) FROM decisions').fetchone()[0], 3)
        self.assertEqual(h.plan(self.db), [])
        with closing(sqlite3.connect(backup)) as saved:
            self.assertEqual(saved.execute('SELECT state FROM movements WHERE id=?', (old,)).fetchone()[0], 'pendiente')

    def test_unambiguous_reference_and_special_case(self):
        self.add('ref', period='2026-08', category='Supermercado', state='aceptado')
        mid = self.add('old', mi=0)
        item = h.plan(self.db)[0]
        self.assertEqual(item['category'], 'Supermercado')
        self.assertFalse(item['eligible'])
        rows = h.plan(self.db, True)
        self.assertTrue(rows[0]['eligible'])
        h.apply(self.db, self.path, h.digest(rows), True)
        row = self.db.execute('SELECT * FROM movements WHERE id=?', (mid,)).fetchone()
        self.assertEqual((row['state'],row['special_case'],row['mi'],row['amor'],row['amount']), ('aceptado',1,0,50,100))

    def test_changed_preview_rejected(self):
        self.add('old')
        token = h.digest(h.plan(self.db))
        self.add('second')
        with self.assertRaises(ValueError):
            h.apply(self.db, self.path, token)
        self.assertEqual(self.db.execute('SELECT count(*) FROM decisions').fetchone()[0], 0)


if __name__ == '__main__':
    unittest.main()
