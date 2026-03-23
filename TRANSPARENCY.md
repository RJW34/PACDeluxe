# PACDeluxe - Transparency Report

**What is this app?**
A native desktop client that bundles the [Pokemon Auto Chess](https://pokemon-auto-chess.com) game with performance optimizations and quality-of-life features. The game is built from upstream source at build time, with a small number of non-gameplay patches applied. All game logic runs on the official servers.

**Platform:** Windows (primary), Linux (experimental)

---

## What This App Does (Complete List)

### System Optimizations (Rust backend)

#### 1. Process Priority (Windows)
- **What:** Sets PACDeluxe to "Above Normal" priority
- **Why:** Ensures the game gets CPU time before background apps
- **API Used:** `SetPriorityClass(ABOVE_NORMAL_PRIORITY_CLASS)`
- **Reversible:** Yes, automatically resets when app closes

#### 2. Timer Resolution (Windows)
- **What:** Requests 1ms system timer resolution
- **Why:** Smoother system timing, reduced scheduling jitter
- **API Used:** `timeBeginPeriod(1)` / `timeEndPeriod(1)` on exit
- **Reversible:** Yes, properly cleaned up on exit

#### 3. Power Throttling Disabled (Windows)
- **What:** Prevents Windows from throttling the app on battery/efficiency mode
- **Why:** Consistent performance regardless of power settings
- **API Used:** `SetProcessInformation(ProcessPowerThrottling)`
- **Reversible:** Yes, only affects this process

#### 4. DWM Window Optimizations (Windows)
- **What:** Disables window animations, rounded corners, and backdrop effects
- **Why:** Slightly reduces rendering overhead
- **API Used:** `DwmSetWindowAttribute()`
- **Reversible:** Yes, only affects this window

#### 5. WebView2 Child Process Priority (Windows)
- **What:** Elevates priority of WebView2 renderer processes spawned by PACDeluxe
- **Why:** The game runs in WebView2 — this ensures the renderer gets priority
- **How:** WMI event-driven detection with polling fallback, scans every 5 seconds
- **Safety:** Only touches processes that are direct children of PACDeluxe

#### 6. WebView2 Chromium Flags (Windows)
- **What:** Sets GPU rasterization, zero-copy, and background throttling flags
- **Why:** Enables GPU-accelerated rasterization and prevents background deprioritization
- **Flags:** `--enable-gpu-rasterization --enable-zero-copy --disable-background-timer-throttling --disable-renderer-backgrounding --disable-web-security`
- **Note on `--disable-web-security`:** Required because the locally-served app makes authenticated API calls to `pokemon-auto-chess.com`, which is a different origin. Without this flag, CORS would block profile loading, leaderboards, bot management, and other server-backed features. This is standard for desktop apps serving local content.
- **Set via:** `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` environment variable before WebView creation

#### 7. Linux Process Priority
- **What:** Sets process niceness for priority scheduling
- **Why:** Same goal as Windows priority elevation
- **Requires:** CAP_SYS_NICE capability for elevated priority

#### 8. GPU Monitoring (Windows only)
- **What:** Reads GPU utilization percentage
- **API Used:** PDH (Performance Data Helper)
- **Linux:** Returns N/A

#### 9. HDR Detection (Windows only)
- **What:** Detects HDR capability and color space
- **API Used:** DXGI 1.6
- **Linux:** Not available

### Runtime Injections (JavaScript, via OVERLAY_SCRIPT in main.rs)

#### 10. Scrollbar/Viewport Fix
- **What:** Hides scrollbars and fixes viewport sizing issues in the WebView
- **Why:** Prevents overflow caused by 100vh/100vw in WebView context

#### 11. Canvas Context Menu
- **What:** Disables default right-click menu on canvas elements
- **Why:** Prevents WebView2 default context menu from interfering with gameplay

#### 12. In-Memory Asset Cache
- **What:** Intercepts `fetch()` for static assets (images, JSON, audio, fonts) and caches responses in memory
- **Limit:** 128MB
- **Version-aware:** Clears cache when game build version changes
- **Prewarm:** On startup, pre-fetches up to 50 assets from previous session
- **Excluded:** API calls, Firebase, Colyseus, WebSocket traffic

#### 13. Performance Overlay
- **What:** Displays FPS, CPU, GPU, memory, refresh rate, RTT, and HDR status
- **Toggle:** Ctrl+Shift+P
- **Data sources:** JavaScript `requestAnimationFrame` for FPS/HZ, Rust IPC for CPU/GPU/Memory/HDR, `PerformanceObserver` for network RTT
- **Draggable:** Position saved to localStorage

#### 14. Fullscreen and Borderless Windowed
- **What:** F11 toggles fullscreen, Shift+F11 toggles borderless windowed mode
- **Implemented via:** Tauri IPC commands (`toggle_fullscreen`, `set_window_mode`)

#### 15. Session Recovery Monitor
- **What:** Detects broken auth state (user appears logged out while Firebase auth is valid) and auto-refreshes
- **Why:** Works around an upstream bug where navigating away from boosters can corrupt session state
- **Duration:** Active for 5 minutes after page load, then stops to save resources

#### 16. Booster "Flip All" Button
- **What:** Adds a "Flip All" button next to "Open a Booster" that flips all unflipped cards at once
- **How:** Dispatches synthetic click events on unflipped `.booster-card` elements
- **Non-competitive:** Purely cosmetic convenience; all card reveals happen client-side anyway

#### 17. Auto-Updater
- **What:** Checks GitHub releases for new versions and shows a non-intrusive banner
- **Flow:** Check → banner notification → user clicks "Update Now" → download → restart
- **Network:** Hits `https://github.com/RJW34/PACDeluxe/releases/latest/download/latest.json`

#### 18. Pixel-Art Rendering (build-time)
- **What:** CSS forces nearest-neighbor interpolation on canvas and sprite elements
- **Why:** Prevents blurry upscaling of pixel art

### Build-Time Patches (applied by build-frontend.js)

#### 19. Initial Phaser Resize
- **What:** Adds `this.resize()` call after the resize event listener in `game-container.ts`
- **Why:** Forces correct initial sizing when the game loads in the Tauri window

#### 20. Booster Equip Button
- **What:** Adds an "Equip" button in `booster.tsx` for newly obtained avatar-compatible cards
- **How:** Dispatches `changeAvatar` action when clicked
- **Non-competitive:** Convenience shortcut for an action already available elsewhere in the UI

#### 21. Server URL Hardcode
- **What:** Replaces `window.location`-derived WebSocket URL with `wss://pokemon-auto-chess.com` in `network.ts`
- **Why:** When served locally via Tauri protocol, `window.location` would resolve to `tauri://localhost`, breaking multiplayer

#### 22a. Anonymous Login Redirect
- **What:** Replaces `window.location.href + "lobby"` with `https://pokemon-auto-chess.com/lobby` in `anonymous-button.tsx`
- **Why:** Guest login redirect would point to `tauri://localhost/lobby` instead of the game lobby

#### 22b. Server Detection
- **What:** Replaces `window.location.origin` check with hardcoded `https://pokemon-auto-chess.com` in `servers-list.tsx`
- **Why:** Current server detection would fail since local origin doesn't match any server URL

#### 22c. Auth Success URL
- **What:** Replaces `window.location.href + "lobby"` with `https://pokemon-auto-chess.com/lobby` in `login.tsx`
- **Why:** Defensive patch for Firebase auth redirect URL

### Startup Behavior

#### 22. Old Installation Cleanup
- **What:** Removes known stale files from previous installations on startup
- **Targets:** Old cache directories, stale WebView2 lock files, deprecated DLLs
- **Locations:** AppData directories (Windows) or XDG directories (Linux), and the executable directory
- **Safety:** Only removes files matching a hardcoded list of known problematic patterns

#### 23. OAuth Popup Management
- **What:** Opens Google/Firebase auth in a popup window, auto-closes on callback
- **Timeout:** Orphaned popups are force-closed after 5 minutes

---

## Network Activity

PACDeluxe makes the following network requests:

| Destination | Purpose | When |
|---|---|---|
| `wss://pokemon-auto-chess.com` | Game server (Colyseus WebSocket) | During gameplay |
| `*.firebaseapp.com`, `*.googleapis.com` | Firebase authentication (Google login) | On login |
| `github.com/RJW34/PACDeluxe/releases` | Update check | On startup (after 5s delay) |
| Game asset URLs | Asset prewarm from previous session | On startup (up to 50 assets) |

PACDeluxe does **not** collect, store, or transmit any user data to PACDeluxe servers (there are none).

---

## Local File Access

| What | Where | Purpose |
|---|---|---|
| Startup cleanup | AppData/XDG dirs, exe directory | Remove stale files from old installations |
| localStorage | WebView2 storage | Overlay position, visibility, cache version, prewarmed asset list |
| Tauri app data | Standard Tauri data directory | Application state |

---

## What This App Does NOT Do

- **No data collection** — We don't collect, store, or transmit any user data
- **No keylogging** — We don't capture keystrokes outside the app
- **No registry modification** — We don't touch the Windows registry
- **No system services** — We don't install any background services
- **No startup entries** — We don't add ourselves to Windows startup
- **No gameplay modification** — We don't touch game logic, RNG, or give any competitive advantage
- **No hidden processes** — Only `pac-deluxe.exe` and standard WebView2 processes

---

## Processes You'll See in Task Manager

| Process | Description |
|---------|-------------|
| `pac-deluxe.exe` | Main PACDeluxe application |
| `msedgewebview2.exe` (multiple) | WebView2 renderer processes (Edge-based, from Microsoft) |

This is normal. WebView2 spawns multiple processes for security isolation (same as Chrome/Edge).

---

## Source Code

This app is open source. You can verify everything yourself:

- **GitHub:** https://github.com/RJW34/PACDeluxe
- **System optimizations:** `src-tauri/src/performance.rs`
- **Main app + OVERLAY_SCRIPT:** `src-tauri/src/main.rs`
- **Build-time patches:** `scripts/build-frontend.js`
- **IPC commands:** `src-tauri/src/commands.rs`

---

## Why Is Windows Warning Me?

If Windows SmartScreen shows a warning, it's because:
1. The app is **not code-signed** (signing costs $200-400/year)
2. SmartScreen hasn't seen this app before

This does NOT mean the app is malicious. To bypass:
1. Click "More info"
2. Click "Run anyway"

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+Shift+P | Toggle performance overlay |
| F11 | Toggle fullscreen |
| Shift+F11 | Toggle borderless windowed |

---

## Technical Details

- **Framework:** Tauri v2 (Rust backend, WebView2/WebKitGTK frontend)
- **Runtime:** Requires WebView2 (auto-downloads if missing on Windows)
- **Platform:** Windows 10/11 (64-bit), Linux (experimental AppImage)
