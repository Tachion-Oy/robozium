@echo off
setlocal
cd /d "%~dp0"
set "ROBOZIUM_START_FLAG=%~1"
if not "%~2"=="" goto usage
if not "%ROBOZIUM_START_FLAG%"=="" if not "%ROBOZIUM_START_FLAG%"=="--mock" goto usage
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1" -ModeFlag "%ROBOZIUM_START_FLAG%"
exit /b %errorlevel%

:usage
echo Usage: start.cmd [--mock] 1>&2
exit /b 2
