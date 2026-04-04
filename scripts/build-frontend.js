#!/usr/bin/env node
/**
 * Frontend Build Script
 *
 * Builds the upstream Pokemon Auto Chess client for the PACDeluxe local-build
 * desktop architecture. Applies the canonical non-gameplay patch inventory
 * declared in scripts/build-manifest.js.
 */

import { execSync } from 'child_process';
import { createHash } from 'crypto';
import { existsSync, mkdirSync, cpSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { REQUIRED_FIREBASE_KEYS, UPSTREAM_PATCHES } from './build-manifest.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
const UPSTREAM_DIR = join(ROOT, 'upstream-game');
const DIST_DIR = join(ROOT, 'dist');
const FIREBASE_CONFIG_FILE = join(ROOT, 'config', 'firebase-client.env');
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
const BOOSTER_CARD_FILE = join(
  UPSTREAM_DIR,
  'app',
  'public',
  'src',
  'pages',
  'component',
  'booster',
  'booster-card.tsx'
);
const BOOSTER_CARD_CSS_FILE = join(
  UPSTREAM_DIR,
  'app',
  'public',
  'src',
  'pages',
  'component',
  'booster',
  'booster-card.css'
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
const ANONYMOUS_BUTTON_FILE = join(
  UPSTREAM_DIR,
  'app',
  'public',
  'src',
  'pages',
  'component',
  'auth',
  'anonymous-button.tsx'
);
const SERVERS_LIST_FILE = join(
  UPSTREAM_DIR,
  'app',
  'public',
  'src',
  'pages',
  'component',
  'servers',
  'servers-list.tsx'
);

function log(msg) {
  console.log(`[build] ${msg}`);
}

function getPatchMeta(id) {
  return UPSTREAM_PATCHES.find((patch) => patch.id === id) ?? { id, summary: id };
}

function replaceOrThrow(content, search, replacement, label) {
  if (!content.includes(search)) {
    throw new Error(`Unable to apply upstream patch (${label}): marker not found`);
  }
  return content.replace(search, replacement);
}

function parseEnvFile(content) {
  const values = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }

  return values;
}

function resolveFirebaseConfig() {
  const sources = [{
    name: 'process.env',
    values: process.env,
  }];

  if (existsSync(FIREBASE_CONFIG_FILE)) {
    sources.push({
      name: 'config/firebase-client.env',
      values: parseEnvFile(readFileSync(FIREBASE_CONFIG_FILE, 'utf-8')),
    });
  }

  const upstreamEnvFile = join(UPSTREAM_DIR, '.env');
  if (existsSync(upstreamEnvFile)) {
    sources.push({
      name: 'upstream-game/.env',
      values: parseEnvFile(readFileSync(upstreamEnvFile, 'utf-8')),
    });
  }

  const resolved = {};
  const resolvedSources = [];

  for (const key of REQUIRED_FIREBASE_KEYS) {
    for (const source of sources) {
      const candidate = source.values[key];
      if (typeof candidate === 'string' && candidate.trim() !== '') {
        resolved[key] = candidate.trim();
        resolvedSources.push(`${key}<=${source.name}`);
        break;
      }
    }
  }

  const missingKeys = REQUIRED_FIREBASE_KEYS.filter((key) => !resolved[key]);
  if (missingKeys.length > 0) {
    throw new Error(
      `Missing Firebase client configuration: ${missingKeys.join(', ')}.\n` +
      'Provide config/firebase-client.env, environment variables, or a pre-existing upstream-game/.env.\n' +
      'See config/firebase-client.env.example for the required keys.'
    );
  }

  return {
    values: resolved,
    resolvedSources,
  };
}

function applyUpstreamPatches() {
  log(`Applying ${UPSTREAM_PATCHES.length} build-time patches from the canonical manifest`);

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
    log(`Applied upstream patch: ${getPatchMeta('phaser-initial-resize').id}`);
  }

  if (!existsSync(BOOSTER_COMPONENT_FILE)) {
    throw new Error(`Upstream file missing: ${BOOSTER_COMPONENT_FILE}`);
  }

  let boosterContent = readFileSync(BOOSTER_COMPONENT_FILE, 'utf-8')
    .replace(/\r\n/g, '\n');

  if (!boosterContent.includes('function onClickEquipCard(')) {
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

    // Add per-card equip handler (replaces the old single-button approach)
    boosterContent = replaceOrThrow(
      boosterContent,
      '  const handleFlip = (index: number) => {\n',
      '  function onClickEquipCard(card: (typeof boosterContent)[0]) {\n' +
        '    dispatch(\n' +
        '      changeAvatar({\n' +
        '        index: PkmIndex[card.name],\n' +
        '        emotion: card.emotion,\n' +
        '        shiny: card.shiny\n' +
        '      })\n' +
        '    )\n' +
        '  }\n' +
        '\n' +
        '  const handleFlip = (index: number) => {\n',
      'booster equip click handler'
    );

    // Pass onEquip callback to each new card
    boosterContent = replaceOrThrow(
      boosterContent,
      '            onFlip={() => handleFlip(i)}\n' +
        '          />\n',
      '            onFlip={() => handleFlip(i)}\n' +
        '            onEquip={card.new ? () => onClickEquipCard(card) : undefined}\n' +
        '          />\n',
      'booster per-card equip prop'
    );

    writeFileSync(BOOSTER_COMPONENT_FILE, boosterContent);
    log(`Applied upstream patch: ${getPatchMeta('booster-equip-button').id}`);
  }

  // === PATCH 2b: Add equip button to individual booster cards ===
  if (existsSync(BOOSTER_CARD_FILE)) {
    let cardContent = readFileSync(BOOSTER_CARD_FILE, 'utf-8')
      .replace(/\r\n/g, '\n');

    if (!cardContent.includes('onEquip')) {
      // Add onEquip to props interface
      cardContent = replaceOrThrow(
        cardContent,
        '  onFlip: () => void\n}\n',
        '  onFlip: () => void\n  onEquip?: () => void\n}\n',
        'booster card equip prop interface'
      );

      // Destructure onEquip in component
      cardContent = replaceOrThrow(
        cardContent,
        '{ card, flipped, onFlip }',
        '{ card, flipped, onFlip, onEquip }',
        'booster card equip destructure'
      );

      // Add equip button below NEW text on flipped cards
      cardContent = replaceOrThrow(
        cardContent,
        '            <p className="new">{t("new")}</p>\n' +
          '          ) : (\n',
        '            <>\n' +
          '              <p className="new">{t("new")}</p>\n' +
          '              {flipped && onEquip && (\n' +
          '                <button\n' +
          '                  className="bubbly orange booster-equip-btn"\n' +
          '                  onClick={(e) => { e.stopPropagation(); onEquip(); }}\n' +
          '                >\n' +
          '                  Equip\n' +
          '                </button>\n' +
          '              )}\n' +
          '            </>\n' +
          '          ) : (\n',
        'booster card equip button jsx'
      );

      writeFileSync(BOOSTER_CARD_FILE, cardContent);
      log('Applied upstream patch: booster-card-equip-button');
    }
  }

  // === PATCH 2c: Add equip button CSS to booster cards ===
  if (existsSync(BOOSTER_CARD_CSS_FILE)) {
    let cardCss = readFileSync(BOOSTER_CARD_CSS_FILE, 'utf-8')
      .replace(/\r\n/g, '\n');

    if (!cardCss.includes('.booster-equip-btn')) {
      cardCss = replaceOrThrow(
        cardCss,
        '.booster-card .new {\n',
        '.booster-equip-btn {\n' +
          '  font-size: 0.65em !important;\n' +
          '  padding: 1px 10px !important;\n' +
          '  margin: 2px auto 0 !important;\n' +
          '  display: block !important;\n' +
          '  cursor: var(--cursor-hover);\n' +
          '}\n' +
          '\n' +
          '.booster-card .new {\n',
        'booster card equip button css'
      );

      writeFileSync(BOOSTER_CARD_CSS_FILE, cardCss);
      log('Applied upstream patch: booster-card-equip-css');
    }
  }

  // === PATCH 3: Hardcode Colyseus server URL for local-build architecture ===
  // When serving locally via Tauri, window.location resolves to tauri://localhost
  // which breaks the WebSocket connection to the game server.
  if (!existsSync(NETWORK_FILE)) {
    throw new Error(`Upstream file missing: ${NETWORK_FILE}`);
  }

  let networkContent = readFileSync(NETWORK_FILE, 'utf-8')
    .replace(/\r\n/g, '\n');
  if (!networkContent.includes('"wss://pokemon-auto-chess.com"')) {
    networkContent = replaceOrThrow(
      networkContent,
      'const endpoint = `${window.location.protocol.replace("http", "ws")}//${\n  window.location.host\n}`',
      'const endpoint = "wss://pokemon-auto-chess.com"',
      'network server URL'
    );
    writeFileSync(NETWORK_FILE, networkContent);
    log(`Applied upstream patch: ${getPatchMeta('network-endpoint-hardcode').id}`);
  }

  // === PATCH 4: Hardcode signInSuccessUrl for local-build architecture ===
  // Defensive patch — popup auth may not use this, but prevents broken redirects.
  if (existsSync(LOGIN_FILE)) {
    let loginContent = readFileSync(LOGIN_FILE, 'utf-8')
      .replace(/\r\n/g, '\n');
    if (!loginContent.includes('"https://pokemon-auto-chess.com/lobby"')) {
      if (loginContent.includes('signInSuccessUrl: window.location.href + "lobby"')) {
        loginContent = loginContent.replace(
          'signInSuccessUrl: window.location.href + "lobby"',
          'signInSuccessUrl: "https://pokemon-auto-chess.com/lobby"'
        );
        writeFileSync(LOGIN_FILE, loginContent);
        log(`Applied upstream patch: ${getPatchMeta('login-success-url').id}`);
      }
    }
  }

  // === PATCH 5: Fix anonymous login redirect for local serving ===
  // anonymous-button.tsx uses window.location.href + "lobby" which breaks under tauri://
  if (existsSync(ANONYMOUS_BUTTON_FILE)) {
    let anonContent = readFileSync(ANONYMOUS_BUTTON_FILE, 'utf-8')
      .replace(/\r\n/g, '\n');
    if (!anonContent.includes('"https://pokemon-auto-chess.com/lobby"')) {
      if (anonContent.includes('window.location.href = window.location.href + "lobby"')) {
        anonContent = anonContent.replace(
          'window.location.href = window.location.href + "lobby"',
          'window.location.href = "https://pokemon-auto-chess.com/lobby"'
        );
        writeFileSync(ANONYMOUS_BUTTON_FILE, anonContent);
        log(`Applied upstream patch: ${getPatchMeta('anonymous-login-redirect').id}`);
      }
    }
  }

  // === PATCH 6: Fix server detection for local serving ===
  // servers-list.tsx uses window.location.origin to detect current server
  if (existsSync(SERVERS_LIST_FILE)) {
    let serversContent = readFileSync(SERVERS_LIST_FILE, 'utf-8')
      .replace(/\r\n/g, '\n');
    if (!serversContent.includes('"https://pokemon-auto-chess.com"')) {
      if (serversContent.includes('server.url?.startsWith(window.location.origin)')) {
        serversContent = serversContent.replace(
          'server.url?.startsWith(window.location.origin)',
          'server.url?.startsWith("https://pokemon-auto-chess.com")'
        );
        writeFileSync(SERVERS_LIST_FILE, serversContent);
        log(`Applied upstream patch: ${getPatchMeta('server-detection-origin').id}`);
      }
    }
  }
}

/**
 * Ensure Firebase client config exists for the upstream build.
 * PACDeluxe no longer scrapes these values from the live production site.
 */
function ensureFirebaseConfig() {
  const envFile = join(UPSTREAM_DIR, '.env');
  const { values, resolvedSources } = resolveFirebaseConfig();
  const envContent = REQUIRED_FIREBASE_KEYS
    .map((key) => `${key}="${values[key].replace(/"/g, '\\"')}"`)
    .join('\n') + '\n';

  writeFileSync(envFile, envContent);
  log(`Firebase config written to upstream-game/.env (${resolvedSources.join(', ')})`);
}

async function main() {
  log('Building Pokemon Auto Chess frontend...');

  // Check upstream exists
  if (!existsSync(join(UPSTREAM_DIR, 'package.json'))) {
    throw new Error('Upstream not found. Run: npm run sync-upstream');
  }

  // Ensure Firebase client config is available for the build
  ensureFirebaseConfig();

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
