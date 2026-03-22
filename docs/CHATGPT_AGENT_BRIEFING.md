# Project Briefing: PACDeluxe - Context for PRD & Documentation Creation

## Executive Summary

**PACDeluxe** is a native desktop client for the open-source browser game [Pokemon Auto Chess](https://github.com/keldaanCommunity/pokemonAutoChess) — an 8-player auto-battler. The project provides system-level performance optimizations and a small set of non-competitive quality-of-life features without modifying gameplay logic.

**GitHub:** https://github.com/RJW34/PACDeluxe

---

## Critical Constraint (MUST BE PRESERVED)

**All features must preserve identical competitive gameplay behavior:**
- No reading/modifying hidden game state
- No altering game logic, RNG, matchmaking, or timing rules
- No automating gameplay decisions
- No gaining informational or mechanical advantage
- Non-competitive QoL features (booster Flip All, Equip, session recovery) are allowed

Any feature that violates these constraints is **prohibited**.

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| Desktop Shell | Tauri v2 (Rust backend + WebView2/WebKitGTK frontend) |
| Native Backend | Rust (Windows APIs, sysinfo, WMI, PDH, DXGI) |
| Frontend | Pokemon Auto Chess with build-time patches (React + Phaser 3) |
| Performance Layer | Injected JavaScript (OVERLAY_SCRIPT in main.rs) |
| IPC | Tauri command system (`#[tauri::command]`) |
| Build System | Node.js scripts + upstream esbuild + Cargo (Rust) |
| Target Platform | Windows (primary), Linux (experimental) |

---

## Architecture Overview

```
PACDeluxe/
├── src-tauri/                 # Rust native backend (Tauri v2)
│   ├── src/
│   │   ├── main.rs            # Entry point, OVERLAY_SCRIPT, Chromium flags, OAuth popups
│   │   ├── performance.rs     # System performance APIs (priority, timers, DWM, GPU, HDR)
│   │   └── commands.rs        # IPC commands exposed to JavaScript
│   ├── Cargo.toml             # Rust dependencies
│   └── tauri.conf.json        # Tauri config (frontendDist: ../dist)
│
├── scripts/                   # Build tooling
│   ├── sync-upstream.js       # Clones/updates Pokemon Auto Chess repo
│   ├── build-frontend.js      # Builds game + applies patches to dist/
│   ├── dev-server.js          # Dev server on port 1420
│   └── validate-determinism.js # Source scanning + optional replay comparison
│
├── upstream-game/             # Cloned Pokemon Auto Chess (gitignored, patched at build time)
├── dist/                      # Built frontend output (gitignored, served at runtime)
└── tests/                     # Ethical safeguard tests
```

---

## How the System Works

### 1. Build Process
1. `npm run sync-upstream` — Clones the upstream Pokemon Auto Chess repository
2. `npm run build:frontend` — Applies build-time patches, builds the client, bundles to `dist/`:
   - Patches `game-container.ts` — Forces initial Phaser resize
   - Patches `booster.tsx` — Adds "Equip" button for new avatar cards
   - Patches `network.ts` — Hardcodes server URL for local serving
   - Copies built assets, styles, JS/CSS bundles to `dist/`
   - Creates `index.html` with pixel-art rendering CSS and build version hash

### 2. Runtime Flow
1. Tauri launches with a WebView2 window loading locally-built assets from `dist/`
2. **Before any content loads**, Rust applies system optimizations:
   - Chromium GPU flags set via `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`
   - Process priority elevated to `ABOVE_NORMAL_PRIORITY_CLASS`
   - 1ms timer resolution (`timeBeginPeriod`)
   - Power throttling disabled
   - DWM transitions disabled
3. **On page load**, JavaScript is injected (`OVERLAY_SCRIPT` in `main.rs`):
   - Scrollbar/viewport fix
   - Canvas context menu disabled
   - In-memory asset cache (128MB limit, version-aware)
   - Performance overlay (FPS, CPU, GPU, Memory, RTT, HZ, HDR)
   - Fullscreen (F11) and borderless windowed (Shift+F11)
   - Session recovery monitor
   - Booster "Flip All" button
   - Auto-updater banner
4. A background thread monitors for new WebView2 child processes and elevates their priority

### 3. IPC Commands (Rust → JavaScript)
| Command | Purpose |
|---------|---------|
| `get_performance_stats` | CPU usage, memory (process-level), uptime |
| `get_system_info` | OS, CPU cores, total RAM, GPU name |
| `get_gpu_stats` | GPU utilization % via PDH API (Windows only) |
| `get_hdr_status` | HDR capability/status via DXGI 1.6 (Windows only) |
| `toggle_fullscreen` | Exclusive fullscreen toggle |
| `set_window_mode` / `get_window_mode` | Windowed/Fullscreen/Borderless |
| `check_for_updates` / `install_update` / `restart_app` | Auto-update flow |
| `get_webview_telemetry` | WebView2 process elevation metrics |

### 4. Performance Optimizations Applied
| Optimization | Location | Effect |
|--------------|----------|--------|
| Chromium GPU rasterization | `main.rs` | GPU-accelerated page rasterization |
| Chromium zero-copy | `main.rs` | Reduces memory copies in rendering pipeline |
| Local asset serving | `tauri.conf.json` | Zero network latency for game assets |
| Process priority | `performance.rs` | Reduces scheduling latency |
| 1ms timer resolution | `performance.rs` | Reduces system timer jitter |
| Power throttling disabled | `performance.rs` | Prevents CPU throttling |
| DWM transitions disabled | `performance.rs` | Faster window updates |
| WebView2 child priority | `performance.rs` | WMI event-driven or polling |
| NEAREST texture filtering | `build-frontend.js` | Crisp pixel art (no blur) |
| In-memory asset cache | `main.rs` (JS) | Faster repeated asset loads |

---

## What Add-Ons Are Appropriate

**Allowed (performance/QoL, non-competitive):**
- Additional performance overlays or telemetry
- Input latency measurement
- Frame timing analysis
- Window management features (snap zones, multi-monitor)
- Audio/visual accessibility options
- Keybind customization for overlay features
- Streaming/recording integration
- Alternative themes/skins for the overlay (not game UI)
- Crash reporting / diagnostics
- Network quality indicators
- UI convenience features that don't affect competitive outcomes

**Not Allowed (gameplay-affecting):**
- Auto-play or auto-battle features
- Information overlays showing hidden game state
- Matchmaking manipulation
- RNG prediction
- Game memory reading/writing
- Automation of any gameplay decision
- Anything giving competitive advantage

---

## Key Files to Understand

| File | What It Does |
|------|--------------|
| `src-tauri/src/main.rs` | Entry point, window config, `OVERLAY_SCRIPT` (all injected JS), Chromium flags |
| `src-tauri/src/performance.rs` | All system performance APIs, GPU/HDR monitoring |
| `src-tauri/src/commands.rs` | All Tauri IPC commands |
| `src-tauri/tauri.conf.json` | App identity, bundling, updater, frontendDist config |
| `scripts/build-frontend.js` | Frontend build + upstream patches (resize, Equip, server URL) |

---

## Build Commands

```bash
npm install
npm run sync-upstream        # Clone Pokemon Auto Chess
cd upstream-game && npm install && cd ..
npm run build:frontend       # Build game + patches to dist/
npm run tauri:dev            # Development mode
npm run tauri:build          # Release build (MSI/NSIS/AppImage)
npm run validate             # Source scanning + optional replay comparison
npm test                     # Ethical safeguard tests
```

---

## Current Version & Known Limitations

- **Version:** 2.0.0
- **Passkeys/WebAuthn:** Not supported (WebView2 limitation)
- **VSync control:** Not available (WebView2 owns swap chain)
- **Frame pacing:** Cannot control directly (uses `requestAnimationFrame`)
- **GPU monitoring:** Windows only (PDH API). Linux returns N/A
- **HDR detection:** Windows only (DXGI 1.6). Not available on Linux
- **Upstream game bugs:** Some are patched via build-time patches or injected JS

---

## PRD Guidelines for Add-Ons

When writing PRDs for PACDeluxe add-ons:

1. **Clearly state** whether the feature touches Rust backend, JavaScript injection, or build-time patching
2. **Specify IPC commands** needed (input/output types in TypeScript and Rust)
3. **Confirm ethical compliance** — does it affect competitive gameplay? If unclear, it's probably not allowed
4. **Consider performance impact** — overlay JS runs on the main thread
5. **Platform considerations** — Windows is primary, Linux is experimental (cfg-gate platform-specific code)
6. **Use existing patterns**:
   - Rust perf monitoring → `performance.rs`
   - Tauri commands → `commands.rs`
   - Injected JS → add to `OVERLAY_SCRIPT` in `main.rs`
   - Build-time patches → `build-frontend.js`

---

*Use this document as your primary reference when creating PRDs, technical specifications, or documentation for PACDeluxe add-ons.*
