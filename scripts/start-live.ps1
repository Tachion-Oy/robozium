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

$hostSupervisorProcess = $null
try {
    $env:ROBOZIUM_MODE = 'live'
    # Compose owns dotenv parsing and environment precedence.
    $composeEnvironment = & docker @composeArguments config --environment
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    $hubRoot = $composeEnvironment |
        Where-Object { $_.StartsWith('ROBOZIUM_HUB_ROOT=') } |
        ForEach-Object { $_.Substring('ROBOZIUM_HUB_ROOT='.Length) }
    $localDirs = $composeEnvironment |
        Where-Object { $_.StartsWith('ROBOZIUM_LOCAL_DIRS=') } |
        ForEach-Object { $_.Substring('ROBOZIUM_LOCAL_DIRS='.Length) }
    Remove-Variable composeEnvironment
    $env:ROBOZIUM_HOST_HUB_DIR = if ($hubRoot) { $hubRoot } else { '../Robozium-Hub' }
    $env:ROBOZIUM_HOST_LOG_DIR = '.runtime/logs'
    $env:ROBOZIUM_HOST_SOCKET_DIR = '.runtime/host-socket'
    # Docker needs these bind-mount sources before starting the container.
    # Python initializes the application directories inside the mounted hub.
    $runtimeDirectories = @(
        (Join-Path $env:ROBOZIUM_HOST_HUB_DIR 'readonly/safe-scripts'),
        $env:ROBOZIUM_HOST_LOG_DIR,
        $env:ROBOZIUM_HOST_SOCKET_DIR,
        'local/tools',
        'local/skills',
        '.runtime/local-deps'
    )
    foreach ($directory in $runtimeDirectories) {
        [System.IO.Directory]::CreateDirectory($directory) | Out-Null
    }
    $localDirs = [string]$localDirs
    if ($localDirs.Contains("`n") -or $localDirs.Contains("`r")) {
        throw 'ROBOZIUM_LOCAL_DIRS must be a semicolon-separated single line'
    }
    $seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    [void]$seen.Add((Resolve-Path -LiteralPath 'local').ProviderPath)
    $mounts = @()
    $containerDirectories = @()
    foreach ($entry in $localDirs.Split(';')) {
        $directory = $entry.Trim()
        if (-not $directory) { continue }
        if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
            throw "ROBOZIUM_LOCAL_DIRS directory does not exist: $directory"
        }
        $source = (Resolve-Path -LiteralPath $directory).ProviderPath
        if (-not $seen.Add($source)) { continue }
        $target = "/app/.runtime/capability-roots/$($mounts.Count)"
        $mounts += @{
            type = 'bind'
            source = $source.Replace('$', '$$')
            target = $target
            read_only = $true
            bind = @{ create_host_path = $false }
        }
        $containerDirectories += $target
    }
    $api = @{ environment = @{ ROBOZIUM_LOCAL_DIRS = ($containerDirectories -join ';') } }
    if ($mounts.Count) { $api.volumes = $mounts }
    @{ services = @{ api = $api } } | ConvertTo-Json -Depth 6 |
        Set-Content -LiteralPath '.runtime/capability-mounts.yaml' -Encoding UTF8
    $composeArguments += @('-f', '.runtime/capability-mounts.yaml')

    if (Get-Command process-compose -ErrorAction SilentlyContinue) {
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
