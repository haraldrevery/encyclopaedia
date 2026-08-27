@echo off
REM ---------------------------------------------------------------------------
REM build.bat - build the site. Double-click it, or run it from cmd.
REM
REM Uses the standalone binary if present (no Node, no npm, no node_modules),
REM and falls back to npx eleventy if it isn't.
REM ---------------------------------------------------------------------------
cd /d "%~dp0"

if exist encyclopedia-win-x64.exe (
    encyclopedia-win-x64.exe %*
) else if exist node_modules\.bin\eleventy.cmd (
    echo encyclopedia-win-x64.exe not found - falling back to local Eleventy.
    call node_modules\.bin\eleventy.cmd %*
) else (
    echo Nothing to build with.
    echo Either compile the binary ^(eleventy_binary\compile.sh^) or run "npm install".
    set RC=1
    goto :done
)
set RC=%ERRORLEVEL%

if "%RC%"=="0" (
    echo.
    echo Done. Open content\index.html in a browser.
    echo Then run healthcheck.bat to check links and file sizes.
)

:done
REM Pause only when double-clicked from Explorer, not when run from a shell.
echo %cmdcmdline% | find /i "%~0" >nul
if not errorlevel 1 pause
exit /b %RC%
