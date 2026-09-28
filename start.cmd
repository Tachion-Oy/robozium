@echo off
setlocal
cd /d "%~dp0"
if not "%~2"=="" goto usage
if "%~1"=="" goto live
if "%~1"=="--mock" goto mock
goto usage

:live
powershell -NoProfile -File "%~dp0scripts\start-live.ps1"
exit /b %errorlevel%

:mock
powershell -NoProfile -File "%~dp0scripts\start-mock.ps1"
exit /b %errorlevel%

:usage
echo Usage: start.cmd [--mock] 1>&2
exit /b 2
