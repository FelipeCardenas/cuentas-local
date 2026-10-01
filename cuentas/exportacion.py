"""Excel downloads for the exact ledger filter, without pagination."""
from datetime import date
from io import BytesIO
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter
import revision_masiva as bulk


def filtered_excel(db, filters):
    clause, args = bulk.where(filters)
    cursor = db.execute('SELECT v.* FROM movements m JOIN v_powerbi v ON v.id=m.id'
                        + clause + ' ORDER BY m.purchase_date DESC,m.id DESC', args)
    headers = [column[0] for column in cursor.description]
    wb = Workbook()
    ws = wb.active
    ws.title = 'Movimientos'
    ws.append(headers)
    for record in cursor:
        ws.append(list(record))
        for cell, header in zip(ws[ws.max_row], headers):
            if isinstance(cell.value, str):
                # Treat user-entered text as literal text, never as an Excel formula.
                cell.data_type = 's'
            if header == 'fecha_compra' and cell.value:
                cell.value = date.fromisoformat(cell.value)
                cell.number_format = 'dd-mm-yyyy'
            elif header in ('monto_clp','mi_clp','amor_clp'):
                cell.number_format = '#,##0.######;[Red]-#,##0.######'
    ws.freeze_panes = 'A2'
    ws.auto_filter.ref = ws.dimensions
    ws.sheet_view.showGridLines = False
    for cell in ws[1]:
        cell.font = Font(bold=True,color='FFFFFF')
        cell.fill = PatternFill('solid',fgColor='126B57')
        cell.alignment = Alignment(vertical='center')
    ws.row_dimensions[1].height = 25
    for index, header in enumerate(headers,1):
        ws.column_dimensions[get_column_letter(index)].width = (
            55 if header=='descripcion' else 24 if header=='categoria' else 19)
    output = BytesIO()
    wb.save(output)
    wb.close()
    return output.getvalue()
