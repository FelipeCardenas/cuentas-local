"""Synthetic fixtures only. Called with an isolated test directory."""
import sys
from pathlib import Path
from datetime import datetime
from openpyxl import Workbook

sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'cuentas'))
import gestor as g

folder=Path(sys.argv[1]);folder.mkdir(parents=True,exist_ok=True)
db=g.connect(folder/'test.sqlite3')
with db:
    batch=g.insert(db,'batches',dict(kind='banco',fingerprint='synthetic',name='Prueba ficticia',period='2026-10',imported_at=g.now()))
    def add(label,period,amount,state):
        amount=g.money(amount)
        return g.insert(db,'movements',dict(batch_id=batch,source_key=label+period,purchase_date=period+'-01',period=period,description=label,normalized_description=g.norm(label),kind='gasto',amount=amount,purchase_amount=amount,holder='Titular',category='Categoria prueba',mi=amount//2,amor=amount-amount//2,state=state))
    for m in range(1,13):add('Compra referencia',f'2025-{m:02}',10000,'aceptado')
    for m in range(1,10):add('Compra actual',f'2026-{m:02}',12000,'aceptado')
    for i in range(40):add(f'Pendiente ejemplo {i:02}','2026-10',8897 if i==0 else 1000,'pendiente')
db.close()
book=Workbook();sheet=book.active;sheet.title='Ultimos Movimientos'
sheet.append(['FECHA','DESCRIPCION','TITULAR/ADICIONAL','MONTO','CUOTAS PENDIENTES','VALOR CUOTA'])
sheet.append([datetime(2026,10,2),'COMPRA TIENDA FICTICIA','Titular',2000,0,2000])
sheet.append([datetime(2026,10,2),'DEVOLUCION FICTICIA','Titular',500,0,-500])
sheet.append([datetime(2026,8,2),'COMPRA EN CUOTAS FICTICIA','Titular',30000,2,10000])
book.save(folder/'import.xlsx');book.close()
