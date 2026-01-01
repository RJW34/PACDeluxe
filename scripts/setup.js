#!/usr/bin/env node
/**
 * Setup Script
 *
 * Automates the complete setup of Pokemon Auto Chess Deluxe.
 * This script:
 * 1. Checks prerequisites (Node.js, Rust, Cargo)
 * 2. Installs npm dependencies
 * 3. Generates required icon files
 * 4. Syncs upstream repository
 * 5. Builds the frontend
 * 6. Verifies Rust compilation
 *
 * Usage: node scripts/setup.js [--skip-upstream] [--dev]
 */

import { execSync, spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

// Parse arguments
const args = process.argv.slice(2);
const skipUpstream = args.includes('--skip-upstream');
const devMode = args.includes('--dev');

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}[setup] ${message}${colors.reset}`);
}

function success(message) {
  log(`✓ ${message}`, 'green');
}

function warn(message) {
  log(`⚠ ${message}`, 'yellow');
}

function error(message) {
  log(`✗ ${message}`, 'red');
}

function exec(command, options = {}) {
  const opts = {
    stdio: 'inherit',
    cwd: options.cwd || ROOT,
    shell: true,
    ...options,
  };

  if (options.silent) {
    opts.stdio = 'pipe';
  }

  try {
    const result = execSync(command, opts);
    return { success: true, output: result?.toString() };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function checkCommand(cmd, versionFlag = '--version') {
  const result = spawnSync(cmd, [versionFlag], {
    shell: true,
    stdio: 'pipe',
  });
  return result.status === 0;
}

function getCommandVersion(cmd, versionFlag = '--version') {
  try {
    const result = execSync(`${cmd} ${versionFlag}`, {
      stdio: 'pipe',
      shell: true,
    });
    return result.toString().trim().split('\n')[0];
  } catch {
    return null;
  }
}

async function main() {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║         Pokemon Auto Chess Deluxe - Setup Script          ║
╚═══════════════════════════════════════════════════════════╝
`);

  // Step 1: Check prerequisites
  log('Checking prerequisites...', 'cyan');

  // Check Node.js
  const nodeVersion = getCommandVersion('node');
  if (!nodeVersion) {
    error('Node.js not found. Please install Node.js 20+');
    process.exit(1);
  }
  success(`Node.js: ${nodeVersion}`);

  // Check npm
  const npmVersion = getCommandVersion('npm');
  if (!npmVersion) {
    error('npm not found');
    process.exit(1);
  }
  success(`npm: ${npmVersion}`);

  // Check Rust
  const rustVersion = getCommandVersion('rustc');
  if (!rustVersion) {
    error('Rust not found. Please install Rust from https://rustup.rs');
    process.exit(1);
  }
  success(`Rust: ${rustVersion}`);

  // Check Cargo
  const cargoVersion = getCommandVersion('cargo');
  if (!cargoVersion) {
    error('Cargo not found');
    process.exit(1);
  }
  success(`Cargo: ${cargoVersion}`);

  // Check for Tauri CLI
  const tauriVersion = getCommandVersion('cargo', 'tauri --version');
  if (!tauriVersion) {
    warn('Tauri CLI not installed. Installing...');
    const result = exec('cargo install tauri-cli');
    if (!result.success) {
      warn('Could not install Tauri CLI globally, will use npx');
    } else {
      success('Tauri CLI installed');
    }
  } else {
    success(`Tauri CLI: ${tauriVersion}`);
  }

  console.log('');

  // Step 2: Install npm dependencies
  log('Installing npm dependencies...', 'cyan');
  if (!exec('npm install').success) {
    error('Failed to install npm dependencies');
    process.exit(1);
  }
  success('npm dependencies installed');
  console.log('');

  // Step 3: Generate icons
  log('Generating icon files...', 'cyan');
  const iconsExist = existsSync(join(ROOT, 'src-tauri/icons/icon.png'));
  if (!iconsExist) {
    if (!exec('node scripts/generate-icons.js').success) {
      error('Failed to generate icons');
      process.exit(1);
    }
    success('Icons generated');
  } else {
    success('Icons already exist');
  }
  console.log('');

  // Step 4: Sync upstream (optional)
  if (!skipUpstream) {
    log('Syncing upstream repository...', 'cyan');
    const upstreamExists = existsSync(join(ROOT, 'upstream-game'));
    if (upstreamExists) {
      log('Upstream exists, updating...');
    } else {
      log('Cloning upstream repository...');
    }

    if (!exec('npm run sync-upstream').success) {
      warn('Upstream sync failed - continuing without it');
      warn('Run "npm run sync-upstream" manually to sync later');
    } else {
      success('Upstream synced');
    }
  } else {
    warn('Skipping upstream sync (--skip-upstream)');
  }
  console.log('');

  // Step 5: Create dist folder if it doesn't exist
  log('Preparing dist folder...', 'cyan');
  const distDir = join(ROOT, 'dist');
  if (!existsSync(distDir)) {
    mkdirSync(distDir, { recursive: true });

    // Create a minimal index.html
    const minimalHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pokemon Auto Chess Deluxe</title>
  <style>
    body {
      margin: 0;
      background: #1a1a2e;
      color: #eee;
      font-family: system-ui;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
    }
    .loading {
      text-align: center;
    }
    .loading h1 {
      font-size: 24px;
      margin-bottom: 20px;
    }
    .loading p {
      color: #888;
    }
  </style>
</head>
<body>
  <div class="loading">
    <h1>Pokemon Auto Chess Deluxe</h1>
    <p>Run "npm run build:frontend" to build the game</p>
  </div>
</body>
</html>`;

    const { writeFileSync } = await import('fs');
    writeFileSync(join(distDir, 'index.html'), minimalHtml);
    success('Created placeholder dist folder');
  } else {
    success('dist folder exists');
  }
  console.log('');

  // Step 6: Verify Rust compilation
  log('Verifying Rust compilation...', 'cyan');
  const cargoCheck = exec('cargo check', { cwd: join(ROOT, 'src-tauri') });
  if (!cargoCheck.success) {
    error('Rust compilation failed');
    error('Run "cd src-tauri && cargo check" for details');
    process.exit(1);
  }
  success('Rust code compiles successfully');
  console.log('');

  // Step 7: Build frontend (if upstream exists)
  const upstreamExists = existsSync(join(ROOT, 'upstream-game', 'package.json'));
  if (upstreamExists) {
    log('Building frontend...', 'cyan');
    const buildCmd = devMode ? 'npm run build:frontend:dev' : 'npm run build:frontend';
    if (!exec(buildCmd).success) {
      warn('Frontend build failed - you may need to fix issues in upstream');
    } else {
      success('Frontend built successfully');
    }
  } else {
    warn('Upstream not synced - skipping frontend build');
    warn('Run "npm run sync-upstream" then "npm run build:frontend"');
  }

  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                    Setup Complete!                        ║
╚═══════════════════════════════════════════════════════════╝

Next steps:
  1. Sync upstream:     npm run sync-upstream
  2. Build frontend:    npm run build:frontend
  3. Run dev mode:      npm run dev
  4. Build release:     npm run build

For more information, see the README.md file.
`);
}

main().catch((err) => {
  error(`Setup failed: ${err.message}`);
  process.exit(1);
});
