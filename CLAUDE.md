# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**PACDeluxe** — A cross-platform native desktop client for the open-source browser game [pokemonAutoChess](https://github.com/keldaanCommunity/pokemonAutoChess) (the 8-player auto-battler). Supports Windows (WebView2) and Linux (WebKitGTK). Focused purely on performance optimization without gameplay modification.

**GitHub:** https://github.com/RJW34/PACDeluxe

---

## CONTINUATION STATE (2026-02-27)

### Current Status: STABLE — v1.6.2
The app is released and in active use. CI/CD builds Windows (MSI/NSIS) and Linux (AppImage) on tag push.

### What's Working:
1. **Tauri v2 shell** — Compiles and runs on Windows and Linux
2. **Google OAuth login** — Works. Auth popups auto-close on callback. Passkeys unsupported (WebView2 limitation)
3. **Performance optimizations:**
   - **Windows:** ABOVE_NORMAL_PRIORITY_CLASS, 1ms timer, DWM optimizations, WebView2 child process elevation (WMI event-driven + polling fallback)
   - **Linux:** Nice-based priority (requires CAP_SYS_NICE for elevated priority)
4. **Performance overlay** — Ctrl+Shift+P (FPS, CPU, Memory, GPU, RTT, HZ, HDR)
5. **In-memory asset cache** — 128MB limit, version-aware invalidation, session prewarm
6. **Auto-updater** — Checks GitHub releases, shows banner, downloads + restarts
7. **Custom booster UX** — "Flip All" button on booster packs, "Equip" button for avatar-compatible cards, session recovery monitor
8. **Window modes** — F11 fullscreen, Shift+F11 borderless windowed
9. **Upstream patch resilience** — build-frontend.js handles multiple import path variants with idempotency guards

### Known Limitations:
- **GPU monitoring** — Windows only (via PDH API). Linux returns N/A
- **HDR detection** — Windows only (via DXGI 1.6). Not available on Linux
- **WebAuthn/Passkeys** — Fundamental WebView2 limitation, use password auth
- **No frame pacing control** — WebView controls frame delivery via requestAnimationFrame
- **No render optimization** — Cannot hook into Phaser without modifying upstream

### Key Files:
```
src-tauri/src/
├── main.rs         # Entry point, OVERLAY_SCRIPT (injected JS), OAuth popup handling
├── lib.rs          # Module exports
├── performance.rs  # Cross-platform perf APIs (cfg-gated), GPU/HDR monitoring
└── commands.rs     # IPC commands (stats, GPU, HDR, updater, window modes)

scripts/
├── build-frontend.js   # Builds upstream client for dist/
├── sync-upstream.js    # Clones/updates pokemonAutoChess
└── validate-determinism.js  # Ethical safeguard validation
```

### Build & Release:
```bash
npm install && npm run sync-upstream
cd upstream-game && npm install && cd ..
npm run tauri:dev          # Dev mode
npm run tauri:build        # Release build
```
Release: push a `v*` tag to trigger `.github/workflows/release.yml` (builds both platforms with signing).

## Critical Constraints

**All optimizations must preserve identical gameplay behavior:**
- No reading/modifying hidden game state
- No altering game logic, RNG, matchmaking, or timing rules
- No automating gameplay decisions
- No gaining informational or mechanical advantage
- Gameplay must be deterministically identical to upstream

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
│   │   ├── main.rs         # Application entry, OVERLAY_SCRIPT
│   │   ├── lib.rs          # Module exports
│   │   ├── performance.rs  # System optimizations, GPU/HDR
│   │   └── commands.rs     # IPC commands, updater
│   ├── Cargo.toml
│   └── tauri.conf.json
├── scripts/                # Build and validation scripts
│   ├── sync-upstream.js    # Sync pokemonAutoChess
│   ├── build-frontend.js   # Build frontend for Tauri
│   └── validate-determinism.js  # Determinism checker
├── tests/                  # Ethical safeguard tests
│   └── ethical-safeguards.test.js
├── docs/                   # Documentation
└── upstream-game/          # Cloned pokemonAutoChess (gitignored)
```

## Build Commands

```bash
# Sync upstream pokemonAutoChess repository
npm run sync-upstream

# Build frontend for Tauri
npm run build:frontend

# Development mode (frontend + Tauri)
npm run dev

# Production build
npm run build

# Run Tauri development server
npm run tauri:dev

# Build Tauri release
npm run tauri:build

# Validate determinism (required before release)
npm run validate

# Run ethical safeguard tests
npm test

# Lint code
npm run lint
```

## Technology Stack

- **Desktop Shell:** Tauri v2 (Rust backend, WebView frontend)
  - Windows: WebView2 (Chromium-based)
  - Linux: WebKitGTK
- **Native Helper:** Rust with platform-specific optimizations (cfg-gated)
- **Frontend:** Cloned upstream pokemonAutoChess (React + Phaser 3)
- **Performance Layer:** JavaScript modules (frame-monitor, profiling-overlay)
- **IPC:** Tauri command system with strict schemas
- **Installers:** Windows (MSI/NSIS), Linux (AppImage)

## Key Files

| File | Purpose |
|------|---------|
| `src-tauri/src/main.rs` | Tauri application entry, window setup |
| `src-tauri/src/performance.rs` | System-level optimizations (priority, timers) |
| `src-tauri/src/commands.rs` | IPC commands (get_performance_stats, get_system_info) |
| `src/performance/frame-monitor.js` | Passive FPS and frame timing measurement |
| `src/performance/profiling-overlay.js` | Performance overlay (Ctrl+Shift+P) |
| `src/bridge/tauri-bridge.js` | JavaScript-Rust bridge |
| `scripts/validate-determinism.js` | Ensures gameplay is identical to browser |

## Validation Requirements

Before any deployment:
1. Run `npm run validate` - must pass
2. Run `npm test` - ethical safeguards must pass
3. No source code may contain forbidden patterns (see tests/ethical-safeguards.test.js)

Any divergence in gameplay behavior blocks release.

## Development Guidelines

1. **Never modify upstream-game/** — It's the source of truth for game logic
2. **Performance only** — All code must affect only rendering/system performance
3. **Test first** — Run ethical tests before committing changes
4. **Document assumptions** — Comment any DOM interaction or timing code
5. **Validate frequently** — Run determinism checks during development

## Upstream Sync

The `upstream-game/` directory contains the cloned pokemonAutoChess repository. To update:

```bash
npm run sync-upstream
```

This pulls the latest version and installs dependencies. The frontend build uses this code unchanged.
