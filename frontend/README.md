# Frontend React

## Estructura

- App.jsx: navegacion, configuracion, notificaciones y coordinacion de modales.
- Accounts.jsx: registro, sesion, hogares, integrantes y vinculacion de IDs.
- Allocations.jsx: resumen de importes por persona.
- Ledger.jsx: filtros, totales, paginacion, exportacion y confirmacion masiva.
- Review.jsx: edicion, reparto, confirmacion, duplicados y descarte reversible.
- Import.jsx: seleccion, vista previa y confirmacion del Excel.
- Categories.jsx: maestro, fusion y acceso al historico filtrado.
- Cuts.jsx: consulta, seleccion y validacion de cortes con token del servidor.
- Statistics.jsx: comparativa, proyeccion y explicacion de variaciones con Chart.js.
- api.js, ui.jsx y domain.js: transporte, componentes comunes y calculos puros.

Los componentes usan estado React. No cargan los antiguos app.js, cortes.js ni
estadisticas.js, no insertan HTML con innerHTML y no incluyen CDN. Se conserva
la hoja de estilos existente para mantener el diseno, mas ajustes responsive.
Los importes editados se envian como cadenas con hasta seis decimales; el
servidor sigue siendo la autoridad para estados, totales y cortes.

## Desarrollo

Instalar Node.js 22.12+ con npm y Python con cuentas/requirements.txt.
En la raiz del repositorio:

```sh
npm --prefix frontend ci
npm --prefix frontend run build
python cuentas/servidor.py --port 8765
```

En otra terminal, para recarga automatica de componentes:

```sh
npm --prefix frontend run dev
```

Vite imprime su URL local y reenvia /api al backend en 127.0.0.1:8765.
Para otro backend, establecer CUENTAS_API_URL antes de iniciar Vite. No publicar
este servidor de desarrollo en Internet. El backend mantiene Host, Origin y
token de solicitudes, sesion HttpOnly y autorizacion por hogar en cada peticion.

Para usar el acceso directo de Windows, compilar primero y reiniciar el servidor
existente: un proceso Python ya iniciado no recarga los cambios de servidor.py.
No borrar datos. La etapa de hogares amplia el esquema y crea un directorio de
identidades; revisar el apartado de respaldos y migracion del README principal.

## Pruebas

```sh
npm --prefix frontend test
python -m unittest discover -s cuentas
```

Pruebas completas de navegador (desde frontend/):

```sh
npx playwright install chromium
npm run test:e2e
```

Si Python no esta en PATH, establecer PYTHON con la ruta al ejecutable.
En Windows se puede usar Edge instalado estableciendo PLAYWRIGHT_CHANNEL=msedge
en vez de descargar Chromium. En PowerShell: `$env:PLAYWRIGHT_CHANNEL='msedge'`.

El test E2E crea una BD y Excel ficticios en un directorio temporal, levanta su
propio backend en un puerto libre y lo detiene al terminar. No se conecta a la
BD real ni a un servidor existente. Las capturas quedan en work/react-qa/,
excluidas de Git. Comprueba paginacion, reparto, confirmacion, descarte y
restauracion, categorias, filtros, XLSX, graficos, importacion repetida y cortes.
Tambien comprueba registro, permisos de dos cuentas, aislamiento entre hogares,
repartos de tres integrantes, solicitudes, aprobaciones, varios IDs por cuenta,
retiro de integrantes, cierre de sesion y vistas moviles.

## Versionado

Incluir package-lock.json y usar npm ci. No incluir node_modules, web-react,
capturas, fixtures generados ni bases de datos. No se han hecho commits o push
automaticos: revisar los cambios en develop antes de publicar.

La etiqueta v1.0.0 conserva la version estable anterior. Los scripts legacy
quedan como referencia temporal para comparar, no como dependencia de React.
