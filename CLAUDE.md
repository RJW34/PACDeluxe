# CLAUDE.md

This file gives Claude Code the current repo truth for PACDeluxe.

## Project Summary

PACDeluxe is a local-build desktop client for Pokemon Auto Chess.

- frontend assets are built into `dist/`
- Tauri loads `dist/index.html`
- native behavior lives in `src-tauri/src/`
- build-time upstream patching lives in `scripts/build-frontend.js`
- the canonical upstream patch inventory lives in `docs/PATCH_MANIFEST.md`

## Supported Platforms

- Windows: supported and released
- Linux: local experimentation only; public release paused

## Architecture Notes

The repo intentionally does **not** maintain a second standalone frontend runtime anymore.

Current runtime source of truth:

- `src-tauri/src/main.rs` (injected OVERLAY_SCRIPT and AUTH_POPUP_BRIDGE_SCRIPT live here)

Current native/backend source of truth:

- `src-tauri/src/commands.rs` (origin-scoped HTTP proxy, updater, window mode, telemetry)
- `src-tauri/src/performance.rs`

Current build source of truth:

- `scripts/build-manifest.js`
- `scripts/build-frontend.js`
- `scripts/verify-build-manifest.js`
- `scripts/proxy-manifest.js` (shared local-asset classifier, prod host constant)

## Network Model

PACDeluxe uses an origin-scoped proxy, not a path allowlist:

- the Rust proxy accepts any relative path (routes to `https://pokemon-auto-chess.com`) and any absolute URL on `pokemon-auto-chess.com` or subdomains; everything else is rejected
- the injected JS fetch interceptor proxies everything that is not a local asset (defined by `scripts/proxy-manifest.js`)
- new upstream API endpoints work automatically - do **not** add per-endpoint allowlists

Firebase popup auth flows through a bidirectional bridge:

- `AUTH_POPUP_BRIDGE_SCRIPT` runs in the popup and mocks `window.opener` plus listens for main->popup events
- the main-window overlay intercepts `window.open` and returns a mock `Window` so Firebase's SDK has a usable popup reference
- `pac-auth-popup-result`, `pac-main-to-popup`, `pac-popup-closed`, `pac-close-auth-popup`, and `pac-popup-redirect-opener` are the Tauri events that wire those windows together

## Guardrails

- Do not add competitive gameplay changes.
- Do not add hidden-state access.
- Do not reintroduce `--disable-web-security`.
- Do not scrape Firebase config from the live production site.
- Do not add undocumented upstream patches.
- Do not reintroduce a path-based proxy allowlist - the model is origin-scoped.
- Keep docs pointing at `docs/PATCH_MANIFEST.md` rather than duplicating patch counts.

## Build Commands

```bash
npm install
npm run sync-upstream
cd upstream-game && npm install && cd ..
npm run build:frontend
npm run tauri:dev
```

## Verification Commands

```bash
npm test
npm run validate
npm run verify:manifest
npm run verify
```

## Key Docs

- `docs/ADR-0001-local-build-architecture.md`
- `docs/PATCH_MANIFEST.md`
- `TRANSPARENCY.md`
- `docs/ETHICS_AND_COMPLIANCE.md`
- `docs/RELEASE_CHECKLIST.md`
