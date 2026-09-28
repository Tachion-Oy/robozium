$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Join-Path $PSScriptRoot '..')
& process-compose -f process-compose.yaml -e .env.encrypt -e .env --no-server '-t=false' up live-windows
exit $LASTEXITCODE
