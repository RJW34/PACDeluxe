#Requires -Version 5.1
<#
.SYNOPSIS
    PACDeluxe Complete Installer

.DESCRIPTION
    Automated installer for PACDeluxe that handles:
    - Prerequisite detection and installation (Node.js, Rust, Visual Studio Build Tools)
    - npm dependency installation
    - Upstream game repository synchronization
    - Frontend and Tauri builds
    - Final installer generation (MSI/NSIS)

.PARAMETER SkipPrerequisites
    Skip prerequisite checks and installations

.PARAMETER SkipUpstream
    Skip upstream repository synchronization

.PARAMETER DevMode
    Build in development mode (faster, no optimizations)

.PARAMETER BuildOnly
    Only build, don't install prerequisites

.PARAMETER CreateRelease
    Create release installers (MSI/NSIS)

.EXAMPLE
    .\install.ps1
    Full installation with all prerequisites

.EXAMPLE
    .\install.ps1 -CreateRelease
    Full installation and create distributable installers

.EXAMPLE
    .\install.ps1 -SkipPrerequisites -BuildOnly
    Quick rebuild without prerequisite checks
#>

param(
    [switch]$SkipPrerequisites,
    [switch]$SkipUpstream,
    [switch]$DevMode,
    [switch]$BuildOnly,
    [switch]$CreateRelease,
    [switch]$Silent,
    [switch]$Help
)

# ============================================================================
# Configuration
# ============================================================================

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$Script:ROOT = $PSScriptRoot
$Script:LOG_FILE = Join-Path $ROOT "install.log"
$Script:REQUIRED_NODE_VERSION = [version]"20.0.0"
$Script:REQUIRED_RUST_VERSION = [version]"1.70.0"

# URLs for prerequisites
$Script:NODE_INSTALLER_URL = "https://nodejs.org/dist/v20.10.0/node-v20.10.0-x64.msi"
$Script:RUSTUP_URL = "https://win.rustup.rs/x86_64"
$Script:VS_BUILD_TOOLS_URL = "https://aka.ms/vs/17/release/vs_BuildTools.exe"

# ============================================================================
# Logging and Output
# ============================================================================

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logMessage = "[$timestamp] [$Level] $Message"
    Add-Content -Path $Script:LOG_FILE -Value $logMessage -ErrorAction SilentlyContinue

    if (-not $Silent) {
        switch ($Level) {
            "SUCCESS" { Write-Host "[OK] $Message" -ForegroundColor Green }
            "WARN"    { Write-Host "[!!] $Message" -ForegroundColor Yellow }
            "ERROR"   { Write-Host "[XX] $Message" -ForegroundColor Red }
            "STEP"    { Write-Host "`n==> $Message" -ForegroundColor Cyan }
            default   { Write-Host "    $Message" -ForegroundColor White }
        }
    }
}

function Write-Banner {
    if (-not $Silent) {
        Write-Host @"

================================================================================
     ____   _    ____ ____       _
    |  _ \ / \  / ___|  _ \  ___| |_   ___  _____
    | |_) / _ \| |   | | | |/ _ \ | | | \ \/ / _ \
    |  __/ ___ \ |___| |_| |  __/ | |_| |>  <  __/
    |_| /_/   \_\____|____/ \___|_|\__,_/_/\_\___|

    Performance-Optimized Pokemon Auto Chess Client
    Installer v1.0.0
================================================================================
"@ -ForegroundColor Cyan
    }
}

function Write-Summary {
    param([hashtable]$Results)

    if (-not $Silent) {
        Write-Host "`n" -NoNewline
        Write-Host "================================================================================" -ForegroundColor Cyan
        Write-Host "                          Installation Summary" -ForegroundColor Cyan
        Write-Host "================================================================================" -ForegroundColor Cyan

        foreach ($key in $Results.Keys) {
            $status = if ($Results[$key]) { "[OK]" } else { "[FAILED]" }
            $color = if ($Results[$key]) { "Green" } else { "Red" }
            Write-Host "  $status $key" -ForegroundColor $color
        }

        Write-Host "================================================================================" -ForegroundColor Cyan
    }
}

# ============================================================================
# Prerequisite Detection
# ============================================================================

function Test-CommandExists {
    param([string]$Command)
    $null -ne (Get-Command $Command -ErrorAction SilentlyContinue)
}

