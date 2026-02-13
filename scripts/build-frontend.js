#!/usr/bin/env node
/**
 * Frontend Build Script
 *
 * Builds Pokemon Auto Chess (the 8-player auto-battler) for the Tauri wrapper.
 * Injects a performance overlay - no game logic modifications.
 */

import { execSync } from 'child_process';
import { createHash } from 'crypto';
import { existsSync, mkdirSync, cpSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
const UPSTREAM_DIR = join(ROOT, 'upstream-game');
const DIST_DIR = join(ROOT, 'dist');
const GAME_CONTAINER_FILE = join(
  UPSTREAM_DIR,
  'app',
  'public',
  'src',
  'game',
  'game-container.ts'
);

function log(msg) {
  console.log(`[build] ${msg}`);
}

function applyUpstreamPatches() {
  if (!existsSync(GAME_CONTAINER_FILE)) {
    throw new Error(`Upstream file missing: ${GAME_CONTAINER_FILE}`);
  }

  const resizeHook = 'this.game.scale.on("resize", this.resize, this)';
  const startupResizeHook = `${resizeHook}\n    this.resize()`;
  const gameContainerContent = readFileSync(GAME_CONTAINER_FILE, 'utf-8');

  if (gameContainerContent.includes(startupResizeHook)) {
    return;
  }

  if (!gameContainerContent.includes(resizeHook)) {
    throw new Error(
      'Unable to apply upstream patch: resize hook marker was not found in game-container.ts'
    );
  }

  writeFileSync(
    GAME_CONTAINER_FILE,
    gameContainerContent.replace(resizeHook, startupResizeHook)
  );
  log('Applied upstream patch: force initial Phaser resize');
}

async function main() {
  log('Building Pokemon Auto Chess frontend...');

  // Check upstream exists
  if (!existsSync(join(UPSTREAM_DIR, 'package.json'))) {
    throw new Error('Upstream not found. Run: npm run sync-upstream');
  }

  applyUpstreamPatches();

  // Build the client
  log('Building upstream client...');
  execSync('npm run build-client', {
    cwd: UPSTREAM_DIR,
    stdio: 'inherit'
  });

  // Find the built files (they have hashes in names)
  const clientDist = join(UPSTREAM_DIR, 'app', 'public', 'dist', 'client');
  const files = readdirSync(clientDist);
  const jsFile = files.find(f => f.startsWith('index-') && f.endsWith('.js'));
  const cssFile = files.find(f => f.startsWith('index-') && f.endsWith('.css'));

  if (!jsFile || !cssFile) {
    throw new Error('Built JS/CSS files not found');
  }

  log(`Found: ${jsFile}, ${cssFile}`);

  // Clean and create dist
  if (existsSync(DIST_DIR)) {
    rmSync(DIST_DIR, { recursive: true });
  }
  mkdirSync(DIST_DIR, { recursive: true });

  // Copy assets
  log('Copying assets...');
  const assetsDir = join(UPSTREAM_DIR, 'app', 'public', 'src', 'assets');
  if (existsSync(assetsDir)) {
    cpSync(assetsDir, join(DIST_DIR, 'assets'), { recursive: true });
  }

  // Copy styles
  const stylesDir = join(UPSTREAM_DIR, 'app', 'public', 'src', 'style');
  if (existsSync(stylesDir)) {
    cpSync(stylesDir, join(DIST_DIR, 'style'), { recursive: true });
  }

  // Copy the built JS and CSS
  cpSync(join(clientDist, jsFile), join(DIST_DIR, 'index.js'));
  cpSync(join(clientDist, cssFile), join(DIST_DIR, 'index.css'));

  // Copy service worker if exists
  if (existsSync(join(clientDist, 'sw.js'))) {
    cpSync(join(clientDist, 'sw.js'), join(DIST_DIR, 'sw.js'));
  }

  // Calculate build version hash from the game bundle
  // This is used by the asset cache to detect version changes
  const jsContent = readFileSync(join(DIST_DIR, 'index.js'));
  const cssContent = readFileSync(join(DIST_DIR, 'index.css'));
  const buildVersion = createHash('sha256')
    .update(jsContent)
    .update(cssContent)
    .digest('hex')
    .substring(0, 12);
  log(`Build version: ${buildVersion}`);

  // Create index.html with performance overlay
  log('Creating index.html with overlay...');
  createIndexHtml(buildVersion);

  log('Build complete! Output: ' + DIST_DIR);
}

function createIndexHtml(buildVersion) {
  const html = `<!DOCTYPE html>
<html lang="en" translate="no">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="icon" href="assets/ui/favicon.ico" />
  <title>PACDeluxe</title>
  <link rel="stylesheet" type="text/css" href="index.css" />
  <!-- PACDeluxe: Force crisp pixel rendering for sprite art -->
  <style>
    canvas,
    img,
    .game-scene canvas,
    #game canvas,
    [class*="pokemon"],
    [class*="sprite"],
    [class*="shop"] img,
    [class*="shop"] canvas {
      image-rendering: pixelated !important;
      image-rendering: crisp-edges !important;
      -ms-interpolation-mode: nearest-neighbor !important;
    }
    /* WebView2-specific: ensure no smoothing on any scaled images */
    * {
      -webkit-font-smoothing: none;
    }
  </style>
  <!-- PACDeluxe build version for cache invalidation -->
  <script>window.__PAC_BUILD_VERSION__="${buildVersion}";window.__PAC_BUILD_TIME__="${new Date().toISOString()}";</script>
  <script src="index.js" defer></script>
</head>
<body>
  <div id="root"></div>
  <div id="modal-root"></div>
  <!-- Performance overlay is injected by Tauri via OVERLAY_SCRIPT in main.rs -->
</body>
</html>`;

  writeFileSync(join(DIST_DIR, 'index.html'), html);
}

main().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
