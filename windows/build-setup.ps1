# Chloe Assistant Windows kurulum dosyasını üretir:
#   dist\windows\Chloe.Assistant.Setup-<sürüm>.exe ve SHA256SUMS.txt
# Gereksinimler: Node.js 22+ (npm ci yapılmış olmalı), Inno Setup 6.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$stage = Join-Path $root 'dist\windows\stage'
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
# Geliştirme makinesindeki kişisel veriler hiçbir zaman pakete girmez.
foreach ($private in 'data', '.env', '.env.local') { if (Test-Path "$stage\app\$private") { Remove-Item "$stage\app\$private" -Recurse -Force } }
Copy-Item $node "$stage\runtime\chloe-node.exe"
Copy-Item LICENSE "$stage\LICENSE.txt"
Copy-Item THIRD_PARTY_NOTICES.md "$stage\THIRD_PARTY_NOTICES.md"
Copy-Item licenses "$stage\licenses" -Recurse
Set-Content "$stage\runtime\NODE-LICENSE.txt" -Encoding utf8 -Value "Node.js $(& $node -v) - MIT License - https://github.com/nodejs/node/blob/main/LICENSE"

& $node windows\make-icon.mjs "$stage\Chloe.ico"
& $csc /nologo /target:winexe /optimize+ "/win32icon:$stage\Chloe.ico" /r:System.Windows.Forms.dll "/out:$stage\Chloe.exe" windows\ChloeLauncher.cs
if ($LASTEXITCODE -ne 0) { throw 'Başlatıcı derlenemedi.' }

Write-Host 'Setup derleniyor...'
& $iscc /Qp "/DMyAppVersion=$version" windows\ChloeSetup.iss
if ($LASTEXITCODE -ne 0) { throw 'Inno Setup derlemesi başarısız.' }

$setup = Join-Path $root "dist\windows\Chloe.Assistant.Setup-$version.exe"
$hash = (Get-FileHash $setup -Algorithm SHA256).Hash.ToLower()
Set-Content (Join-Path $root 'dist\windows\SHA256SUMS.txt') -Encoding ascii -Value "$hash  Chloe.Assistant.Setup-$version.exe"
Write-Host "Hazır: $setup"
