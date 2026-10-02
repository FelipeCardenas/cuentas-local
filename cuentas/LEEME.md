# Base local e importador de cuentas

> Version con hogares: usar el README.md de la raiz para registro, permisos,
> respaldos y repartos por persona. Las referencias Mi/Amor y los comandos de
> revision de dos personas de este documento describen la version anterior.
> No usar scripts de esa version contra una base migrada. Cerrar el servidor
> anterior antes de iniciar el nuevo; no ejecutarlos contra la misma base.

La base esta en `datos/cuentas.sqlite3`. La carpeta `entrada` recibe los Excel del banco. La ejecucion es manual.

## Pantalla en el navegador

Abra `Abrir Cuentas.cmd` con doble clic. Inicia el servidor local y abre el navegador. Si ya esta funcionando, reutiliza la direccion. Solo escucha en este computador (127.0.0.1). No accede al banco ni transmite los archivos a un servicio externo.

- Importar Excel: seleccione un .xlsx, indique el mes de las cuotas, revise la vista previa y confirme. Si ya existe, abre el lote sin agregar movimientos.
- Revision: filtre por lote, mes, tipo o texto y abra un movimiento. Edite categoria, periodo, Mi y Amor. Guardar conserva el borrador; Confirmar lo incluye en el real confirmado cuando categoria y reparto son validos.
- Confirmar todos: en Pendientes aplica a todas las paginas de los filtros actuales. Muestra cuantos se confirmaran y cuantos seguiran pendientes por categoria ausente o reparto incompleto/descuadrado. Conserva compras coincidentes como independientes; no deduplica ni cambia montos/repartos. El proceso es atomico y registra cada decision.
- Pendiente Mi / Amor: sumas de gastos y devoluciones pendientes de los filtros actuales, incluyendo sus signos. Los repartos desconocidos no se inventan: se indica que los totales son parciales. Ingresos y pagos CMR no entran en estos dos importes.
- Confirmados: abra cualquier movimiento para editar categoria, Mi y Amor. Guardar mantiene el estado confirmado y exige que el reparto siga sumando el monto total original, que no se edita.
- Porcentajes: escriba de 0 a 100 en Mi o Amor; el otro porcentaje se completa hasta 100 y se recalculan los dos importes. El boton 50/50 sigue disponible. Los importes se conservan con precision de seis decimales y el complemento evita diferencias de redondeo.
- Caso especial: marque la casilla para permitir que Mi + Amor sea distinto del monto total. La excepcion queda guardada, auditada y exportada como caso_especial; se respeta al confirmar individualmente o en masa. Todavia se requieren categoria y ambos importes numericos (pueden ser cero). Desmarcarla restablece la validacion normal. El monto de la compra no cambia.
- Coincidencias: compare los movimientos, conserve una compra independiente o vincule un duplicado a otro movimiento previamente confirmado.
- Historico: consulta todos los lotes. Los datos de origen y el historial de revisiones aparecen en el panel de cada movimiento.
- Exportar confirmados: descarga el CSV de gastos y devoluciones aceptados. La conexion directa de Power BI aun no esta configurada.

Los tres totales corresponden al lote elegido, incluso cuando se filtra la tabla por estado o mes. Las pruebas de cambios se realizaron sobre copias aisladas; no se aprobaron gastos reales durante las pruebas. El historico conserva incidencias de enlace ambiguo entre fuentes para una revision posterior; esta primera pantalla no modifica esos enlaces de origen.

Se incluyen iconos Lucide servidos localmente. No se requiere conexion a Internet para cargar la interfaz. Para iniciar el servidor manualmente: `python servidor.py --auto-port` (requiere openpyxl).

## Uso desde PowerShell

Abra PowerShell en esta carpeta y ejecute:

```powershell
.\cuentas.ps1 resumen
.\cuentas.ps1 importar ".\entrada\archivo.xlsx" --mes-cuotas 2026-09
.\cuentas.ps1 importar-carpeta --mes-cuotas 2026-09
.\cuentas.ps1 resumen --lote 2
.\cuentas.ps1 exportar .\salida
```

