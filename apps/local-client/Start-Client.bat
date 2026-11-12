@echo off
setlocal
cd /d "%~dp0"
if not defined EL_CLIENT_PORT set EL_CLIENT_PORT=4376
start "" /b powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0Open-Client.ps1"
:startclient
"%~dp0runtime\node.exe" "%~dp0apps\local-client\client.mjs"
if "%ERRORLEVEL%"=="75" goto startclient
pause
