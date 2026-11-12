@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\public-server.ps1" -Action Stop
set "taskExit=%ERRORLEVEL%"
if not "%taskExit%"=="0" echo Public server failed to stop. See the error above.
if /I not "%~1"=="--no-pause" pause
exit /b %taskExit%
