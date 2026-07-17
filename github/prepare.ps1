[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$destination = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'repository'))
$expectedPrefix = [System.IO.Path]::GetFullPath($PSScriptRoot) + [System.IO.Path]::DirectorySeparatorChar

if (-not $destination.StartsWith($expectedPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Unsafe GitHub staging destination: $destination"
}

if (Test-Path -LiteralPath $destination) {
  Remove-Item -LiteralPath $destination -Recurse -Force
}
New-Item -ItemType Directory -Path $destination | Out-Null

$entries = Get-Content (Join-Path $PSScriptRoot 'manifest.txt') |
  ForEach-Object { $_.Trim() } |
  Where-Object { $_ -and -not $_.StartsWith('#') }

foreach ($entry in $entries) {
  $source = [System.IO.Path]::GetFullPath((Join-Path $projectRoot $entry))
  $target = [System.IO.Path]::GetFullPath((Join-Path $destination $entry))

  if (-not $source.StartsWith($projectRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Manifest entry escapes project root: $entry"
  }
  if (-not $target.StartsWith($destination + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Manifest entry escapes staging directory: $entry"
  }
  if (-not (Test-Path -LiteralPath $source)) {
    throw "Manifest entry does not exist: $entry"
  }

  New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
  Copy-Item -LiteralPath $source -Destination $target -Recurse -Force
}

& (Join-Path $PSScriptRoot 'audit.ps1') -Path $destination
if ($LASTEXITCODE -ne 0) {
  throw 'GitHub staging audit failed.'
}

Write-Host "GitHub staging directory is ready: $destination"
