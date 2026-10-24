@echo off
chcp 65001 >nul 2>&1
setlocal

title Fix GitHub Hosts - treatment-tracker

rem ---- Check admin, self-elevate if needed ----
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo.
    echo   Requesting administrator rights...
    echo   A UAC window will pop up. Please click "Yes".
    echo.
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo.
echo   Running with administrator rights.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0fix-github-hosts.ps1"

endlocal