El mes indicado corresponde a las cuotas del archivo. Las compras de una cuota usan su fecha original, aunque pertenezcan a otro mes. Para cargas atrasadas, indique el periodo de las cuotas, no el mes de ejecucion. En una carga por carpeta todos los archivos reciben ese mismo periodo; separe los archivos de otros periodos.

El comando `importar-carpeta` procesa `.xlsx` y omite temporales de Excel. Cada archivo se confirma en una transaccion independiente. Si uno falla, muestra el error y continua con los demas; termina con codigo 2 si hubo errores. No borra ni mueve archivos de entrada. Es seguro repetir la ejecucion: se reconoce el contenido, incluso si cambia el nombre del archivo.

## Revision por comandos (alternativa)

Los identificadores aparecen en `salida/pendientes.csv` y `v_powerbi.csv`.

```powershell
.\cuentas.ps1 revisar 123 editar --categoria "Supermercado" --mi 5000 --amor 5000
.\cuentas.ps1 revisar 123 aceptar --nota "Categoria y reparto revisados"
.\cuentas.ps1 revisar 124 duplicado --duplicado-de 123 --nota "Mismo cargo en otra exportacion"
.\cuentas.ps1 revisar 125 conservar --nota "Segunda compra real del mismo importe"
```

Estos son ejemplos: sustituya los identificadores y montos por los del movimiento que revise. Use punto para decimales y omita separadores de miles. `conservar` confirma que es una compra independiente pero deja pendiente la aprobacion de categoria/reparto. `aceptar` exige categoria y que Mi + Amor coincida con el monto, tambien para devoluciones. Para cambiar el periodo existe `--mes YYYY-MM`.

Los campos de los CSV exportados son para inspeccion; editarlos no actualiza la base. Las modificaciones se realizan mediante la pantalla o el comando de revision. Todas se registran en `decisions`. Guardar permite dejar un reparto incompleto; Confirmar exige que este completo. Los avisos de categoria y reparto se actualizan al guardar.

## Datos y calculos

- `batches`: importaciones, hash de contenido y periodo de cuotas.
- `files`: copias de origen en `datos/originales`, con hash para trazabilidad. No es una politica de respaldos del sistema.
- `observations`: valores originales, hoja y fila para trazabilidad de las fuentes importadas.
- `movements`: registros canonicos propuestos, fechas, periodos, tipos, categoria, reparto y estado.
- `issues` y `candidates`: diferencias pendientes y coincidencias entre compras, incluidas las de archivos solapados.
- `decisions`: registro de cambios antes/despues con fecha y nota.

Los importes se guardan como enteros en millonesimas de CLP (1 CLP = 1.000.000 unidades internas), redondeando a seis decimales para eliminar residuos de coma flotante. Las vistas y CSV muestran CLP. Se preservan valores historicos de medio peso. Los textos originales como '-' permanecen en las observaciones; no se convierten automaticamente en cero.

Los sueldos se clasifican como ingresos y no entran en los indicadores de gasto. Los datos financieros de cada instalacion se conservan fuera del repositorio.

Los pagos CMR se clasifican como `pago_tarjeta` y quedan fuera de gastos. Las devoluciones conservan su signo negativo y reparto editable. Nuevos gastos usan 50/50 y categorias sugeridas del historico; Shell y Copec se marcan como variables. Toda sugerencia sigue pendiente de aprobacion.

Los archivos bancarios deben tener FECHA, DESCRIPCION, TITULAR/ADICIONAL, MONTO, CUOTAS PENDIENTES y VALOR CUOTA. Se detectan cuotas pendientes o diferencia entre total de compra y valor cuota; una ultima cuota puede tener cero pendientes y aun conservar un total distinto. Si hay cuotas se exige `--mes-cuotas`. La exportacion de movimientos facturados con otro esquema necesita validar un ejemplo antes de ampliar el lector.

