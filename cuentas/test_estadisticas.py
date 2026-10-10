import sqlite3
import unittest
from unittest.mock import patch

from estadisticas import monthly, weekly


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


class WeeklyStatisticsTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        self.db.execute('CREATE TABLE movements(id INTEGER PRIMARY KEY, purchase_date TEXT, period TEXT, state TEXT, kind TEXT, amount INTEGER, mi INTEGER, amor INTEGER)')

    def tearDown(self):
        self.db.close()

    def add(self, day, amount, state='aceptado', kind='gasto'):
        return self.db.execute('INSERT INTO movements(purchase_date,period,state,kind,amount,mi,amor) VALUES (?,?,?,?,?,?,?)',
                               (day, '2030-01', state, kind, amount*1000000, amount*250000, amount*750000)).lastrowid

    def test_calendar_boundaries_and_purchase_date_not_assigned_period(self):
        self.add('2026-09-30', 999)
        self.add('2026-10-01', 100)
        self.add('2026-10-04', 50)
        self.add('2026-10-05', 20)
        self.add('2026-10-31', 40)
        self.add('2026-11-01', 888)
        rows = weekly(self.db)['years']['2026']['10']
        self.assertEqual((rows[0]['start'],rows[0]['end']),('2026-10-01','2026-10-04'))
        self.assertEqual((rows[-1]['start'],rows[-1]['end']),('2026-10-26','2026-10-31'))
        self.assertEqual([r['total'] for r in rows],[150,20,0,0,40])
        self.assertEqual(sum(r['total'] for r in rows),210)
        self.assertEqual(rows[0]['mi'],37.5)

    def test_only_confirmed_expenses_and_signed_refunds(self):
        self.add('2026-10-06', 100)
        self.add('2026-10-07', -150, kind='devolucion')
        for state in ('pendiente','duplicado','excluido_gasto'):
            self.add('2026-10-06',999,state=state)
        for kind in ('pago_tarjeta','ingreso'):
            self.add('2026-10-06',999,kind=kind)
        row = weekly(self.db)['years']['2026']['10'][1]
        self.assertEqual((row['total'],row['count']),(-50,2))

    def test_leap_year_and_six_week_month(self):
        self.add('2024-02-29', 10)
        self.add('2026-03-31', 20)
        years = weekly(self.db)['years']
        self.assertEqual(years['2024']['02'][-1]['end'],'2024-02-29')
        self.assertEqual(len(years['2026']['03']),6)
        self.assertEqual(years['2026']['03'][0]['start'],'2026-03-01')

    def test_person_allocations_include_retired_members(self):
        mid = self.add('2026-10-01', 100)
        self.db.execute('CREATE TABLE allocations(movement_id INTEGER, person_id TEXT, amount INTEGER)')
        self.db.executemany('INSERT INTO allocations VALUES (?,?,?)',[(mid,'a',30000000),(mid,'b',70000000)])
        members = [dict(id='a',name='A',active=1),dict(id='b',name='B',active=0)]
        with patch('estadisticas.repartos.people',return_value=members):
            data = weekly(self.db)
        self.assertEqual(data['people'],members)
        self.assertEqual(data['years']['2026']['10'][0]['a'],30)
        self.assertEqual(data['years']['2026']['10'][0]['b'],70)

    def test_empty(self):
        self.assertEqual(weekly(self.db),dict(years={},people=[]))


if __name__ == '__main__':
    unittest.main()
