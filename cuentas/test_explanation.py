import sqlite3
import unittest

import estadisticas as stats


class ExplanationTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        self.db.execute('CREATE TABLE movements(period TEXT,state TEXT,kind TEXT,amount INTEGER,mi INTEGER,amor INTEGER,category TEXT,description TEXT)')

    def tearDown(self):
        self.db.close()

    def add(self, year, amount, category='Comida', description='COMPRA CAFE*', kind='gasto', state='aceptado', mi=None):
        split = amount/2 if mi is None else mi
        self.db.execute('INSERT INTO movements VALUES (?,?,?,?,?,?,?,?)',
                        (f'{year}-09', state, kind, int(amount*1000000), int(split*1000000), int((amount-split)*1000000), category, description))

    def result(self, person='total'):
        return stats.explanation(self.db, dict(current='2026-09',reference='2025-09',person=person))

    def test_decomposition_and_group_reconciliation(self):
        self.add(2025,100)
        self.add(2025,100)
        self.add(2026,150,description='compra cafe')
        self.add(2026,150,category='Otros',description='COMPRA OTRO')
        self.add(2026,150)
        self.add(2026,-20,kind='devolucion')
        for state in ('pendiente','duplicado','excluido_gasto'):
            self.add(2026,999,state=state)
        self.add(2026,999,kind='pago_tarjeta')
        self.add(2026,999,kind='ingreso')
        r=self.result()
        self.assertEqual(r['delta'],230)
        self.assertEqual(r['current']['count'],3)
        self.assertEqual(r['current']['average'],150)
        self.assertEqual(r['current']['pending'],1)
        self.assertEqual(r['effects'],dict(count=125,average=125,refunds=-20))
        self.assertAlmostEqual(sum(r['effects'].values()),r['delta'])
        for key in ('categories','merchants'):
            self.assertAlmostEqual(sum(x['delta'] for x in r[key]),r['delta'])
        self.assertEqual(len(r['merchants']),2)
        self.assertEqual(self.result('mi')['delta'],115)

    def test_missing_period_and_zero_denominator(self):
        self.add(2026,100)
        self.assertFalse(self.result()['comparable'])
        self.assertIsNone(self.result()['delta'])
        self.add(2025,0)
        self.assertTrue(self.result()['comparable'])
        self.assertIsNone(self.result()['percent'])

    def test_person_counts_only_allocated_purchases_and_special_split(self):
        self.add(2025,100,mi=0)
        self.add(2026,100,mi=30)
        r=self.result('mi')
        self.assertEqual(r['reference']['count'],0)
        self.assertIsNone(r['reference']['average'])
        self.assertIsNone(r['effects'])
        self.db.execute("UPDATE movements SET amor=10000000 WHERE period='2026-09'")
        self.assertEqual(self.result('amor')['current']['net'],10)

    def test_incomplete_split_not_silently_compared(self):
        self.add(2025,100)
        self.add(2026,100)
        self.db.execute("UPDATE movements SET mi=NULL WHERE period='2026-09'")
        self.assertFalse(self.result('mi')['comparable'])

    def test_validation(self):
        for params in (dict(current='bad',reference='2025-09'),
                       dict(current='2026-09',reference='2025-08'),
                       dict(current='2026-09',reference='2026-09'),
                       dict(current='2026-09',reference='2025-09',person='invalid')):
            with self.assertRaises(ValueError):
                stats.explanation(self.db,params)


if __name__=='__main__':
    unittest.main()
