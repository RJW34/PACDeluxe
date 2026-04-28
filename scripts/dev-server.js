#!/usr/bin/env node
/**
 * Development Server
 *
 * Serves the dist/ folder for Tauri's `beforeDevCommand`. Tauri points its
 * webview at http://localhost:1420 and the injected main.rs overlay script
 * handles all upstream API calls via the native Rust proxy, so this server
 * only ever needs to serve static assets and the SPA index.html fallback.
 *
 * Direct-browser access (without Tauri) is not supported: without the
 * overlay, upstream fetches would hit this server instead of the native
 * proxy and get a bogus HTML response. A 501 is returned for non-static
 * GET requests in that case so the failure mode is at least explicit.
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isLocalStaticPath } from './proxy-manifest.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DIST_DIR = join(__dirname, '..', 'dist');
const PORT = 1420;

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};

// SPA routes defined by upstream's React Router. Any GET to one of these
// paths (or its sub-routes) should serve index.html so the SPA can route.
const SPA_ROUTE_PREFIXES = [
  '/lobby',
  '/preparation',
  '/game',
  '/after',
  '/bot-builder',
  '/bot-admin',
  '/sprite-viewer',
  '/map-viewer',
  '/gameboy',
  '/translations',
  '/auth',
];

function getMimeType(filepath, pathname = '') {
  if (pathname.startsWith('/tilemap/')) {
    return 'application/json';
  }
  const ext = extname(filepath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function serveFile(res, filepath, pathname = '') {
  try {
    if (!existsSync(filepath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    const stat = statSync(filepath);
    if (stat.isDirectory()) {
      filepath = join(filepath, 'index.html');
      if (!existsSync(filepath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }
    }

    const content = readFileSync(filepath);
    const mimeType = getMimeType(filepath, pathname);

    res.writeHead(200, {
      'Content-Type': mimeType,
      'Content-Length': content.length,
      'Cache-Control': 'no-cache',
    });
    res.end(content);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(`Server Error: ${err.message}`);
  }
}

function resolveDistFile(pathname) {
  const filepath = join(DIST_DIR, pathname);
  if (existsSync(filepath)) {
    return filepath;
  }
  if (
    pathname.startsWith('/tilemap/') &&
    !pathname.endsWith('.json') &&
    /^[A-Za-z0-9_-]+$/.test(pathname.slice('/tilemap/'.length))
  ) {
    return `${filepath}.json`;
  }
  return filepath;
}

const server = createServer((req, res) => {
  // Handle CORS for development
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  let pathname = req.url.split('?')[0];
  if (pathname === '/') {
    pathname = '/index.html';
  }

  const filepath = resolveDistFile(pathname);

  // Known SPA routes -> index.html, upstream's React Router handles them.
  if (SPA_ROUTE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    serveFile(res, join(DIST_DIR, 'index.html'), pathname);
    return;
  }

  // Local static asset (matches dist/ prefix or extension) -> serve from dist/.
  if (isLocalStaticPath(pathname)) {
    serveFile(res, filepath, pathname);
    return;
  }

  // Non-static, non-SPA path that exists on disk (e.g. a new asset extension
  // we haven't classified yet).
  if (existsSync(filepath) && statSync(filepath).isFile()) {
    serveFile(res, filepath, pathname);
    return;
  }

  // Anything else is expected to be an upstream API call that the Tauri
  // runtime proxy handles. When the dev server is used standalone without
  // Tauri there is no proxy - tell the caller that explicitly instead of
  // silently returning index.html (which would break JSON parsing).
  res.writeHead(501, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    error: 'PACDeluxe native proxy required',
    message: 'Upstream API requests are routed by the Tauri runtime. Run `npm run tauri:dev` instead of accessing this dev server directly.',
    path: pathname,
  }));
});

// Check if dist exists
if (!existsSync(DIST_DIR)) {
  console.error('[dev-server] Error: dist/ directory not found');
  console.error('[dev-server] Run "npm run build:frontend:dev" first');
  process.exit(1);
}

server.listen(PORT, () => {
  console.log(`[dev-server] Serving ${DIST_DIR}`);
  console.log(`[dev-server] http://localhost:${PORT}`);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[dev-server] Shutting down...');
  server.close();
  process.exit(0);
});
