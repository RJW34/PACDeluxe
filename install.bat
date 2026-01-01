@echo off
setlocal EnableDelayedExpansion

:: ============================================================================
:: PACDeluxe Installer Launcher
:: ============================================================================
:: This batch file launches the PowerShell installer with the appropriate
:: execution policy and administrator privileges if needed.
:: ============================================================================

title PACDeluxe Installer

:: Check for help flag
if "%1"=="-h" goto :show_help
if "%1"=="--help" goto :show_help
if "%1"=="/?" goto :show_help

:: Change to script directory
cd /d "%~dp0"

:: Check PowerShell availability
where powershell >nul 2>&1
if errorlevel 1 (
    echo [ERROR] PowerShell is required but not found in PATH.
    echo Please install PowerShell or run install.ps1 directly.
    pause
    exit /b 1
)

:: Check if running as administrator
net session >nul 2>&1
if errorlevel 1 (
    echo [INFO] Some features require administrator privileges.
    echo [INFO] If prerequisite installation fails, re-run as Administrator.
    echo.
)

:: Parse arguments and build PowerShell command
set PS_ARGS=
if "%1"=="--release" set PS_ARGS=-CreateRelease
if "%1"=="-r" set PS_ARGS=-CreateRelease
if "%1"=="--dev" set PS_ARGS=-DevMode
if "%1"=="-d" set PS_ARGS=-DevMode
if "%1"=="--quick" set PS_ARGS=-SkipPrerequisites -SkipUpstream
if "%1"=="-q" set PS_ARGS=-SkipPrerequisites -SkipUpstream
if "%1"=="--build-only" set PS_ARGS=-BuildOnly
if "%1"=="-b" set PS_ARGS=-BuildOnly

:: Display banner
echo.
echo ================================================================================
echo     PACDeluxe Installer
echo     Performance-Optimized Pokemon Auto Chess Client
echo ================================================================================
echo.

:: Run the PowerShell installer
echo [INFO] Launching PowerShell installer...
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %PS_ARGS%

if errorlevel 1 (
    echo.
    echo [ERROR] Installation encountered errors. Check install.log for details.
    pause
    exit /b 1
)

echo.
echo [INFO] Installation script completed.
pause
exit /b 0

:show_help
echo.
echo PACDeluxe Installer
echo.
echo Usage: install.bat [options]
echo.
echo Options:
echo   -r, --release      Build and create release installers (MSI/NSIS)
echo   -d, --dev          Build in development mode (faster)
echo   -q, --quick        Skip prerequisites and upstream sync
echo   -b, --build-only   Only build, don't check prerequisites
echo   -h, --help         Show this help message
echo.
echo Examples:
echo   install.bat              Full installation
echo   install.bat --release    Create distributable installers
echo   install.bat --quick      Quick rebuild
echo.
pause
exit /b 0
