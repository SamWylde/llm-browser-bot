@echo off
REM ===========================================================================
REM LLM Browser Bot - Startup Launcher
REM This script launches the PowerShell startup script with necessary permissions
REM ===========================================================================

echo Launching LLM Browser Bot...
powershell -NoProfile -ExecutionPolicy Bypass -File start_server.ps1

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Launcher encountered an error.
    pause
)
