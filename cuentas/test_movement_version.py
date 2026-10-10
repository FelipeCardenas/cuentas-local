import unittest
import servidor


class MovementVersionTests(unittest.TestCase):
    def test_grid_and_detail_share_version_but_edits_change_it(self):
        row=dict(id=1,description='Compra',amount=1000000,category='Comida')
        expected=servidor.movement(row)['version']
        self.assertEqual(servidor.movement(dict(row,issue_count=0))['version'],expected)
        self.assertNotEqual(servidor.movement(dict(row,category='Otro'))['version'],expected)
