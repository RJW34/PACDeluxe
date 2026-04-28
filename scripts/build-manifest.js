#!/usr/bin/env node

export const REQUIRED_FIREBASE_KEYS = [
  'FIREBASE_API_KEY',
  'FIREBASE_AUTH_DOMAIN',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_STORAGE_BUCKET',
  'FIREBASE_MESSAGING_SENDER_ID',
  'FIREBASE_APP_ID',
];

export const UPSTREAM_PATCHES = [
  {
    id: 'phaser-initial-resize',
    file: 'app/public/src/game/game-container.ts',
    summary: 'Forces an initial Phaser resize call so the locally served client sizes correctly on first paint.',
  },
  {
    id: 'booster-equip-button',
    file: 'app/public/src/pages/component/booster/booster.tsx',
    summary: 'Adds an Equip shortcut for newly opened avatar-compatible booster cards.',
  },
  {
    id: 'network-endpoint-hardcode',
    file: 'app/public/src/network.ts',
    summary: 'Pins the Colyseus WebSocket endpoint to the official production server for local-build runtime use.',
  },
  {
    id: 'login-signin-flow',
    file: 'app/public/src/pages/component/auth/login.tsx',
    summary: 'Keeps Firebase auth on popup flow so the main WebView does not leave the bundled client during OAuth; the Tauri popup bridge supplies FirebaseUI\'s window.open/window.opener contract.',
  },
  {
    id: 'login-no-redirect-after-auth',
    file: 'app/public/src/pages/component/auth/login.tsx',
    summary: 'Returns false from FirebaseUI signInSuccessWithAuthResult so React handles the authenticated state without an extra FirebaseUI navigation.',
  },
  {
    id: 'login-success-url',
    file: 'app/public/src/pages/component/auth/login.tsx',
    summary: 'Points Firebase auth success redirect back to the local-build origin root (window.location.origin + "/"). The root path serves dist/index.html; returning to /lobby would 404/hang on tauri-plugin-localhost which has no SPA fallback.',
  },
  {
    id: 'anonymous-login-redirect',
    file: 'app/public/src/pages/component/auth/anonymous-button.tsx',
    summary: 'Fixes anonymous-login lobby redirection for the local-build runtime.',
  },
  {
    id: 'server-detection-origin',
    file: 'app/public/src/pages/component/servers/servers-list.tsx',
    summary: 'Keeps official-server detection stable when the client is served from the Tauri origin.',
  },
  {
    id: 'service-worker-cache-disable',
    file: 'app/public/src/index.tsx',
    summary: 'Unregisters the upstream cache-first service worker and clears CacheStorage so stale packaged-asset fallbacks cannot persist across PACDeluxe builds.',
  },
];

export const BUILD_MANIFEST_DOC = 'docs/PATCH_MANIFEST.md';
