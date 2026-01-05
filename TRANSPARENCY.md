# PACDeluxe - Transparency Report

**What is this app?**
A native Windows wrapper for Pokemon Auto Chess (https://pokemon-auto-chess.com) that applies performance optimizations. The game itself is loaded from the official servers - we don't modify gameplay.

---

## What This App Does (Complete List)

### 1. Process Priority (Windows API)
- **What:** Sets PACDeluxe to "Above Normal" priority
- **Why:** Ensures the game gets CPU time before background apps
- **API Used:** `SetPriorityClass(ABOVE_NORMAL_PRIORITY_CLASS)`
- **Reversible:** Yes, automatically resets when app closes

### 2. Timer Resolution (Windows API)
- **What:** Requests 1ms system timer resolution
- **Why:** Smoother frame pacing, reduced input lag
- **API Used:** `timeBeginPeriod(1)` / `timeEndPeriod(1)` on exit
- **Reversible:** Yes, properly cleaned up on exit

### 3. Power Throttling Disabled (Windows API)
- **What:** Prevents Windows from throttling the app on battery/efficiency mode
- **Why:** Consistent performance regardless of power settings
- **API Used:** `SetProcessInformation(ProcessPowerThrottling)`
- **Reversible:** Yes, only affects this process

### 4. DWM Window Optimizations (Windows API)
- **What:** Disables window animations, rounded corners, and backdrop effects
- **Why:** Slightly reduces rendering overhead
- **API Used:** `DwmSetWindowAttribute()`
- **Reversible:** Yes, only affects this window

### 5. WebView2 Child Process Priority
- **What:** Elevates priority of WebView2 renderer processes spawned by PACDeluxe
- **Why:** The game runs in WebView2 - this ensures the renderer gets priority
- **How:** Background thread scans for `msedgewebview2.exe` children every 5 seconds
- **Safety:** Only touches processes that are direct children of PACDeluxe

### 6. CSS Styling Injection
- **What:** Injects CSS for visual enhancements
- **Changes:**
  - Orbitron font (loaded from Google Fonts)
  - Dark theme with Pokemon-themed colors
  - Scrollbar overflow fix
  - Button styling improvements
- **Why:** Aesthetic improvements, easier on the eyes
- **Toggle:** Ctrl+Shift+G to toggle visual enhancements

### 7. Performance Overlay
- **What:** Shows FPS, CPU usage, and memory usage
- **Toggle:** Ctrl+Shift+P
- **Data Source:** JavaScript `requestAnimationFrame` for FPS, Rust `sysinfo` crate for system stats

---

## What This App Does NOT Do

- **No network requests** - All traffic goes directly to Pokemon Auto Chess servers
- **No data collection** - We don't collect, store, or transmit any user data
- **No keylogging** - We don't capture keystrokes outside the app
- **No file access** - We don't read or write files on your system (except app data)
- **No registry modification** - We don't touch the Windows registry
- **No system services** - We don't install any background services
- **No startup entries** - We don't add ourselves to Windows startup
- **No gameplay modification** - We don't touch game logic, RNG, or give any advantage
- **No hidden processes** - Only `pac-deluxe.exe` and standard WebView2 processes

---

## Processes You'll See in Task Manager

When PACDeluxe is running, you'll see:

| Process | Description |
|---------|-------------|
| `pac-deluxe.exe` | Main PACDeluxe application |
| `msedgewebview2.exe` (multiple) | WebView2 renderer processes (Edge-based, from Microsoft) |

This is normal. WebView2 spawns multiple processes for security isolation (same as Chrome/Edge).

---

## Source Code

This app is open source. You can verify everything yourself:

- **GitHub:** https://github.com/RJW34/PACDeluxe
- **Performance code:** `src-tauri/src/performance.rs`
- **Main app:** `src-tauri/src/main.rs`
- **All Windows API calls are documented with comments**

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
| Ctrl+Shift+P | Toggle performance overlay (FPS/CPU/Memory) |
| Ctrl+Shift+G | Toggle visual enhancements (dark theme) |
| F11 | Toggle fullscreen |

---

## Technical Details

- **Framework:** Tauri v2 (Rust backend, WebView2 frontend)
- **Size:** ~1.8 MB installer, ~5 MB installed
- **Runtime:** Requires WebView2 (auto-downloads if missing, ~140 MB)
- **Platform:** Windows 10/11 (64-bit only)

---

## Questions?

Contact the developer or check the GitHub issues page.
