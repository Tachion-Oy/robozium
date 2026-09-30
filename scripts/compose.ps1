# Launch the application independently of optional host processes.
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet('live', 'mock')]
    [string]$Mode
)

$ErrorActionPreference = 'Stop'

$composeArguments = @('compose')
foreach ($envFile in @('.env.encrypt', '.env')) {
    if (Test-Path -LiteralPath $envFile -PathType Leaf) {
        $composeArguments += @('--env-file', $envFile)
    }
}
$composeArguments += @('-f', 'compose.yaml')

$launchLockPath = '.runtime/launch.lock'
[System.IO.Directory]::CreateDirectory('.runtime') | Out-Null
try {
    $launchLockHandle = [System.IO.File]::Open($launchLockPath, 'OpenOrCreate', 'ReadWrite', 'None')
} catch {
    throw "Already running: $launchLockPath"
}

$hostSupervisorProcess = $null
try {
    $env:ROBOZIUM_MODE = $Mode
    if ($Mode -eq 'live') {
        # Compose owns dotenv parsing and environment precedence.
        $hubRoot = & docker @composeArguments config --environment |
            Where-Object { $_.StartsWith('ROBOZIUM_HUB_ROOT=') } |
            ForEach-Object { $_.Substring('ROBOZIUM_HUB_ROOT='.Length) }
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        $env:ROBOZIUM_HOST_HUB_DIR = if ($hubRoot) { $hubRoot } else { '../Robozium-Hub' }
        $env:ROBOZIUM_HOST_LOG_DIR = '.runtime/logs'
        $env:ROBOZIUM_HOST_SOCKET_DIR = '.runtime/host-socket'
    } else {
        $env:ROBOZIUM_HOST_HUB_DIR = '.runtime/mock-hub'
        $env:ROBOZIUM_HOST_LOG_DIR = '.runtime/mock-logs'
        $env:ROBOZIUM_HOST_SOCKET_DIR = '.runtime/mock-socket'
    }
    $runtimeDirectories = @(
        (Join-Path $env:ROBOZIUM_HOST_HUB_DIR 'readonly/safe-scripts'),
        $env:ROBOZIUM_HOST_LOG_DIR,
        $env:ROBOZIUM_HOST_SOCKET_DIR,
        'local',
        '.runtime/local-deps'
    )
    foreach ($directory in $runtimeDirectories) {
        [System.IO.Directory]::CreateDirectory($directory) | Out-Null
    }

    if ($Mode -eq 'live' -and (Get-Command process-compose -ErrorAction SilentlyContinue)) {
        $hostSupervisorOptions = @{
            FilePath = 'process-compose'
            ArgumentList = @(
                '-f', 'process-compose.yaml',
                '--disable-dotenv', '--no-server', '-t=false',
                '--namespace', 'live-windows', 'up'
            )
            PassThru = $true
            NoNewWindow = $true
            RedirectStandardOutput = "$env:ROBOZIUM_HOST_LOG_DIR/host-services.log"
            RedirectStandardError = "$env:ROBOZIUM_HOST_LOG_DIR/host-services.err.log"
        }
        try {
            $hostSupervisorProcess = Start-Process @hostSupervisorOptions
        } catch {
            Add-Content -LiteralPath $hostSupervisorOptions.RedirectStandardError -Value 'Optional host supervisor could not start.'
        }
    }

    & docker @composeArguments up --build --exit-code-from api
    $composeExitCode = $LASTEXITCODE
} finally {
    if ($hostSupervisorProcess -and -not $hostSupervisorProcess.HasExited) {
        & taskkill /PID $hostSupervisorProcess.Id /T /F > $null 2>&1
    }
    $launchLockHandle.Dispose()
}
exit $composeExitCode
