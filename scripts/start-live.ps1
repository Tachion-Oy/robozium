$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Join-Path $PSScriptRoot '..')
& ./scripts/compose.ps1 live ROBOZIUM_API_USER compose.yaml .env.encrypt .env .runtime/launch.lock up --build --exit-code-from api
exit $LASTEXITCODE
