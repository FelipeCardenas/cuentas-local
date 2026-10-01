# Preparacion del repositorio

Alcance de esta etapa: revisar los archivos y preparar exclusiones. No se ha
creado un repositorio Git, hecho commits ni publicado archivos en GitHub.

## Archivos destinados al repositorio

- Codigo Python y pruebas automatizadas en cuentas/.
- Frontend HTML, CSS y JavaScript en cuentas/web/.
- Lanzadores de Windows, requirements.txt y LEEME.md.
- Icono de la aplicacion (ICO y PNG).
- .gitignore y este documento.

## Archivos privados, solo locales

- cuentas/datos/: base SQLite, respaldos y fuentes originales.
- cuentas/entrada/ y cuentas/salida/: importaciones y exportaciones.
- work/ y outputs/: analisis, reparaciones puntuales, copias de pruebas y capturas.
- Logs, accesos directos .lnk, caches y entornos virtuales.
- Variables de entorno, credenciales, claves y certificados privados.

La lista de inclusion es conservadora. Nuevas carpetas y tipos de archivo
requieren revisar .gitignore antes de publicarlos. No usar git add -f para datos.
Ignorar un archivo no lo borra ni constituye un respaldo; tampoco quita archivos
que ya estuvieran versionados. Esta carpeta aun no tiene historial Git.

## Pendientes antes de publicar

- Crear un respaldo independiente y consistente de la BD y originales.
- Revisar la lista exacta y el diff del primer commit, incluidos sus tests.
- Ejecutar las pruebas sobre bases temporales.
- Avisos de Lucide y Feather incluidos en THIRD_PARTY_NOTICES.md.
- La interfaz usa un perfil generico Usuario; conserva Mi/Amor como etiquetas
  funcionales. Las pruebas usan nombres ficticios.
- Los lanzadores dependen del runtime local de Codex. Documentar o adaptar
  la instalacion portable en una etapa posterior.
- El propietario creara y publicara manualmente un repositorio publico.
- Comprobar identidad del autor; usar el correo noreply de GitHub si se desea
  evitar publicar el correo personal en los commits.

No incluir datos reales como fixtures de pruebas. .gitignore no detecta secretos
ni informacion financiera escrita dentro de archivos de codigo permitidos.
