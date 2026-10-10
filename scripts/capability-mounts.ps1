# Print a Compose override for extra capability directories; run from the checkout.
param([string]$Directories = '')
$ErrorActionPreference = 'Stop'

if ($Directories.Contains("`n") -or $Directories.Contains("`r")) {
    throw 'ROBOZIUM_LOCAL_DIRS must be a semicolon-separated single line'
}
$seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
[void]$seen.Add((Resolve-Path -LiteralPath 'local').ProviderPath)
$mounts = @()
$containerDirectories = @()
foreach ($entry in $Directories.Split(';')) {
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
@{ services = @{ api = $api } } | ConvertTo-Json -Depth 6
