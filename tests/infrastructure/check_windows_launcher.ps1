$ErrorActionPreference = 'Stop'
$source = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$case = Join-Path $env:RUNNER_TEMP ('robozium runtime ' + [Guid]::NewGuid().ToString('N'))
$checkout = Join-Path $case 'checkout with spaces'
$bin = Join-Path $case 'bin'
[System.IO.Directory]::CreateDirectory($checkout) | Out-Null
[System.IO.Directory]::CreateDirectory($bin) | Out-Null
[System.IO.Directory]::CreateDirectory((Join-Path $checkout 'scripts')) | Out-Null
foreach ($file in @('start.cmd', 'process-compose.yaml', 'compose.yaml')) {
    Copy-Item -LiteralPath (Join-Path $source $file) -Destination (Join-Path $checkout $file)
}
foreach ($file in @('start-live.ps1', 'start-mock.ps1', 'compose.ps1')) {
    Copy-Item -LiteralPath (Join-Path $source "scripts/$file") -Destination (Join-Path $checkout "scripts/$file")
}
$dockerArgs = Join-Path $case 'docker-args.txt'
$dockerEnv = Join-Path $case 'docker-env.txt'
@'
@echo off
if not "%1"=="compose" exit /b 9
echo %* > "%TEST_DOCKER_ARGS%"
echo %ROBOZIUM_HUB_ROOT% > "%TEST_DOCKER_ENV%"
exit /b 0
'@ | Set-Content -LiteralPath (Join-Path $bin 'docker.cmd')
$savedPath = $env:PATH
$env:PATH = "$bin;$savedPath"
$env:TEST_DOCKER_ARGS = $dockerArgs
$env:TEST_DOCKER_ENV = $dockerEnv
try {
    Set-Location -LiteralPath $checkout
    & cmd /c start.cmd --mock
    if ($LASTEXITCODE -ne 0) { throw "Mock launcher exited $LASTEXITCODE" }
    if ((Get-Content -LiteralPath $dockerArgs -Raw) -notmatch 'up --build --exit-code-from api') {
        throw 'Incorrect mock service selection'
    }
    & cmd /c start.cmd bad
    if ($LASTEXITCODE -ne 2) { throw 'Invalid arguments were accepted' }

    $hub = Join-Path $case 'Live Hub with spaces'
    "ROBOZIUM_HUB_ROOT='$hub'" | Set-Content -LiteralPath (Join-Path $checkout '.env.encrypt')
    & cmd /c start.cmd
    if ($LASTEXITCODE -ne 0) { throw "Live launcher exited $LASTEXITCODE" }
    if ((Get-Content -LiteralPath $dockerEnv -Raw).Trim() -ne $hub) {
        throw 'Incorrect live hub environment'
    }
    if ((Get-Content -LiteralPath $dockerArgs -Raw) -notmatch 'up --build --exit-code-from api') {
        throw 'Incorrect Windows live service selection'
    }
    if ((Get-Content -LiteralPath $dockerArgs -Raw) -notmatch '--env-file .env.encrypt') {
        throw 'Encrypted input was not passed to Docker Compose'
    }
    Write-Host 'Windows launcher mock/live, validation, encrypted input, and spaced paths passed.'
} finally {
    $env:PATH = $savedPath
    Set-Location -LiteralPath $source
    Remove-Item -LiteralPath $case -Recurse -Force
}