function Get-NodeVersion {
    try {
        $output = & node --version 2>&1
        if ($output -match 'v(\d+\.\d+\.\d+)') {
            return [version]$Matches[1]
        }
    } catch {}
    return $null
}

function Get-RustVersion {
    try {
        $output = & rustc --version 2>&1
        if ($output -match '(\d+\.\d+\.\d+)') {
            return [version]$Matches[1]
        }
    } catch {}
    return $null
}

function Get-CargoVersion {
    try {
        $output = & cargo --version 2>&1
        if ($output -match '(\d+\.\d+\.\d+)') {
            return [version]$Matches[1]
        }
    } catch {}
    return $null
}

function Test-VSBuildTools {
    # Check for Visual Studio Build Tools or Visual Studio with C++ workload
    $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    if (Test-Path $vswhere) {
        $vsInstalls = & $vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -format json 2>&1 | ConvertFrom-Json
        return ($vsInstalls.Count -gt 0)
    }

    # Fallback: check for cl.exe in PATH
    return Test-CommandExists "cl"
}

function Test-WebView2 {
    # Check if WebView2 runtime is installed
    $regPaths = @(
        "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
        "HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
        "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
    )

    foreach ($path in $regPaths) {
        if (Test-Path $path) {
            return $true
        }
    }

    # Windows 11 has WebView2 built-in
    $osVersion = [System.Environment]::OSVersion.Version
    return ($osVersion.Build -ge 22000)
}

# ============================================================================
# Prerequisite Installation
# ============================================================================

function Install-NodeJS {
    Write-Log "Installing Node.js v20 LTS..." "STEP"

    $installerPath = Join-Path $env:TEMP "node-installer.msi"

    try {
        Write-Log "Downloading Node.js installer..."
        Invoke-WebRequest -Uri $Script:NODE_INSTALLER_URL -OutFile $installerPath -UseBasicParsing

        Write-Log "Running Node.js installer (this may take a few minutes)..."
        $process = Start-Process msiexec.exe -ArgumentList "/i", $installerPath, "/qn", "/norestart" -Wait -PassThru

        if ($process.ExitCode -eq 0) {
            # Refresh PATH
            $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
            Write-Log "Node.js installed successfully" "SUCCESS"
            return $true
        } else {
            Write-Log "Node.js installation failed with exit code $($process.ExitCode)" "ERROR"
            return $false
        }
    } catch {
        Write-Log "Failed to install Node.js: $_" "ERROR"
        return $false
    } finally {
        Remove-Item $installerPath -ErrorAction SilentlyContinue
    }
}

function Install-Rust {
    Write-Log "Installing Rust via rustup..." "STEP"

    $installerPath = Join-Path $env:TEMP "rustup-init.exe"

    try {
        Write-Log "Downloading rustup installer..."
        Invoke-WebRequest -Uri $Script:RUSTUP_URL -OutFile $installerPath -UseBasicParsing

        Write-Log "Running rustup installer..."
        $process = Start-Process $installerPath -ArgumentList "-y", "--default-toolchain", "stable" -Wait -PassThru -NoNewWindow

        if ($process.ExitCode -eq 0) {
            # Add cargo to PATH for current session
            $cargoPath = Join-Path $env:USERPROFILE ".cargo\bin"
            $env:Path = "$cargoPath;$env:Path"
            Write-Log "Rust installed successfully" "SUCCESS"
            return $true
        } else {
            Write-Log "Rust installation failed with exit code $($process.ExitCode)" "ERROR"
            return $false
        }
    } catch {
        Write-Log "Failed to install Rust: $_" "ERROR"
        return $false
    } finally {
        Remove-Item $installerPath -ErrorAction SilentlyContinue
    }
}

function Install-VSBuildTools {
    Write-Log "Installing Visual Studio Build Tools..." "STEP"
    Write-Log "This is required for compiling native Rust code" "INFO"

    $installerPath = Join-Path $env:TEMP "vs_BuildTools.exe"

    try {
        Write-Log "Downloading VS Build Tools installer..."
        Invoke-WebRequest -Uri $Script:VS_BUILD_TOOLS_URL -OutFile $installerPath -UseBasicParsing

        Write-Log "Running VS Build Tools installer (this may take 10-15 minutes)..."
        $args = @(
            "--quiet",
            "--wait",
            "--norestart",
            "--nocache",
            "--add", "Microsoft.VisualStudio.Workload.VCTools",
            "--add", "Microsoft.VisualStudio.Component.Windows11SDK.22621",
            "--includeRecommended"
        )

        $process = Start-Process $installerPath -ArgumentList $args -Wait -PassThru

        if ($process.ExitCode -eq 0 -or $process.ExitCode -eq 3010) {
            Write-Log "VS Build Tools installed successfully" "SUCCESS"
            if ($process.ExitCode -eq 3010) {
                Write-Log "A system restart may be required" "WARN"
            }
            return $true
        } else {
            Write-Log "VS Build Tools installation failed with exit code $($process.ExitCode)" "ERROR"
            return $false
        }
    } catch {
        Write-Log "Failed to install VS Build Tools: $_" "ERROR"
        return $false
    } finally {
        Remove-Item $installerPath -ErrorAction SilentlyContinue
    }
}

