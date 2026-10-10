param([ValidateSet('live', 'mock')][string]$Mode = 'live')
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Join-Path $PSScriptRoot '..')
$env:ROBOZIUM_MODE = $Mode
$env:ROBOZIUM_LAUNCHER_WEB_PORT = [string]$env:ROBOZIUM_WEB_PORT
$control = '.runtime/env-control'
[System.IO.Directory]::CreateDirectory($control) | Out-Null
try { $launchLock = [System.IO.File]::Open('.runtime/launch.lock', 'OpenOrCreate', 'ReadWrite', 'None') }
catch { throw 'Already running: .runtime/launch.lock' }
$script:supervisor = $null
$script:started = $false
$utf8 = New-Object System.Text.UTF8Encoding $false

function Write-AtomicText([string]$Path, [string]$Text) {
    $temporary = "$Path.next"
    [System.IO.File]::WriteAllText($temporary, $Text, $utf8)
    if (Test-Path -LiteralPath $Path) {
        # Windows PowerShell converts $null to an empty string for this .NET
        # argument. NullString supplies the actual null backup path.
        [System.IO.File]::Replace($temporary, $Path, [System.Management.Automation.Language.NullString]::Value)
    }
    else { [System.IO.File]::Move($temporary, $Path) }
}
function Set-Status([string]$Status) { Write-AtomicText "$control/status" $Status }
function Invoke-ComposeFile([string]$SettingsFile, [string[]]$ComposeArgs) {
    $arguments = @('compose')
    foreach ($file in @($SettingsFile, '.env')) {
        if (Test-Path -LiteralPath $file -PathType Leaf) { $arguments += @('--env-file', $file) }
    }
    & docker @arguments @ComposeArgs
}
function Invoke-AppCompose([string[]]$ComposeArgs) {
    Invoke-ComposeFile -SettingsFile '.env.encrypt' -ComposeArgs (@('-f', 'compose.yaml', '-f', '.runtime/capability-mounts.yaml') + $ComposeArgs)
}
function Set-Environment([string]$SettingsFile) {
    $values = Invoke-ComposeFile -SettingsFile $SettingsFile -ComposeArgs @('-f', 'compose.yaml', 'config', '--environment')
    if ($LASTEXITCODE -ne 0) { throw 'Invalid environment configuration' }
    $hub = ''; $script:localDirs = ''
    foreach ($line in $values) {
        if ($line.StartsWith('ROBOZIUM_HUB_ROOT=')) { $hub = $line.Substring('ROBOZIUM_HUB_ROOT='.Length) }
        if ($line.StartsWith('ROBOZIUM_LOCAL_DIRS=')) { $script:localDirs = $line.Substring('ROBOZIUM_LOCAL_DIRS='.Length) }
    }
    $hub = $hub -replace '\\\\', '\'
    $script:localDirs = $script:localDirs -replace '\\\\', '\'
    if (Test-Path Env:ROBOZIUM_HUB_ROOT) { $hub = $env:ROBOZIUM_HUB_ROOT }
    if (Test-Path Env:ROBOZIUM_LOCAL_DIRS) { $script:localDirs = $env:ROBOZIUM_LOCAL_DIRS }
    if ($Mode -eq 'mock') {
        $env:ROBOZIUM_HOST_HUB_DIR = '.runtime/mock-hub'
        $env:ROBOZIUM_HOST_LOG_DIR = '.runtime/mock-logs'
        $env:ROBOZIUM_HOST_SOCKET_DIR = '.runtime/mock-socket'
    } else {
        $env:ROBOZIUM_HOST_HUB_DIR = if ($hub) { $hub } else { '../Robozium-Hub' }
        $env:ROBOZIUM_HOST_LOG_DIR = '.runtime/logs'
        $env:ROBOZIUM_HOST_SOCKET_DIR = '.runtime/host-socket'
    }
}
function New-RuntimeDirectories {
    foreach ($directory in @((Join-Path $env:ROBOZIUM_HOST_HUB_DIR 'readonly/safe-scripts'), $env:ROBOZIUM_HOST_LOG_DIR, $env:ROBOZIUM_HOST_SOCKET_DIR, 'local/tools', 'local/skills', '.runtime/local-deps')) {
        [System.IO.Directory]::CreateDirectory($directory) | Out-Null
    }
}
function Write-CapabilityMounts([string]$Directories, [string]$Destination) {
    if ($Directories.Contains("`n") -or $Directories.Contains("`r")) { throw 'Catalogue paths must be on a single line' }
    $seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    [void]$seen.Add((Resolve-Path -LiteralPath 'local').ProviderPath)
    $mounts = @(); $targets = @()
    foreach ($item in $Directories.Split(';')) {
        $directory = $item.Trim()
        if (-not $directory) { continue }
        if (-not (Test-Path -LiteralPath $directory -PathType Container)) { throw 'Catalogue folder does not exist' }
        $source = (Resolve-Path -LiteralPath $directory).ProviderPath
        if (-not $seen.Add($source)) { continue }
        $target = "/app/.runtime/capability-roots/$($mounts.Count)"
        $mounts += @{ type = 'bind'; source = $source.Replace('$', '$$'); target = $target; read_only = $true; bind = @{ create_host_path = $false } }
        $targets += $target
    }
    $api = @{ environment = @{ ROBOZIUM_LOCAL_DIRS = ($targets -join ';') } }
    if ($mounts.Count) { $api.volumes = $mounts }
    Write-AtomicText $Destination (@{ services = @{ api = $api } } | ConvertTo-Json -Depth 6)
}
function Start-HostProcesses {
    if ($script:supervisor -and -not $script:supervisor.HasExited) { & taskkill /PID $script:supervisor.Id /T /F > $null 2>&1 }
    $script:supervisor = $null
    if ($Mode -ne 'live' -or -not (Get-Command process-compose -ErrorAction SilentlyContinue)) { return }
    try {
        $script:supervisor = Start-Process process-compose -ArgumentList @('-f', 'process-compose.yaml', '--disable-dotenv', '--no-server', '-t=false', '--namespace', 'live-windows', 'up') -PassThru -NoNewWindow -RedirectStandardOutput "$env:ROBOZIUM_HOST_LOG_DIR/host-services.log" -RedirectStandardError "$env:ROBOZIUM_HOST_LOG_DIR/host-services.err.log"
    } catch { $script:supervisor = $null }
}
function Apply-Request {
    Remove-Item -LiteralPath "$control/request"
    $current = if (Test-Path -LiteralPath '.env.encrypt') { [System.IO.File]::ReadAllText('.env.encrypt') } else { '' }
    $expected = [System.IO.File]::ReadAllText("$control/expected")
    if ($current -cne $expected) { Set-Status 'failed_conflict'; return }
    Set-Status 'applying'
    try {
        Set-Environment "$control/candidate"
        Write-CapabilityMounts $script:localDirs "$control/mounts.candidate"
        New-RuntimeDirectories
    } catch { Set-Status 'failed_configuration'; Set-Environment '.env.encrypt'; return }
    Copy-Item -LiteralPath '.runtime/capability-mounts.yaml' -Destination "$control/mounts.previous"
    Write-AtomicText '.env.encrypt' ([System.IO.File]::ReadAllText("$control/candidate"))
    Copy-Item -LiteralPath "$control/mounts.candidate" -Destination '.runtime/capability-mounts.yaml' -Force
    Remove-Item Env:ROBOZIUM_BOOT_ERROR -ErrorAction SilentlyContinue
    Start-HostProcesses
    Invoke-AppCompose -ComposeArgs @('up', '--no-build', '--force-recreate', '--wait', '--wait-timeout', '180', 'api', 'web')
    if ($LASTEXITCODE -eq 0) { Set-Status 'applied'; return }
    Write-AtomicText '.env.encrypt' $expected
    Copy-Item -LiteralPath "$control/mounts.previous" -Destination '.runtime/capability-mounts.yaml' -Force
    Set-Environment '.env.encrypt'
    Start-HostProcesses
    Invoke-AppCompose -ComposeArgs @('up', '--no-build', '--wait', '--wait-timeout', '180', 'api', 'web')
    Set-Status 'failed_restart'
}
try {
    Set-Environment '.env.encrypt'
    New-RuntimeDirectories
    try { Write-CapabilityMounts $script:localDirs '.runtime/capability-mounts.yaml' }
    catch {
        $env:ROBOZIUM_BOOT_ERROR = 'A catalogue folder is unavailable. Correct it in Environment and apply again.'
        Write-CapabilityMounts '' '.runtime/capability-mounts.yaml'
    }
    Set-Status 'idle'
    Start-HostProcesses
    $script:started = $true
    Invoke-AppCompose -ComposeArgs @('up', '--build', '--wait', '--wait-timeout', '180', 'api', 'web')
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    $missing = 0
    while ($true) {
        if (Invoke-AppCompose -ComposeArgs @('ps', '--status', 'running', '-q', 'api')) { $missing = 0 }
        else {
            if (-not (Invoke-AppCompose -ComposeArgs @('ps', '--all', '-q', 'api'))) { break }
            $missing++
            if ($missing -ge 5) { break }
            Start-Sleep -Seconds 1
            continue
        }
        if (Test-Path -LiteralPath "$control/request") {
            if ([System.IO.File]::ReadAllText("$control/request").Trim() -eq 'apply') { Apply-Request }
            else { Remove-Item -LiteralPath "$control/request"; Set-Status 'failed_request' }
        }
        Start-Sleep -Seconds 1
    }
} finally {
    if ($script:supervisor -and -not $script:supervisor.HasExited) { & taskkill /PID $script:supervisor.Id /T /F > $null 2>&1 }
    if ($script:started) { Invoke-AppCompose -ComposeArgs @('stop') | Out-Null }
    $launchLock.Dispose()
}
