import tempfile
import unittest
from contextlib import closing
from pathlib import Path

import hogares


class AccountTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.directory = hogares.Directory(Path(self.temp.name) / 'test.sqlite3')
        self.credentials = dict(name='Ana', email='ana@example.test', password='Una clave ficticia 123')
        self.raw = self.directory.authenticate(self.credentials, True)
        self.session = self.directory.session(self.raw)
        self.id = self.session['account_id']
        self.home = self.directory.overview(self.id)['homes'][0]['id']

    def tearDown(self):
        self.temp.cleanup()

    def update(self, **data):
        return self.directory.update_account(self.session, data)

    def test_profile_only_changes_session_owner(self):
        members = self.directory.members(self.home)
        self.update(action='profile', name='Ana nueva', account_id='otra')
        self.assertEqual(self.directory.session(self.raw)['name'], 'Ana nueva')
        self.assertEqual(members, self.directory.members(self.home))
        with self.assertRaises(ValueError):self.update(action='profile', name=' ')

    def test_password_rotation_revokes_every_session(self):
        second = self.directory.authenticate(self.credentials)
        with closing(self.directory.connect()) as db:
            old_salt = db.execute('SELECT salt FROM accounts').fetchone()[0]
        data = dict(action='password', current_password=self.credentials['password'], new_password='Nueva clave ficticia 456', confirmation='Nueva clave ficticia 456')
        with self.assertRaises(ValueError):self.update(**{**data, 'confirmation':'otra'})
        with self.assertRaises(ValueError):self.update(**{**data, 'new_password':'corta', 'confirmation':'corta'})
        with self.assertRaises(hogares.AccessError):self.update(**{**data, 'current_password':'Clave incorrecta 123'})
        self.assertIsNotNone(self.directory.session(second))
        self.assertTrue(self.update(**data)['signed_out'])
        self.assertIsNone(self.directory.session(self.raw))
        self.assertIsNone(self.directory.session(second))
        with self.assertRaises(hogares.AccessError):self.update(action='profile', name='Sesion vencida')
        with self.assertRaises(hogares.AccessError):self.directory.authenticate(self.credentials)
        self.assertIsNotNone(self.directory.session(self.directory.authenticate({**self.credentials, 'password':data['new_password']})))
        with closing(self.directory.connect()) as db:
            self.assertNotEqual(old_salt, db.execute('SELECT salt FROM accounts').fetchone()[0])

    def test_last_administrator_including_archived_is_protected(self):
        self.directory.manage(self.id, self.home, dict(action='archive_home'))
        with self.assertRaisesRegex(ValueError, 'otro administrador'):
            self.update(action='delete', current_password=self.credentials['password'], confirmation='ELIMINAR')
        self.assertIsNotNone(self.directory.session(self.raw))

    def test_delete_preserves_people_and_rejects_reactivation(self):
        credentials=dict(name='Bea', email='bea@example.test', password='Otra clave ficticia 123')
        raw=self.directory.authenticate(credentials, True)
        other=self.directory.session(raw)['account_id']
        person=self.directory.members(self.home)[1]['id']
        self.directory.manage(other,None,dict(action='claim',person_id=person))
        claim=self.directory.details(self.id,self.home)['claims'][0]['id']
        self.directory.manage(self.id,self.home,dict(action='approve',claim_id=claim))
        self.directory.manage(self.id,self.home,dict(action='membership',person_id=person,role='admin'))
        people=self.directory.members(self.home)
        self.update(action='delete',current_password=self.credentials['password'],confirmation='ELIMINAR')
        self.assertIsNone(self.directory.session(self.raw))
        self.assertTrue(self.directory.authorize(other,self.home)['admin'])
        after=self.directory.members(self.home)
        self.assertEqual([p['id'] for p in people],[p['id'] for p in after])
        self.assertEqual(after[0]['active'],0)
        with self.assertRaises(hogares.AccessError):self.directory.authenticate(self.credentials)
        with self.assertRaises(ValueError):self.directory.authenticate(self.credentials,True)
        with self.assertRaises(hogares.AccessError):self.directory.manage(self.id,None,dict(action='create',name='No',address='No'))
        with self.assertRaises(ValueError):self.directory.manage(other,self.home,dict(action='membership',person_id=after[0]['id'],active=True))

    def test_no_home_account_can_delete_without_affecting_owner(self):
        credentials=dict(name='Bea',email='bea@example.test',password='Otra clave ficticia 123')
        raw=self.directory.authenticate(credentials,True)
        session=self.directory.session(raw)
        person=self.directory.members(self.home)[1]['id']
        self.directory.manage(session['account_id'],None,dict(action='claim',person_id=person))
        data=dict(action='delete',current_password=credentials['password'],confirmation='ELIMINAR')
        with self.assertRaises(ValueError):self.directory.update_account(session,{**data,'confirmation':'no'})
        self.directory.update_account(session,data)
        self.assertIsNone(self.directory.session(raw))
        self.assertIsNotNone(self.directory.session(self.raw))
        self.assertEqual(self.directory.details(self.id,self.home)['claims'],[])
