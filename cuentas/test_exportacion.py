from io import BytesIO
from pathlib import Path
import tempfile
import unittest
from openpyxl import load_workbook
import gestor as g
from exportacion import filtered_excel
from test_revision_masiva import seed


class ExportTests(unittest.TestCase):
    def test_filters_all_pages_and_cell_types(self):
        with tempfile.TemporaryDirectory() as folder:
            db=g.connect(Path(folder)/'test.db')
            try:
                seed(db,80)
                with db:
                    db.execute("UPDATE movements SET period='2025-09' WHERE id>40")
                    db.execute("UPDATE movements SET description='=1+1',mi=-500000,amor=1000500000 WHERE id=1")
                wb=load_workbook(BytesIO(filtered_excel(db,dict(year='2026',month='09',category='Comida',page='2'))))
                ws=wb.active
                self.assertEqual(ws.max_row,41)
                self.assertEqual([c.value for c in ws[1]],[c[0] for c in db.execute('SELECT * FROM v_powerbi LIMIT 0').description])
                row=next(r for r in ws.iter_rows(min_row=2) if r[0].value==1)
                self.assertEqual(row[3].value,'=1+1')
                self.assertEqual(row[3].data_type,'s')
                self.assertEqual(row[6].value,-0.5)
                self.assertEqual(row[1].value.strftime('%Y-%m-%d'),'2026-09-01')
                self.assertEqual(ws.freeze_panes,'A2')
                wb.close()
                wb=load_workbook(BytesIO(filtered_excel(db,dict(year='2030'))))
                self.assertEqual(wb.active.max_row,1)
                wb.close()
            finally:db.close()
