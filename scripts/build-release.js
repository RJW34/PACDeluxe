#!/usr/bin/env node
/**
 * Release Builder Script
 *
 * Creates a complete release package including:
 * - MSI and NSIS installers (via Tauri)
 * - Portable executable
 * - SHA256 checksums
 * - Release documentation
 * - Version manifest
 *
 * Usage: node scripts/build-release.js [--skip-build] [--skip-tests]
 */

import { execSync, spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync, statSync, createWriteStream } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

// Parse arguments
const args = process.argv.slice(2);
const skipBuild = args.includes('--skip-build');
const skipTests = args.includes('--skip-tests');
const verbose = args.includes('--verbose') || args.includes('-v');

// Configuration
const config = {
  name: 'PACDeluxe',
  version: JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version,
  releaseDir: join(ROOT, 'release'),
  bundleDir: join(ROOT, 'src-tauri', 'target', 'release', 'bundle'),
  distDir: join(ROOT, 'dist'),
};

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

function log(message, type = 'info') {
  const prefix = {
    info: `${colors.dim}[build]${colors.reset}`,
    success: `${colors.green}[OK]${colors.reset}`,
    warn: `${colors.yellow}[!!]${colors.reset}`,
    error: `${colors.red}[XX]${colors.reset}`,
    step: `${colors.cyan}==>${colors.reset}`,
  };
  console.log(`${prefix[type]} ${message}`);
}

function exec(command, options = {}) {
  const opts = {
    cwd: options.cwd || ROOT,
    stdio: verbose ? 'inherit' : 'pipe',
    shell: true,
    ...options,
  };

  try {
    const result = execSync(command, opts);
    return { success: true, output: result?.toString() };
  } catch (e) {
    return { success: false, error: e.message, output: e.stdout?.toString() };
  }
}

