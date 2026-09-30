$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Join-Path $PSScriptRoot '..')
& ./scripts/compose.ps1 -Mode mock
exit $LASTEXITCODE
