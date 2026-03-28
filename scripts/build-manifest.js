#!/usr/bin/env node

export const REQUIRED_FIREBASE_KEYS = [
  'FIREBASE_API_KEY',
  'FIREBASE_AUTH_DOMAIN',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_STORAGE_BUCKET',
  'FIREBASE_MESSAGING_SENDER_ID',
  'FIREBASE_APP_ID',
];

export const PAC_API_PROXY_PATHS = [
  '/profile',
  '/bots',
  '/leaderboards',
  '/tilemap/',
  '/game-history/',
  '/chat-history/',
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
    id: 'login-success-url',
    file: 'app/public/src/pages/component/auth/login.tsx',
    summary: 'Pins Firebase auth success redirect handling to the official lobby URL.',
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
];

export const BUILD_MANIFEST_DOC = 'docs/PATCH_MANIFEST.md';