function calculateSHA256(filePath) {
  const fileBuffer = readFileSync(filePath);
  const hashSum = createHash('sha256');
  hashSum.update(fileBuffer);
  return hashSum.digest('hex');
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

async function main() {
  console.log(`
${colors.cyan}================================================================================
     ${config.name} Release Builder v${config.version}
================================================================================${colors.reset}
`);

  const startTime = Date.now();

  // Step 1: Validate prerequisites
  log('Validating prerequisites...', 'step');

  if (!existsSync(join(ROOT, 'node_modules'))) {
    log('node_modules not found. Run: npm install', 'error');
    process.exit(1);
  }

  if (!existsSync(join(ROOT, 'upstream-game', 'package.json'))) {
    log('upstream-game not found. Run: npm run sync-upstream', 'error');
    process.exit(1);
  }

  log('Prerequisites validated', 'success');

  // Step 2: Run tests (unless skipped)
  if (!skipTests) {
    log('Running tests...', 'step');

    const testResult = exec('npm test');
    if (!testResult.success) {
      log('Tests failed! Cannot create release.', 'error');
      process.exit(1);
    }
    log('All tests passed', 'success');
  } else {
    log('Skipping tests (--skip-tests)', 'warn');
  }

  // Step 3: Build frontend
  if (!skipBuild) {
    log('Building frontend...', 'step');

    const frontendResult = exec('npm run build:frontend');
    if (!frontendResult.success) {
      log('Frontend build failed', 'error');
      process.exit(1);
    }
    log('Frontend built successfully', 'success');

    // Step 4: Build Tauri app
    log('Building Tauri application (this may take several minutes)...', 'step');

    const tauriResult = exec('npm run tauri:build');
    if (!tauriResult.success) {
      log('Tauri build failed', 'error');
      if (verbose) {
        console.log(tauriResult.output);
      }
      process.exit(1);
    }
    log('Tauri application built successfully', 'success');
  } else {
    log('Skipping build (--skip-build)', 'warn');
  }

  // Step 5: Create release directory
  log('Creating release package...', 'step');

  if (existsSync(config.releaseDir)) {
    exec(`rmdir /s /q "${config.releaseDir}"`, { shell: true });
  }
  mkdirSync(config.releaseDir, { recursive: true });

  // Step 6: Copy installers and create checksums
  const artifacts = [];

  // Copy MSI installer
  const msiDir = join(config.bundleDir, 'msi');
  if (existsSync(msiDir)) {
    const msiFiles = readdirSync(msiDir).filter(f => f.endsWith('.msi'));
    for (const file of msiFiles) {
      const src = join(msiDir, file);
      const dest = join(config.releaseDir, file);
      copyFileSync(src, dest);

      const stats = statSync(dest);
      const sha256 = calculateSHA256(dest);

      artifacts.push({
        name: file,
        type: 'MSI Installer',
        size: stats.size,
        sizeFormatted: formatBytes(stats.size),
        sha256: sha256,
      });

      log(`Copied: ${file} (${formatBytes(stats.size)})`);
    }
  }

  // Copy NSIS installer
  const nsisDir = join(config.bundleDir, 'nsis');
  if (existsSync(nsisDir)) {
    const nsisFiles = readdirSync(nsisDir).filter(f => f.endsWith('.exe'));
    for (const file of nsisFiles) {
      const src = join(nsisDir, file);
      const dest = join(config.releaseDir, file);
      copyFileSync(src, dest);

      const stats = statSync(dest);
      const sha256 = calculateSHA256(dest);

      artifacts.push({
        name: file,
        type: 'NSIS Installer',
        size: stats.size,
        sizeFormatted: formatBytes(stats.size),
        sha256: sha256,
      });

      log(`Copied: ${file} (${formatBytes(stats.size)})`);
    }
  }

  // Copy portable executable if exists
  const exePath = join(ROOT, 'src-tauri', 'target', 'release', 'pac-deluxe.exe');
  if (existsSync(exePath)) {
    const portableName = `${config.name}-${config.version}-portable.exe`;
    const dest = join(config.releaseDir, portableName);
    copyFileSync(exePath, dest);

    const stats = statSync(dest);
    const sha256 = calculateSHA256(dest);

    artifacts.push({
      name: portableName,
      type: 'Portable Executable',
      size: stats.size,
      sizeFormatted: formatBytes(stats.size),
      sha256: sha256,
    });

    log(`Copied: ${portableName} (${formatBytes(stats.size)})`);
  }

  if (artifacts.length === 0) {
    log('No build artifacts found! Ensure Tauri build completed.', 'error');
    process.exit(1);
  }

  // Step 7: Create checksums file
  log('Generating checksums...', 'step');

  let checksums = `# ${config.name} v${config.version} - SHA256 Checksums\n`;
  checksums += `# Generated: ${new Date().toISOString()}\n\n`;

  for (const artifact of artifacts) {
    checksums += `${artifact.sha256}  ${artifact.name}\n`;
  }

  writeFileSync(join(config.releaseDir, 'SHA256SUMS.txt'), checksums);
  log('Checksums generated: SHA256SUMS.txt', 'success');

  // Step 8: Create version manifest
  log('Creating version manifest...', 'step');

  const manifest = {
    name: config.name,
    version: config.version,
    publisher: 'RyanAbsoGoofyChungus',
    releaseDate: new Date().toISOString(),
    platform: 'windows-x64',
    minimumOS: 'Windows 11',
    artifacts: artifacts.map(a => ({
      filename: a.name,
      type: a.type,
      size: a.size,
      sha256: a.sha256,
    })),
    dependencies: {
      webview2: 'auto-installed',
      nodeVersion: process.version,
      rustVersion: exec('rustc --version', { stdio: 'pipe' }).output?.trim() || 'unknown',
    },
    repository: 'https://github.com/RJW34/PACDeluxe',
  };

  writeFileSync(
    join(config.releaseDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );
  log('Manifest created: manifest.json', 'success');

  // Step 9: Create release notes template
  log('Creating release notes...', 'step');

  const releaseNotes = `# ${config.name} v${config.version}

Release Date: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}

## Installation

### Windows Installer (Recommended)
Download and run one of the following:
- \`${artifacts.find(a => a.type === 'MSI Installer')?.name || 'PACDeluxe.msi'}\` - Standard Windows Installer
- \`${artifacts.find(a => a.type === 'NSIS Installer')?.name || 'PACDeluxe-Setup.exe'}\` - NSIS Installer

### Portable Version
Download \`${artifacts.find(a => a.type === 'Portable Executable')?.name || 'PACDeluxe-portable.exe'}\` - No installation required.

## System Requirements
- **Operating System:** Windows 11 (64-bit)
- **RAM:** 4 GB minimum, 8 GB recommended
- **Disk Space:** ~300 MB
- **Internet:** Required for game connectivity

## Checksums
Verify your download using the SHA256 checksums in \`SHA256SUMS.txt\`.

## What's New
- Performance-optimized native Windows client
- Reduced memory usage compared to browser
- Lower input latency
- Performance overlay (Ctrl+Shift+P)

## Known Issues
- Windows Hello passkeys not supported (WebView2 limitation) - use password login
- Auth popup may not auto-close in some cases

## Support
Report issues at: https://github.com/RJW34/PACDeluxe/issues
`;

  writeFileSync(join(config.releaseDir, 'RELEASE_NOTES.md'), releaseNotes);
  log('Release notes created: RELEASE_NOTES.md', 'success');

  // Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`
${colors.cyan}================================================================================
                         Release Build Complete!
================================================================================${colors.reset}

${colors.green}Version:${colors.reset} ${config.version}
${colors.green}Output:${colors.reset}  ${config.releaseDir}
${colors.green}Time:${colors.reset}    ${elapsed}s

${colors.cyan}Artifacts:${colors.reset}
`);

  for (const artifact of artifacts) {
    console.log(`  ${artifact.name}`);
    console.log(`    Type: ${artifact.type}`);
    console.log(`    Size: ${artifact.sizeFormatted}`);
    console.log(`    SHA256: ${artifact.sha256.substring(0, 16)}...`);
    console.log('');
  }

  console.log(`${colors.green}Release package ready for distribution!${colors.reset}`);
}

main().catch(err => {
  log(`Build failed: ${err.message}`, 'error');
  if (verbose) {
    console.error(err);
  }
  process.exit(1);
});
