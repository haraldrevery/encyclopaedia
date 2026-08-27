@echo off
REM ---------------------------------------------------------------------------
REM healthcheck.bat - launcher for healthcheck.ps1.
REM
REM Double-click it, or run it from cmd. Passes any arguments straight through
REM (-Quiet, -Help). Exit code is propagated so it can gate a deploy.
REM ---------------------------------------------------------------------------
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0healthcheck.ps1" %*
set RC=%ERRORLEVEL%

REM If this was double-clicked from Explorer the window would vanish before the
REM report could be read, so pause - but not when run from an existing shell.
echo %cmdcmdline% | find /i "%~0" >nul
if not errorlevel 1 pause

exit /b %RC%
