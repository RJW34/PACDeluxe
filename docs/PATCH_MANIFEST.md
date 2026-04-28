# PACDeluxe Patch Manifest

This is the canonical inventory of build-time upstream patches applied by `scripts/build-frontend.js`.

If this file and the build manifest code disagree, the repo is out of date and `npm run verify:manifest` should fail.

## Current Patch Inventory

| Patch ID | Upstream File | Purpose |
|---|---|---|
| `phaser-initial-resize` | `app/public/src/game/game-container.ts` | Forces an initial Phaser resize call so the locally served client sizes correctly on first paint. |
| `booster-equip-button` | `app/public/src/pages/component/booster/booster.tsx` | Adds an Equip shortcut for newly opened avatar-compatible booster cards. |
| `network-endpoint-hardcode` | `app/public/src/network.ts` | Pins the Colyseus WebSocket endpoint to the official production server for local-build runtime use. |
| `login-signin-flow` | `app/public/src/pages/component/auth/login.tsx` | Keeps Firebase auth on popup flow so the main WebView does not leave the bundled client during OAuth; the Tauri popup bridge supplies FirebaseUI's `window.open`/`window.opener` contract. |
| `login-no-redirect-after-auth` | `app/public/src/pages/component/auth/login.tsx` | Returns `false` from FirebaseUI `signInSuccessWithAuthResult` so React handles the authenticated state without an extra FirebaseUI navigation. |
| `login-success-url` | `app/public/src/pages/component/auth/login.tsx` | Points Firebase auth success redirect back to the local-build origin root (`window.location.origin + "/"`). Returning to `/lobby` directly would hang on `tauri-plugin-localhost` since that path isn't a file in `dist/` and the plugin has no SPA fallback. |
| `anonymous-login-redirect` | `app/public/src/pages/component/auth/anonymous-button.tsx` | Fixes anonymous-login lobby redirection for the local-build runtime. |
| `server-detection-origin` | `app/public/src/pages/component/servers/servers-list.tsx` | Keeps official-server detection stable when the client is served from the Tauri origin. |
| `service-worker-cache-disable` | `app/public/src/index.tsx` | Unregisters the upstream cache-first service worker and clears CacheStorage so stale packaged-asset fallbacks cannot persist across PACDeluxe builds. |

## Build Configuration Contract

PACDeluxe requires explicit Firebase client configuration for local builds.

Provide the values in one of these ways:

1. `config/firebase-client.env`
2. environment variables in your shell
3. an existing `upstream-game/.env`

Tracked template:

- `config/firebase-client.env.example`

PACDeluxe does not scrape Firebase configuration from the live production site anymore.

## Packaged Runtime Asset Contract

PACDeluxe must not depend on stale browser caches or proxy timing for render-critical Phaser assets.

`npm run build:frontend` must:

- restore or generate upstream texture-pack atlases for `abilities`, `attacks`, `item`, `status`, and `types`
- copy those generated atlas JSON/PNG files into `dist/assets/`
- generate local dungeon tilemaps into `dist/tilemap/*.json`
- serve `/tilemap/<MapName>` as packaged JSON from the local server
- replace upstream `sw.js` with a cleanup worker and unregister old service workers

`npm test` and `npm run verify:release` enforce these requirements so future releases cannot silently ship the old Pokeball-placeholder or blank-map failure modes.

## Release Signing Contract

Tauri 2 signing is noninteractive in CI. Release signing must use:

- `TAURI_PRIVATE_KEY`
- `TAURI_PRIVATE_KEY_PASSWORD`

The GitHub workflow maps the existing secret names (`TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) into the Tauri 2 names before building and signing. `npm run release:sign` refuses to run without a password so local releases fail clearly instead of hanging on a hidden prompt. `npm run release:manifest` then writes `latest.json` from the exact signed MSI/NSIS artifacts that are uploaded to GitHub.

After the GitHub release is published, `npm run verify:updater` must pass. It reads the configured updater endpoint from `src-tauri/tauri.conf.json` and fails if live `latest.json` still advertises an older version, which is exactly the condition that prevents installed clients from being prompted to update.
