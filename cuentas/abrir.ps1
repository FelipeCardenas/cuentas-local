param([switch]$NoBrowser)

$runtime = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
$script = Join-Path $PSScriptRoot 'servidor.py'
$stdout = Join-Path $PSScriptRoot 'servidor.log'
$stderr = Join-Path $PSScriptRoot 'servidor-error.log'
if (-not (Test-Path -LiteralPath $runtime)) {
    throw "No se encontro Python en $runtime"
}
if (Test-Path -LiteralPath $stdout) {
    $existingUrl = Get-Content -LiteralPath $stdout -First 1
    if ($existingUrl -match '^http://127\.0\.0\.1:\d+$') {
        try {
            $status = Invoke-RestMethod -Uri "$existingUrl/api/config" -TimeoutSec 2
            if ($status.app -eq 'cuentas-local') {
                if (-not $NoBrowser) { Start-Process $existingUrl }
                Write-Output $existingUrl
                exit 0
            }
        } catch { }
    }
}
$process = Start-Process -FilePath $runtime -ArgumentList @("`"$script`"", '--auto-port') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
for ($attempt = 0; $attempt -lt 40; $attempt++) {
    Start-Sleep -Milliseconds 250
    if ($process.HasExited) { throw (Get-Content -LiteralPath $stderr -Raw) }
    if (Test-Path -LiteralPath $stdout) {
        $url = Get-Content -LiteralPath $stdout -First 1
        if ($url -match '^http://127\.0\.0\.1:\d+$') {
            try {
                $status = Invoke-RestMethod -Uri "$url/api/config" -TimeoutSec 2
                if ($status.app -ne 'cuentas-local') { continue }
            } catch { continue }
            if (-not $NoBrowser) { Start-Process $url }
            Write-Output $url
            exit 0
        }
    }
}
throw 'El servidor no respondio. Revise servidor-error.log.'
