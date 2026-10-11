import tempfile
import unittest
from pathlib import Path

import gestor as g
import revision_masiva as bulk


def seed(db,count=3000):
    with db:
        batch=g.insert(db,'batches',dict(kind='banco',fingerprint='test',name='Prueba masiva',period='2026-09',imported_at=g.now()))
        for i in range(count):
            g.insert(db,'movements',dict(batch_id=batch,source_key=f'test:{i}',purchase_date='2026-09-01',period='2026-09',description=f'Compra {i}',normalized_description=f'compra {i}',kind='gasto',amount=g.money(1000),category='Comida',mi=g.money(500),amor=g.money(500),state='pendiente'))


class BulkTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.db=g.connect(Path(self.temp.name)/'test.sqlite3');seed(self.db)
    def tearDown(self):
        self.db.close();self.temp.cleanup()

    def test_all_pages_and_edit_after_acceptance(self):
        info,_=bulk.plan(self.db,{'batch':'1','page':'1'})
        self.assertEqual(info['eligible'],3000)
        self.assertEqual(info['mi'],'1500000')
        result=bulk.confirm(self.db,{'batch':'1'},info['token'])
        self.assertEqual(result['confirmed'],3000)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM decisions').fetchone()[0],3000)
        g.review(self.db,1,'editar',category='Retail',mi='200',amor='800')
        r=self.db.execute('SELECT * FROM movements WHERE id=1').fetchone()
        self.assertEqual((r['state'],r['category'],r['amount'],r['mi']),('aceptado','Retail',g.money(1000),g.money(200)))
        self.assertEqual(bulk.plan(self.db,{})[0]['mi'],'0')

    def test_filters_negative_amounts_and_skipped_rows(self):
        with self.db:
            self.db.execute("UPDATE movements SET period='2026-08' WHERE id>4")
            self.db.execute('UPDATE movements SET category=NULL WHERE id=1')
            self.db.execute('UPDATE movements SET mi=NULL WHERE id=2')
            self.db.execute('UPDATE movements SET amor=0 WHERE id=3')
            self.db.execute("UPDATE movements SET kind='devolucion',amount=-1000000000,mi=-500000000,amor=-500000000 WHERE id=4")
        filters={'period':'2026-09'};info,_=bulk.plan(self.db,filters)
        self.assertEqual(info['selected'],4);self.assertEqual(info['eligible'],1)
        self.assertEqual(info['mi'],'500');self.assertEqual(info['amor'],'500')
        self.assertEqual(info['incomplete'],1);self.assertEqual(info['unbalanced'],1)
        self.assertEqual(bulk.confirm(self.db,filters,info['token'])['confirmed'],1)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM movements WHERE state='pendiente'").fetchone()[0],2999)

    def test_stale_preview_and_rollback(self):
        info,_=bulk.plan(self.db,{})
        g.review(self.db,1,'editar',category='Retail')
        with self.assertRaises(ValueError):bulk.confirm(self.db,{},info['token'])
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM movements WHERE state='aceptado'").fetchone()[0],0)
        info,_=bulk.plan(self.db,{})
        self.db.execute("CREATE TRIGGER fail_decision BEFORE INSERT ON decisions WHEN NEW.movement_id=10 BEGIN SELECT RAISE(ABORT,'test'); END")
        with self.assertRaises(Exception):bulk.confirm(self.db,{},info['token'])
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM movements WHERE state='aceptado'").fetchone()[0],0)

    def test_repeat_and_excluded_payments(self):
        with self.db:self.db.execute("UPDATE movements SET kind='pago_tarjeta',state='excluido_gasto' WHERE id=1")
        info,_=bulk.plan(self.db,{'q':'compra 1'})
        self.assertLess(info['selected'],3000)
        bulk.confirm(self.db,{'q':'compra 1'},info['token'])
        with self.assertRaises(ValueError):bulk.confirm(self.db,{'q':'compra 1'},info['token'])
        self.assertEqual(self.db.execute('SELECT state FROM movements WHERE id=1').fetchone()[0],'excluido_gasto')

    def test_discard_all_pages_uncategorized_and_restore(self):
        with self.db:
            self.db.execute("UPDATE movements SET category=NULL,mi=NULL,amor=NULL WHERE id=1")
            self.db.execute("UPDATE movements SET state='aceptado' WHERE id=2")
            self.db.execute("UPDATE movements SET state='duplicado',duplicate_of=2 WHERE id=3")
            self.db.execute("UPDATE movements SET kind='pago_tarjeta',state='excluido_gasto' WHERE id=4")
        filters={'batch':'1'}
        info,_=bulk.plan(self.db,filters,'descartar')
        self.assertEqual(info['eligible'],2997)
        result=bulk.confirm(self.db,filters,info['token'],'descartar')
        self.assertEqual(result['discarded'],2997)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM decisions WHERE action='descartar'").fetchone()[0],2997)
        self.assertEqual(self.db.execute('SELECT state FROM movements WHERE id=2').fetchone()[0],'aceptado')
        self.assertEqual(self.db.execute('SELECT state FROM movements WHERE id=3').fetchone()[0],'duplicado')
        g.review(self.db,1,'restaurar')
        row=self.db.execute('SELECT state,category,mi FROM movements WHERE id=1').fetchone()
        self.assertEqual(tuple(row),('pendiente',None,None))

    def test_discard_filters_stale_token_and_action_binding(self):
        filters={'q':'compra 0','batch':'1','year':'2026','month':'09'}
        info,_=bulk.plan(self.db,filters,'descartar')
        self.assertEqual(info['eligible'],1)
        with self.assertRaises(ValueError):bulk.confirm(self.db,{},info['token'],'descartar')
        with self.assertRaises(ValueError):bulk.confirm(self.db,filters,info['token'],'aceptar')
        g.review(self.db,1,'editar',category='Retail')
        with self.assertRaises(ValueError):bulk.confirm(self.db,filters,info['token'],'descartar')
        info,_=bulk.plan(self.db,filters,'descartar')
        bulk.confirm(self.db,filters,info['token'],'descartar')
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM movements WHERE state='pendiente'").fetchone()[0],2999)

    def test_discard_rollback_and_linked_copies(self):
        info,_=bulk.plan(self.db,{},'descartar')
        with self.db:self.db.execute('UPDATE movements SET duplicate_of=1 WHERE id=2')
        with self.assertRaises(ValueError):bulk.confirm(self.db,{},info['token'],'descartar')
        info,_=bulk.plan(self.db,{},'descartar')
        self.assertEqual(info['skipped'][0]['id'],1)
        self.db.execute("CREATE TRIGGER fail_discard BEFORE INSERT ON decisions WHEN NEW.movement_id=10 BEGIN SELECT RAISE(ABORT,'test'); END")
        with self.assertRaises(Exception):bulk.confirm(self.db,{},info['token'],'descartar')
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM movements WHERE state='excluido_gasto'").fetchone()[0],0)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM decisions').fetchone()[0],0)


if __name__=='__main__':unittest.main()