# ============================================================================
# Build Steps
# ============================================================================

function Install-NpmDependencies {
    Write-Log "Installing npm dependencies..." "STEP"

    Push-Location $Script:ROOT
    try {
        $output = & npm install 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Log "npm dependencies installed" "SUCCESS"
            return $true
        } else {
            Write-Log "npm install failed: $output" "ERROR"
            return $false
        }
    } catch {
        Write-Log "npm install error: $_" "ERROR"
        return $false
    } finally {
        Pop-Location
    }
}

function Sync-UpstreamRepository {
    Write-Log "Synchronizing upstream repository..." "STEP"

    Push-Location $Script:ROOT
    try {
        $upstreamPath = Join-Path $Script:ROOT "upstream-game"

        if (Test-Path $upstreamPath) {
            Write-Log "Upstream exists, updating..."
        } else {
            Write-Log "Cloning upstream repository..."
        }

        # Run sync-upstream - temporarily disable strict error handling
        # npm outputs informational messages to stderr which aren't errors
        $prevErrorAction = $ErrorActionPreference
        $ErrorActionPreference = "Continue"

        $output = cmd /c "npm run sync-upstream 2>&1"
        $exitCode = $LASTEXITCODE

        $ErrorActionPreference = $prevErrorAction

        # Convert output to string for pattern matching
        $outputStr = $output -join "`n"

        # Check for actual success indicators
        $hasSuccess = $outputStr -match "Upstream sync complete" -or $outputStr -match "Upstream version:"

        if ($exitCode -eq 0 -or $hasSuccess) {
            Write-Log "Upstream synchronized" "SUCCESS"
            return $true
        } else {
            Write-Log "Upstream sync failed (exit code: $exitCode)" "ERROR"
            return $false
        }
    } catch {
        Write-Log "Upstream sync error: $_" "ERROR"
        return $false
    } finally {
        Pop-Location
    }
}

function Build-Frontend {
    param([switch]$Dev)

    $mode = if ($Dev) { "development" } else { "production" }
    Write-Log "Building frontend ($mode mode)..." "STEP"

    Push-Location $Script:ROOT
    try {
        $script = if ($Dev) { "build:frontend:dev" } else { "build:frontend" }
        $output = & npm run $script 2>&1

        if ($LASTEXITCODE -eq 0) {
            Write-Log "Frontend built successfully" "SUCCESS"
            return $true
        } else {
            Write-Log "Frontend build failed" "ERROR"
            return $false
        }
    } catch {
        Write-Log "Frontend build error: $_" "ERROR"
        return $false
    } finally {
        Pop-Location
    }
}

function Build-TauriApp {
    param([switch]$Release)

    $mode = if ($Release) { "release" } else { "debug" }
    Write-Log "Building Tauri application ($mode)..." "STEP"

    Push-Location $Script:ROOT
    try {
        # Temporarily disable strict error handling - Tauri outputs info to stderr
        $prevErrorAction = $ErrorActionPreference
        $ErrorActionPreference = "Continue"

        if ($Release) {
            $output = cmd /c "npm run tauri:build 2>&1"
        } else {
            $output = cmd /c "npm run tauri -- build --debug 2>&1"
        }
        $exitCode = $LASTEXITCODE

        $ErrorActionPreference = $prevErrorAction

        # Convert output to string for pattern matching
        $outputStr = $output -join "`n"

        # Check for success indicators
        $hasSuccess = $outputStr -match "Finished" -or $outputStr -match "bundles at:"

        if ($exitCode -eq 0 -or $hasSuccess) {
            Write-Log "Tauri application built successfully" "SUCCESS"
            return $true
        } else {
            Write-Log "Tauri build failed (exit code: $exitCode)" "ERROR"
            return $false
        }
    } catch {
        Write-Log "Tauri build error: $_" "ERROR"
        return $false
    } finally {
        Pop-Location
    }
}

