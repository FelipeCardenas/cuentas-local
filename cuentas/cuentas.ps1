$runtime = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
if (-not (Test-Path -LiteralPath $runtime)) {
    throw 'No se encontro Python del entorno. Instale Python con openpyxl y ejecute gestor.py.'
}
& $runtime (Join-Path $PSScriptRoot 'gestor.py') @args
exit $LASTEXITCODE
