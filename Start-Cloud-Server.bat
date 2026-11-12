@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\cloud-service.ps1" -Action Start
exit /b %ERRORLEVEL%
