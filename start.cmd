@echo off
setlocal
cd /d "%~dp0"

set "ROBOSPRAWL_MODE=live"
if "%~1"=="--mock" set "ROBOSPRAWL_MODE=mock"
if not "%~1"=="" if not "%~1"=="--mock" goto usage
docker compose up --build
exit /b %errorlevel%

:usage
echo Usage: start.cmd [--mock] 1>&2
exit /b 2
