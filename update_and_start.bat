@echo off
REM ===========================================================================
REM LLM Browser Bot - Startup Launcher
REM This script launches the PowerShell startup script with necessary permissions
REM ===========================================================================

setlocal
pushd "%~dp0"

echo Launching LLM Browser Bot...
echo This window will stay open while the server is running.
powershell -NoProfile -ExecutionPolicy Bypass -File start_server.ps1

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Launcher encountered an error.
    pause
)

popd
endlocal
