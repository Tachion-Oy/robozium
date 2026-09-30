# Launch the application independently of optional host processes.
$ErrorActionPreference = 'Stop'
$mode = $args[0]
$base, $encrypted, $plain, $lock = $args[2..5]
[System.IO.Directory]::CreateDirectory((Split-Path -Parent $lock)) | Out-Null
try {
    $handle = [System.IO.File]::Open($lock, 'OpenOrCreate', 'ReadWrite', 'None')
} catch {
    throw "Already running: $lock"
}
$supervisor = $null
try {
    $composeArguments = @('compose')
    if (Test-Path -LiteralPath $encrypted -PathType Leaf) {
        $composeArguments += @('--env-file', $encrypted)
    }
    if (Test-Path -LiteralPath $plain -PathType Leaf) {
        $composeArguments += @('--env-file', $plain)
    }
    $composeArguments += @('-f', $base)
    $env:ROBOZIUM_MODE = $mode
    if ($mode -eq 'live') {
        $hub = & docker @composeArguments config --environment |
            Where-Object { $_.StartsWith('ROBOZIUM_HUB_ROOT=') } |
            ForEach-Object { $_.Substring('ROBOZIUM_HUB_ROOT='.Length) }
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        $env:ROBOZIUM_HOST_HUB_DIR = if ($hub) { $hub } else { '../Robozium-Hub' }
        $env:ROBOZIUM_HOST_LOG_DIR = '.runtime/logs'
        $env:ROBOZIUM_HOST_SOCKET_DIR = '.runtime/host-socket'
    } else {
        $env:ROBOZIUM_HOST_HUB_DIR = '.runtime/mock-hub'
        $env:ROBOZIUM_HOST_LOG_DIR = '.runtime/mock-logs'
        $env:ROBOZIUM_HOST_SOCKET_DIR = '.runtime/mock-socket'
    }
    foreach ($path in @((Join-Path $env:ROBOZIUM_HOST_HUB_DIR 'readonly/safe-scripts'),
            $env:ROBOZIUM_HOST_LOG_DIR, $env:ROBOZIUM_HOST_SOCKET_DIR, 'local', '.runtime/local-deps')) {
        [System.IO.Directory]::CreateDirectory($path) | Out-Null
    }
    if ($mode -eq 'live' -and (Get-Command process-compose -ErrorAction SilentlyContinue)) {
        try {
            $supervisor = Start-Process process-compose -PassThru -NoNewWindow `
                -ArgumentList @('-f', 'process-compose.yaml', '--disable-dotenv', '--no-server', '-t=false', '-n', 'live-windows', 'up') `
                -RedirectStandardOutput "$env:ROBOZIUM_HOST_LOG_DIR/host-services.log" `
                -RedirectStandardError "$env:ROBOZIUM_HOST_LOG_DIR/host-services.err.log"
        } catch {
            Add-Content "$env:ROBOZIUM_HOST_LOG_DIR/host-services.err.log" 'Optional host supervisor could not start.'
        }
    }
    $applicationArguments = $args[6..($args.Count - 1)]
    & docker @composeArguments @applicationArguments
    $code = $LASTEXITCODE
} finally {
    if ($supervisor -and -not $supervisor.HasExited) {
        & taskkill /PID $supervisor.Id /T /F > $null 2>&1
    }
    $handle.Dispose()
}
exit $code
