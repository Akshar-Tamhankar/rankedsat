@echo off
rem RankedSat local test launcher.
rem Installs dependencies on first run, starts the server, opens two browser
rem windows at http://localhost:3000 so one person can play both sides.

setlocal
cd /d "%~dp0app"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found on PATH. Install Node.js 18+ from https://nodejs.org and re-run.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies ^(first run only^)...
  call npm install
  if errorlevel 1 (
    echo npm install failed. See output above.
    pause
    exit /b 1
  )
)

echo Starting RankedSat server at http://localhost:3000 ...
start "RankedSat Server" cmd /k "cd /d "%~dp0app" && npm start"

rem Give the server a moment to boot, then open two windows for solo testing.
timeout /t 3 /nobreak >nul
start "" "http://localhost:3000"
timeout /t 1 /nobreak >nul
start "" "http://localhost:3000"

echo.
echo Two browser windows/tabs opened. Give each a different display name to duel yourself.
echo Close the "RankedSat Server" window to stop the server.
endlocal
