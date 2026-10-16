# Installs the explain-change binary and its agent skills on Windows. No runtime needed.
#
#   irm https://raw.githubusercontent.com/denjamio/explain-change/main/install.ps1 | iex
#
# $env:EXPLAIN_CHANGE_VERSION = "v0.2.0" picks a release (default: the latest).
$ErrorActionPreference = "Stop"
$repo = "denjamio/explain-change"
$bin = Join-Path $env:LOCALAPPDATA "explain-change\bin"
$asset = "explain-change-windows-x64.exe"
$url = if ($env:EXPLAIN_CHANGE_VERSION) {
  "https://github.com/$repo/releases/download/$($env:EXPLAIN_CHANGE_VERSION)/$asset"
} else {
  "https://github.com/$repo/releases/latest/download/$asset"
}
New-Item -ItemType Directory -Force -Path $bin | Out-Null
$exe = Join-Path $bin "explain-change.exe"
$tmp = "$exe.new"
Write-Host "explain-change: downloading $url"
Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing
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
