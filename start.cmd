@echo off
setlocal
cd /d "%~dp0"

set "ROBOZIUM_MODE=live"
if "%~1"=="--mock" set "ROBOZIUM_MODE=mock"
if not "%~1"=="" if not "%~1"=="--mock" goto usage
if exist ".env.encrypt" (
  docker compose -f compose.yaml -f compose.encrypted.yaml up --build
) else (
  docker compose up --build
)
exit /b %errorlevel%

:usage
echo Usage: start.cmd [--mock] 1>&2
exit /b 2