Solo CLP esta habilitado. Si existe columna MONEDA con otro valor se rechaza la importacion para evitar mezclar monedas; conversion automatica queda pendiente de elegir proveedor y fecha de tasa. El formato conocido no trae columna de moneda.

## Tres montos

`resumen --lote N` muestra bruto, deduplicado propuesto y real confirmado. Se excluyen pagos de tarjeta e ingresos de los tres. El bruto suma todas las compras y devoluciones del lote. La propuesta agrupa por fecha, descripcion normalizada, importe, periodo y tipo; puede subestimar compras iguales legitimas. El real confirmado cuenta solo registros aceptados.

Sin `--lote`, el bruto incluye todos los lotes y puede sumar observaciones solapadas. No es un gasto consolidado aprobado. Los registros pendientes no aumentan el real confirmado; un real inicial de cero no significa ausencia de gastos. Al aceptar dos compras iguales, ambas cuentan en real; al declarar una duplicada, solo cuenta la aceptada de destino.

## Power BI y alcance

`v_powerbi` expone todos los estados. `v_gastos_confirmados` expone solamente gastos/devoluciones aceptados. La exportacion incluye ambas vistas, pendientes, incidencias y coincidencias. La conexion directa de Power BI a SQLite aun no esta instalada ni validada; requerira comprobar un controlador compatible. Los CSV son una salida disponible desde ahora, no una conexion ya configurada con el informe.

La integracion de Google se utilizo para preparar el historico. Este programa funciona localmente y no accede a Google ni al banco. La pantalla ya esta disponible. La conexion directa de Power BI sigue pendiente.

## Verificacion

```powershell
& "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" -m unittest discover -s . -v
```

Las pruebas usan bases temporales. Cubren importacion repetida, archivos solapados, dos compras iguales reales, devoluciones, pagos CMR, periodos de cuotas, precision monetaria, persistencia de revisiones y reversion completa ante un error. Tambien leen el archivo de ejemplo bancario cuando esta disponible.
# Maestro de categorias

## Cuentas en pareja

Consulta los importes de Mi y Amor entre dos fechas, con un filtro opcional de lote.
Solo se incluyen gastos y devoluciones confirmados. Las cuotas se seleccionan por
su mes asignado; las compras de una cuota, por fecha de compra. Los pagos de tarjeta
y los ingresos quedan fuera. Los casos especiales conservan su reparto.

Consultar no guarda un corte. Validar y guardar conserva las cifras y los IDs
seleccionados; no registra pagos ni depositos. El siguiente inicio sugerido es la
fecha final del ultimo corte vigente, sin repetir los movimientos ya considerados.
Las compras anteriores sin corte se avisan y pueden incluirse expresamente.
En la primera consulta se debe elegir el rango: no se asume que el historico fue
cobrado ni se crean cortes a partir de Excel automaticamente.

El historial muestra las cifras acordadas, incluso si luego se modifica un reparto.
Las diferencias posteriores aparecen como ajustes en la proxima consulta, tambien
cuando la fecha original queda fuera del rango o del lote elegido.
Se puede anular el ultimo corte vigente; queda auditado y libera sus movimientos.
Los lotes muestran su numero y periodo de gastos, no el mes de carga.

La seccion Categorias permite agregar, renombrar, fusionar y eliminar nombres.
Las variantes de mayusculas, espacios y tildes se reconocen como una sola categoria.
La migracion inicial unifica ademas Automivil/Automovil y Servicio/Servicios.
Renombrar o fusionar actualiza pendientes y confirmados sin modificar importes,
repartos ni estados; cada movimiento afectado conserva su registro de auditoria.
Los nombres anteriores se recuerdan para futuras importaciones.
No se puede eliminar una categoria con movimientos: primero debe fusionarse
con otra. La eliminacion nunca borra movimientos.
