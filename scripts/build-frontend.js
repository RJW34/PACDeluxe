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
const BOOSTER_COMPONENT_FILE = join(
  UPSTREAM_DIR,
  'app',
  'public',
  'src',
  'pages',
  'component',
  'booster',
  'booster.tsx'
);
const NETWORK_FILE = join(
  UPSTREAM_DIR,
  'app',
  'public',
  'src',
  'network.ts'
);
const LOGIN_FILE = join(
  UPSTREAM_DIR,
  'app',
  'public',
  'src',
  'pages',
  'component',
  'auth',
  'login.tsx'
);

function log(msg) {
  console.log(`[build] ${msg}`);
}

function replaceOrThrow(content, search, replacement, label) {
  if (!content.includes(search)) {
    throw new Error(`Unable to apply upstream patch (${label}): marker not found`);
  }
  return content.replace(search, replacement);
}

function applyUpstreamPatches() {
  if (!existsSync(GAME_CONTAINER_FILE)) {
    throw new Error(`Upstream file missing: ${GAME_CONTAINER_FILE}`);
  }

  const resizeHook = 'this.game.scale.on("resize", this.resize, this)';
  const startupResizeHook = `${resizeHook}\n    this.resize()`;
  const gameContainerContent = readFileSync(GAME_CONTAINER_FILE, 'utf-8');

  if (!gameContainerContent.includes(startupResizeHook)) {
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

  if (!existsSync(BOOSTER_COMPONENT_FILE)) {
    throw new Error(`Upstream file missing: ${BOOSTER_COMPONENT_FILE}`);
  }

  let boosterContent = readFileSync(BOOSTER_COMPONENT_FILE, 'utf-8')
    .replace(/\r\n/g, '\n');

  if (!boosterContent.includes('function onClickEquip()')) {
    if (!boosterContent.includes('import { PkmIndex } from "../../../../../types/enum/Pokemon"\n')) {
      boosterContent = replaceOrThrow(
        boosterContent,
        'import { useTranslation } from "react-i18next"\n',
        'import { useTranslation } from "react-i18next"\n' +
          'import { PkmIndex } from "../../../../../types/enum/Pokemon"\n',
        'booster pkm index import'
      );
    }

    if (!boosterContent.includes('changeAvatar')) {
      if (boosterContent.includes('import { openBooster } from "../../../stores/NetworkStore"\n')) {
        boosterContent = replaceOrThrow(
          boosterContent,
          'import { openBooster } from "../../../stores/NetworkStore"\n',
          'import { changeAvatar, openBooster } from "../../../stores/NetworkStore"\n',
          'booster network import legacy'
        );
      } else if (boosterContent.includes('import { openBooster } from "../../../network"\n')) {
        boosterContent = replaceOrThrow(
          boosterContent,
          'import { openBooster } from "../../../network"\n',
          'import { openBooster } from "../../../network"\n' +
            'import { changeAvatar } from "../../../stores/NetworkStore"\n',
          'booster network import current'
        );
      } else {
        throw new Error('Unable to apply upstream patch (booster network import): marker not found');
      }
    }

    if (!boosterContent.includes('const equipableCard = boosterContent.find(')) {
      boosterContent = replaceOrThrow(
        boosterContent,
        '  const [loading, setLoading] = useState(false)\n',
        '  const [loading, setLoading] = useState(false)\n' +
          '  const equipableCard = boosterContent.find((card) => card.new)\n',
        'booster equipable card state'
      );
    }

    boosterContent = replaceOrThrow(
      boosterContent,
      '  const handleFlip = (index: number) => {\n',
      '  function onClickEquip() {\n' +
        '    if (!equipableCard) return\n' +
        '\n' +
        '    dispatch(\n' +
        '      changeAvatar({\n' +
        '        index: PkmIndex[equipableCard.name],\n' +
        '        emotion: equipableCard.emotion,\n' +
        '        shiny: equipableCard.shiny\n' +
        '      })\n' +
        '    )\n' +
        '  }\n' +
        '\n' +
        '  const handleFlip = (index: number) => {\n',
      'booster equip click handler'
    );

    boosterContent = replaceOrThrow(
      boosterContent,
      '        <span className="booster-count">{numberOfBooster}</span>\n',
      '        {equipableCard && (\n' +
        '          <button className="bubbly orange" onClick={onClickEquip} style={{ fontSize: "0.85em" }}>\n' +
        '            Equip\n' +
        '          </button>\n' +
        '        )}\n' +
        '        <span className="booster-count">{numberOfBooster}</span>\n',
      'booster equip button'
    );

    writeFileSync(BOOSTER_COMPONENT_FILE, boosterContent);
    log('Applied upstream patch: booster Equip button for new avatar cards');
  }

  // === PATCH 3: Hardcode Colyseus server URL for local-build architecture ===
  // When serving locally via Tauri, window.location resolves to tauri://localhost
  // which breaks the WebSocket connection to the game server.
  if (!existsSync(NETWORK_FILE)) {
    throw new Error(`Upstream file missing: ${NETWORK_FILE}`);
  }

  let networkContent = readFileSync(NETWORK_FILE, 'utf-8');
  if (!networkContent.includes('"wss://pokemon-auto-chess.com"')) {
    networkContent = replaceOrThrow(
      networkContent,
      'const endpoint = `${window.location.protocol.replace("http", "ws")}//${\n  window.location.host\n}`',
      'const endpoint = "wss://pokemon-auto-chess.com"',
      'network server URL'
    );
    writeFileSync(NETWORK_FILE, networkContent);
    log('Applied upstream patch: hardcoded Colyseus server URL for local serving');
  }

  // === PATCH 4: Hardcode signInSuccessUrl for local-build architecture ===
  // Defensive patch — popup auth may not use this, but prevents broken redirects.
  if (existsSync(LOGIN_FILE)) {
    let loginContent = readFileSync(LOGIN_FILE, 'utf-8');
    if (!loginContent.includes('"https://pokemon-auto-chess.com/lobby"')) {
      if (loginContent.includes('signInSuccessUrl: window.location.href + "lobby"')) {
        loginContent = loginContent.replace(
          'signInSuccessUrl: window.location.href + "lobby"',
          'signInSuccessUrl: "https://pokemon-auto-chess.com/lobby"'
        );
        writeFileSync(LOGIN_FILE, loginContent);
        log('Applied upstream patch: hardcoded signInSuccessUrl for local serving');
      }
    }
  }
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

  // Copy locales (i18next translations loaded at runtime via HTTP backend)
  const localesDir = join(clientDist, 'locales');
  if (existsSync(localesDir)) {
    cpSync(localesDir, join(DIST_DIR, 'locales'), { recursive: true });
    log('Copied locales/');
  } else {
    log('Warning: locales/ not found in upstream build output');
  }

  // Copy pokechess sub-game assets (Gameboy mode)
  const pokechessDir = join(clientDist, 'pokechess');
  if (existsSync(pokechessDir)) {
    cpSync(pokechessDir, join(DIST_DIR, 'pokechess'), { recursive: true });
    log('Copied pokechess/');
  }

  // Copy changelog (patch notes markdown files)
  const changelogDir = join(clientDist, 'changelog');
  if (existsSync(changelogDir)) {
    cpSync(changelogDir, join(DIST_DIR, 'changelog'), { recursive: true });
    log('Copied changelog/');
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
