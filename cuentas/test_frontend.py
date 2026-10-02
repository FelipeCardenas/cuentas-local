import tempfile
import unittest
from pathlib import Path
from servidor import static_file, STATIC


class FrontendTests(unittest.TestCase):
    def test_assets_do_not_expose_data_or_source(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            (root/'assets').mkdir()
            (root/'assets'/'app.js').write_text('test')
            (root/'secret.sqlite3').write_text('private')
            self.assertEqual(static_file(root,'/assets/app.js'),(root/'assets/app.js').resolve())
            for path in ['/assets/../secret.sqlite3','/assets/../../secret.js','/assets/a\\b.js','/datos/cuentas.sqlite3','/src/App.jsx','/assets/missing.js','/assets/%2e%2e/secret.js']:
                self.assertIsNone(static_file(root,path))

    def test_legacy_remains_available(self):
        self.assertEqual(static_file(STATIC,'/'),STATIC/'index.html')
        self.assertIsNone(static_file(STATIC,'/../gestor.py'))
