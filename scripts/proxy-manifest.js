/**
 * Runtime proxy manifest (origin-scoped model).
 *
 * PACDeluxe serves the upstream client from its own local origin
 * (tauri://localhost in production builds, http://localhost:1420 under
 * `tauri dev`). Every network request must be classified as either:
 *
 *   - a local asset bundled into dist/  -> served by Tauri's frontendDist
 *   - an upstream call                  -> routed through the native Rust
 *                                          proxy to https://pokemon-auto-chess.com
 *
 * This file is the single source of truth for that classification. It's
 * consumed by:
 *
 *   - scripts/dev-server.js          - serves files from dist/, SPA fallback
 *   - tests/ethical-safeguards.test.js - sanity-checks the manifest
 *
 * The Rust proxy in src-tauri/src/commands.rs enforces the same
 * origin-scoping rule independently: it only accepts absolute URLs that
 * target the production host (or its subdomains), plus the one exact
 * community-servers manifest URL read-only.
 */

/**
 * Path prefixes for directories bundled into dist/. Relative fetches that
 * start with any of these are served locally.
 */
export const LOCAL_STATIC_FETCH_PREFIXES = Object.freeze([
  '/assets/',
  '/style/',
  '/locales/',
  '/pokechess/',
  '/changelog/',
]);

/**
 * File extensions that are always served locally from dist/ when they
 * appear as a top-level path. `.json` is intentionally excluded: the
 * upstream may expose API endpoints that end in `.json`.
 */
export const LOCAL_STATIC_FETCH_EXTENSIONS = Object.freeze([
  '.html',
  '.js',
  '.mjs',
  '.map',
  '.css',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.ico',
  '.mp3',
  '.ogg',
  '.wav',
  '.m4a',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
]);

export const PROD_ORIGIN = 'https://pokemon-auto-chess.com';
export const PROD_HOST = 'pokemon-auto-chess.com';

export const COMMUNITY_SERVERS_MANIFEST_URL =
  'https://raw.githubusercontent.com/keldaanCommunity/pokemonAutoChess/master/community-servers.md';

/**
 * Classify a local pathname as a static local asset or an upstream request.
 *
 * Callers are expected to pass a clean pathname, but strip `?` and `#`
 * defensively so a fragment or query on an extension path doesn't flip
 * the classification.
 *
 * @param {string} pathname
 * @returns {boolean} true if the path should be served from dist/
 */
export function isLocalStaticPath(pathname) {
  if (!pathname || pathname === '/' || pathname === '') return true;
  const clean = pathname.split('?')[0].split('#')[0];
  if (!clean || clean === '/') return true;
  for (const prefix of LOCAL_STATIC_FETCH_PREFIXES) {
    if (clean.startsWith(prefix)) return true;
  }
  const dot = clean.lastIndexOf('.');
  if (dot >= 0) {
    const ext = clean.slice(dot).toLowerCase();
    if (LOCAL_STATIC_FETCH_EXTENSIONS.includes(ext)) return true;
  }
  return false;
}
