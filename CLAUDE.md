# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**PACDeluxe** — A native desktop client for the open-source browser game [pokemonAutoChess](https://github.com/keldaanCommunity/pokemonAutoChess) (the 8-player auto-battler). Bundles the upstream game with build-time patches, system-level performance tuning, and non-competitive QoL features. Windows (WebView2) primary, Linux (WebKitGTK) experimental.

**GitHub:** https://github.com/RJW34/PACDeluxe

---

## CONTINUATION STATE (2026-03-21)

### Current Status: v2.0.0 — LOCAL-BUILD ARCHITECTURE
Major architecture pivot: the app now serves locally-built frontend assets from `dist/` instead of loading the live site. CI/CD builds Windows (MSI/NSIS) and Linux (AppImage) on tag push.

### What's Working:
1. **Tauri v2 shell** — Compiles and runs on Windows and Linux
2. **Local-build pipeline** — `build-frontend.js` builds upstream game to `dist/`, applies idempotent patches, Tauri serves via custom protocol
3. **Chromium GPU flags** — `--enable-gpu-rasterization --enable-zero-copy` via WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
4. **Google OAuth login** — Works. Auth popups auto-close on callback. Passkeys unsupported (WebView2 limitation)
5. **System optimizations:**
   - **Windows:** ABOVE_NORMAL_PRIORITY_CLASS, 1ms timer, DWM optimizations, WebView2 child process elevation (WMI event-driven + polling fallback)
   - **Linux:** Nice-based priority (requires CAP_SYS_NICE for elevated priority)
6. **Performance overlay** — Ctrl+Shift+P (FPS, CPU, Memory, GPU, RTT, HZ, HDR)
7. **In-memory asset cache** — 128MB limit, version-aware invalidation, session prewarm
8. **Auto-updater** — Checks GitHub releases, shows banner, downloads + restarts
9. **Custom booster UX** — "Flip All" button (runtime), "Equip" button (build-time patch), session recovery monitor
10. **Window modes** — F11 fullscreen, Shift+F11 borderless windowed
11. **Build-time patches** — Resize fix, booster Equip, server URL, anonymous login redirect, server detection, auth success URL (all idempotent)

### Known Limitations:
- **GPU monitoring** — Windows only (via PDH API). Linux returns N/A
- **HDR detection** — Windows only (via DXGI 1.6). Not available on Linux
- **WebAuthn/Passkeys** — Fundamental WebView2 limitation, use password auth
- **No frame pacing control** — WebView controls frame delivery via requestAnimationFrame
- **No render optimization** — Cannot hook into Phaser without modifying upstream game logic
- **Binary size** — Bundled assets increase installer size significantly vs live-site wrapper

### Key Files:
```
src-tauri/src/
├── main.rs         # Entry point, OVERLAY_SCRIPT (injected JS), OAuth popup handling, Chromium flags
├── lib.rs          # Module exports
├── performance.rs  # Cross-platform perf APIs (cfg-gated), GPU/HDR monitoring
└── commands.rs     # IPC commands (stats, GPU, HDR, updater, window modes)

scripts/
├── build-frontend.js   # Builds upstream client for dist/, applies build-time patches
├── sync-upstream.js    # Clones/updates pokemonAutoChess
└── validate-determinism.js  # Source scanning + optional replay comparison
```

### Build & Release:
```bash
npm install && npm run sync-upstream
cd upstream-game && npm install && cd ..
npm run build:frontend     # Build game to dist/ with patches
npm run tauri:dev          # Dev mode (auto-starts dev server on port 1420)
npm run tauri:build        # Release build
```
Release: push a `v*` tag to trigger `.github/workflows/release.yml` (builds both platforms with signing).

## Critical Constraints

**All features must preserve identical competitive gameplay behavior:**
- No reading/modifying hidden game state
- No altering game logic, RNG, matchmaking, or timing rules
- No automating gameplay decisions
- No gaining informational or mechanical advantage
- Non-competitive QoL features (booster Flip All, Equip, session recovery) are allowed

## Architecture

