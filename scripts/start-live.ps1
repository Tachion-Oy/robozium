$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'launch.ps1') -Mode live
exit $LASTEXITCODE
