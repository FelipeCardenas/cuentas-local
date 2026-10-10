$ErrorActionPreference = 'Stop'
$target = Join-Path $PSScriptRoot 'Abrir Cuentas Produccion.cmd'
$desktop = [Environment]::GetFolderPath('DesktopDirectory')
if (-not $desktop -or -not (Test-Path -LiteralPath $target)) {
    throw 'No se encontro el escritorio o el lanzador de produccion.'
}
$path = Join-Path $desktop 'Cuentas - Produccion.lnk'
if (Test-Path -LiteralPath $path) {
    throw "Ya existe $path. No se sobrescribio el acceso directo."
}
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($path)
$shortcut.TargetPath = $target
$shortcut.WorkingDirectory = Split-Path -Parent $PSScriptRoot
$shortcut.IconLocation = Join-Path $PSScriptRoot 'cuentas.ico'
$shortcut.Description = 'Cuentas: produccion local con datos reales'
$shortcut.Save()
Write-Host "Acceso creado: $path"
