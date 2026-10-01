# Cuentas Local

Aplicacion local para importar movimientos bancarios en Excel, revisar gastos,
asignar categorias, distribuir importes entre dos personas, guardar cortes
y consultar estadisticas. Backend Python, frontend HTML/CSS/JavaScript y SQLite.

## Instalacion

Requiere Python 3.12 (version probada). Desde la raiz del proyecto:

```sh
python -m venv .venv
```

Activar el entorno en Windows PowerShell con `.\.venv\Scripts\Activate.ps1`
o en Linux/macOS con `source .venv/bin/activate`. Luego:

```sh
python -m pip install -r cuentas/requirements.txt
python cuentas/servidor.py --auto-port
```

Abrir la direccion local que imprime el servidor. La primera ejecucion crea
una base vacia; este repositorio no incluye movimientos ni archivos bancarios.
Los lanzadores .cmd/.ps1 existentes usan un runtime local de Codex; para una
instalacion independiente usar los comandos anteriores.

## Pruebas

```sh
python -m unittest discover -s cuentas
```

Las pruebas generan datos ficticios y bases temporales.

## Privacidad y alcance

- Uso local: no exponer el servidor a Internet ni a una red compartida.
- No hay login multiusuario. El token local no sustituye autenticacion.
- Los datos se almacenan en cuentas/datos/ y no se versionan.
- GitHub respalda el codigo, no la BD, los Excel ni los cortes personales.
- Mantener respaldos independientes de la BD y los originales importados.
- Solo CLP; el reparto actual es para dos participantes (Mi y Amor).
- Docker, PostgreSQL, React y hogares multiusuario quedan fuera de esta version.

Consultar cuentas/LEEME.md para los comandos y el formato de importacion.
Las licencias de componentes externos figuran en THIRD_PARTY_NOTICES.md.