```
pacdeluxe/
├── src/                    # JavaScript performance modules
│   ├── performance/        # Frame monitoring, input tracking, overlay
│   │   ├── frame-monitor.js    # Passive FPS/timing measurement
│   │   ├── input-optimizer.js  # Input latency monitoring
│   │   ├── asset-cache.js      # In-memory asset caching
│   │   ├── network-monitor.js  # Network RTT tracking
│   │   └── profiling-overlay.js # Ctrl+Shift+P overlay
│   ├── bridge/             # Tauri IPC bridge
│   │   └── tauri-bridge.js
│   └── index.js            # Main entry point
├── src-tauri/              # Rust native backend
│   ├── src/
│   │   ├── main.rs         # Application entry, OVERLAY_SCRIPT, Chromium flags
│   │   ├── lib.rs          # Module exports
│   │   ├── performance.rs  # System optimizations, GPU/HDR
│   │   └── commands.rs     # IPC commands, updater
│   ├── Cargo.toml
│   └── tauri.conf.json     # frontendDist: ../dist
├── scripts/                # Build tooling
│   ├── sync-upstream.js    # Sync pokemonAutoChess
│   ├── build-frontend.js   # Build + patch upstream for dist/
│   ├── dev-server.js       # Dev server on port 1420
│   └── validate-determinism.js  # Source scanning + replay comparison
├── dist/                   # Built frontend output (gitignored, served at runtime)
├── tests/                  # Ethical safeguard tests
│   └── ethical-safeguards.test.js
├── docs/                   # Documentation
└── upstream-game/          # Cloned pokemonAutoChess (gitignored, patched at build time)
```

## Build Commands

```bash
# Sync upstream pokemonAutoChess repository
npm run sync-upstream

# Build frontend for Tauri (patches upstream, bundles to dist/)
npm run build:frontend

# Development mode (frontend + Tauri)
npm run dev

# Production build
npm run build

# Run Tauri development server
npm run tauri:dev

# Build Tauri release
npm run tauri:build

# Run source scanning + optional replay validation
npm run validate

# Run ethical safeguard tests
npm test

# Lint code
npm run lint
```

## Technology Stack

- **Desktop Shell:** Tauri v2 (Rust backend, WebView frontend)
  - Windows: WebView2 (Chromium-based) with GPU rasterization flags
  - Linux: WebKitGTK
- **Native Backend:** Rust with platform-specific optimizations (cfg-gated)
- **Frontend:** Upstream pokemonAutoChess (React + Phaser 3) with build-time patches
- **Runtime Injections:** OVERLAY_SCRIPT in main.rs (overlay, cache, QoL features)
- **IPC:** Tauri command system
- **Installers:** Windows (MSI/NSIS), Linux (AppImage)

## Key Files

| File | Purpose |
|------|---------|
| `src-tauri/src/main.rs` | Tauri entry, window setup, OVERLAY_SCRIPT, Chromium flags |
| `src-tauri/src/performance.rs` | System-level optimizations (priority, timers, GPU, HDR) |
| `src-tauri/src/commands.rs` | IPC commands (stats, updater, window modes) |
| `scripts/build-frontend.js` | Builds upstream to dist/ with patches (resize, Equip, server URL) |
| `scripts/validate-determinism.js` | Source scanning + optional replay comparison |

## Validation Requirements

Before any deployment:
1. Run `npm run validate` — static source scanning must pass
2. Run `npm test` — ethical safeguards must pass
3. No source code in `src/` or `src-tauri/src/` may contain forbidden patterns
4. Replay-based determinism comparison runs when replay artifacts are present (optional)

## Development Guidelines

1. **All upstream modifications must be idempotent build-time patches** in `build-frontend.js`, not manual edits to `upstream-game/`
2. **Preserve identical gameplay** — Features must not affect competitive outcomes
3. **Test first** — Run ethical tests before committing changes
4. **Document assumptions** — Comment any DOM interaction or timing code
5. **Validate frequently** — Run source scanning during development

## Upstream Sync

The `upstream-game/` directory contains the cloned pokemonAutoChess repository. To update:

```bash
npm run sync-upstream
```

This pulls the latest version and installs dependencies. Build-time patches are applied by `npm run build:frontend` (idempotent — safe to re-run).
