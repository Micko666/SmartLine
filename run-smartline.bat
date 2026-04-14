@echo off
setlocal
cd /d "%~dp0"
title SmartLine Dev Server

if not exist package.json (
  echo [ERROR] package.json not found. Put this file in the project root folder.
  pause
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or not in PATH.
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm is not available. Reinstall Node.js.
  pause
  exit /b 1
)

:: Kill any process already using port 8080 so restart always works
echo Freeing port 8080...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8080 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"
timeout /t 1 /nobreak >nul

if not exist node_modules (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
)

echo.
echo  SmartLine is starting...
echo  http://localhost:8080
echo.

:: Open browser after 3s delay in background (hidden window, no flash)
start /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep 3; Start-Process 'http://localhost:8080'"

call npm run dev

echo.
echo  Server stopped.
pause
