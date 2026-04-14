# PACDeluxe Patch Manifest

This is the canonical inventory of build-time upstream patches applied by `scripts/build-frontend.js`.

If this file and the build manifest code disagree, the repo is out of date and `npm run verify:manifest` should fail.

## Current Patch Inventory

| Patch ID | Upstream File | Purpose |
|---|---|---|
| `phaser-initial-resize` | `app/public/src/game/game-container.ts` | Forces an initial Phaser resize call so the locally served client sizes correctly on first paint. |
| `booster-equip-button` | `app/public/src/pages/component/booster/booster.tsx` | Adds an Equip shortcut for newly opened avatar-compatible booster cards. |
| `network-endpoint-hardcode` | `app/public/src/network.ts` | Pins the Colyseus WebSocket endpoint to the official production server for local-build runtime use. |
| `login-signin-flow` | `app/public/src/pages/component/auth/login.tsx` | Switches Firebase auth from popup to redirect flow so OAuth works inside WebView2 without iframe<->popup postMessage plumbing. |
| `login-success-url` | `app/public/src/pages/component/auth/login.tsx` | Points Firebase auth success redirect back to the local-build origin root (`window.location.origin + "/"`). Returning to `/lobby` directly would hang on `tauri-plugin-localhost` since that path isn't a file in `dist/` and the plugin has no SPA fallback. |
| `anonymous-login-redirect` | `app/public/src/pages/component/auth/anonymous-button.tsx` | Fixes anonymous-login lobby redirection for the local-build runtime. |
| `server-detection-origin` | `app/public/src/pages/component/servers/servers-list.tsx` | Keeps official-server detection stable when the client is served from the Tauri origin. |

## Build Configuration Contract

PACDeluxe requires explicit Firebase client configuration for local builds.

Provide the values in one of these ways:

1. `config/firebase-client.env`
2. environment variables in your shell
3. an existing `upstream-game/.env`

Tracked template:

- `config/firebase-client.env.example`

PACDeluxe does not scrape Firebase configuration from the live production site anymore.

