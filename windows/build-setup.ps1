# Chloe Assistant Windows kurulum dosyasını üretir:
#   dist\windows\Chloe.Assistant.Setup-<sürüm>.exe ve SHA256SUMS.txt
# Gereksinimler: Node.js 22+ (npm ci yapılmış olmalı), Inno Setup 6.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
# Outside the checkout: Node would otherwise resolve modules the bundle lacks from
# the repo's own node_modules, hiding missing files until a real install.
$stage = Join-Path $env:TEMP 'ChloeSetupStage'
$iscc = @("${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe", "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe") |
  Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) { throw 'Inno Setup 6 bulunamadı: https://jrsoftware.org/isinfo.php' }
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw '.NET Framework derleyicisi (csc.exe) bulunamadı.' }
$node = (Get-Command node).Source

Write-Host "Chloe ${version}: bağımsız sunucu derleniyor..."
$env:CHLOE_STANDALONE = '1'; $env:NEXT_DIST_DIR = '.next-win'; $env:NEXT_TELEMETRY_DISABLED = '1'
if (Test-Path .next-win) { Remove-Item .next-win -Recurse -Force }
& $node node_modules\next\dist\bin\next build
if ($LASTEXITCODE -ne 0) { throw 'next build başarısız.' }
Remove-Item Env:CHLOE_STANDALONE, Env:NEXT_DIST_DIR

Write-Host 'Kurulum klasörü hazırlanıyor...'
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force "$stage\app", "$stage\runtime" | Out-Null
# robocopy: Copy-Item treats [ ] in Turbopack chunk names as wildcards and skips them.
function Copy-Tree($from, $to) { robocopy $from $to /E /NFL /NDL /NJH /NJS /NP | Out-Null; if ($LASTEXITCODE -ge 8) { throw "Kopyalama başarısız: $from" } }
Copy-Tree .next-win\standalone "$stage\app"
Copy-Tree .next-win\static "$stage\app\.next-win\static"
Copy-Tree public "$stage\app\public"
Copy-Item $node "$stage\runtime\chloe-node.exe"
Copy-Item LICENSE "$stage\LICENSE.txt"
Copy-Item THIRD_PARTY_NOTICES.md "$stage\THIRD_PARTY_NOTICES.md"
Copy-Item licenses "$stage\licenses" -Recurse
Set-Content "$stage\runtime\NODE-LICENSE.txt" -Encoding utf8 -Value "Node.js $(& $node -v) - MIT License - https://github.com/nodejs/node/blob/main/LICENSE"

& $node windows\make-icon.mjs "$stage\Chloe.ico"
$versionSource = Join-Path $env:TEMP 'ChloeVersion.cs'
Set-Content $versionSource -Encoding utf8 -Value "static class ChloeVersion { public const string Value = `"$version.0`"; }"
# /codepage:65001 keeps Turkish messages and the publisher name intact.
& $csc /nologo /codepage:65001 /target:winexe /optimize+ "/win32icon:$stage\Chloe.ico" /r:System.Windows.Forms.dll "/out:$stage\Chloe.exe" windows\ChloeLauncher.cs $versionSource
if ($LASTEXITCODE -ne 0) { throw 'Başlatıcı derlenemedi.' }

Write-Host 'Paketlenmiş sunucu deneniyor...'
# Gerçek kurulum gibi çalıştırılır; geçici veri klasörleri kullanıcının kasasına dokunmaz.
$smoke = Join-Path $env:TEMP "ChloeSetupSmoke-$PID"
$vars = @{ PORT = '3099'; HOSTNAME = '127.0.0.1'; NODE_ENV = 'production'; CHLOE_CONNECTION_DIR = "$smoke\conn"; CHLOE_OAUTH_DIR = "$smoke\oauth"; CHLOE_OFFICE_DIR = "$smoke\office"; CHLOE_MEMORY_DIR = "$smoke\memory" }
foreach ($k in $vars.Keys) { Set-Item "Env:$k" $vars[$k] }
$log = Join-Path $env:TEMP 'ChloeSetupSmoke.log'
$server = Start-Process "$stage\runtime\chloe-node.exe" -ArgumentList 'server.js' -WorkingDirectory "$stage\app" -WindowStyle Hidden -PassThru -RedirectStandardOutput $log -RedirectStandardError "$log.err"
foreach ($k in $vars.Keys) { Remove-Item "Env:$k" }
try {
  $base = 'http://127.0.0.1:3099'
  for ($i = 0; $i -lt 60; $i++) { try { Invoke-WebRequest "$base/" -UseBasicParsing -TimeoutSec 2 | Out-Null; break } catch { Start-Sleep -Milliseconds 500 } }
  $failures = @()
  foreach ($path in '/', '/chloe-portrait.jpg', '/icon.png', '/manifest.webmanifest', '/api/avatar', '/api/identity', '/api/conversations', '/api/projects', '/api/expertise', '/api/skills', '/api/office') {
    try { $r = Invoke-WebRequest "$base$path" -UseBasicParsing -TimeoutSec 20 -Headers @{ 'X-Chloe-Client' = 'smoke' }; if ($r.StatusCode -ne 200) { $failures += "$path $($r.StatusCode)" } }
    catch { $failures += "$path $($_.Exception.Message)" }
  }
  try {
    Invoke-WebRequest "$base/api/settings" -Method Post -UseBasicParsing -TimeoutSec 20 -ContentType 'application/json' -Body '{"action":"migrate","patch":{},"revision":0}' -Headers @{ 'x-chloe-settings' = '1'; Origin = $base } | Out-Null
  } catch { $failures += "/api/settings $($_.Exception.Message)" }
  $errors = Get-Content $log, "$log.err" -ErrorAction SilentlyContinue | Select-String 'Cannot find module|Failed to load'
  if ($errors) { $failures += $errors | ForEach-Object { $_.Line } }
  if ($failures) { throw ("Paket denemesi başarısız:`n" + ($failures -join "`n")) }
} finally {
  Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 500
  Remove-Item $smoke -Recurse -Force -ErrorAction SilentlyContinue
}
# Deneme ve geliştirme makinesindeki kişisel veriler hiçbir zaman pakete girmez.
foreach ($private in 'data', '.env', '.env.local') { if (Test-Path "$stage\app\$private") { Remove-Item "$stage\app\$private" -Recurse -Force } }

Write-Host 'Setup derleniyor...'
& $iscc /Qp "/DMyAppVersion=$version" "/DStage=$stage" windows\ChloeSetup.iss
if ($LASTEXITCODE -ne 0) { throw 'Inno Setup derlemesi başarısız.' }

$setup = Join-Path $root "dist\windows\Chloe.Assistant.Setup-$version.exe"
$hash = (Get-FileHash $setup -Algorithm SHA256).Hash.ToLower()
Set-Content (Join-Path $root 'dist\windows\SHA256SUMS.txt') -Encoding ascii -Value "$hash  Chloe.Assistant.Setup-$version.exe"
Write-Host "Hazır: $setup"
