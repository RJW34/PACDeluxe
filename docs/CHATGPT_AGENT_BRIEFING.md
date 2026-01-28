# Project Briefing: PACDeluxe - Context for PRD & Documentation Creation

## Executive Summary

**PACDeluxe** is a native Windows 11 desktop client wrapper for the open-source browser game [Pokemon Auto Chess](https://github.com/keldaanCommunity/pokemonAutoChess) — an 8-player auto-battler. The project focuses **exclusively on performance optimization** without any gameplay modification.

**GitHub:** https://github.com/RJW34/PACDeluxe

---

## Critical Constraint (MUST BE PRESERVED)

**All optimizations must preserve identical gameplay behavior:**
- No reading/modifying hidden game state
- No altering game logic, RNG, matchmaking, or timing rules
- No automating gameplay decisions
- No gaining informational or mechanical advantage
- Gameplay must be deterministically identical to the browser version

Any add-on that violates these constraints is **prohibited**.

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| Desktop Shell | Tauri v2 (Rust backend + WebView2 frontend) |
| Native Backend | Rust (Windows APIs, sysinfo, WMI) |
| Frontend | Unmodified Pokemon Auto Chess (React + Phaser 3) |
| Performance Layer | Injected JavaScript (non-game-altering) |
| IPC | Tauri command system (`#[tauri::command]`) |
| Build System | Node.js scripts + Vite (upstream) + Cargo (Rust) |
| Target Platform | Windows 11 only (no macOS/Linux) |

---

## Architecture Overview

```
PACDeluxe/
├── src-tauri/                 # Rust native backend (Tauri v2)
│   ├── src/
│   │   ├── main.rs            # Entry point, window creation, injected overlay script
│   │   ├── performance.rs     # Windows performance APIs (priority, timers, DWM, GPU, HDR)
│   │   └── commands.rs        # IPC commands exposed to JavaScript
│   ├── Cargo.toml             # Rust dependencies
│   └── tauri.conf.json        # Tauri configuration
│
├── scripts/                   # Build tooling
│   ├── sync-upstream.js       # Clones/updates Pokemon Auto Chess repo
│   └── build-frontend.js      # Builds game + injects overlay, WebGL fixes
│
├── upstream-game/             # Cloned Pokemon Auto Chess (gitignored, NEVER modified)
├── dist/                      # Built frontend output (gitignored)
└── tests/                     # Ethical safeguard tests
```

---

## How the System Works

### 1. Build Process
1. `npm run sync-upstream` — Clones the upstream Pokemon Auto Chess repository
2. `npm run build:frontend` — Builds the upstream client unchanged, then:
   - Copies built assets to `dist/`
   - Creates `index.html` with performance overlay and WebGL texture filtering fixes
   - Calculates a build version hash for cache invalidation

### 2. Runtime Flow
1. Tauri launches with a WebView2 window pointed at `https://pokemon-auto-chess.com`
2. **Before any content loads**, Rust applies system optimizations:
   - Process priority elevated to `ABOVE_NORMAL_PRIORITY_CLASS`
   - 1ms timer resolution (`timeBeginPeriod`)
   - Power throttling disabled
   - DWM transitions disabled
   - DPI awareness enabled
3. **On page load**, JavaScript is injected (`OVERLAY_SCRIPT` in `main.rs`):
   - Performance overlay (FPS, CPU, GPU, Memory, RTT, HDR status)
   - Asset cache (in-memory, 256MB limit, version-aware)
   - CSS optimizations for tooltips and pixel-art rendering
   - Session recovery for upstream bugs
   - Booster "Flip All" button fix
   - Auto-updater UI
4. A background thread monitors for new WebView2 child processes and elevates their priority

### 3. IPC Commands (Rust → JavaScript)
| Command | Purpose |
|---------|---------|
| `get_performance_stats` | CPU usage, memory (process-level), uptime |
| `get_system_info` | OS, CPU cores, total RAM, GPU name |
| `get_gpu_stats` | GPU utilization % via PDH API |
| `get_hdr_status` | HDR capability/status via DXGI 1.6 |
| `toggle_fullscreen` | Exclusive fullscreen toggle |
| `set_window_mode` / `get_window_mode` | Windowed/Fullscreen/Borderless |
| `check_for_updates` / `install_update` / `restart_app` | Auto-update flow |
| `get_webview_telemetry` | WebView2 process elevation metrics |

### 4. Performance Optimizations Applied
| Optimization | Location | Effect |
|--------------|----------|--------|
| Process priority | `performance.rs` | Reduces scheduling latency |
| 1ms timer resolution | `performance.rs` | Smoother frame pacing |
| Power throttling disabled | `performance.rs` | Prevents CPU throttling |
| DWM transitions disabled | `performance.rs` | Faster window updates |
| WebView2 child priority | `performance.rs` | WMI event-driven or polling |
| NEAREST texture filtering | `build-frontend.js` | Crisp pixel art (no blur) |
| sRGB color space | `build-frontend.js` | Consistent colors vs browser |
| Asset cache | `main.rs` (JS) | Faster asset loads |
| Tooltip GPU acceleration | `main.rs` (JS) | Smoother hover popups |

---

## What Add-Ons Are Appropriate

**Allowed (performance/UX only):**
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
| `src-tauri/src/main.rs` | Entry point, window config, `OVERLAY_SCRIPT` (all injected JS) |
| `src-tauri/src/performance.rs` | All Windows performance APIs, GPU/HDR monitoring |
| `src-tauri/src/commands.rs` | All Tauri IPC commands |
| `src-tauri/tauri.conf.json` | App identity, bundling, updater config |
| `scripts/build-frontend.js` | Frontend build process, WebGL hooks |

---

## Build Commands

```bash
npm install
npm run sync-upstream        # Clone Pokemon Auto Chess
cd upstream-game && npm install && cd ..
npm run build:frontend       # Build game + overlay
npm run tauri:dev            # Development mode
npm run tauri:build          # Release build (MSI/NSIS)
npm run validate             # Determinism checks
npm test                     # Ethical safeguard tests
```

---

## Current Version & Known Limitations

- **Version:** 1.4.1
- **Passkeys/WebAuthn:** Not supported (WebView2 limitation)
- **VSync control:** Not available (WebView2 owns swap chain)
- **Frame pacing:** Cannot control directly (use `requestAnimationFrame`)
- **Upstream game bugs:** Some are patched via injected JS (booster bug, session recovery)

---

## PRD Guidelines for Add-Ons

When writing PRDs for PACDeluxe add-ons:

1. **Clearly state** whether the feature touches Rust backend, JavaScript injection, or both
2. **Specify IPC commands** needed (input/output types in TypeScript and Rust)
3. **Confirm ethical compliance** — does it affect gameplay? If unclear, it's probably not allowed
4. **Consider performance impact** — overlay JS runs on the main thread
5. **Target Windows 11** — no need for cross-platform considerations
6. **Use existing patterns**:
   - Rust perf monitoring → `performance.rs`
   - Tauri commands → `commands.rs`
   - Injected JS → add to `OVERLAY_SCRIPT` in `main.rs`
   - Build-time hooks → `build-frontend.js`

---

## Questions to Ask When Designing Add-Ons

1. Does this feature modify, read, or depend on game state? (**Must be NO**)
2. Does this give the user any advantage over browser players? (**Must be NO**)
3. Is this purely observational (FPS, latency, system stats)? (**Should be YES**)
4. Does this require new Windows API calls? (Add to `Cargo.toml` features)
5. Does this require new IPC commands? (Add to `commands.rs`)
6. Does this affect the build process? (Modify `build-frontend.js`)

---

*Use this document as your primary reference when creating PRDs, technical specifications, or documentation for PACDeluxe add-ons.*
