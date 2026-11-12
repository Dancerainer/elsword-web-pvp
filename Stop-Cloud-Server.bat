@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\cloud-service.ps1" -Action Stop
exit /b %ERRORLEVEL%
