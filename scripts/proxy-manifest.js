/**
 * Runtime proxy allowlist manifest.
 *
 * Keep this file in sync with:
 * - src-tauri/src/commands.rs
 * - the injected proxy runtime inside src-tauri/src/main.rs
 * - scripts/dev-server.js
 */

export const PROXY_API_PATHS = Object.freeze([
  '/profile',
  '/players',
  '/bots',
  '/leaderboards',
  '/tilemap/',
  '/game-history/',
  '/chat-history/',
  '/moderation/',
]);

export const COMMUNITY_SERVERS_MANIFEST_URL =
  'https://raw.githubusercontent.com/keldaanCommunity/pokemonAutoChess/master/community-servers.md';

export const LOCAL_STATIC_FETCH_PREFIXES = Object.freeze([
  '/changelog/',
  '/locales/',
]);
