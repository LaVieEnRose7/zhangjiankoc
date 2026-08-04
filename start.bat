@echo off
chcp 65001 >nul
title ZhangJian KOC Workbench V3
cd /d "%~dp0"

where node >nul 2>nul
if %errorlevel% neq 0 (
  if exist "C:\Users\shiaj\.workbuddy\binaries\node\versions\22.22.2\node.exe" (
    set "NODE_EXE=C:\Users\shiaj\.workbuddy\binaries\node\versions\22.22.2\node.exe"
  ) else (
    echo [ERROR] Node.js not found. Please install Node.js first.
    pause
    exit /b 1
  )
) else (
  set "NODE_EXE=node"
)

if not exist node_modules (
  echo Installing dependencies...
  call npm install
)

echo Starting server on port 4567 ...
"%NODE_EXE%" server/server.cjs
pause
