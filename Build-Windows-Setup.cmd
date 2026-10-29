@echo off
rem Chloe Assistant Windows setup dosyasini uretir (dist\windows).
cd /d "%~dp0"
if not exist node_modules (
  call npm ci || exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows\build-setup.ps1"
exit /b %errorlevel%
