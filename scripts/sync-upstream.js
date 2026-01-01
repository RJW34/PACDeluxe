#!/usr/bin/env node
/**
 * Sync Upstream Script
 *
 * Synchronizes the upstream pokemonAutoChess repository and prepares
 * the frontend for building. This script:
 * 1. Pulls latest changes from upstream
 * 2. Installs upstream dependencies
 * 3. Downloads music assets
 * 4. Validates the sync was successful
 *
 * IMPORTANT: This script does NOT modify any gameplay logic.
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, cpSync, rmSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
const UPSTREAM_DIR = join(ROOT, 'upstream-game');
const UPSTREAM_REPO = 'https://github.com/keldaanCommunity/pokemonAutoChess.git';

function log(message) {
  console.log(`[sync-upstream] ${message}`);
}

function exec(command, options = {}) {
  log(`Executing: ${command}`);
  try {
    execSync(command, {
      stdio: 'inherit',
      cwd: options.cwd || ROOT,
      ...options
    });
  } catch (error) {
    console.error(`Command failed: ${command}`);
    throw error;
  }
}

async function main() {
  log('Starting upstream sync...');

  // Check if upstream exists
  if (!existsSync(UPSTREAM_DIR)) {
    log('Cloning upstream repository...');
    exec(`git clone --depth 1 ${UPSTREAM_REPO} upstream-game`);
  } else {
    log('Updating upstream repository...');
    exec('git fetch origin', { cwd: UPSTREAM_DIR });
    exec('git reset --hard origin/master', { cwd: UPSTREAM_DIR });
  }

  // Install upstream dependencies
  log('Installing upstream dependencies...');
  exec('npm install', { cwd: UPSTREAM_DIR });

  // Verify critical files exist
  const criticalFiles = [
    'app/public/src/index.tsx',
    'app/public/src/game/game-container.ts',
    'app/public/src/game/scenes/game-scene.ts',
    'esbuild.js',
    'package.json'
  ];

  for (const file of criticalFiles) {
    const fullPath = join(UPSTREAM_DIR, file);
    if (!existsSync(fullPath)) {
      throw new Error(`Critical file missing: ${file}`);
    }
  }

  log('Upstream sync complete!');
  log(`Upstream version: ${getUpstreamVersion()}`);
}

function getUpstreamVersion() {
  try {
    const pkgContent = readFileSync(join(UPSTREAM_DIR, 'package.json'), 'utf-8');
    const pkg = JSON.parse(pkgContent);
    return pkg.version;
  } catch {
    return 'unknown';
  }
}

main().catch(error => {
  console.error('Sync failed:', error);
  process.exit(1);
});
