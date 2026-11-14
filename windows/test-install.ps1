$ErrorActionPreference = 'Stop'
$version = (Get-Content (Join-Path $PSScriptRoot '..\package.json') -Raw | ConvertFrom-Json).version
$setup = Join-Path $PSScriptRoot "..\dist\windows\Chloe.Assistant.Setup-$version.exe"
$target = Join-Path $env:TEMP ("Chloe-Install-QA-" + [guid]::NewGuid().ToString('N'))
$server = $null
try {
  $install = Start-Process -FilePath $setup -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/DIR=`"$target`"" -WindowStyle Hidden -PassThru -Wait
  if ($install.ExitCode -ne 0) { throw "Setup exit: $($install.ExitCode)" }
  if (-not (Test-Path "$target\Chloe.exe")) { throw 'Launcher missing' }
  $env:PORT = '3199'; $env:HOSTNAME = '127.0.0.1'; $env:NODE_ENV = 'production'
  $env:CHLOE_DATA_DIR = "$target\app\data"
  $env:CHLOE_CONNECTION_DIR = "$target\qa-conn"; $env:CHLOE_OAUTH_DIR = "$target\qa-oauth"
  $server = Start-Process "$target\runtime\chloe-node.exe" -ArgumentList 'server.js' -WorkingDirectory "$target\app" -WindowStyle Hidden -PassThru -RedirectStandardOutput "$target\server.log" -RedirectStandardError "$target\server.err"
  $ready = $false
  for ($i = 0; $i -lt 60; $i++) {
    if ($server.HasExited) { throw 'Installed server exited' }
    try { $r = Invoke-WebRequest 'http://127.0.0.1:3199/api/conversations' -TimeoutSec 2; if ($r.StatusCode -eq 200) { $ready = $true; break } } catch { Start-Sleep -Milliseconds 500 }
  }
  if (-not $ready) { throw 'Installed server did not become ready' }
  Set-Content "$target\app\data\qa-preserve.txt" 'preserve-on-upgrade-and-uninstall'
  Stop-Process -Id $server.Id -Force; $server.WaitForExit(); $server = $null
  $upgrade = Start-Process -FilePath $setup -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/DIR=`"$target`"" -WindowStyle Hidden -PassThru -Wait
  if ($upgrade.ExitCode -ne 0 -or -not (Test-Path "$target\app\data\qa-preserve.txt")) { throw 'Upgrade failed or removed data' }
  $uninstall = Start-Process "$target\unins000.exe" -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART' -WindowStyle Hidden -PassThru -Wait
  if ($uninstall.ExitCode -ne 0 -or -not (Test-Path "$target\app\data\qa-preserve.txt")) { throw 'Uninstall failed or removed data' }
  if (Test-Path "$target\Chloe.exe") { throw 'Uninstall left launcher behind' }
  Write-Output 'PASS: install, installed server, upgrade, uninstall, user-data preservation'
} finally {
  if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force }
  foreach ($name in 'PORT','HOSTNAME','NODE_ENV','CHLOE_DATA_DIR','CHLOE_CONNECTION_DIR','CHLOE_OAUTH_DIR') { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
  # This script only removes its uniquely named temporary installation.
  $resolved = [IO.Path]::GetFullPath($target)
  if ((Split-Path $resolved -Parent) -eq [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') -and (Split-Path $resolved -Leaf) -like 'Chloe-Install-QA-*') {
    Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction SilentlyContinue
  }
}
