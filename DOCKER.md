# Docker local

## Entornos

| Entorno | Compose | Imagen | URL | Volumen |
| --- | --- | --- | --- | --- |
| Pruebas | compose.yaml | cuentas-local:dev | http://127.0.0.1:8768 | cuentas-docker-prueba_datos-prueba |
| Produccion | compose.real.yaml | cuentas-local:prod-20261009-2 | http://127.0.0.1:8767 | cuentas-datos-reales-20261005 |

La rama Git no selecciona el entorno. Produccion ejecuta una imagen previamente
preparada, sin compilar el checkout. Cambiar a develop no cambia el contenedor.
Las etiquetas Docker pueden sobrescribirse: nunca reconstruir una etiqueta prod
existente. Cada entrega debe usar una etiqueta nueva y un codigo revisado en main.
No se despliega en la nube ni se publica ninguna imagen con estos comandos.

## Preparacion inicial de la imagen real

Ejecutar en PowerShell desde la raiz del repositorio, una sola vez. Conserva
exactamente la imagen del contenedor real existente; no usa la etiqueta latest,
que puede haber cambiado. No modifica ni detiene el contenedor ni sus datos.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\cuentas\preparar-imagen-produccion.ps1
docker image ls cuentas-local
```

Este paso conserva la version anterior como `cuentas-local:prod-20261005`.
La entrega actual usa `cuentas-local:prod-20261009-2`, que debe construirse
desde main despues de fusionar el PR, antes de ejecutar el lanzador:

```powershell
docker build -t cuentas-local:prod-20261009-2 .
```

Si la etiqueta nueva ya existe, no sobrescribirla: verificar su origen primero.
Si hay errores, no continuar ni reconstruir produccion desde develop.
La nueva etiqueta puede compartir ID con la anterior: es normal; los futuros
builds de pruebas solo actualizan cuentas-local:dev.

## Inicio como aplicacion

Tras preparar la imagen, ejecutar `cuentas/Abrir Cuentas Produccion.cmd`.
El lanzador inicia Docker Desktop si hace falta, espera al motor, verifica imagen
y volumen, inicia el servicio real y abre el navegador cuando responde.
No descarga imagenes, no compila codigo y no crea el volumen real si falta.
La primera ejecucion puede recrear el contenedor por el cambio de etiqueta,
conservando su volumen. No ejecutar mientras se importa o se guarda un corte.

Para crear un acceso en el escritorio, ejecutar desde la raiz:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\cuentas\crear-acceso-produccion.ps1
```

No mover el repositorio despues de crear el acceso. No requiere VS Code, Python
ni Node en ejecucion. Requiere Docker Desktop instalado y acceso a su motor.
No usar el antiguo `cuentas/Abrir Cuentas.cmd`: inicia Python con otra base.
Cerrar el navegador no detiene el contenedor. No se configura inicio con Windows.

Para detenerlo explicitamente:

```powershell
docker compose -f compose.real.yaml stop
```

## Desarrollo y pruebas

```powershell
docker compose -f compose.yaml up -d --build
```

Abrir http://127.0.0.1:8768. El cambio de puerto permite ejecutar ambos entornos.
El servidor de pruebas escucha tambien internamente en 8768 para conservar
las validaciones de Host/Origin y los nombres de cookie por puerto del servidor.
El volumen de pruebas existente se conserva. Este comando no construye ni
actualiza la imagen de produccion.

## Entregas futuras

1. Probar los cambios en el entorno de pruebas y fusionar el PR hacia main.
2. Desde un checkout limpio del commit revisado, construir una imagen con una
   etiqueta nueva `cuentas-local:prod-<version>`; registrar el commit de origen.
3. Cambiar la imagen de compose.real.yaml a esa etiqueta y revisar el cambio.
4. Con la aplicacion sin operaciones en curso, iniciar el lanzador de produccion.
5. Verificar la aplicacion antes de eliminar cualquier imagen anterior.

Conservar la imagen anterior no garantiza revertir cambios de esquema de BD.
Antes de una entrega con migraciones hace falta un plan de respaldo y restauracion.
La automatizacion de respaldos y la migracion de BD no forman parte de este cambio.
No ejecutar `docker compose down -v`, `docker volume rm` ni limpiezas de volumenes
para actualizar. GitHub conserva codigo, no gastos ni archivos Excel.

## Docker Desktop

Salir de la busqueda global con Clear search. En el menu izquierdo, Images muestra
las imagenes locales, Containers los proyectos y Volumes los datos persistentes.
Los cambios de codigo o de rama no crean imagenes: solo un build o un etiquetado.
Si la vista sigue vacia, comparar sin modificar el contexto:

```powershell
docker context show
docker image ls
docker compose -f compose.real.yaml ps
```

No restablecer Docker Desktop ni borrar datos para solucionar una vista vacia.
