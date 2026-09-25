param([string]$ModeFlag = "")

$ErrorActionPreference = "Stop"
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
Set-Location -LiteralPath $repoRoot

$composeArgs = @()
if (Test-Path -LiteralPath ".env.encrypt" -PathType Leaf) {
    $composeArgs += @("--env-file", ".env.encrypt")
    if (Test-Path -LiteralPath ".env" -PathType Leaf) {
        $composeArgs += @("--env-file", ".env")
    }
}

if ($ModeFlag -eq "--mock") {
    $mode = "mock"
    $hubDir = Join-Path $repoRoot ".runtime/mock-hub"
    $logDir = Join-Path $repoRoot ".runtime/mock-logs"
} elseif ($ModeFlag -eq "") {
    $mode = "live"
    $configuredRoot = $env:ROBOZIUM_HUB_ROOT
    if (-not $configuredRoot) {
        $composeEnvironment = & docker compose @composeArgs config --environment
        if ($LASTEXITCODE -ne 0) {
            throw "Could not read Docker Compose environment."
        }
        foreach ($line in $composeEnvironment) {
            if ($line -match '^ROBOZIUM_HUB_ROOT=(.*)$') {
                $configuredRoot = $Matches[1]
                break
            }
        }
    }
    if (-not $configuredRoot) {
        $configuredRoot = "../Robozium-Hub"
    }
    if ([System.IO.Path]::IsPathRooted($configuredRoot)) {
        $hubDir = [System.IO.Path]::GetFullPath($configuredRoot)
    } else {
        $hubDir = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $configuredRoot))
    }
    $logDir = Join-Path $repoRoot ".runtime/logs"
} else {
    throw "Usage: start.cmd [--mock]"
}

foreach ($directory in @($hubDir, $logDir)) {
    if ((Test-Path -LiteralPath $directory) -and
        -not (Test-Path -LiteralPath $directory -PathType Container)) {
        throw "Storage path is not a directory: $directory"
    }
    [System.IO.Directory]::CreateDirectory($directory) | Out-Null
    $probe = Join-Path $directory (".robozium-write-check-" + [Guid]::NewGuid().ToString("N"))
    try {
        $stream = [System.IO.File]::Open(
            $probe,
            [System.IO.FileMode]::CreateNew,
            [System.IO.FileAccess]::Write,
            [System.IO.FileShare]::None
        )
        $stream.Dispose()
    } catch {
        throw "Storage directory is not writable: $directory"
    } finally {
        if ([System.IO.File]::Exists($probe)) {
            [System.IO.File]::Delete($probe)
        }
    }
}

$env:ROBOZIUM_HOST_HUB_DIR = $hubDir
$env:ROBOZIUM_HOST_LOG_DIR = $logDir
$env:ROBOZIUM_MODE = $mode
$env:ROBOZIUM_API_USER = "10001:10001"

if (Test-Path -LiteralPath ".env.encrypt" -PathType Leaf) {
    & docker compose @composeArgs -f compose.yaml -f compose.encrypted.yaml up --build
} else {
    & docker compose @composeArgs up --build
}
exit $LASTEXITCODE
