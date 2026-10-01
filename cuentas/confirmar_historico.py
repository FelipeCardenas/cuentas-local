"""Explicit, backed-up confirmation of pending expense periods before 2026."""
import argparse
from collections import Counter, defaultdict
from contextlib import closing
import hashlib
import json
from pathlib import Path
import re
import sqlite3
from datetime import datetime

import categorias
import gestor as g


def merchant(description):
    text = re.sub(r'[^a-z0-9]+', ' ', g.norm(description)).strip()
    return re.sub(r'^compra\s+', '', text)


def plan(db, special=False):
    references = defaultdict(list)
    for r in db.execute("""SELECT id,description,category FROM movements
            WHERE state IN ('aceptado','pendiente') AND kind IN ('gasto','devolucion')
            AND category IS NOT NULL AND trim(category)!=''"""):
        references[merchant(r['description'])].append(dict(r))
    rows = []
    for r in db.execute("""SELECT * FROM movements WHERE state='pendiente'
            AND period < '2026-01' AND kind IN ('gasto','devolucion') ORDER BY id"""):
        before = dict(r)
        g.period(r['period'])
        key = merchant(r['description'])
        refs = references.get(key, [])
        # Only whole-word prefixes with a meaningful merchant name; no fuzzy guesses.
        if not refs and len(key) >= 5 and key not in ('mercadopago', 'merpago', 'webpay', 'flow'):
            refs = [ref for name, matches in references.items()
                    if name.startswith(key + ' ') for ref in matches]
        names = {ref['category'] for ref in refs}
        category = r['category'] or (next(iter(names)) if len(names) == 1 else 'Otros')
        reason = 'conservada' if r['category'] else 'referencia' if len(names) == 1 else 'otros'
        mismatch = r['mi'] is not None and r['amor'] is not None and r['mi']+r['amor'] != r['amount']
        eligible = r['mi'] is not None and r['amor'] is not None and (not mismatch or r['special_case'] or special)
        rows.append(dict(before=before, category=category, reason=reason,
                         references=[ref['id'] for ref in refs] if reason == 'referencia' else [],
                         eligible=eligible, special_case=bool(r['special_case'] or (special and mismatch))))
    return rows


def digest(rows):
    return hashlib.sha256(json.dumps(rows, sort_keys=True).encode()).hexdigest()


def apply(db, path, expected, special=False):
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    backup = Path(path).with_name('cuentas-antes-confirmacion-historica-' + stamp + '.sqlite3.bak')
    # Reserve the write lock while a separate reader takes a consistent backup.
    db.execute('BEGIN IMMEDIATE')
    try:
        rows = plan(db, special)
        if digest(rows) != expected:
            raise ValueError('Los datos cambiaron desde la vista previa; revise nuevamente.')
        with closing(sqlite3.connect(path)) as source, closing(sqlite3.connect(backup)) as target:
            source.backup(target)
        for item in rows:
            if not item['eligible']:
                continue
            before = item['before']
            after = dict(before, category=categorias.ensure(db, item['category']),
                         state='aceptado', special_case=int(item['special_case']))
            db.execute("UPDATE movements SET category=?,state='aceptado',special_case=? WHERE id=?",
                       (after['category'], after['special_case'], before['id']))
            db.execute('UPDATE issues SET resolved=1 WHERE movement_id=?', (before['id'],))
            g.insert(db, 'decisions', dict(movement_id=before['id'], created_at=g.now(),
                     action='confirmar_historico_pre2026',
                     before_json=json.dumps(before, ensure_ascii=False),
                     after_json=json.dumps(after, ensure_ascii=False),
                     note=json.dumps(dict(scope='Periodos anteriores a 2026; confirmacion solicitada por usuario',
                          category_source=item['reason'], references=item['references'],
                          preserved='Monto y reparto Mi/Amor originales',
                          special_case_authorized=special), ensure_ascii=False)))
        db.commit()
        return str(backup)
    except Exception:
        db.rollback()
        raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--db', type=Path, default=g.DEFAULT_DB)
    parser.add_argument('--apply-token')
    parser.add_argument('--special', action='store_true')
    args = parser.parse_args()
    db = sqlite3.connect(args.db)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    try:
        rows = plan(db, args.special)
        print(json.dumps(dict(token=digest(rows), pending=len(rows),
            eligible=sum(r['eligible'] for r in rows),
            categories=Counter(r['reason'] for r in rows),
            years=Counter(r['before']['period'][:4] for r in rows),
            skipped=[r['before']['id'] for r in rows if not r['eligible']]), ensure_ascii=False))
        if args.apply_token:
            print(json.dumps(dict(backup=apply(db, args.db, args.apply_token, args.special))))
    finally:
        db.close()


if __name__ == '__main__':
    main()
