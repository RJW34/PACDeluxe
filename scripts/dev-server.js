#!/usr/bin/env node
/**
 * Development Server
 *
 * Serves the dist folder for Tauri development.
 * Uses native http module to avoid extra dependencies.
 */

import { createServer } from 'http';
import { readFileSync, existsSync, statSync } from 'fs';
import { join, extname, dirname } from 'path';
import { fileURLToPath } from 'url';

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

function getMimeType(filepath) {
  const ext = extname(filepath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function serveFile(res, filepath) {
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
    const mimeType = getMimeType(filepath);

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

  const filepath = join(DIST_DIR, pathname);
  serveFile(res, filepath);
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
