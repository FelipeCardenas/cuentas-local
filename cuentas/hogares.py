"""Local accounts and household authorization, separate from each household ledger."""
import hashlib
import hmac
import re
import secrets
import sqlite3
import time
import unicodedata
import uuid
from contextlib import closing
from pathlib import Path

import gestor as g


class AccessError(ValueError):
    pass


def uid():
    return str(uuid.uuid4())


def household_key(value):
    return ' '.join(unicodedata.normalize('NFKC',value).casefold().split())


def text(value, label, maximum=160):
    if not isinstance(value, str) or not 1 <= len(value.strip()) <= maximum:
        raise ValueError(f'{label}: valor obligatorio (maximo {maximum} caracteres)')
    return value.strip()


def password_hash(password, salt):
    if not isinstance(password, str) or not 12 <= len(password) <= 256:
        raise ValueError('La contrasena debe tener entre 12 y 256 caracteres')
    return hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), 600_000).hex()


def contact_email(value):
    if not isinstance(value, str):
        raise ValueError('Correo de contacto invalido')
    value = value.strip()
    if value and (len(value) > 254 or not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', value)):
        raise ValueError('Correo de contacto invalido')
    return value


class Directory:
    def __init__(self, ledger, initial_name='Departamento', initial_address=''):
        self.ledger = Path(ledger).resolve()
        self.path = self.ledger.with_name(self.ledger.stem + '-identidades.sqlite3')
        self.folder = self.ledger.parent / (self.ledger.stem + '-hogares')
        self.initial_name, self.initial_address = initial_name, initial_address
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with closing(self.connect()) as db:
            db.executescript('''
              CREATE TABLE IF NOT EXISTS accounts(
                id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
                salt TEXT NOT NULL, password_hash TEXT NOT NULL);
              CREATE TABLE IF NOT EXISTS homes(
                id TEXT PRIMARY KEY, name TEXT NOT NULL, address TEXT NOT NULL,
                ledger TEXT NOT NULL UNIQUE);
              CREATE TABLE IF NOT EXISTS people(
                id TEXT PRIMARY KEY, name TEXT NOT NULL, surname TEXT NOT NULL DEFAULT '',
                alias TEXT NOT NULL DEFAULT '', account_id TEXT REFERENCES accounts(id));
              CREATE TABLE IF NOT EXISTS members(
                home_id TEXT NOT NULL REFERENCES homes(id), person_id TEXT NOT NULL REFERENCES people(id),
                role TEXT NOT NULL CHECK(role IN ('admin','member')), active INTEGER NOT NULL DEFAULT 1,
                position INTEGER NOT NULL, PRIMARY KEY(home_id,person_id));
              CREATE TABLE IF NOT EXISTS sessions(
                digest TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
                csrf TEXT NOT NULL, expires INTEGER NOT NULL);
              CREATE TABLE IF NOT EXISTS claims(
                id TEXT PRIMARY KEY, person_id TEXT NOT NULL REFERENCES people(id),
                account_id TEXT NOT NULL REFERENCES accounts(id), status TEXT NOT NULL DEFAULT 'pending',
                created INTEGER NOT NULL, UNIQUE(person_id,account_id));
              CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
              CREATE TABLE IF NOT EXISTS home_archives(
                account_id TEXT NOT NULL REFERENCES accounts(id), home_id TEXT NOT NULL REFERENCES homes(id),
                archived_at TEXT NOT NULL, PRIMARY KEY(account_id,home_id));
              CREATE TABLE IF NOT EXISTS home_creations(
                account_id TEXT NOT NULL REFERENCES accounts(id), request_id TEXT NOT NULL,
                name_key TEXT NOT NULL, address_key TEXT NOT NULL,
                home_id TEXT NOT NULL REFERENCES homes(id), PRIMARY KEY(account_id,request_id));
            ''')
            with db:
                if 'contact_email' not in {r[1] for r in db.execute('PRAGMA table_info(people)')}:
                    db.execute("ALTER TABLE people ADD COLUMN contact_email TEXT NOT NULL DEFAULT ''")
                if 'deleted_at' not in {r[1] for r in db.execute('PRAGMA table_info(accounts)')}:
                    db.execute('ALTER TABLE accounts ADD COLUMN deleted_at TEXT')
                if 'created_at' not in {r[1] for r in db.execute('PRAGMA table_info(homes)')}:
                    db.execute('ALTER TABLE homes ADD COLUMN created_at TEXT')
                for key,value in [('initial_name',initial_name),('initial_address',initial_address)]:
                    db.execute('INSERT OR IGNORE INTO settings VALUES(?,?)',(key,value))
            self.initial_name=db.execute("SELECT value FROM settings WHERE key='initial_name'").fetchone()[0]
            self.initial_address=db.execute("SELECT value FROM settings WHERE key='initial_address'").fetchone()[0]

    def connect(self):
        db = sqlite3.connect(self.path, timeout=15)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        return db

    def session(self, raw):
        if not raw:
            return None
        with closing(self.connect()) as db:
            row = db.execute('''SELECT s.*, a.email, a.name FROM sessions s JOIN accounts a
                ON a.id=s.account_id WHERE digest=? AND expires>? AND a.deleted_at IS NULL''',
                (hashlib.sha256(raw.encode()).hexdigest(), int(time.time()))).fetchone()
            return dict(row) if row else None

    def authenticate(self, data, register=False):
        email = text(data.get('email'), 'Correo', 254).lower()
        if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email):
            raise ValueError('Correo invalido')
        with closing(self.connect()) as db, db:
            db.execute('BEGIN IMMEDIATE')
            if register:
                if db.execute('SELECT 1 FROM accounts WHERE email=?', (email,)).fetchone():
                    raise ValueError('No se pudo registrar esta cuenta; intenta iniciar sesion')
                name = text(data.get('name'), 'Nombre')
                salt = secrets.token_hex(16)
                hashed = password_hash(data.get('password'), salt)
                account_id = uid()
                first = not db.execute('SELECT 1 FROM accounts').fetchone()
                db.execute('INSERT INTO accounts(id,email,name,salt,password_hash) VALUES(?,?,?,?,?)', (account_id,email,name,salt,hashed))
                if first:
                    home_id = uid()
                    db.execute('INSERT INTO homes(id,name,address,ledger,created_at) VALUES(?,?,?,?,?)',
                               (home_id, self.initial_name, self.initial_address, str(self.ledger),g.now()))
                    for index, label in enumerate((name, 'Amor')):
                        person_id = uid()
                        db.execute('INSERT INTO people(id,name,account_id) VALUES(?,?,?)',
                                   (person_id,label,account_id if index == 0 else None))
                        db.execute('INSERT INTO members VALUES(?,?,?,?,?)',
                                   (home_id,person_id,'admin' if index == 0 else 'member',1,index))
            else:
                row = db.execute('SELECT * FROM accounts WHERE email=?', (email,)).fetchone()
                # Equal-cost verification for unknown accounts as well.
                hashed = password_hash(data.get('password'), row['salt'] if row else '00'*16)
                if not row or not hmac.compare_digest(hashed, row['password_hash']) or row['deleted_at']:
                    raise AccessError('Correo o contrasena incorrectos')
                account_id = row['id']
            raw, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
            db.execute('DELETE FROM sessions WHERE expires<=?', (int(time.time()),))
            db.execute('INSERT INTO sessions VALUES(?,?,?,?)',
                       (hashlib.sha256(raw.encode()).hexdigest(), account_id, csrf, int(time.time())+43200))
        return raw

    def logout(self, session):
        with closing(self.connect()) as db, db:
            db.execute('DELETE FROM sessions WHERE digest=?', (session['digest'],))

    def update_account(self, session, data):
        with closing(self.connect()) as db, db:
            db.execute('BEGIN IMMEDIATE')
            user=db.execute('''SELECT a.* FROM accounts a JOIN sessions s ON s.account_id=a.id
                WHERE s.digest=? AND s.expires>? AND a.deleted_at IS NULL''',
                (session['digest'],int(time.time()))).fetchone()
            if not user:raise AccessError('La sesion ya no esta vigente. Inicia sesion nuevamente.')
            account_id=user['id']
            action=data.get('action')
            if action=='profile':
                db.execute('UPDATE accounts SET name=? WHERE id=?',(text(data.get('name'),'Nombre'),account_id))
                return dict(ok=True)
            if action not in ('password','delete'):raise ValueError('Accion de cuenta no soportada')
            hashed=password_hash(data.get('current_password'),user['salt'])
            if not hmac.compare_digest(hashed,user['password_hash']):
                raise AccessError('La contrasena actual es incorrecta')
            if action=='password':
                if data.get('new_password')!=data.get('confirmation'):
                    raise ValueError('Las contrasenas nuevas no coinciden')
                salt=secrets.token_hex(16)
                hashed=password_hash(data.get('new_password'),salt)
                db.execute('UPDATE accounts SET salt=?,password_hash=? WHERE id=?',(salt,hashed,account_id))
            else:
                if data.get('confirmation')!='ELIMINAR':raise ValueError('Escribe ELIMINAR para confirmar')
                # Count distinct accounts, not linked personas; personal archives still need an administrator.
                blocked=db.execute('''SELECT DISTINCT h.name FROM homes h JOIN members m ON m.home_id=h.id
                    JOIN people p ON p.id=m.person_id
                    WHERE p.account_id=? AND m.active=1 AND m.role='admin' AND NOT EXISTS (
                      SELECT 1 FROM members other JOIN people op ON op.id=other.person_id
                      JOIN accounts a ON a.id=op.account_id
                      WHERE other.home_id=h.id AND other.active=1 AND other.role='admin'
                        AND a.id<>? AND a.deleted_at IS NULL)''',(account_id,account_id)).fetchall()
                if blocked:raise ValueError('Antes de eliminar tu cuenta, asigna otro administrador en: '+', '.join(r['name'] for r in blocked))
                db.execute('UPDATE accounts SET deleted_at=? WHERE id=?',(g.now(),account_id))
                db.execute('UPDATE members SET active=0 WHERE person_id IN (SELECT id FROM people WHERE account_id=?)',(account_id,))
                db.execute("UPDATE claims SET status='rejected' WHERE account_id=? AND status='pending'",(account_id,))
            db.execute('DELETE FROM sessions WHERE account_id=?',(account_id,))
            return dict(ok=True,signed_out=True)

    def overview(self, account_id):
        with closing(self.connect()) as db:
            user = dict(db.execute('SELECT id,name,email FROM accounts WHERE id=?', (account_id,)).fetchone())
            history = [dict(r) for r in db.execute('''SELECT h.id,h.name,h.address,h.created_at,a.archived_at,
                MAX(m.role='admin') admin FROM homes h JOIN members m ON m.home_id=h.id
                JOIN people p ON p.id=m.person_id
                LEFT JOIN home_archives a ON a.home_id=h.id AND a.account_id=p.account_id
                WHERE p.account_id=? AND m.active=1
                GROUP BY h.id ORDER BY h.name,h.created_at,h.id''', (account_id,))]
            homes=[h for h in history if not h['archived_at']]
            links = [dict(r) for r in db.execute('''SELECT p.id,p.name,p.alias,h.name household,m.active
                FROM people p JOIN members m ON p.id=m.person_id JOIN homes h ON h.id=m.home_id
                WHERE p.account_id=? ORDER BY h.name''', (account_id,))]
            claims = [dict(r) for r in db.execute('SELECT id,person_id,status FROM claims WHERE account_id=?', (account_id,))]
            return dict(user=user, homes=homes, home_history=history, links=links, claims=claims)

    def authorize(self, account_id, home_id, admin=False, include_archived=False):
        with closing(self.connect()) as db:
            home = db.execute('''SELECT h.*, MAX(m.role='admin') admin FROM homes h
                JOIN members m ON h.id=m.home_id JOIN people p ON p.id=m.person_id
                JOIN accounts a ON a.id=p.account_id
                WHERE h.id=? AND p.account_id=? AND m.active=1 AND a.deleted_at IS NULL GROUP BY h.id''',
                (home_id,account_id)).fetchone()
            if not home or (admin and not home['admin']):
                raise AccessError('No tienes permiso para este hogar')
            if not include_archived and db.execute('SELECT 1 FROM home_archives WHERE account_id=? AND home_id=?',(account_id,home_id)).fetchone():
                raise AccessError('Este hogar esta archivado en tu cuenta. Reactivalo desde Historial de hogares.')
            return dict(home)

    def members(self, home_id):
        with closing(self.connect()) as db:
            return [dict(r) for r in db.execute('''SELECT p.*,m.role,m.active,m.position
                FROM members m JOIN people p ON p.id=m.person_id WHERE m.home_id=? ORDER BY m.position''', (home_id,))]

    def manage(self, account_id, home_id, data):
        with closing(self.connect()) as db:
            if not db.execute('SELECT 1 FROM accounts WHERE id=? AND deleted_at IS NULL',(account_id,)).fetchone():
                raise AccessError('Cuenta no disponible')
        action = data.get('action')
        if action == 'create':
            name, address = text(data.get('name'),'Nombre del hogar'), text(data.get('address'),'Direccion',500)
            request_id=data.get('request_id')
            if request_id is not None:request_id=text(request_id,'Identificador de solicitud',100)
            name_key,address_key=household_key(name),household_key(address)
            with closing(self.connect()) as db, db:
                db.execute('BEGIN IMMEDIATE')
                if request_id:
                    previous=db.execute('SELECT * FROM home_creations WHERE account_id=? AND request_id=?',(account_id,request_id)).fetchone()
                    if previous:
                        if (previous['name_key'],previous['address_key'])!=(name_key,address_key):
                            raise ValueError('Esta solicitud ya creo un hogar con otros datos. Revisa el historial antes de volver a crear.')
                        self.authorize(account_id,previous['home_id'],include_archived=True)
                        return dict(id=previous['home_id'],reused=True)
                existing=db.execute('''SELECT DISTINCT h.* FROM homes h JOIN members m ON h.id=m.home_id
                    JOIN people p ON p.id=m.person_id WHERE p.account_id=? AND m.active=1''',(account_id,)).fetchall()
                if any((household_key(h['name']),household_key(h['address']))==(name_key,address_key) for h in existing):
                    raise ValueError('Ya tienes un hogar con ese nombre y direccion. Revisalo en Hogares o reactivalo desde Historial de hogares.')
                hid, pid = uid(), uid()
                path = self.folder / hid / 'cuentas.sqlite3'
                with closing(g.connect(path)):pass
                user = db.execute('SELECT name FROM accounts WHERE id=?',(account_id,)).fetchone()
                db.execute('INSERT INTO homes(id,name,address,ledger,created_at) VALUES(?,?,?,?,?)',(hid,name,address,str(path),g.now()))
                db.execute('INSERT INTO people(id,name,account_id) VALUES(?,?,?)',(pid,user['name'],account_id))
                db.execute('INSERT INTO members VALUES(?,?,?,?,?)',(hid,pid,'admin',1,0))
                if request_id:db.execute('INSERT INTO home_creations VALUES(?,?,?,?,?)',(account_id,request_id,name_key,address_key,hid))
            return dict(id=hid)
        if action in ('archive_home','restore_home'):
            target=data.get('home_id') or home_id
            self.authorize(account_id,target,include_archived=True)
            with closing(self.connect()) as db, db:
                if action=='archive_home':
                    db.execute('INSERT OR IGNORE INTO home_archives VALUES(?,?,?)',(account_id,target,g.now()))
                else:
                    db.execute('DELETE FROM home_archives WHERE account_id=? AND home_id=?',(account_id,target))
            return dict(ok=True,id=target)
        if action == 'claim':
            pid = text(data.get('person_id'),'ID de persona')
            with closing(self.connect()) as db, db:
                person = db.execute('SELECT * FROM people WHERE id=?',(pid,)).fetchone()
                if not person or person['account_id'] is not None or not db.execute(
                    'SELECT 1 FROM members WHERE person_id=? AND active=1',(pid,)).fetchone():
                    raise ValueError('No se puede solicitar la vinculacion con ese ID')
                db.execute('''INSERT INTO claims VALUES(?,?,?,'pending',?)
                    ON CONFLICT(person_id,account_id) DO UPDATE SET status='pending',created=excluded.created''',
                    (uid(),pid,account_id,int(time.time())))
            return dict(ok=True)
        self.authorize(account_id,home_id,admin=True)
        with closing(self.connect()) as db, db:
            db.execute('BEGIN IMMEDIATE')
            if action == 'edit_home':
                db.execute('UPDATE homes SET name=?,address=? WHERE id=?',
                           (text(data.get('name'),'Nombre'),text(data.get('address'),'Direccion',500),home_id))
            elif action == 'add_person':
                pid=uid()
                db.execute('INSERT INTO people(id,name,surname,alias,contact_email) VALUES(?,?,?,?,?)',
                           (pid,text(data.get('name'),'Nombre'),str(data.get('surname','')).strip()[:160],str(data.get('alias','')).strip()[:160],contact_email(data.get('contact_email',''))))
                position=db.execute('SELECT COALESCE(MAX(position),-1)+1 FROM members WHERE home_id=?',(home_id,)).fetchone()[0]
                db.execute('INSERT INTO members VALUES(?,?,?,?,?)',(home_id,pid,'member',1,position))
            elif action in ('edit_person','membership'):
                pid=data.get('person_id')
                member=db.execute('SELECT * FROM members WHERE home_id=? AND person_id=?',(home_id,pid)).fetchone()
                if not member:raise ValueError('Integrante inexistente')
                if action == 'edit_person':
                    email=db.execute('SELECT contact_email FROM people WHERE id=?',(pid,)).fetchone()[0]
                    db.execute('UPDATE people SET name=?,surname=?,alias=?,contact_email=? WHERE id=?',
                               (text(data.get('name'),'Nombre'),str(data.get('surname','')).strip()[:160],str(data.get('alias','')).strip()[:160],contact_email(data.get('contact_email',email)),pid))
                else:
                    role=data.get('role',member['role']); active=data.get('active',bool(member['active']))
                    if role not in ('admin','member') or type(active) is not bool:raise ValueError('Permisos invalidos')
                    linked=db.execute('SELECT account_id FROM people WHERE id=?',(pid,)).fetchone()[0]
                    if active and linked and not db.execute('SELECT 1 FROM accounts WHERE id=? AND deleted_at IS NULL',(linked,)).fetchone():
                        raise ValueError('La cuenta vinculada esta eliminada')
                    if role=='admin' and not linked:raise ValueError('Un administrador debe tener cuenta vinculada')
                    db.execute('UPDATE members SET role=?,active=? WHERE home_id=? AND person_id=?',(role,int(active),home_id,pid))
                    if not db.execute("SELECT 1 FROM members WHERE home_id=? AND role='admin' AND active=1",(home_id,)).fetchone():
                        raise ValueError('El hogar debe conservar al menos un administrador activo')
            elif action in ('approve','reject'):
                claim=db.execute('''SELECT c.* FROM claims c JOIN members m ON m.person_id=c.person_id
                    WHERE c.id=? AND m.home_id=? AND m.active=1 AND c.status='pending' ''', (data.get('claim_id'),home_id)).fetchone()
                if not claim:raise ValueError('Solicitud no disponible')
                if action=='approve':
                    if db.execute('SELECT account_id FROM people WHERE id=?',(claim['person_id'],)).fetchone()[0]:
                        raise ValueError('La persona ya tiene una cuenta vinculada')
                    db.execute('UPDATE people SET account_id=? WHERE id=?',(claim['account_id'],claim['person_id']))
                    db.execute("UPDATE claims SET status='rejected' WHERE person_id=? AND status='pending'",(claim['person_id'],))
                db.execute('UPDATE claims SET status=? WHERE id=?',('approved' if action=='approve' else 'rejected',claim['id']))
            else:
                raise ValueError('Accion de hogar no soportada')
        return dict(ok=True)

    def details(self, account_id, home_id):
        home=self.authorize(account_id,home_id)
        home.pop('ledger')
        with closing(self.connect()) as db:
            claims=[dict(r) for r in db.execute('''SELECT c.id,c.person_id,c.created,a.name,a.email
                FROM claims c JOIN accounts a ON c.account_id=a.id JOIN members m ON m.person_id=c.person_id
                WHERE m.home_id=? AND m.active=1 AND c.status='pending' ''',(home_id,))] if home['admin'] else []
        members=self.members(home_id)
        for person in members:
            person['linked']=person.pop('account_id') is not None
        return dict(home=home,people=members,claims=claims)
