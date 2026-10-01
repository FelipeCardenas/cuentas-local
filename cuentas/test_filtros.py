import tempfile
import unittest
from pathlib import Path
import gestor as g
import revision_masiva as bulk
from test_revision_masiva import seed


class FilterTests(unittest.TestCase):
    def test_filtered_summary_all_pages_and_refunds(self):
        with tempfile.TemporaryDirectory() as folder:
            db=g.connect(Path(folder)/'test.db')
            try:
                seed(db,80)
                with db:
                    db.execute("UPDATE movements SET state='aceptado'")
                    db.execute("UPDATE movements SET period='2025-09' WHERE id>40")
                    db.execute("UPDATE movements SET kind='devolucion',amount=-1000000000,mi=-200000000,amor=-800000000 WHERE id=1")
                    db.execute("UPDATE movements SET state='duplicado',duplicate_of=3 WHERE id=2")
                s=g.summary(db,filters=dict(year='2026',month='09',page='2'))
                self.assertEqual(s['movimientos'],39)
                self.assertEqual(s['real_confirmado_clp'],'37000')
                self.assertEqual(s['mi_confirmado_clp'],'18800')
                self.assertEqual(s['amor_confirmado_clp'],'18200')
                empty=g.summary(db,filters=dict(year='2030'))
                self.assertEqual(empty['mi_confirmado_clp'],'0')
                pending=g.summary(db,filters=dict(state='pendiente'))
                self.assertEqual(pending['real_confirmado_clp'],'0')
            finally:db.close()

    def test_category_exact_and_bulk(self):
        with tempfile.TemporaryDirectory() as folder:
            db=g.connect(Path(folder)/'test.db')
            try:
                seed(db,4)
                g.review(db,1,'editar',category='Comida rapida')
                filters=dict(category='Comida',year='2026',month='09')
                info,rows=bulk.plan(db,filters)
                self.assertEqual([r['id'] for r in rows],[2,3,4])
                self.assertEqual(info['mi'],'1500')
                self.assertEqual(bulk.confirm(db,filters,info['token'])['confirmed'],3)
                self.assertEqual(db.execute('SELECT state FROM movements WHERE id=1').fetchone()[0],'pendiente')
                self.assertEqual(bulk.plan(db,dict(category="Comida' OR 1=1 --"))[0]['selected'],0)
            finally:db.close()

    def test_dates_period_and_bulk_scope(self):
        with tempfile.TemporaryDirectory() as folder:
            db=g.connect(Path(folder)/'test.db')
            try:
                seed(db,4)
                with db:
                    db.execute("UPDATE movements SET purchase_date='2026-09-12' WHERE id=2")
                    db.execute("UPDATE movements SET purchase_date='2026-09-13' WHERE id=3")
                    db.execute("UPDATE movements SET purchase_date='2025-05-01',period='2025-09',installment=1 WHERE id=4")
                self.assertEqual(bulk.plan(db,{'month':'09'})[0]['selected'],4)
                self.assertEqual(bulk.plan(db,{'year':'2025'})[0]['selected'],1)
                filters=dict(month='09',year='2026',date_from='2026-09-01',date_to='2026-09-12')
                info,rows=bulk.plan(db,filters)
                self.assertEqual([r['id'] for r in rows],[1,2])
                self.assertEqual(info['mi'],'1000')
                self.assertEqual(bulk.confirm(db,filters,info['token'])['confirmed'],2)
                for filters in [dict(month='13'),dict(year='x'),dict(date_from='2026-02-30'),dict(date_from='2026-09-12',date_to='2026-09-01')]:
                    with self.assertRaises(ValueError):bulk.plan(db,filters)
            finally:db.close()
