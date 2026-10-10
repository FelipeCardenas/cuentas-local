param(
    [switch]$NoBrowser,
    [ValidateRange(1, 600)][int]$DockerTimeoutSeconds = 120,
    [ValidateRange(1, 120)][int]$AppTimeoutSeconds = 30
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$compose = Join-Path $root 'compose.real.yaml'
$url = 'http://127.0.0.1:8767'
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'No se encontro Docker. Instale Docker Desktop y vuelva a abrir este lanzador.'
}
if (-not (Test-Path -LiteralPath $compose)) { throw "No existe $compose" }

# The launcher never builds the working tree or chooses an environment by branch.
function Test-DockerEngine {
    $ErrorActionPreference = 'Continue'
    docker info --format '{{.OSType}}' *> $null
    return $LASTEXITCODE -eq 0
}
if (-not (Test-DockerEngine)) {
    $desktop = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
    if (-not (Test-Path -LiteralPath $desktop)) {
        throw 'Abra Docker Desktop, espere Engine running y vuelva a intentarlo.'
    }
    Write-Host 'Esperando a Docker Desktop...'
    Start-Process -FilePath $desktop -WindowStyle Hidden
    $deadline = (Get-Date).AddSeconds($DockerTimeoutSeconds)
    do {
        Start-Sleep -Seconds 2
        $ready = Test-DockerEngine
    } while (-not $ready -and (Get-Date) -lt $deadline)
    if (-not $ready) {
        throw 'Docker no responde. Revise Docker Desktop y los permisos de su usuario.'
    }
}

$configText = docker compose --project-directory $root -f $compose config --format json
if ($LASTEXITCODE -ne 0) { throw 'No se pudo validar compose.real.yaml.' }
$config = ($configText -join "`n") | ConvertFrom-Json
$image = $config.services.cuentas.image
$volume = $config.volumes.'datos-reales'.name
if (-not $image -or -not $volume -or $config.name -ne 'cuentas-docker-real' -or
    $config.volumes.'datos-reales'.external -ne $true -or
    $image -notmatch '^cuentas-local:prod-[a-zA-Z0-9_.-]+$') {
    throw 'La configuracion no corresponde al entorno real con imagen versionada y volumen externo.'
}
docker image inspect $image *> $null
if ($LASTEXITCODE -ne 0) {
    throw "Falta la imagen $image. Complete la preparacion descrita en DOCKER.md. No se compilara develop."
}
docker volume inspect $volume *> $null
if ($LASTEXITCODE -ne 0) {
    throw "No existe el volumen real $volume. No se creara una base vacia."
}

docker compose --project-directory $root -f $compose up -d --no-build --pull never cuentas
if ($LASTEXITCODE -ne 0) {
    throw 'No se pudo iniciar produccion. Revise Docker y si el puerto 8767 esta ocupado.'
}
$deadline = (Get-Date).AddSeconds($AppTimeoutSeconds)
do {
    $session = $null
    try {
        $session = Invoke-RestMethod -Uri "$url/api/session" -TimeoutSec 2
    } catch { }
    if ($session -and $session.app -eq 'cuentas-local') {
        Write-Host "Produccion lista: $url ($image)"
        if (-not $NoBrowser) { Start-Process $url }
        return
    }
    Start-Sleep -Milliseconds 500
} while ((Get-Date) -lt $deadline)
throw 'El servicio no respondio. Revise: docker compose -f compose.real.yaml logs --tail 30 cuentas'
