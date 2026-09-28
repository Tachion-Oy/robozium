$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Join-Path $PSScriptRoot '..')
& process-compose -f process-compose.yaml --disable-dotenv --no-server '-t=false' up mock
exit $LASTEXITCODE
