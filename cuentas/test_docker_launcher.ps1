# Isolated launcher tests: Docker, browser and HTTP are replaced with fakes.
$ErrorActionPreference = 'Stop'
$launcher = Join-Path $PSScriptRoot 'abrir-docker.ps1'
function Assert($condition, $message) {
    if (-not $condition) { throw $message }
}
function global:docker {
    $line = $args -join ' '
    $global:Calls.Add($line)
    $global:LASTEXITCODE = 0
    if ($line -like '*config --format json') {
        if ($global:Scenario -eq 'config-fails') { $global:LASTEXITCODE = 1; return }
        $image = if ($global:Scenario -eq 'wrong-image') { 'cuentas-local:dev' } else { 'cuentas-local:prod-20261005' }
        return (@{
            name = 'cuentas-docker-real'
            services = @{ cuentas = @{ image = $image } }
            volumes = @{ 'datos-reales' = @{ name = 'cuentas-datos-reales-20261005'; external = $true } }
        } | ConvertTo-Json -Depth 5)
    }
    if (($line -like 'image inspect*' -and $global:Scenario -eq 'missing-image') -or
        ($line -like 'volume inspect*' -and $global:Scenario -eq 'missing-volume') -or
        ($line -like '* up *' -and $global:Scenario -eq 'up-fails')) {
        $global:LASTEXITCODE = 1
    }
}
function global:Invoke-RestMethod {
    param($Uri, $TimeoutSec)
    Assert ($Uri -eq 'http://127.0.0.1:8767/api/session') 'Puerto real incorrecto'
    if ($global:Scenario -eq 'http-fails') { throw 'Servicio no disponible' }
    return @{ app = 'cuentas-local' }
}
function global:Start-Process {
    param($FilePath)
    $global:Opened.Add($FilePath)
}
try {
    foreach ($scenario in @('ok', 'no-browser', 'wrong-image', 'config-fails', 'missing-image', 'missing-volume', 'up-fails', 'http-fails')) {
        $global:Scenario = $scenario
        $global:Calls = [System.Collections.Generic.List[string]]::new()
        $global:Opened = [System.Collections.Generic.List[string]]::new()
        $failed = $false
        try { & $launcher -NoBrowser:($scenario -eq 'no-browser') -AppTimeoutSeconds 1 }
        catch { $failed = $true }
        $success = $scenario -in @('ok', 'no-browser')
        Assert ($failed -ne $success) "Resultado incorrecto: $scenario"
        $starts = @($global:Calls | Where-Object { $_ -like '* up *' })
        if ($success -or $scenario -in @('up-fails', 'http-fails')) {
            Assert ($starts.Count -eq 1) "Falta inicio de produccion: $scenario"
            Assert ($starts[0] -like '*compose.real.yaml*up -d --no-build --pull never cuentas') 'Inicio inseguro'
        } else { Assert ($starts.Count -eq 0) "Inicio inesperado: $scenario" }
        Assert ($global:Opened.Count -eq [int]($scenario -eq 'ok')) "Navegador inesperado: $scenario"
        Assert (@($global:Calls | Where-Object { $_ -match '\b(build|tag|rm|prune|down)\b' -and $_ -notlike '*--no-build*' }).Count -eq 0) 'Operacion no permitida'
        Write-Host "OK: $scenario"
    }
    function global:docker {
        $line = $args -join ' '
        $global:Calls.Add($line)
        $global:LASTEXITCODE = 0
        if ($line -eq 'inspect cuentas-docker-real-cuentas-1') {
            if ($global:Scenario -eq 'missing-container') { $global:LASTEXITCODE = 1; return }
            $volume = if ($global:Scenario -eq 'wrong-volume') { 'datos-prueba' } else { 'cuentas-datos-reales-20261005' }
            return (@{
                Image = 'sha256:validated'
                Mounts = @(@{ Destination = '/data'; Name = $volume })
            } | ConvertTo-Json -Depth 5)
        }
        if ($line -like 'image ls*') {
            if ($global:Scenario -eq 'same-tag') { return 'sha256:validated' }
            if ($global:Scenario -eq 'different-tag') { return 'sha256:other' }
        }
    }
    foreach ($scenario in @('new-tag', 'same-tag', 'different-tag', 'wrong-volume', 'missing-container')) {
        $global:Scenario = $scenario
        $global:Calls.Clear()
        $failed = $false
        try { & (Join-Path $PSScriptRoot 'preparar-imagen-produccion.ps1') }
        catch { $failed = $true }
        Assert ($failed -eq ($scenario -notin @('new-tag', 'same-tag'))) "Preparacion incorrecta: $scenario"
        $tags = @($global:Calls | Where-Object { $_ -like 'image tag*' })
        Assert ($tags.Count -eq [int]($scenario -eq 'new-tag')) "Etiquetado inesperado: $scenario"
        if ($tags.Count) { Assert ($tags[0] -eq 'image tag sha256:validated cuentas-local:prod-20261005') 'Imagen incorrecta' }
        Assert (@($global:Calls | Where-Object { $_ -match '\b(compose|build|rm|prune|stop|start)\b' }).Count -eq 0) 'Se altero el entorno'
        Write-Host "OK: $scenario"
    }
} finally {
    Remove-Item Function:\docker, Function:\Invoke-RestMethod, Function:\Start-Process
    Remove-Variable Calls, Opened, Scenario -Scope Global -ErrorAction SilentlyContinue
}
