import json
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

import gestor as g
import hogares
import repartos
import cortes
import estadisticas
import servidor
from test_revision_masiva import seed


class HouseholdTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.path=Path(self.temp.name)/'test.sqlite3'
        self.db=g.connect(self.path)
        seed(self.db,2)
        self.directory=hogares.Directory(self.path,'Hogar de prueba','Direccion ficticia')
        self.raw=self.directory.authenticate(dict(name='Ana',email='ana@example.test',password='Una clave ficticia 123'),True)
        self.account=self.directory.session(self.raw)['account_id']
        self.home=self.directory.overview(self.account)['homes'][0]['id']
        self.sync()

    def sync(self):
        repartos.sync(self.db,self.directory.members(self.home))
        self.people=repartos.people(self.db)
        self.ids=[p['id'] for p in self.people]

    def tearDown(self):
        self.db.close();self.temp.cleanup()

    def register(self,email='otra@example.test'):
        raw=self.directory.authenticate(dict(name='Otra',email=email,password='Otra clave ficticia 123'),True)
        return raw,self.directory.session(raw)['account_id']

    def third(self):
        self.directory.manage(self.account,self.home,dict(action='add_person',name='Tercera'))
        self.sync()

    def test_optional_contact_email_create_edit_and_clear(self):
        self.directory.manage(self.account,self.home,dict(action='add_person',name='Contacto',contact_email='  persona@example.test  '))
        person=self.directory.details(self.account,self.home)['people'][-1]
        self.assertEqual(person['contact_email'],'persona@example.test')
        self.assertFalse(person['linked'])
        data=dict(action='edit_person',person_id=person['id'],name='Contacto actualizado')
        self.directory.manage(self.account,self.home,data)
        self.assertEqual(self.directory.members(self.home)[-1]['contact_email'],'persona@example.test')
        self.directory.manage(self.account,self.home,{**data,'contact_email':'otro@example.test'})
        self.assertEqual(self.directory.members(self.home)[-1]['contact_email'],'otro@example.test')
        self.directory.manage(self.account,self.home,{**data,'contact_email':''})
        self.assertEqual(self.directory.members(self.home)[-1]['contact_email'],'')
        self.directory.manage(self.account,self.home,dict(action='edit_person',person_id=self.ids[0],name='Ana',contact_email='contacto@example.test'))
        self.assertEqual(self.directory.overview(self.account)['user']['email'],'ana@example.test')

    def test_contact_email_validation_and_permissions(self):
        before=self.directory.members(self.home)
        for invalid in ['sin-arroba','a@','a b@example.test','a@example.test\nb@example.test',42,None,'a'*250+'@example.test']:
            with self.subTest(value=invalid),self.assertRaises(ValueError):
                self.directory.manage(self.account,self.home,dict(action='add_person',name='Invalida',contact_email=invalid))
        self.assertEqual(before,self.directory.members(self.home))
        _,other=self.register()
        with self.assertRaises(hogares.AccessError):
            self.directory.manage(other,self.home,dict(action='edit_person',person_id=self.ids[0],name='Ana',contact_email='otro@example.test'))

    def test_contact_email_migration_preserves_existing_people(self):
        with closing(self.directory.connect()) as db,db:
            db.execute('ALTER TABLE people DROP COLUMN contact_email')
            before=[tuple(r) for r in db.execute('SELECT id,name,surname,alias,account_id FROM people ORDER BY id')]
        migrated=hogares.Directory(self.path)
        with closing(migrated.connect()) as db:
            self.assertEqual(before,[tuple(r) for r in db.execute('SELECT id,name,surname,alias,account_id FROM people ORDER BY id')])
            self.assertTrue(all(r[0]=='' for r in db.execute('SELECT contact_email FROM people')))
        hogares.Directory(self.path)
        self.assertIsNotNone(migrated.session(self.raw))

    def test_password_session_and_last_admin(self):
        with closing(self.directory.connect()) as db:
            row=db.execute('SELECT * FROM accounts').fetchone()
            self.assertNotEqual(row['password_hash'],'Una clave ficticia 123')
            self.assertNotIn(self.raw,[r[0] for r in db.execute('SELECT digest FROM sessions')])
        with self.assertRaises(hogares.AccessError):
            self.directory.authenticate(dict(email='ana@example.test',password='incorrecta pero larga'))
        with self.assertRaises(ValueError):
            self.directory.manage(self.account,self.home,dict(action='membership',person_id=self.ids[0],active=False))
        self.assertTrue(self.directory.authorize(self.account,self.home)['admin'])
        self.directory.logout(self.directory.session(self.raw))
        self.assertIsNone(self.directory.session(self.raw))

    def test_archive_and_restore_all_homes_preserves_data(self):
        before=[tuple(r) for r in self.db.execute('SELECT * FROM movements ORDER BY id')]
        members=self.directory.members(self.home)
        self.directory.manage(self.account,self.home,dict(action='archive_home'))
        self.directory.manage(self.account,self.home,dict(action='archive_home'))
        overview=self.directory.overview(self.account)
        self.assertEqual(overview['homes'],[])
        self.assertEqual(len(overview['home_history']),1)
        self.assertTrue(overview['home_history'][0]['archived_at'])
        with self.assertRaises(hogares.AccessError):self.directory.authorize(self.account,self.home)
        self.directory.manage(self.account,None,dict(action='restore_home',home_id=self.home))
        self.assertEqual(self.directory.overview(self.account)['homes'][0]['id'],self.home)
        self.assertEqual(members,self.directory.members(self.home))
        self.assertEqual(before,[tuple(r) for r in self.db.execute('SELECT * FROM movements ORDER BY id')])

    def test_archiving_is_personal_and_does_not_restore_removed_membership(self):
        _,account=self.register()
        self.directory.manage(account,None,dict(action='claim',person_id=self.ids[1]))
        claim=self.directory.details(self.account,self.home)['claims'][0]
        self.directory.manage(self.account,self.home,dict(action='approve',claim_id=claim['id']))
        self.directory.manage(account,None,dict(action='archive_home',home_id=self.home))
        self.assertTrue(self.directory.authorize(self.account,self.home)['admin'])
        self.directory.manage(self.account,self.home,dict(action='membership',person_id=self.ids[1],active=False))
        with self.assertRaises(hogares.AccessError):
            self.directory.manage(account,None,dict(action='restore_home',home_id=self.home))
        self.assertEqual(self.directory.overview(account)['home_history'],[])

    def test_creation_retries_and_duplicate_names_addresses(self):
        data=dict(action='create',name='Casa',address='Calle ficticia 123',request_id='same-request')
        first=self.directory.manage(self.account,None,data)
        again=self.directory.manage(self.account,None,data)
        self.assertEqual(first['id'],again['id'])
        self.assertTrue(again['reused'])
        self.assertEqual(len(list(self.directory.folder.glob('*/cuentas.sqlite3'))),1)
        with self.assertRaises(ValueError):
            self.directory.manage(self.account,None,dict(data,address='Otra direccion'))
        for key in ('next-request',None):
            with self.assertRaises(ValueError):
                self.directory.manage(self.account,None,dict(data,name=' CASA ',address='calle  ficticia 123',request_id=key))
        self.directory.manage(self.account,None,dict(action='archive_home',home_id=first['id']))
        with self.assertRaises(ValueError):
            self.directory.manage(self.account,None,dict(data,request_id='after-archive'))
        different=self.directory.manage(self.account,None,dict(data,address='Calle distinta',request_id='different'))
        self.assertNotEqual(first['id'],different['id'])

    def test_concurrent_creation_is_idempotent(self):
        from concurrent.futures import ThreadPoolExecutor
        data=dict(action='create',name='Casa',address='Direccion de prueba',request_id='parallel')
        with ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(lambda _:self.directory.manage(self.account,None,data),range(2)))
        self.assertEqual(results[0]['id'],results[1]['id'])
        self.assertEqual(len(self.directory.overview(self.account)['homes']),2)

    def test_claim_requires_approval_and_removal_revokes_access(self):
        raw,account=self.register()
        self.assertEqual(self.directory.overview(account)['homes'],[])
        self.directory.manage(account,None,dict(action='claim',person_id=self.ids[1]))
        with self.assertRaises(hogares.AccessError):self.directory.authorize(account,self.home)
        claim=self.directory.details(self.account,self.home)['claims'][0]
        with self.assertRaises(hogares.AccessError):
            self.directory.manage(account,self.home,dict(action='approve',claim_id=claim['id']))
        self.directory.manage(self.account,self.home,dict(action='approve',claim_id=claim['id']))
        self.assertFalse(self.directory.authorize(account,self.home)['admin'])
        with self.assertRaises(hogares.AccessError):
            self.directory.manage(account,self.home,dict(action='add_person',name='Intruso'))
        self.directory.manage(self.account,self.home,dict(action='membership',person_id=self.ids[1],active=False))
        with self.assertRaises(hogares.AccessError):self.directory.authorize(account,self.home)
        self.sync()
        self.assertEqual(repartos.get(self.db,1)[self.ids[1]],g.money(500))

    def test_same_account_can_link_different_ids_in_multiple_homes(self):
        other=self.directory.manage(self.account,None,dict(action='create',name='Segundo',address='Calle ficticia'))['id']
        self.directory.manage(self.account,other,dict(action='add_person',name='Misma persona'))
        target=self.directory.members(other)[1]['id']
        _,account=self.register()
        for home,pid in [(self.home,self.ids[1]),(other,target)]:
            self.directory.manage(account,None,dict(action='claim',person_id=pid))
            claim=self.directory.details(self.account,home)['claims'][0]
            self.directory.manage(self.account,home,dict(action='approve',claim_id=claim['id']))
        self.assertEqual(len(self.directory.overview(account)['homes']),2)
        self.assertEqual({p['id'] for p in self.directory.overview(account)['links']},{self.ids[1],target})
        path=self.directory.authorize(account,other)['ledger']
        with closing(g.connect(path)) as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM movements').fetchone()[0],0)
        _,outsider=self.register('tercera@example.test')
        with self.assertRaises(hogares.AccessError):self.directory.authorize(outsider,other)

    def test_migration_is_idempotent_and_cuts_preserved(self):
        before=[dict(r) for r in self.db.execute('SELECT * FROM movements')]
        self.sync();self.sync()
        self.assertEqual(before,[dict(r) for r in self.db.execute('SELECT * FROM movements')])
        self.assertEqual(repartos.get(self.db,1),{pid:g.money(500) for pid in self.ids})
        self.third()
        self.assertNotIn(self.ids[2],repartos.get(self.db,1))

    def test_legacy_saved_cut_is_migrated_without_charging_again(self):
        path=Path(self.temp.name)/'legacy.sqlite3'
        with closing(g.connect(path)) as db:
            seed(db,2)
            with db:db.execute("UPDATE movements SET state='aceptado'")
            filters=dict(start='2026-09-01',end='2026-09-30')
            plan=cortes.plan(db,filters)
            cid=cortes.save(db,dict(filters,token=plan['token']))['id']
            total_before=(plan['mi'],plan['amor'])
            repartos.sync(db,self.directory.members(self.home))
            migrated=cortes.detail(db,cid)
            self.assertEqual((migrated['mi'],migrated['amor']),total_before)
            self.assertEqual(migrated['allocations'],{pid:g.money(1000) for pid in self.ids})
            self.assertEqual(cortes.plan(db,filters)['count'],0)
            repartos.sync(db,self.directory.members(self.home))
            self.assertEqual(migrated,cortes.detail(db,cid))

    def test_three_people_exact_splits_stale_versions_and_cut_deltas(self):
        self.third()
        p,q,r=self.ids
        g.review(self.db,1,'aceptar',allocations={p:'500',q:'300',r:'200'})
        row=self.db.execute('SELECT * FROM movements WHERE id=1').fetchone()
        old=servidor.movement(row,self.db)['version']
        filters=dict(start='2026-09-01',end='2026-09-30')
        plan=cortes.plan(self.db,filters)
        cid=cortes.save(self.db,dict(filters,token=plan['token']))['id']
        # First-person and total values remain equal; only two other people change.
        g.review(self.db,1,'editar',allocations={p:'500',q:'200',r:'300'})
        row=self.db.execute('SELECT * FROM movements WHERE id=1').fetchone()
        self.assertNotEqual(old,servidor.movement(row,self.db)['version'])
        delta=cortes.plan(self.db,filters)
        self.assertEqual(delta['adjustments'],1)
        self.assertEqual(delta['allocations'],{p:0,q:g.money(-100),r:g.money(100)})
        self.assertEqual(cortes.detail(self.db,cid)['rows'][0]['allocations'][r],g.money(200))
        self.assertEqual(estadisticas.monthly(self.db)['years']['2026'][8][r],300)
        self.directory.manage(self.account,self.home,dict(action='membership',person_id=r,active=False))
        self.sync()
        self.assertEqual(cortes.detail(self.db,cid)['rows'][0]['allocations'][r],g.money(200))
        with self.assertRaises(ValueError):g.review(self.db,2,'editar',allocations={p:'500',q:'200',r:'300'})
        self.assertEqual(repartos.get(self.db,2)[p],g.money(500))

    def test_unknown_people_and_unbalanced_amounts_fail_atomically(self):
        before=repartos.get(self.db,1)
        for values in ({'foreign':'1000'},{self.ids[0]:'999'},{}):
            with self.assertRaises(ValueError):g.review(self.db,1,'aceptar',allocations=values)
            self.assertEqual(repartos.get(self.db,1),before)
        with self.db:repartos.default(self.db,1,-1)
        self.assertEqual(sum(repartos.get(self.db,1).values()),-1)


if __name__=='__main__':unittest.main()
