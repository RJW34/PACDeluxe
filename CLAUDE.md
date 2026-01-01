# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**PACDeluxe** — A native Windows 11 desktop client for the open-source browser game [pokemonAutoChess](https://github.com/keldaanCommunity/pokemonAutoChess) (the 8-player auto-battler). Focused purely on performance optimization without gameplay modification.

**GitHub:** https://github.com/RJW34/PACDeluxe

---

## TRIGGER: "plugins go"

When the user says **"plugins go"**, respond with:

```
Ready to set up plugins for PACDeluxe. Please run these commands:

1. /plugin install rust-analyzer-lsp@claude-plugins-official
2. /plugin install context7@claude-plugins-official
3. /plugin install frontend-design@claude-plugins-official

After installing, restart Claude CLI with: claude --resume

Then say "ready" to continue where we left off.
```

---

## CONTINUATION STATE (2026-01-01)

### Current Status: BUILDS AND RUNS
The app compiles and launches. Core implementation is complete.

### What's Working:
1. **Tauri v2 shell** - Compiles and runs on Windows
2. **Frontend build** - Correctly builds Pokemon Auto Chess (not pokechess)
3. **Performance optimizations applied:**
   - ABOVE_NORMAL_PRIORITY_CLASS for process
   - 1ms timer resolution (timeBeginPeriod)
   - DWM transitions disabled
   - Priority boost disabled for consistent timing
4. **Performance overlay** - Toggle with Ctrl+Shift+P (FPS, CPU, Memory)
5. **Frame monitor** - Passive FPS/frame timing measurement

### Known Limitations:
- **GPU monitoring** - Not available (would require vendor-specific SDKs)
- **No frame pacing control** - WebView controls frame delivery via requestAnimationFrame
- **No render optimization** - Cannot hook into Phaser without modifying upstream

### Immediate Next Steps:
1. **TEST THE APP** - Run `npm run tauri:dev` and verify:
   - Pokemon Auto Chess login screen appears (Google/Email/Twitter auth)
   - Can log in and reach lobby
   - Can join a game (8-player multiplayer)
   - Performance overlay works (Ctrl+Shift+P)
2. **Fix any Firebase/auth issues** - May need CSP adjustments
3. **Fix any WebSocket connection issues** - Game uses Colyseus

### Key Files (Simplified - Windows Only):
```
src-tauri/
├── src/
│   ├── main.rs         # Entry point, applies optimizations
│   ├── lib.rs          # Module exports
│   ├── performance.rs  # Windows perf APIs (priority, timer, DWM)
│   └── commands.rs     # IPC: get_performance_stats, get_system_info
├── Cargo.toml          # Minimal deps: tauri, sysinfo, windows
└── tauri.conf.json     # Window config, CSP, bundle settings

scripts/
└── build-frontend.js   # Builds upstream, injects perf overlay

dist/                   # Built frontend (gitignored)
upstream-game/          # Cloned pokemonAutoChess (gitignored)
```

### Build Commands:
```bash
# First time setup
npm install
npm run sync-upstream      # Clones pokemonAutoChess
cd upstream-game && npm install && cd ..

# Build and run
npm run build:frontend     # Builds game + overlay
npm run tauri:dev          # Run in dev mode
npm run tauri:build        # Release build (MSI/NSIS)
```

### Critical Notes:
- **Windows 11 only** - No macOS/Linux code, simplified for one platform
- **Game is multiplayer** - Requires internet for Firebase auth + Colyseus servers
- **No VSync control** - Performance users typically disable VSync themselves
- **Subagents available** - Use Task tool for parallel debugging/exploration

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
