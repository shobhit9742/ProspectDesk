$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$packageDirectory = Join-Path $projectRoot 'output'
New-Item -ItemType Directory -Force -Path $packageDirectory | Out-Null
$packagePath = Join-Path $packageDirectory ('ProspectDesk-source-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.zip')
$archive = [System.IO.Compression.ZipFile]::Open($packagePath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  $files = Get-ChildItem -LiteralPath $projectRoot -File -Recurse -Force | Where-Object {
    $relative = $_.FullName.Substring($projectRoot.Length + 1).Replace('\', '/')
    $relative -notmatch '(^|/)(node_modules|dist|\.local|\.git|\.impeccable|output|graft|tmp|\.cache)(/|$)' -and
    $_.Name -notin @('.env', '.ignore') -and $_.Name -notlike '.env.*' -and
    $_.Extension -notin @('.log', '.tsbuildinfo') -and
    $relative -notmatch '(^|/)(coverage|playwright-report|test-results)(/|$)'
  }
  foreach ($file in $files) {
    $entry = $file.FullName.Substring($projectRoot.Length + 1).Replace('\', '/')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $entry) | Out-Null
  }
  $examplePath = Join-Path $projectRoot 'server/.env.example'
  [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $examplePath, 'server/.env.example') | Out-Null
} finally { $archive.Dispose() }
$check = [System.IO.Compression.ZipFile]::OpenRead($packagePath)
try {
  if ($check.Entries.FullName -match '(^|/)(\.env|node_modules|\.local)(/|$)') { throw 'Unexpected private/runtime entry in package.' }
  Write-Output ('Source package: ' + $packagePath)
  Write-Output ('Entries: ' + $check.Entries.Count)
} finally { $check.Dispose() }
