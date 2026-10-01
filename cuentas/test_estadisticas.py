import sqlite3
import unittest

from estadisticas import monthly


class StatisticsTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        self.db.execute('CREATE TABLE movements(period TEXT, state TEXT, kind TEXT, amount INTEGER, mi INTEGER, amor INTEGER)')

    def tearDown(self):
        self.db.close()

    def add(self, period, amount, state='aceptado', kind='gasto'):
        self.db.execute('INSERT INTO movements VALUES (?,?,?,?,?,?)',
                        (period, state, kind, amount*1000000, amount*250000, amount*750000))

    def test_net_confirmed_only_and_allocations(self):
        self.add('2026-09', 100)
        self.add('2026-09', -20, kind='devolucion')
        for state in ('pendiente', 'duplicado', 'excluido_gasto'):
            self.add('2026-09', 999, state=state)
        self.add('2026-09', 999, kind='pago_tarjeta')
        self.add('2026-09', 999, kind='ingreso')
        row = monthly(self.db)['years']['2026'][8]
        self.assertEqual(row, {'count': 2, 'total': 80, 'mi': 20, 'amor': 60})

    def test_missing_month_is_not_zero(self):
        self.add('2025-01', 0)
        self.add('2026-08', 123)
        self.add('bad-period', 100)
        years = monthly(self.db)['years']
        self.assertEqual(set(years), {'2025', '2026'})
        self.assertEqual(years['2025'][0]['total'], 0)
        self.assertIsNone(years['2025'][1])
        self.assertEqual(years['2026'][7]['total'], 123)

    def test_empty(self):
        self.assertEqual(monthly(self.db), {'years': {}})


if __name__ == '__main__':
    unittest.main()
