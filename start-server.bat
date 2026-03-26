@echo off
setlocal EnableExtensions

cd /d "%~dp0"
title Netcode Lab Server

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js was not found on PATH.
    echo Install Node.js 18+ first, then run this script again.
    goto :done
)

where npm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] npm was not found on PATH.
    echo Install Node.js 18+ first, then run this script again.
    goto :done
)

if not exist package.json (
    echo [ERROR] package.json was not found in "%CD%".
    goto :done
)

if not exist node_modules (
    echo Dependencies not found. Installing them now...
    echo.
    call npm ci --no-fund --no-audit
    if errorlevel 1 (
        echo.
        echo [ERROR] Failed to install dependencies.
        echo Run "npm ci" manually to see the full error.
        goto :done
    )
    echo.
)

echo Starting Netcode Lab...
echo Open http://localhost:3000/ after the server is ready.
echo Press Ctrl+C once to stop the server.
echo After the server exits, this window will stay open.
echo.

node server/src/index.js

if errorlevel 1 (
    echo.
    echo [ERROR] The server exited with an error.
)

:done
echo.
echo The server has stopped. Review the output above.
pause
