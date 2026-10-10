# Cuentas Local

Aplicacion local para importar movimientos bancarios en Excel, revisar gastos,
asignar categorias, distribuir importes entre integrantes de hogares, guardar cortes
y consultar estadisticas. Backend Python, frontend React y SQLite.

## Instalacion

Para produccion local con Docker y acceso directo en Windows, ver
[DOCKER.md](DOCKER.md). El lanzador `cuentas/Abrir Cuentas Produccion.cmd`
usa el volumen real, no las bases del inicio directo con Python.

Requiere Python 3.12 (version probada), Node.js 22.12 o superior y npm.
Desde la raiz del proyecto:

```sh
python -m venv .venv
```

Activar el entorno en Windows PowerShell con `.\.venv\Scripts\Activate.ps1`
o en Linux/macOS con `source .venv/bin/activate`. Luego:

```sh
python -m pip install -r cuentas/requirements.txt
npm --prefix frontend ci
npm --prefix frontend run build
python cuentas/servidor.py --auto-port
```

Abrir la direccion local que imprime el servidor. La primera ejecucion crea
una base vacia; este repositorio no incluye movimientos ni archivos bancarios.
Los lanzadores .cmd/.ps1 existentes usan un runtime local de Codex; para una
instalacion independiente usar los comandos anteriores.

React se compila en cuentas/web-react/ (ignorado por Git). Node no se necesita
para ejecutar el servidor despues de compilar. La aplicacion funciona sin CDN.
La interfaz anterior se conserva como referencia de la version estable, pero
no soporta cuentas ni hogares. Utilizar React para esta version.
Ver [frontend/README.md](frontend/README.md) para desarrollo y pruebas de navegador.

## Pruebas

Estadisticas incluye gasto semanal por anio, mes y persona, agrupado por fecha
de compra en semanas de lunes a domingo limitadas al mes seleccionado. Suma
solo gastos y devoluciones confirmados; mantiene los repartos historicos.
La comparativa mensual existente sigue usando el periodo asignado.

La vista separa comparacion anual y analisis del mes. Debajo, la matriz de
categorias muestra los doce meses y totales anuales, con filtros independientes
de anio, persona, base de fechas y categorias. El selector permite buscar,
marcar todas o ninguna; solo recalcula la tabla y el grafico de ese bloque.
Los importes suman gastos confirmados menos devoluciones, sin modificar datos.

En Revision, cada fila pendiente permite confirmar (sin avisos pendientes) o
rechazar conservando el historial en Descartados. Los casos con avisos se revisan
desde el detalle. Los cortes guardados permiten descargar su detalle en Excel;
se exportan los repartos y categorias historicos, incluidos ajustes y anulaciones.

Los calculos nuevos por porcentaje o partes iguales usan pesos enteros y
conservan la suma exacta. En porcentajes, el importe de la persona editada se
redondea al peso mas cercano (mitades alejandose de cero); la otra recibe el
resto. En partes iguales, los pesos sobrantes se asignan en el orden de integrantes.
Los repartos historicos no se redondean al abrirlos ni al exportarlos.

El reconocimiento automatico conserva el umbral textual del 90%. En nuevas
importaciones, las advertencias manuales usan 70%, ademas de la misma fecha,
importe, tipo y periodo. Esto no fusiona ni descarta movimientos y no modifica
retroactivamente las importaciones anteriores.

```sh
python -m unittest discover -s cuentas
npm --prefix frontend test
```

Las pruebas generan datos ficticios y bases temporales.

## Privacidad y alcance

- Uso local: no exponer el servidor a Internet ni a una red compartida.
- Registro local con correo y contrasena (minimo 12 caracteres). No se envia
  correo de verificacion ni hay recuperacion de contrasenas por correo.
- En ejecucion directa los datos se almacenan en cuentas/datos/; con Docker,
  en el volumen del entorno elegido. No se versionan.
- GitHub respalda el codigo, no la BD, los Excel ni los cortes personales.
- Mantener respaldos independientes de la BD y los originales importados.
- Solo CLP; reparto exacto por persona, con hasta seis decimales.
- Docker local esta disponible. PostgreSQL y despliegue en internet siguen pendientes.

## Personas, cuentas y hogares

