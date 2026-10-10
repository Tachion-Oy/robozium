$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'launch.ps1') -Mode mock
exit $LASTEXITCODE
