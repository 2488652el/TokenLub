[CmdletBinding()]
param(
  [string]$Path
)

$ErrorActionPreference = 'Stop'
if (-not $Path) {
  $Path = Join-Path $PSScriptRoot 'repository'
}
$root = [System.IO.Path]::GetFullPath($Path)
if (-not (Test-Path -LiteralPath $root -PathType Container)) {
  throw "GitHub staging directory does not exist: $root"
}
$rootPrefix = $root.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar

$issues = [System.Collections.Generic.List[string]]::new()
$blockedDirectories = @('.git', '.claude', '.codex', '.cache', 'node_modules', 'artifacts', 'out', 'coverage', 'test-results', 'playwright-report')
$blockedExtensions = @('.db', '.sqlite', '.sqlite3', '.log', '.pem', '.key', '.pfx', '.p12', '.exe', '.msi', '.dmg', '.zip', '.7z', '.tar', '.gz')
$textExtensions = @('.cjs', '.css', '.html', '.js', '.json', '.md', '.mjs', '.ps1', '.sh', '.sql', '.ts', '.tsx', '.txt', '.yml', '.yaml')
$secretPatterns = @(
  '-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
  'AKIA[0-9A-Z]{16}',
  'ASIA[0-9A-Z]{16}',
  'github_pat_[A-Za-z0-9_]{20,}',
  'gh[pousr]_[A-Za-z0-9]{30,}',
  'sk-(?:proj|live)-[A-Za-z0-9_-]{20,}',
  'xox[baprs]-[A-Za-z0-9-]{20,}',
  'AIza[0-9A-Za-z_-]{30,}'
)

foreach ($file in Get-ChildItem -LiteralPath $root -Recurse -Force -File) {
  if (-not $file.FullName.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    $issues.Add("file escapes staging directory: $($file.FullName)")
    continue
  }
  $relative = $file.FullName.Substring($rootPrefix.Length)
  $segments = $relative -split '[\\/]'

  if ($segments | Where-Object { $blockedDirectories -contains $_ }) {
    $issues.Add("blocked directory: $relative")
  }
  if ($file.Name -in @('.env', '.env.local', '.env.production') -or $file.Name -like 'id_rsa*') {
    $issues.Add("private configuration file: $relative")
  }
  if ($blockedExtensions -contains $file.Extension.ToLowerInvariant()) {
    $issues.Add("blocked binary or data file: $relative")
  }

  if ($textExtensions -contains $file.Extension.ToLowerInvariant()) {
    $content = Get-Content -LiteralPath $file.FullName -Raw
    foreach ($pattern in $secretPatterns) {
      if ($content -match $pattern) {
        $issues.Add("possible secret content: $relative")
        break
      }
    }
  }
}

if ($issues.Count -gt 0) {
  Write-Error ("GitHub audit failed:`n- " + ($issues -join "`n- "))
  exit 1
}

Write-Host "GitHub audit passed: $root"
exit 0
