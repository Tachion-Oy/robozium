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
        'local/tools',
        'local/skills',
        '.runtime/local-deps'
    )
    foreach ($directory in $runtimeDirectories) {
        [System.IO.Directory]::CreateDirectory($directory) | Out-Null
    }
    $composeEnvironment = & docker @composeArguments config --environment
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    $localDirs = $composeEnvironment |
        Where-Object { $_.StartsWith('ROBOZIUM_LOCAL_DIRS=') } |
        ForEach-Object { $_.Substring('ROBOZIUM_LOCAL_DIRS='.Length) }
    Remove-Variable composeEnvironment
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

    & docker @composeArguments up --build --exit-code-from api
    $composeExitCode = $LASTEXITCODE
} finally {
    $launchLockHandle.Dispose()
}
exit $composeExitCode
