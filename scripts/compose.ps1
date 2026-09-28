# Platform adaptation only; Windows uses the container user declared by Compose.
$ErrorActionPreference = 'Stop'
$base, $encrypted, $plain, $lock = $args[1..4]
[System.IO.Directory]::CreateDirectory((Split-Path -Parent $lock)) | Out-Null
try {
    $handle = [System.IO.File]::Open($lock, 'OpenOrCreate', 'ReadWrite', 'None')
} catch {
    throw "Already running: $lock"
}
try {
    $composeArguments = @('compose')
    if (Test-Path -LiteralPath $encrypted -PathType Leaf) {
        $composeArguments += @('--env-file', $encrypted)
    }
    if (Test-Path -LiteralPath $plain -PathType Leaf) {
        $composeArguments += @('--env-file', $plain)
    }
    $composeArguments += @('-f', $base)
    $composeArguments += $args[5..($args.Count - 1)]
    & docker @composeArguments
    $code = $LASTEXITCODE
} finally {
    $handle.Dispose()
}
exit $code
