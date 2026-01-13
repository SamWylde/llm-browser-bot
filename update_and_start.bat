@echo off
setlocal

echo ==========================================
echo      LLM Browser Bot - Update & Start
echo ==========================================

echo [1/4] Checking for updates...
if exist "update_logic.ps1" (
    powershell -ExecutionPolicy Bypass -File update_logic.ps1
) else (
    echo Warning: update_logic.ps1 not found. Trying git directly...
    where git >nul 2>nul
    if %ERRORLEVEL% EQU 0 (
        git pull
    ) else (
        echo Warning: Git not found and update script missing. Skipping update.
    )
)

cd server || (echo Error: server directory not found & pause & exit /b 1)

echo [2/4] Installing dependencies...
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo Error: npm install failed
    pause
    exit /b 1
)

echo [3/4] Building server...
call npm run build
if %ERRORLEVEL% NEQ 0 (
    echo Error: Build failed
    pause
    exit /b 1
)

echo [4/4] Starting server...
echo.
echo Server is running. detailed logs are above.
echo Press Ctrl+C to stop the server.
echo.
call npm start

pause