La primera cuenta registrada administra el hogar inicial y sus datos existentes.
Hacer esta configuracion desde el equipo de confianza antes de permitir otros
usuarios. El primer hogar se llama Departamento; su direccion se puede editar
desde Hogares y personas. No se incluyen direcciones personales en el repositorio.

Cada hogar tiene nombre, direccion e integrantes. Cada integrante posee un UUID
independiente y puede existir sin cuenta de acceso. Para vincular una cuenta,
su titular solicita el ID y un administrador del hogar aprueba la solicitud.
Conocer el ID nunca concede acceso por si solo. Una cuenta puede vincular varios
IDs, incluso creados en hogares distintos: no se fusionan ni duplican gastos.

Los integrantes vinculados pueden consultar y gestionar todos los gastos del
hogar; solo administradores gestionan integrantes y solicitudes. Retirar a una
persona revoca su acceso por esa ficha, sin borrar sus repartos ni los cortes.
Siempre debe quedar al menos un administrador activo. Los cambios posteriores
a un corte se presentan como ajustes por persona, no como otro gasto completo.

Archivar un hogar es una preferencia personal: lo quita de la lista activa de
esa cuenta, sin afectar a los demas integrantes ni borrar datos. El Historial
de hogares conserva su ID, direccion, estado y fechas disponibles; permite
reactivarlo mientras la cuenta conserve una pertenencia activa. No permite
recuperar permisos que un administrador haya revocado. Los hogares anteriores
a esta ampliacion aparecen sin fecha de creacion registrada.

La creacion admite reintentos con el mismo identificador de solicitud sin
crear otra base. Tambien rechaza un nuevo hogar con nombre y direccion iguales
a uno ya vinculado a la cuenta, incluso archivado. No fusiona duplicados previos.
Seleccionar o crear un hogar desde Hogares y personas mantiene ese modulo;
el selector lateral y el boton Ir a Revision abren la revision del hogar elegido.

Para conservar el motor local y aislar todas las consultas, importaciones,
duplicados y exportaciones, esta etapa utiliza una base SQLite por hogar y un
directorio central de identidades. No es todavia una migracion a PostgreSQL.
Con `--db carpeta/cuentas.sqlite3`, se guardan:

- `cuentas.sqlite3`: datos del hogar inicial.
- `cuentas-identidades.sqlite3`: cuentas, hashes de contrasenas, sesiones,
  hogares, personas, pertenencias y solicitudes. Las sesiones duran 12 horas.
- `cuentas-hogares/<id>/cuentas.sqlite3`: otros hogares y sus originales.
- `cuentas-antes-hogares.sqlite3`: respaldo consistente previo a la primera
  migracion, si ya existia una base. No se sobrescribe.

Respaldar la carpeta completa con el servidor detenido, incluidos los originales.
Las bases no estan cifradas en disco: el login de la aplicacion no protege contra
alguien que tenga acceso a los archivos del equipo. El correo es un identificador
local, no una identidad verificada. Para acceder desde otro dispositivo se
necesitara una etapa posterior de alojamiento seguro; no abrir puertos ahora.

La migracion conserva los campos historicos `mi` y `amor` como totales de
compatibilidad internos (primera persona y resto). Los repartos por UUID son
la fuente para las vistas nuevas, los cortes, estadisticas y exportaciones.
No escribir directamente en esos campos ni usar herramientas de versiones
anteriores contra una base ya migrada. Para volver a v1.0.0 usar su respaldo,
no la base modificada; los cambios nuevos no estaran en ese respaldo.

Consultar cuentas/LEEME.md para los comandos y el formato de importacion.
Las licencias de componentes externos figuran en THIRD_PARTY_NOTICES.md.

### Mi cuenta

El nombre al pie del menu abre la gestion de la cuenta, tambien disponible sin
hogares activos. Permite editar el nombre de acceso (independiente de los nombres
de las personas) y cambiar la contrasena verificando la actual. El cambio de
contrasena cierra todas las sesiones.

Eliminar cuenta es una baja logica: desactiva el acceso y sus pertenencias,
revoca todas las sesiones y rechaza solicitudes de vinculacion pendientes.
Conserva personas, datos personales y gastos compartidos; no es un borrado de
datos personales. Exige contrasena actual y confirmacion. Si es la unica cuenta
administradora de un hogar, incluso archivado, primero debe asignar otra cuenta
administradora activa. No hay recuperacion desde la interfaz ni se permite
registrarse otra vez con el mismo correo.
