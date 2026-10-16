# Installs the explain-change binary and its agent skills on Windows. No runtime needed. The binary must match the
# SHA256SUMS of its release.
#
#   irm https://raw.githubusercontent.com/denjamio/explain-change/main/install.ps1 | iex
#
# $env:EXPLAIN_CHANGE_VERSION = "v0.2.0" picks a release (default: the latest).
$ErrorActionPreference = "Stop"
$repo = "denjamio/explain-change"
$bin = Join-Path $env:LOCALAPPDATA "explain-change\bin"
$asset = "explain-change-windows-x64.exe"
$releases = if ($env:EXPLAIN_CHANGE_RELEASES) { $env:EXPLAIN_CHANGE_RELEASES } else { "https://github.com/$repo/releases" }
$dir = if ($env:EXPLAIN_CHANGE_VERSION) {
  "$releases/download/$($env:EXPLAIN_CHANGE_VERSION)"
} else {
  "$releases/latest/download"
}
$url = "$dir/$asset"
New-Item -ItemType Directory -Force -Path $bin | Out-Null
$exe = Join-Path $bin "explain-change.exe"
$tmp = "$exe.new"
Write-Host "explain-change: downloading $url"
Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing
$sums = (Invoke-WebRequest -Uri "$dir/SHA256SUMS" -UseBasicParsing).Content
if ($sums -is [byte[]]) { $sums = [Text.Encoding]::UTF8.GetString($sums) }
$expected = $null
foreach ($line in $sums -split "`r?`n") {
  $parts = $line.Trim() -split "\s+", 2
  if ($parts.Count -eq 2 -and $parts[1].TrimStart("*") -eq $asset) { $expected = $parts[0].ToLower() }
}
$actual = (Get-FileHash -Algorithm SHA256 -Path $tmp).Hash.ToLower()
if (-not $expected -or $expected -ne $actual) {
  Remove-Item -Force $tmp
  throw "explain-change: $asset does not match the release's SHA256SUMS (expected $expected, got $actual)"
}
& $tmp --version | Out-Null
if (Test-Path $exe) { Move-Item -Force $exe "$exe.old" }
Move-Item -Force $tmp $exe
Remove-Item -Force "$exe.old" -ErrorAction SilentlyContinue
& $exe --version
& $exe install
$path = [Environment]::GetEnvironmentVariable("Path", "User")
if (-not ($path -split ";" -contains $bin)) {
  [Environment]::SetEnvironmentVariable("Path", "$path;$bin", "User")
  Write-Host "note: added $bin to your user PATH; open a new terminal to use explain-change"
}