function Copy-ReleaseArtifacts {
    Write-Log "Copying release artifacts..." "STEP"

    $bundlePath = Join-Path $Script:ROOT "src-tauri\target\release\bundle"
    $outputPath = Join-Path $Script:ROOT "release"

    if (-not (Test-Path $bundlePath)) {
        Write-Log "Bundle path not found: $bundlePath" "ERROR"
        return $false
    }

    try {
        # Create output directory
        if (Test-Path $outputPath) {
            Remove-Item $outputPath -Recurse -Force
        }
        New-Item -ItemType Directory -Path $outputPath -Force | Out-Null

        # Copy MSI installer
        $msiPath = Join-Path $bundlePath "msi"
        if (Test-Path $msiPath) {
            Get-ChildItem $msiPath -Filter "*.msi" | ForEach-Object {
                Copy-Item $_.FullName -Destination $outputPath
                Write-Log "Copied: $($_.Name)"
            }
        }

        # Copy NSIS installer
        $nsisPath = Join-Path $bundlePath "nsis"
        if (Test-Path $nsisPath) {
            Get-ChildItem $nsisPath -Filter "*.exe" | ForEach-Object {
                Copy-Item $_.FullName -Destination $outputPath
                Write-Log "Copied: $($_.Name)"
            }
        }

        Write-Log "Release artifacts copied to: $outputPath" "SUCCESS"
        return $true
    } catch {
        Write-Log "Failed to copy artifacts: $_" "ERROR"
        return $false
    }
}

# ============================================================================
# Validation
# ============================================================================

function Test-Installation {
    Write-Log "Validating installation..." "STEP"

    $valid = $true

    # Check dist folder exists
    $distPath = Join-Path $Script:ROOT "dist"
    if (Test-Path (Join-Path $distPath "index.html")) {
        Write-Log "Frontend build verified" "SUCCESS"
    } else {
        Write-Log "Frontend build not found" "ERROR"
        $valid = $false
    }

    # Check Cargo.lock exists (indicates successful Rust build)
    $cargoLock = Join-Path $Script:ROOT "src-tauri\Cargo.lock"
    if (Test-Path $cargoLock) {
        Write-Log "Rust dependencies verified" "SUCCESS"
    } else {
        Write-Log "Rust dependencies not found" "WARN"
    }

    return $valid
}

function Run-Tests {
    Write-Log "Running ethical safeguard tests..." "STEP"

    Push-Location $Script:ROOT
    try {
        $output = & npm test 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Log "All tests passed" "SUCCESS"
            return $true
        } else {
            Write-Log "Tests failed" "ERROR"
            return $false
        }
    } catch {
        Write-Log "Test error: $_" "ERROR"
        return $false
    } finally {
        Pop-Location
    }
}

# ============================================================================
# Main Installation Flow
# ============================================================================

