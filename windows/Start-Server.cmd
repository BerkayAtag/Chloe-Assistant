@echo off
setlocal
cd /d "%~dp0app"
set "HOSTNAME=127.0.0.1"
if not defined PORT set "PORT=3004"
set "NODE_ENV=production"
set "NEXT_TELEMETRY_DISABLED=1"
if not defined CHLOE_DATA_DIR set "CHLOE_DATA_DIR=%~dp0data"
echo Chloe: http://127.0.0.1:%PORT%
"%~dp0runtime\chloe-node.exe" server.js
exit /b %errorlevel%
