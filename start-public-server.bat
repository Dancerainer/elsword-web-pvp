@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\public-server.ps1" -Action Start
set "taskExit=%ERRORLEVEL%"
if not "%taskExit%"=="0" echo Public server failed to start. See the error above and runtime logs.
if /I not "%~1"=="--no-pause" pause
exit /b %taskExit%