function Main {
    # Initialize
    "" | Out-File $Script:LOG_FILE -Force
    Write-Banner

    if ($Help) {
        Get-Help $MyInvocation.MyCommand.Path -Full
        return
    }

    Write-Log "Starting PACDeluxe installation..." "STEP"
    Write-Log "Installation log: $Script:LOG_FILE"

    $results = @{}

    # ==========================================================================
    # Phase 1: Prerequisites
    # ==========================================================================

    if (-not $SkipPrerequisites -and -not $BuildOnly) {
        Write-Log "Checking prerequisites..." "STEP"

        # Check Node.js
        $nodeVersion = Get-NodeVersion
        if ($null -eq $nodeVersion) {
            Write-Log "Node.js not found" "WARN"
            $results["Node.js Installation"] = Install-NodeJS
            $nodeVersion = Get-NodeVersion
        } elseif ($nodeVersion -lt $Script:REQUIRED_NODE_VERSION) {
            Write-Log "Node.js $nodeVersion is below required $($Script:REQUIRED_NODE_VERSION)" "WARN"
            $results["Node.js Upgrade"] = Install-NodeJS
        } else {
            Write-Log "Node.js $nodeVersion detected" "SUCCESS"
            $results["Node.js"] = $true
        }

        # Check Rust
        $rustVersion = Get-RustVersion
        if ($null -eq $rustVersion) {
            Write-Log "Rust not found" "WARN"
            $results["Rust Installation"] = Install-Rust
        } elseif ($rustVersion -lt $Script:REQUIRED_RUST_VERSION) {
            Write-Log "Rust $rustVersion is below required $($Script:REQUIRED_RUST_VERSION)" "WARN"
            Write-Log "Please update Rust: rustup update" "INFO"
            $results["Rust"] = $false
        } else {
            Write-Log "Rust $rustVersion detected" "SUCCESS"
            $results["Rust"] = $true
        }

        # Check Cargo
        if (-not (Get-CargoVersion)) {
            Write-Log "Cargo not found (should be installed with Rust)" "ERROR"
            $results["Cargo"] = $false
        } else {
            Write-Log "Cargo detected" "SUCCESS"
            $results["Cargo"] = $true
        }

        # Check VS Build Tools
        if (-not (Test-VSBuildTools)) {
            Write-Log "Visual Studio Build Tools not found" "WARN"
            $response = Read-Host "Install Visual Studio Build Tools? This is required for native compilation. [Y/n]"
            if ($response -ne 'n' -and $response -ne 'N') {
                $results["VS Build Tools Installation"] = Install-VSBuildTools
            } else {
                Write-Log "Skipping VS Build Tools - native builds may fail" "WARN"
            }
        } else {
            Write-Log "Visual Studio Build Tools detected" "SUCCESS"
            $results["VS Build Tools"] = $true
        }

        # Check WebView2
        if (Test-WebView2) {
            Write-Log "WebView2 runtime detected" "SUCCESS"
            $results["WebView2"] = $true
        } else {
            Write-Log "WebView2 will be installed during app build" "INFO"
            $results["WebView2"] = $true
        }
    } else {
        Write-Log "Skipping prerequisite checks" "INFO"
    }

    # Verify we have minimum requirements to continue
    if (-not (Get-NodeVersion)) {
        Write-Log "Node.js is required to continue. Please install Node.js 20+ and restart." "ERROR"
        return
    }

    # ==========================================================================
    # Phase 2: Dependencies
    # ==========================================================================

    $results["npm Dependencies"] = Install-NpmDependencies
    if (-not $results["npm Dependencies"]) {
        Write-Log "Failed to install npm dependencies. Cannot continue." "ERROR"
        Write-Summary $results
        return
    }

    # ==========================================================================
    # Phase 3: Upstream Sync
    # ==========================================================================

    if (-not $SkipUpstream) {
        $results["Upstream Sync"] = Sync-UpstreamRepository
        if (-not $results["Upstream Sync"]) {
            Write-Log "Upstream sync failed. Some builds may not work." "WARN"
        }
    } else {
        Write-Log "Skipping upstream sync" "INFO"
    }

    # ==========================================================================
    # Phase 4: Build
    # ==========================================================================

    $results["Frontend Build"] = Build-Frontend -Dev:$DevMode

    if ($CreateRelease) {
        $results["Tauri Build"] = Build-TauriApp -Release

        if ($results["Tauri Build"]) {
            $results["Release Artifacts"] = Copy-ReleaseArtifacts
        }
    }

    # ==========================================================================
    # Phase 5: Validation
    # ==========================================================================

    $results["Installation Validation"] = Test-Installation

    # Run tests only if building release
    if ($CreateRelease) {
        $results["Tests"] = Run-Tests
    }

    # ==========================================================================
    # Summary
    # ==========================================================================

    Write-Summary $results

    $failures = $results.Values | Where-Object { $_ -eq $false }
    if ($failures.Count -eq 0) {
        Write-Host "`n[SUCCESS] Installation completed successfully!" -ForegroundColor Green

        if ($CreateRelease) {
            $releasePath = Join-Path $Script:ROOT "release"
            Write-Host "`nRelease installers available at:" -ForegroundColor Cyan
            Write-Host "  $releasePath" -ForegroundColor White
        } else {
            Write-Host "`nNext steps:" -ForegroundColor Cyan
            Write-Host "  Run dev mode:      npm run dev" -ForegroundColor White
            Write-Host "  Build release:     .\install.ps1 -CreateRelease" -ForegroundColor White
        }
    } else {
        Write-Host "`n[WARNING] Installation completed with $($failures.Count) issue(s)" -ForegroundColor Yellow
        Write-Host "Check the log file for details: $Script:LOG_FILE" -ForegroundColor Gray
    }
}

# Run main
Main
