@echo off
setlocal EnableExtensions EnableDelayedExpansion
rem ───────────────────────────────────────────────────────────────────────────
rem  Trading Companion — one-click install for Windows
rem
rem    install.bat               install deps + Desktop & Start-Menu shortcuts
rem    install.bat /installer    also build the real Setup .exe
rem    install.bat /remove       undo the shortcuts
rem    install.bat /dry          print everything it would do, change nothing
rem    install.bat /help
rem
rem  Needs Node.js 18+ (nodejs.org). No admin rights required.
rem ───────────────────────────────────────────────────────────────────────────

set "HERE=%~dp0"
if "%HERE:~-1%"=="\" set "HERE=%HERE:~0,-1%"
set "COMPDIR=%HERE%\companion"
set "APPDIR=%APPDATA%\TradingCompanion"
set "LNK_DESK=%USERPROFILE%\Desktop\Trading Companion.lnk"
set "LNK_MENU=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Trading Companion.lnk"
set "DRY=0"
set "BUILD=0"
set "REMOVE=0"

:args
if "%~1"=="" goto argsdone
if /i "%~1"=="/dry"       set "DRY=1"
if /i "%~1"=="/installer" set "BUILD=1"
if /i "%~1"=="/remove"    set "REMOVE=1"
if /i "%~1"=="/help"      goto help
if /i "%~1"=="-h"         goto help
shift
goto args
:argsdone

echo.
echo   Trading Companion - installer (Windows)
echo   ---------------------------------------
echo.

rem ── remove ─────────────────────────────────────────────────────────────────
if "%REMOVE%"=="1" goto remove

rem ── prerequisites ──────────────────────────────────────────────────────────
where node >nul 2>nul
if errorlevel 1 (
  echo   X  Node.js is not installed.
  echo      Download the LTS installer from https://nodejs.org and run this again.
  goto fail
)
for /f "tokens=1 delims=v." %%a in ('node -v') do set "NODEMAJ=%%a"
if %NODEMAJ% LSS 18 (
  echo   X  Node.js v%NODEMAJ% found, but v18 or newer is required.
  goto fail
)
for /f "tokens=*" %%v in ('node -v') do set "NODEV=%%v"
for /f "tokens=*" %%v in ('npm -v')  do set "NPMV=%%v"
echo     node %NODEV%, npm %NPMV%

if not exist "%COMPDIR%\main.js" (
  echo   X  companion\ folder not found next to install.bat
  goto fail
)

rem ── dependencies ───────────────────────────────────────────────────────────
if "%DRY%"=="1" (
  echo   ^> [dry] install the Electron shell into companion\
) else (
  echo   ^> install the Electron shell (one-off download, ~150 MB)
  pushd "%COMPDIR%"
  call npm install --no-audit --no-fund
  if errorlevel 1 ( popd & echo   X  npm install failed & goto fail )
  popd
)

rem ── hidden launcher (so no console window stays open) ──────────────────────
if "%DRY%"=="1" (
  echo   ^> [dry] write launcher %APPDIR%\launch.vbs
) else (
  echo   ^> write launcher %APPDIR%\launch.vbs
  if not exist "%APPDIR%" mkdir "%APPDIR%"
  > "%APPDIR%\launch.vbs" (
    echo Set ws = CreateObject^("Wscript.Shell"^)
    echo ws.CurrentDirectory = "%COMPDIR%"
    echo ws.Run "cmd /c npm start", 0, False
  )
)

rem ── shortcuts ──────────────────────────────────────────────────────────────
if "%DRY%"=="1" (
  echo   ^> [dry] create Desktop shortcut
  echo   ^> [dry] create Start Menu shortcut
  goto afterlinks
)
echo   ^> create Desktop + Start Menu shortcuts
set "PS1=%APPDIR%\mklink.ps1"
if not exist "%APPDIR%" mkdir "%APPDIR%"
> "%PS1%" (
  echo $ws = New-Object -ComObject WScript.Shell
  echo foreach ($t in @('%LNK_DESK%', '%LNK_MENU%'^)^) {
  echo   $dir = Split-Path $t -Parent
  echo   if (-not (Test-Path $dir^)^) { New-Item -ItemType Directory -Path $dir -Force ^| Out-Null }
  echo   $s = $ws.CreateShortcut($t^)
  echo   $s.TargetPath = 'wscript.exe'
  echo   $s.Arguments = '"%APPDIR%\launch.vbs"'
  echo   $s.WorkingDirectory = '%COMPDIR%'
  echo   $s.IconLocation = '%COMPDIR%\packaging\icon.ico'
  echo   $s.Description = 'Always-on-top trading coach'
  echo   $s.Save(^)
  echo }
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
if errorlevel 1 echo   !  shortcuts could not be created (you can still run: cd companion ^&^& npm start)
:afterlinks

rem ── optional real installer ────────────────────────────────────────────────
if "%BUILD%"=="1" (
  echo   ^> build the Setup .exe (downloads packaging tools once)
  if "%DRY%"=="1" (
    echo     [dry] npm run dist:win
    echo     [dry] run companion\release\Trading-Companion-Setup-*.exe
  ) else (
    pushd "%COMPDIR%"
    call npm run dist:win
    if errorlevel 1 ( popd & echo   X  build failed & goto fail )
    popd
    for /f "tokens=*" %%f in ('dir /b /o-d "%COMPDIR%\release\*.exe" 2^>nul') do (
      echo   ^> launching %%f
      start "" "%COMPDIR%\release\%%f"
      goto built
    )
    echo   !  no .exe found in companion\release
    :built
  )
)

echo.
echo   Installed. Start it from the Desktop icon, the Start Menu, or:
echo       cd companion ^&^& npm start
echo.
echo   Optional starter library:   node tools\seed-demo.js
echo   Full guide:                 README-companion.md
if "%DRY%"=="1" echo. & echo   (dry run - nothing was changed)
echo.
goto end

:remove
echo   ^> removing shortcuts and launcher
if exist "%LNK_DESK%" del "%LNK_DESK%"
if exist "%LNK_MENU%" del "%LNK_MENU%"
if exist "%APPDIR%\launch.vbs" del "%APPDIR%\launch.vbs"
if exist "%APPDIR%\mklink.ps1" del "%APPDIR%\mklink.ps1"
echo     done. Your knowledge base was left untouched.
goto end

:help
findstr /b /c:"rem  " "%~f0" | more
goto end

:fail
echo.
echo   Installation stopped. Fix the problem above and run install.bat again.
echo.
endlocal
exit /b 1

:end
endlocal
exit /b 0
