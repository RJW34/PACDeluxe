#!/usr/bin/env node
/**
 * Frontend Build Script
 *
 * Builds Pokemon Auto Chess (the 8-player auto-battler) for the Tauri wrapper.
 * Injects a performance overlay - no game logic modifications.
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, cpSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
const UPSTREAM_DIR = join(ROOT, 'upstream-game');
const DIST_DIR = join(ROOT, 'dist');

function log(msg) {
  console.log(`[build] ${msg}`);
}

async function main() {
  log('Building Pokemon Auto Chess frontend...');

  // Check upstream exists
  if (!existsSync(join(UPSTREAM_DIR, 'package.json'))) {
    throw new Error('Upstream not found. Run: npm run sync-upstream');
  }

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

  // Create index.html with performance overlay
  log('Creating index.html with overlay...');
  createIndexHtml();

  log('Build complete! Output: ' + DIST_DIR);
}

function createIndexHtml() {
  const html = `<!DOCTYPE html>
<html lang="en" translate="no">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="icon" href="assets/ui/favicon.ico" />
  <title>Pokemon Auto Chess Deluxe</title>
  <link rel="stylesheet" type="text/css" href="index.css" />
  <script src="index.js" defer></script>
</head>
<body>
  <div id="root"></div>
  <div id="modal-root"></div>

  <!-- PAC Deluxe Performance Overlay (Ctrl+Shift+P to toggle) -->
  <div id="pac-perf" style="display:none;position:fixed;top:8px;right:8px;background:rgba(0,0,0,0.9);color:#0f0;font:12px/1.4 monospace;padding:10px 14px;border-radius:6px;z-index:99999;border:1px solid #0f04;min-width:140px;box-shadow:0 2px 10px rgba(0,0,0,0.5);">
    <div style="color:#0f8;font-weight:bold;margin-bottom:6px;border-bottom:1px solid #0f03;padding-bottom:4px;">⚡ PAC Deluxe</div>
    <div>FPS: <span id="pac-fps">--</span></div>
    <div>CPU: <span id="pac-cpu">--</span>%</div>
    <div>MEM: <span id="pac-mem">--</span> MB</div>
    <div>GPU: <span id="pac-gpu">--</span></div>
  </div>
  <script>
  (function() {
    const overlay = document.getElementById('pac-perf');
    let visible = false;
    let frameCount = 0;
    let lastTime = performance.now();
    let fps = 0;

    // FPS counter using requestAnimationFrame
    function countFrame() {
      frameCount++;
      const now = performance.now();
      if (now - lastTime >= 1000) {
        fps = Math.round(frameCount * 1000 / (now - lastTime));
        frameCount = 0;
        lastTime = now;
      }
      requestAnimationFrame(countFrame);
    }
    countFrame();

    // Update overlay with native stats
    async function updateOverlay() {
      if (!visible) return;
      document.getElementById('pac-fps').textContent = fps;

      if (window.__TAURI__) {
        try {
          const stats = await window.__TAURI__.invoke('get_performance_stats');
          document.getElementById('pac-cpu').textContent = stats.cpu_usage.toFixed(1);
          document.getElementById('pac-mem').textContent = stats.memory_usage_mb;
          document.getElementById('pac-gpu').textContent = stats.gpu_usage !== null ? stats.gpu_usage.toFixed(0) + '%' : 'N/A';
        } catch(e) { console.error('Stats error:', e); }
      }
    }
    setInterval(updateOverlay, 500);

    // Toggle with Ctrl+Shift+P
    document.addEventListener('keydown', e => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        visible = !visible;
        overlay.style.display = visible ? 'block' : 'none';
        if (visible) updateOverlay();
      }
    });

    console.log('[PAC Deluxe] Performance overlay ready - press Ctrl+Shift+P to toggle');
  })();
  </script>
</body>
</html>`;

  writeFileSync(join(DIST_DIR, 'index.html'), html);
}

main().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
