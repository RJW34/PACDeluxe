# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**PACDeluxe** — A native Windows 11 desktop client for the open-source browser game [pokemonAutoChess](https://github.com/keldaanCommunity/pokemonAutoChess) (the 8-player auto-battler). Focused purely on performance optimization without gameplay modification.

**GitHub:** https://github.com/RJW34/PACDeluxe

---

## CONTINUATION STATE (2026-01-01)

### Current Status: TESTING RECENT FIXES
App is running via `npm run tauri:dev`. User is testing fixes for blurriness and font changes.

### Just Completed This Session:
1. **Fixed blurriness** - Added missing `enable_dpi_awareness()` function to `performance.rs:66-86`
   - The function was being called but never defined (causing WebView2 to render without DPI awareness)
   - Now sets Per-Monitor DPI Awareness v2 for crisp rendering on high-DPI displays
2. **Replaced Jost font with Orbitron** - Added to `main.rs:35-49`
   - Injects Google Fonts Orbitron import
   - Overrides font-family on html, body, button, input, select, textarea
3. **Scrollbar fix** - Already in place from previous session (`main.rs:26-33`)
   - Injects `html { overflow: hidden !important; }` to fix 100vw overflow bug

### User Needs to Verify:
1. **Sharpness** - Is content less blurry than before?
2. **Font** - Does UI show Orbitron (geometric/techy) instead of Jost?
3. **Scrollbar** - No unwanted vertical scrollbar on booster page?

### What's Working:
1. **Tauri v2 shell** - Compiles and runs on Windows
2. **Google OAuth login** - Works (passkeys don't work - known WebView2 limitation)
3. **Performance optimizations applied:**
   - Per-monitor DPI awareness v2 (NEW - fixes blurriness)
   - ABOVE_NORMAL_PRIORITY_CLASS for process
   - 1ms timer resolution (timeBeginPeriod)
   - DWM transitions disabled
   - Priority boost disabled for consistent timing
   - Power throttling disabled
   - WebView2 child process priority elevation (background thread)
   - Windows 11 DWM optimizations (no rounded corners, no mica)
4. **Performance overlay** - Toggle with Ctrl+Shift+P (FPS, CPU, Memory)
5. **CSS Fixes injected** - Scrollbar fix, Orbitron font replacement

### Known Issues:
- **Auth popup doesn't auto-close** - `window.close()` not working in WebView2
- **WebAuthn/Passkeys** - Not supported in WebView2 (use password login instead)

### Key Files Modified This Session:
- `src-tauri/src/performance.rs` - Added `enable_dpi_awareness()` function
- `src-tauri/src/main.rs` - Added Orbitron font injection to OVERLAY_SCRIPT

### Build Commands:
```bash
npm run tauri:dev          # Run in dev mode (currently running)
npm run tauri:build        # Release build (MSI/NSIS)
```

### Critical Notes:
- **Windows 11 only** - No macOS/Linux code
- **Game is multiplayer** - Requires internet for Firebase auth + Colyseus servers
- **Don't modify upstream-game/** - CSS fixes are injected via main.rs OVERLAY_SCRIPT

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
│   │   ├── asset-cache.js      # IndexedDB asset caching
│   │   └── profiling-overlay.js # Ctrl+Shift+P overlay
│   ├── bridge/             # Tauri IPC bridge
│   │   └── tauri-bridge.js
│   └── index.js            # Main entry point
├── src-tauri/              # Rust native backend
│   ├── src/
│   │   ├── main.rs         # Application entry
│   │   ├── lib.rs          # Library exports
│   │   ├── performance.rs  # System optimizations
│   │   ├── commands.rs     # IPC commands
│   │   └── config.rs       # Configuration
│   ├── Cargo.toml
│   └── tauri.conf.json
├── scripts/                # Build and validation scripts
│   ├── sync-upstream.js    # Sync pokemonAutoChess
│   ├── build-frontend.js   # Build frontend for Tauri
│   └── validate-determinism.js  # Determinism checker
├── tests/                  # Ethical safeguard tests
│   └── ethical-safeguards.test.js
├── docs/                   # Documentation
│   ├── README.md
│   ├── UPSTREAM_ANALYSIS.md
│   ├── ETHICS_AND_COMPLIANCE.md
│   └── PERFORMANCE_TUNING.md
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
- **Native Helper:** Rust (performance.rs, commands.rs)
- **Frontend:** Cloned upstream pokemonAutoChess (React + Phaser 3)
- **Performance Layer:** JavaScript modules (frame-monitor, profiling-overlay)
- **IPC:** Tauri command system with strict schemas

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
