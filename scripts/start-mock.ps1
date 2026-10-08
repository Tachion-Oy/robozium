$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Join-Path $PSScriptRoot '..')

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

try {
    $env:ROBOZIUM_MODE = 'mock'
    $env:ROBOZIUM_HOST_HUB_DIR = '.runtime/mock-hub'
    $env:ROBOZIUM_HOST_LOG_DIR = '.runtime/mock-logs'
    $env:ROBOZIUM_HOST_SOCKET_DIR = '.runtime/mock-socket'
    # Docker needs these bind-mount sources before starting the container.
    # Python initializes the application directories inside the mounted hub.
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
    if (-not (Test-Path -LiteralPath 'local/__init__.py')) {
        Copy-Item -LiteralPath 'examples/local-registration.py' -Destination 'local/__init__.py'
    }

    & docker @composeArguments up --build --exit-code-from api
    $composeExitCode = $LASTEXITCODE
} finally {
    $launchLockHandle.Dispose()
}
exit $composeExitCode
