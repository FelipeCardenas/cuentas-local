$ErrorActionPreference = 'Stop'
$raw = docker inspect cuentas-docker-real-cuentas-1
if ($LASTEXITCODE -ne 0) { throw 'No se encontro el contenedor real. Detener aqui.' }
$container = @((($raw -join "`n") | ConvertFrom-Json))[0]
$mount = @($container.Mounts | Where-Object { $_.Destination -eq '/data' })
if ($mount.Count -ne 1 -or $mount[0].Name -ne 'cuentas-datos-reales-20261005') {
    throw 'El contenedor no usa el volumen real esperado. No se hicieron cambios.'
}
$tag = 'cuentas-local:prod-20261005'
$existing = docker image ls --no-trunc --quiet $tag
if ($LASTEXITCODE -ne 0) { throw 'No se pudo consultar la imagen. Detener aqui.' }
if ($existing) {
    if ($existing -ne $container.Image) { throw 'La etiqueta ya existe con otra imagen. No se sobrescribio.' }
} else {
    docker image tag $container.Image $tag
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo etiquetar la imagen real.' }
}
Write-Host "Imagen preparada: $tag ($($container.Image))"
Write-Host 'El contenedor y el volumen no fueron modificados.'
