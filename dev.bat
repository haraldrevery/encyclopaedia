@echo off
REM ---------------------------------------------------------------------------
REM dev.bat - live-reloading development server.
REM
REM You only need this when changing the LOOK or the LOGIC. Editing markdown
REM never needs it: run build.bat and refresh.
REM
REM With node_modules present you get Eleventy's live-reloading dev server;
REM without it we fall back to tw.exe plus the standalone binary (rebuild on
REM keypress, no live reload). Either way nothing is ever downloaded.
REM Content globs are kept identical to dev.sh - if they drift, the two
REM platforms compile different CSS from the same source.
REM ---------------------------------------------------------------------------
cd /d "%~dp0"

if not exist tw.exe (
    echo tw.exe not found - CSS will not rebuild.
    echo Download the standalone Tailwind CLI as tw.exe into this folder.
    goto serve
)

.\tw.exe -i css/input.css -o css/main.css --content "./pages/**/*.njk,./eleventy_settings/**/*.njk" --minify
.\tw.exe -i css/input_prose.css -o css/prose.css --content "./pages/**/*.njk,./eleventy_settings/**/*.njk" --minify

start "Tailwind main"  cmd /c ".\tw.exe -i css/input.css -o css/main.css --content \"./pages/**/*.njk,./eleventy_settings/**/*.njk\" --watch --minify"
start "Tailwind prose" cmd /c ".\tw.exe -i css/input_prose.css -o css/prose.css --content \"./pages/**/*.njk,./eleventy_settings/**/*.njk\" --watch --minify"

:serve
REM Never "npx eleventy": with no node_modules that prompts to install, and the
REM package it installs is the donated placeholder that only throws. The real
REM package is @11ty/eleventy, and a dev server has no business hitting the
REM network anyway - use what is on disk or say why we can't.
if exist node_modules\.bin\eleventy.cmd (
    call node_modules\.bin\eleventy.cmd --serve --incremental
    goto :eof
)

if not exist encyclopedia-win-x64.exe (
    echo No node_modules and no encyclopedia-win-x64.exe - nothing can serve.
    echo Run "npm install" ^(live reload^), or compile the binary
    echo with eleventy_binary\compile.sh ^(rebuild on keypress^).
    pause
    exit /b 1
)

echo No node_modules - using encyclopedia-win-x64.exe. No live reload.
encyclopedia-win-x64.exe || (pause & exit /b 1)

if not defined PORT set PORT=8080
where python >nul 2>&1
if errorlevel 1 (
    echo.
    echo python not found - no server. Open content\index.html directly.
) else (
    start "Encyclopedia server" cmd /c "python -m http.server %PORT% --directory content --bind 127.0.0.1"
    echo.
    echo Serving http://127.0.0.1:%PORT%/
)

:rebuild
echo.
echo Press any key to rebuild, or close this window to stop.
pause >nul
encyclopedia-win-x64.exe --quiet
goto rebuild
