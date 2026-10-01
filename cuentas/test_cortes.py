import tempfile
import unittest
from pathlib import Path

import gestor as g
import cortes as c
from test_revision_masiva import seed


class CutTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.db=g.connect(Path(self.temp.name)/'test.db')
        seed(self.db,4)
        with self.db:self.db.execute("UPDATE movements SET state='aceptado'")
        self.filters=dict(start='2026-09-01',end='2026-09-12')

    def tearDown(self):
        self.db.close();self.temp.cleanup()

    def save(self, **changes):
        data={**self.filters,**changes}
        p=c.plan(self.db,data)
        return c.save(self.db,dict(data,token=p['token']))

    def test_preview_read_only_validation_excludes_only_selected(self):
        p=c.plan(self.db,self.filters)
        self.assertEqual(p['count'],4)
        self.assertEqual(c.history(self.db),[])
        self.save(excluded=[1])
        self.assertEqual([r['id'] for r in c.plan(self.db,self.filters)['rows']],[1])
        self.assertEqual(c.history(self.db)[0]['mi'],g.money(1500))

    def test_stale_changes_rejected_and_repeat_prevented(self):
        p=c.plan(self.db,self.filters)
        g.review(self.db,1,'editar',mi='400',amor='600')
        with self.assertRaises(ValueError):
            c.save(self.db,dict(self.filters,token=p['token']))
        self.assertEqual(c.history(self.db),[])
        p=c.plan(self.db,self.filters)
        c.save(self.db,dict(self.filters,token=p['token']))
        with self.assertRaises(ValueError):
            c.save(self.db,dict(self.filters,token=p['token']))

    def test_snapshots_and_delta_after_edit(self):
        cut=self.save()
        g.review(self.db,1,'editar',mi='400',amor='600')
        p=c.plan(self.db,dict(start='2026-10-01',end='2026-10-12'))
        self.assertEqual((p['mi'],p['amor'],p['adjustments']),(g.money(-100),g.money(100),1))
        self.assertEqual(c.detail(self.db,cut['id'])['mi'],g.money(2000))
        self.save()
        self.assertEqual(c.plan(self.db,self.filters)['count'],0)

    def test_late_same_day_rows_not_lost_and_old_pending(self):
        with self.db:self.db.execute("UPDATE movements SET state='pendiente' WHERE id=1")
        self.save()
        self.assertEqual(c.plan(self.db,self.filters)['pending'],1)
        g.review(self.db,1,'aceptar')
        self.assertEqual(c.plan(self.db,dict(start='2026-09-12',end='2026-09-20',include_older=True))['count'],1)

    def test_refund_payment_and_installment_month(self):
        with self.db:
            self.db.execute("UPDATE movements SET kind='devolucion',amount=-1000000000,mi=-500000000,amor=-500000000 WHERE id=1")
            self.db.execute("UPDATE movements SET kind='pago_tarjeta',state='excluido_gasto' WHERE id=2")
            self.db.execute("UPDATE movements SET installment=1,purchase_date='2026-05-01' WHERE id=3")
        p=c.plan(self.db,dict(start='2026-09-07',end='2026-09-12'))
        self.assertEqual([r['id'] for r in p['rows']],[3])
        p=c.plan(self.db,self.filters)
        self.assertEqual(p['mi'],g.money(500))

    def test_cancel_latest_and_revalidate(self):
        first=self.save(excluded=[1])
        second=self.save()
        with self.assertRaises(ValueError):c.cancel(self.db,first['id'])
        c.cancel(self.db,second['id'])
        self.assertEqual(c.plan(self.db,self.filters)['count'],1)
        self.save()
        self.assertEqual(c.plan(self.db,self.filters)['count'],0)

    def test_all_pages_and_batch_filter(self):
        with self.db:
            self.db.execute("UPDATE movements SET source_key='other:'||id")
            self.db.execute("UPDATE batches SET fingerprint='other'")
        seed(self.db,3000)
        with self.db:self.db.execute("UPDATE movements SET state='aceptado'")
        p=c.plan(self.db,dict(self.filters,batch='2'))
        self.assertEqual(p['count'],3000)
        self.save(batch='2')
        self.assertEqual(c.plan(self.db,self.filters)['count'],4)

    def test_invalid_date_range(self):
        with self.assertRaises(ValueError):
            c.plan(self.db,dict(start='2026-10-01',end='2026-09-01'))

    def test_anchor_uses_last_movement_not_query_end_and_skips_cancelled(self):
        with self.db:
            self.db.execute("UPDATE movements SET purchase_date='2026-09-17' WHERE id IN (1,2)")
            self.db.execute("UPDATE movements SET purchase_date='2026-09-18' WHERE id=3")
        first=self.save(end='2026-09-20',excluded=[3,4])
        self.assertEqual(c.defaults(self.db)['start'],'2026-09-17')
        p=c.plan(self.db,dict(c.defaults(self.db),automatic=True))
        self.assertEqual([r['id'] for r in p['rows']],[3])
        second=self.save(end='2026-09-20',excluded=[4])
        self.assertEqual(c.defaults(self.db)['start'],'2026-09-18')
        c.cancel(self.db,second['id'])
        self.assertEqual(c.defaults(self.db)['last_id'],first['id'])
        self.assertEqual(c.defaults(self.db)['start'],'2026-09-17')
