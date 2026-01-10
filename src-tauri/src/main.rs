// Windows subsystem - no console in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod performance;
mod commands;

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri::webview::NewWindowResponse;
use tracing::{info, debug, warn, Level};
use tracing_subscriber::FmtSubscriber;
use std::sync::atomic::{AtomicU32, AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use std::path::PathBuf;

/// Clean up problematic files from old installations
/// Runs on every startup to ensure clean state
fn cleanup_old_installation() {
    // Get the executable directory
    let exe_dir = match std::env::current_exe() {
        Ok(path) => path.parent().map(|p| p.to_path_buf()),
        Err(_) => None,
    };

    // Get AppData directories
    let local_appdata = std::env::var("LOCALAPPDATA").ok().map(PathBuf::from);
    let appdata = std::env::var("APPDATA").ok().map(PathBuf::from);

    let mut cleaned = Vec::new();

    // List of known problematic files/directories to remove
    // Add patterns here as issues are discovered
    let problematic_patterns: Vec<(&str, Option<&PathBuf>)> = vec![
        // Old cache files that may have incompatible formats
        ("PACDeluxe/cache_v0", local_appdata.as_ref()),
        ("PACDeluxe/old_config.json", appdata.as_ref()),
        // Stale WebView2 data that can cause issues
        ("PACDeluxe/EBWebView/stale_lock", local_appdata.as_ref()),
    ];

    for (pattern, base_dir) in problematic_patterns {
        if let Some(base) = base_dir {
            let full_path = base.join(pattern);
            if full_path.exists() {
                match if full_path.is_dir() {
                    std::fs::remove_dir_all(&full_path)
                } else {
                    std::fs::remove_file(&full_path)
                } {
                    Ok(_) => {
                        cleaned.push(full_path.display().to_string());
                    }
                    Err(e) => {
                        warn!("Failed to clean up {}: {}", full_path.display(), e);
                    }
                }
            }
        }
    }

    // Check for old DLLs in exe directory that shouldn't exist
    if let Some(exe_path) = exe_dir {
        let old_dlls = ["old_webview.dll", "deprecated_helper.dll"];
        for dll in old_dlls {
            let dll_path = exe_path.join(dll);
            if dll_path.exists() {
                if let Err(e) = std::fs::remove_file(&dll_path) {
                    warn!("Failed to remove old DLL {}: {}", dll, e);
                } else {
                    cleaned.push(dll_path.display().to_string());
                }
            }
        }
    }

    if !cleaned.is_empty() {
        info!("Cleaned up {} old installation artifacts: {:?}", cleaned.len(), cleaned);
    } else {
        debug!("No old installation artifacts to clean up");
    }
}

/// Counter for unique popup window labels
static POPUP_COUNTER: AtomicU32 = AtomicU32::new(0);

/// Performance overlay script injected into the game page
const OVERLAY_SCRIPT: &str = r#"
(function() {
    // Wait for body to exist
    function init() {
        if (!document.body) {
            setTimeout(init, 50);
            return;
        }

        // === SCROLLBAR BUG FIX ===
        // Upstream bug: body/root use width:100vw which includes scrollbar width,
        // causing horizontal overflow and an unnecessary vertical scrollbar
        // Fix: hide overflow on html and body, use 100% instead of 100vw
        const scrollbarFix = document.createElement('style');
        scrollbarFix.textContent = `
            html, body {
                overflow: hidden !important;
                overflow-x: hidden !important;
                overflow-y: auto !important;
                width: 100% !important;
                max-width: 100% !important;
            }
            body > div, #root {
                max-width: 100% !important;
                overflow-x: hidden !important;
            }
            /* Hide scrollbar on booster popup */
            #boosters-page {
                scrollbar-width: none !important;
            }
            #boosters-page::-webkit-scrollbar {
                display: none !important;
            }
            dialog:has(#boosters-page) {
                scrollbar-width: none !important;
            }
            dialog:has(#boosters-page)::-webkit-scrollbar {
                display: none !important;
            }
            .modal-body:has(#boosters-page) {
                scrollbar-width: none !important;
            }
            .modal-body:has(#boosters-page)::-webkit-scrollbar {
                display: none !important;
            }
        `;
        document.head.appendChild(scrollbarFix);
        console.log('[PACDeluxe] Scrollbar fix applied');

        // === CONTEXT MENU FIX ===
        // Disable default WebView2 context menu to prevent interference with game UI
        // (Tier list maker and other features use mouse events that conflict with context menu)
        document.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            return false;
        });
        console.log('[PACDeluxe] Context menu disabled');

        // === ASSET CACHE WITH VERSION CHECK ===
        // Intercepts fetch() for static assets (images, JSON, audio)
        // Clears cache when game version changes
        (function() {
            const CACHE_VERSION_KEY = '__pac_cache_version__';
            const CACHE_ASSETS_KEY = '__pac_discovered_assets__';
            const currentVersion = window.__PAC_BUILD_VERSION__ || 'unknown';
            const storedVersion = localStorage.getItem(CACHE_VERSION_KEY);

            // Version mismatch - clear stale data
            if (storedVersion && storedVersion !== currentVersion) {
                console.log('[PACDeluxe] Version changed (' + storedVersion + ' -> ' + currentVersion + '), clearing cache');
                localStorage.removeItem(CACHE_ASSETS_KEY);
            }
            localStorage.setItem(CACHE_VERSION_KEY, currentVersion);

            // Patterns for cacheable assets
            const cacheablePatterns = [
                /\.(png|jpg|jpeg|gif|webp|svg)$/i,
                /\.(json)$/i,
                /\.(mp3|ogg|wav|m4a)$/i,
                /\.(woff|woff2|ttf|otf)$/i,
                /\/assets\//i,
            ];
            const neverCachePatterns = [
                /\/api\//i, /firestore/i, /firebase/i, /colyseus/i, /socket/i, /\?/
            ];

            function shouldCache(url) {
                for (const p of neverCachePatterns) if (p.test(url)) return false;
                for (const p of cacheablePatterns) if (p.test(url)) return true;
                return false;
            }

            // In-memory cache (256MB limit)
            const cache = new Map();
            let cacheSize = 0;
            const maxSize = 256 * 1024 * 1024;

            const originalFetch = window.fetch.bind(window);
            window.fetch = async (input, init) => {
                const url = typeof input === 'string' ? input : input.url;
                const method = init?.method?.toUpperCase() || 'GET';

                if (method !== 'GET' || !shouldCache(url)) {
                    return originalFetch(input, init);
                }

                // Check cache
                if (cache.has(url)) {
                    return cache.get(url).clone();
                }

                // Fetch and cache
                const response = await originalFetch(input, init);
                if (response.ok) {
                    const size = parseInt(response.headers.get('content-length') || '50000', 10);
                    if (cacheSize + size <= maxSize) {
                        cache.set(url, response.clone());
                        cacheSize += size;
                    }
                }
                return response;
            };

            // Record discovered assets after game loads (for future prewarm)
            setTimeout(() => {
                const urls = Array.from(cache.keys()).slice(0, 500);
                if (urls.length > 0) {
                    localStorage.setItem(CACHE_ASSETS_KEY, JSON.stringify(urls));
                    console.log('[PACDeluxe] Recorded ' + urls.length + ' assets for prewarm');
                }
            }, 30000);

            // Auto-prewarm from previous session
            const savedAssets = localStorage.getItem(CACHE_ASSETS_KEY);
            if (savedAssets && storedVersion === currentVersion) {
                try {
                    const urls = JSON.parse(savedAssets);
                    console.log('[PACDeluxe] Prewarming ' + urls.length + ' cached assets');
                    let i = 0;
                    function prewarmNext() {
                        if (i >= urls.length || i >= 50) return; // Limit to 50
                        const url = urls[i++];
                        if (!cache.has(url)) {
                            fetch(url).catch(() => {});
                        }
                        setTimeout(prewarmNext, 100); // Rate limit
                    }
                    setTimeout(prewarmNext, 2000); // Start after 2s
                } catch(e) {}
            }

            console.log('[PACDeluxe] Asset cache initialized (v' + currentVersion + ')');
        })();

        // === TOOLTIP & HOVER PERFORMANCE OPTIMIZATIONS ===
        // Game uses react-tooltip which can lag on hover due to positioning recalculations
        // These CSS optimizations force GPU acceleration and reduce layout thrashing
        const perfStyles = document.createElement('style');
        perfStyles.id = 'pac-perf-styles';
        perfStyles.textContent = `
            /* GPU-accelerate react-tooltip for smoother show/hide */
            .react-tooltip {
                transform: translateZ(0) !important;
                will-change: opacity, transform !important;
                contain: layout style paint !important;
                backface-visibility: hidden !important;
            }

            /* Optimize any element with tooltip data attribute */
            [data-tooltip-id] {
                will-change: auto;
            }
            [data-tooltip-id]:hover {
                will-change: contents;
            }

            /* GPU-accelerate game detail popups and menus */
            /* Note: Removed .my-box and .nes-container - was causing Additional picks popup sizing issues */
            .game-pokemon-detail,
            .game-player-detail {
                transform: translateZ(0);
                backface-visibility: hidden;
            }

            /* Optimize synergy and item displays that show on hover */
            .synergy-detail,
            .item-detail,
            .pokemon-detail {
                will-change: opacity, visibility;
            }

            /* Optimize filters that run on hover (grayscale, contrast, etc) */
            [class*="-portrait-hint"],
            [class*="-locked"] {
                transform: translateZ(0);
                backface-visibility: hidden;
            }

            /* Fix Additional Picks popup - shift up so bottom row is fully visible */
            /* (This is an upstream bug we're fixing for PACDeluxe users) */
            #game-additional-pokemons {
                transform: translateY(-25px) !important;
            }
        `;

        document.head.appendChild(perfStyles);
        console.log('[PACDeluxe] Tooltip performance optimizations applied');

        // Remove any existing overlay (from HTML template or previous injection)
        const existingOverlay = document.getElementById('pac-perf');
        if (existingOverlay) existingOverlay.remove();

        // Prevent duplicate injection - if our overlay already exists, bail out
        if (document.getElementById('pac-perf-rust')) {
            console.log('[PACDeluxe] Overlay already exists, skipping duplicate injection');
            return;
        }

        // Create overlay element
        const overlay = document.createElement('div');
        overlay.id = 'pac-perf-rust';
        overlay.innerHTML = `
            <div style="color:#0f8;font-weight:bold;margin-bottom:6px;border-bottom:1px solid #0f03;padding-bottom:4px;">⚡ PACDeluxe</div>
            <div>FPS: <span class="fps-val">--</span></div>
            <div>CPU: <span class="cpu-val">--</span>%</div>
            <div>GPU: <span class="gpu-val">--</span>%</div>
            <div>MEM: <span class="mem-val">--</span> GB</div>
            <div>HZ: <span class="hz-val">--</span></div>
            <div>RTT: <span class="rtt-val">--</span> ms</div>
            <div>HDR: <span class="hdr-val">--</span></div>
        `;
        overlay.style.cssText = 'display:none;position:fixed;top:8px;right:8px;background:rgba(0,0,0,0.9);color:#0f0;font:12px/1.4 monospace;padding:10px 14px;border-radius:6px;z-index:99999;border:1px solid #0f04;min-width:140px;box-shadow:0 2px 10px rgba(0,0,0,0.5);cursor:move;user-select:none;';
        document.body.appendChild(overlay);

        // === OVERLAY DRAGGABLE/DOCKABLE ===
        let isDragging = false;
        let dragStartX = 0, dragStartY = 0, overlayStartX = 0, overlayStartY = 0;

        overlay.addEventListener('mousedown', (e) => {
            isDragging = true;
            dragStartX = e.clientX;
            dragStartY = e.clientY;
            const rect = overlay.getBoundingClientRect();
            overlayStartX = rect.left;
            overlayStartY = rect.top;
            overlay.style.right = 'auto';
            overlay.style.bottom = 'auto';
            overlay.style.left = rect.left + 'px';
            overlay.style.top = rect.top + 'px';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const dx = e.clientX - dragStartX;
            const dy = e.clientY - dragStartY;
            overlay.style.left = (overlayStartX + dx) + 'px';
            overlay.style.top = (overlayStartY + dy) + 'px';
        });

        document.addEventListener('mouseup', () => {
            if (!isDragging) return;
            isDragging = false;

            // Keep position where user dropped it
            const rect = overlay.getBoundingClientRect();

            // Persist position as x,y coordinates
            localStorage.setItem('pac_overlay_pos', JSON.stringify({
                x: rect.left,
                y: rect.top
            }));
        });

        // Restore saved position on load
        const savedPos = localStorage.getItem('pac_overlay_pos');
        if (savedPos) {
            try {
                const pos = JSON.parse(savedPos);
                overlay.style.right = 'auto';
                overlay.style.bottom = 'auto';
                overlay.style.left = pos.x + 'px';
                overlay.style.top = pos.y + 'px';
            } catch(e) {}
        }

        // Store element references (not IDs)
        const fpsEl = overlay.querySelector('.fps-val');
        const cpuEl = overlay.querySelector('.cpu-val');
        const gpuEl = overlay.querySelector('.gpu-val');
        const memEl = overlay.querySelector('.mem-val');
        const hzEl = overlay.querySelector('.hz-val');
        const rttEl = overlay.querySelector('.rtt-val');
        const hdrEl = overlay.querySelector('.hdr-val');

        // === SETTINGS PERSISTENCE ===
        let visible = localStorage.getItem('pac_overlay_visible') === 'true';
        overlay.style.display = visible ? 'block' : 'none';

        // === COMBINED FPS & REFRESH RATE MEASUREMENT ===
        // Single rAF loop for both metrics to reduce overhead
        let frameCount = 0;
        let lastFpsTime = performance.now();
        let lastFrameTime = performance.now();
        let fps = 0;
        let refreshRate = 0;
        const frameTimes = [];

        function measureFrame() {
            const now = performance.now();

            // FPS: count frames per second
            frameCount++;
            if (now - lastFpsTime >= 1000) {
                fps = Math.round(frameCount * 1000 / (now - lastFpsTime));
                frameCount = 0;
                lastFpsTime = now;
            }

            // HZ: measure frame deltas for refresh rate
            const delta = now - lastFrameTime;
            lastFrameTime = now;

            if (delta > 0 && delta < 100) { // Sanity check
                frameTimes.push(delta);
                if (frameTimes.length > 60) frameTimes.shift();

                if (frameTimes.length >= 30) {
                    const avgDelta = frameTimes.reduce((a,b) => a+b, 0) / frameTimes.length;
                    refreshRate = Math.round(1000 / avgDelta);
                }
            }

            requestAnimationFrame(measureFrame);
        }
        requestAnimationFrame(measureFrame);

        // === NETWORK METRICS ===
        let networkRtt = 0;
        const rttSamples = [];

        if (typeof PerformanceObserver !== 'undefined') {
            const netObserver = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    // Filter for game traffic
                    if (entry.name.includes('colyseus') ||
                        entry.name.includes('pokemon-auto-chess') ||
                        entry.name.includes('socket')) {

                        const rtt = entry.responseEnd - entry.requestStart;
                        if (rtt > 0 && rtt < 5000) {
                            rttSamples.push(rtt);
                            if (rttSamples.length > 20) rttSamples.shift();
                            networkRtt = Math.round(
                                rttSamples.reduce((a,b) => a+b, 0) / rttSamples.length
                            );
                        }
                    }
                }
            });

            try {
                netObserver.observe({ entryTypes: ['resource'] });
            } catch(e) {
                console.log('[PACDeluxe] Network observer not available');
            }
        }

        if (visible) setTimeout(() => { /* trigger initial update */ }, 100);

        // Update overlay using stored element references
        async function updateOverlay() {
            if (!visible) return;
            if (fpsEl) fpsEl.textContent = fps;
            if (hzEl) hzEl.textContent = refreshRate;
            if (rttEl) rttEl.textContent = networkRtt || '--';

            // Tauri v2: invoke is at window.__TAURI__.core.invoke
            const invoke = window.__TAURI__?.core?.invoke;
            if (invoke) {
                try {
                    // Fetch CPU/Memory stats
                    const stats = await invoke('get_performance_stats');
                    if (stats) {
                        if (cpuEl) cpuEl.textContent = typeof stats.cpu_usage === 'number' ? stats.cpu_usage.toFixed(1) : '--';
                        if (memEl) memEl.textContent = typeof stats.memory_usage_mb === 'number' ? (stats.memory_usage_mb / 1024).toFixed(2) : '--';
                    }
                    // Fetch GPU stats
                    const gpuStats = await invoke('get_gpu_stats');
                    if (gpuStats && gpuEl) {
                        if (gpuStats.available) {
                            gpuEl.textContent = gpuStats.usage_percent.toFixed(1);
                        } else {
                            gpuEl.textContent = 'N/A';
                        }
                    }
                    // Fetch HDR status (only once, doesn't change often)
                    if (hdrEl && hdrEl.textContent === '--') {
                        const hdrInfo = await invoke('get_hdr_status');
                        if (hdrInfo) {
                            if (hdrInfo.enabled) {
                                hdrEl.textContent = hdrInfo.color_space;
                                hdrEl.style.color = '#ff0';
                            } else if (hdrInfo.supported) {
                                hdrEl.textContent = 'Available';
                                hdrEl.style.color = '#0ff';
                            } else {
                                hdrEl.textContent = 'Off';
                                hdrEl.style.color = '#888';
                            }
                        }
                    }
                } catch(e) {
                    console.error('[PACDeluxe] Stats error:', e);
                }
            } else {
                console.warn('[PACDeluxe] Tauri invoke not found');
            }
        }
        setInterval(updateOverlay, 500);

        // Toggle overlay with Ctrl+Shift+P
        // Toggle fullscreen with F11
        // Toggle borderless windowed with Shift+F11
        document.addEventListener('keydown', async e => {
            if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'p') {
                e.preventDefault();
                visible = !visible;
                overlay.style.display = visible ? 'block' : 'none';
                localStorage.setItem('pac_overlay_visible', visible);
                if (visible) updateOverlay();
            }
            // Shift+F11 for borderless windowed
            if (e.shiftKey && e.key === 'F11') {
                e.preventDefault();
                if (window.__TAURI__) {
                    try {
                        const currentMode = await window.__TAURI__.core.invoke('get_window_mode');
                        const newMode = currentMode === 'BorderlessWindowed' ? 'Windowed' : 'BorderlessWindowed';
                        await window.__TAURI__.core.invoke('set_window_mode', { mode: newMode });
                        console.log('[PACDeluxe] Window mode:', newMode);
                    } catch(e) { console.error('[PACDeluxe] Borderless error:', e); }
                }
            }
            // F11 for exclusive fullscreen (only if Shift not pressed)
            else if (e.key === 'F11' && !e.shiftKey) {
                e.preventDefault();
                if (window.__TAURI__) {
                    try {
                        await window.__TAURI__.core.invoke('toggle_fullscreen');
                    } catch(e) { console.error('[PACDeluxe] Fullscreen error:', e); }
                }
            }
        });

        // === BOOSTER BUG FIX ===
        // Upstream bug: opening boosters and navigating away can corrupt session state
        // Detection: user appears logged out (login UI shown) but Firebase auth is valid
        // Fix: detect broken state and auto-recover by refreshing the page
        (function boosterFix() {
            let wasAuthenticated = false;
            let checkCount = 0;

            const stateChecker = setInterval(() => {
                checkCount++;

                // Check for Firebase auth state
                const hasFirebaseAuth = typeof firebase !== 'undefined' &&
                    firebase.auth && firebase.auth().currentUser;

                // Check if login UI is shown (user appears logged out)
                const loginUI = document.querySelector('.firebaseui-container') ||
                    document.querySelector('[class*="firebase"]') ||
                    document.getElementById('play-panel')?.querySelector('button[class*="firebase"]');

                // Check if we're on the home/login route
                const onLoginPage = window.location.pathname === '/' ||
                    window.location.pathname === '';

                // Track if user was authenticated before
                if (hasFirebaseAuth && !onLoginPage) {
                    wasAuthenticated = true;
                }

                // Detect broken state: was authenticated, now on login page with Firebase still valid
                if (wasAuthenticated && onLoginPage && hasFirebaseAuth && loginUI) {
                    console.warn('[PACDeluxe] Detected broken session state, recovering...');
                    // Clear the flag and refresh to recover
                    wasAuthenticated = false;
                    // Small delay to avoid rapid refresh loops
                    setTimeout(() => {
                        window.location.reload();
                    }, 500);
                }

                // Also monitor for sudden appearance of login UI when authenticated
                if (hasFirebaseAuth && loginUI && checkCount > 5) {
                    const joinLobbyBtn = document.querySelector('button.bubbly.green');
                    if (!joinLobbyBtn) {
                        // Login buttons visible but no Join Lobby - broken state
                        console.warn('[PACDeluxe] Session desync detected, refreshing...');
                        setTimeout(() => window.location.reload(), 500);
                    }
                }

                // Stop checking after 5 minutes to save resources
                if (checkCount > 300) {
                    clearInterval(stateChecker);
                }
            }, 1000);

            console.log('[PACDeluxe] Session recovery monitor active');
        })();

        // === DYNAMIC BOOSTER BUTTON TEXT ===
        // Changes the "Open Booster" button text to "Flip All" when cards are unflipped
        // This provides clearer UX by showing what the button will actually do
        (function dynamicBoosterButton() {
            let lastCheck = 0;

            function updateButtonText() {
                const boostersPage = document.getElementById('boosters-page');
                if (!boostersPage) return;

                const openBoosterBtn = boostersPage.querySelector('button.bubbly');
                if (!openBoosterBtn) return;

                // Check for unflipped cards (cards without the 'flipped' class)
                const boosterCards = boostersPage.querySelectorAll('.booster-card');
                const unflippedCards = boostersPage.querySelectorAll('.booster-card:not(.flipped)');

                // If there are cards and some are unflipped, show "Flip All"
                if (boosterCards.length > 0 && unflippedCards.length > 0) {
                    if (!openBoosterBtn.textContent.includes('Flip')) {
                        openBoosterBtn.textContent = 'Flip All';
                        openBoosterBtn.classList.add('blue');
                        openBoosterBtn.disabled = false;
                    }
                } else {
                    // Reset to original text when no unflipped cards
                    if (openBoosterBtn.textContent.includes('Flip')) {
                        openBoosterBtn.textContent = 'Open a Booster';
                    }
                }
            }

            // Check periodically
            setInterval(() => {
                const now = Date.now();
                if (now - lastCheck < 200) return;
                lastCheck = now;
                updateButtonText();
            }, 200);

            // Also observe DOM changes for immediate response
            new MutationObserver(updateButtonText).observe(document.body, {
                subtree: true,
                attributes: true,
                attributeFilter: ['class']
            });

            console.log('[PACDeluxe] Dynamic booster button text ready');
        })();

        // === AUTO-UPDATER ===
        // Check for updates on startup and show non-intrusive notification
        // Uses custom Rust commands to avoid CSP issues with plugin IPC
        (async function checkForUpdates() {
            // Wait for Tauri to be fully initialized
            await new Promise(resolve => setTimeout(resolve, 5000));

            const invoke = window.__TAURI__?.core?.invoke;
            if (!invoke) {
                console.log('[PACDeluxe] Tauri not available, skipping update check');
                return;
            }

            try {
                // Check for updates using our custom Rust command
                const update = await invoke('check_for_updates');
                console.log('[PACDeluxe] Update check result:', update);

                if (update && update.available) {
                    console.log('[PACDeluxe] Update available:', update.version);

                    // Create update notification banner
                    const banner = document.createElement('div');
                    banner.id = 'pac-update-banner';
                    banner.innerHTML = '<span>PACDeluxe v' + update.version + ' available!</span>' +
                        '<button id="pac-update-btn">Update Now</button>' +
                        '<button id="pac-update-dismiss">x</button>';
                    banner.style.cssText = 'position:fixed;top:0;left:50%;transform:translateX(-50%);background:linear-gradient(90deg,#1a5a1a,#2a7a2a);color:#fff;padding:8px 16px;border-radius:0 0 8px 8px;z-index:99998;font:13px/1.4 sans-serif;display:flex;align-items:center;gap:12px;box-shadow:0 2px 10px rgba(0,0,0,0.3);';
                    document.body.appendChild(banner);

                    // Update button handler
                    document.getElementById('pac-update-btn').onclick = async () => {
                        banner.innerHTML = '<span>Downloading update...</span>';
                        try {
                            // Download and install using our custom Rust command
                            await invoke('install_update');
                            banner.innerHTML = '<span>Update installed! Restarting...</span>';
                            // Restart the app
                            setTimeout(async () => {
                                await invoke('restart_app');
                            }, 1500);
                        } catch (e) {
                            console.error('[PACDeluxe] Update failed:', e);
                            banner.innerHTML = '<span>Update failed: ' + (e.message || e) + '</span>';
                            setTimeout(() => banner.remove(), 5000);
                        }
                    };

                    // Dismiss button
                    document.getElementById('pac-update-dismiss').onclick = () => banner.remove();

                    // Style the buttons
                    const btnStyle = 'background:#fff;color:#1a5a1a;border:none;padding:4px 12px;border-radius:4px;cursor:pointer;font-weight:bold;';
                    document.getElementById('pac-update-btn').style.cssText = btnStyle;
                    document.getElementById('pac-update-dismiss').style.cssText = 'background:transparent;color:#fff;border:none;padding:4px;cursor:pointer;font-size:16px;';
                } else {
                    console.log('[PACDeluxe] App is up to date');
                }
            } catch (e) {
                // Log the error for debugging
                console.log('[PACDeluxe] Update check failed:', e.message || e);
            }
        })();

        console.log('[PACDeluxe] Ready - Ctrl+Shift+P: overlay, F11: fullscreen, Shift+F11: borderless');
    }
    init();
})();
"#;

fn main() {
    // Initialize logging
    let subscriber = FmtSubscriber::builder()
        .with_max_level(if cfg!(debug_assertions) { Level::DEBUG } else { Level::INFO })
        .finish();
    tracing::subscriber::set_global_default(subscriber).ok();

    info!("Starting PACDeluxe");

    // Clean up any problematic files from old installations
    cleanup_old_installation();

    // Apply system optimizations
    performance::apply_system_optimizations();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let app_handle = app.handle().clone();

            // Create window programmatically with on_page_load handler
            let window = WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::External("https://pokemon-auto-chess.com".parse().unwrap())
            )
            .title("PACDeluxe")
            .inner_size(1280.0, 900.0)
            .min_inner_size(1024.0, 768.0)
            .resizable(true)
            .center()
            .focused(true)
            .visible(true)
            // Required for HTML5 drag & drop to work in WebView2 on Windows
            // (Tauri's default handler intercepts drag events, blocking tier list maker etc.)
            .disable_drag_drop_handler()
            .on_page_load(|webview, _payload| {
                if let Err(e) = webview.eval(OVERLAY_SCRIPT) {
                    tracing::warn!("Failed to inject overlay script: {}", e);
                } else {
                    tracing::debug!("Overlay script injected successfully");
                }
            })
            // Handle OAuth popup windows (Google/Firebase auth)
            .on_new_window(move |url, features| {
                let popup_id = POPUP_COUNTER.fetch_add(1, Ordering::SeqCst);
                let label = format!("auth-popup-{}", popup_id);
                debug!("Opening popup window: {} -> {}", label, url);

                // Shared state for popup lifecycle management
                let auth_completed = Arc::new(AtomicBool::new(false));
                let popup_closed = Arc::new(AtomicBool::new(false));
                let popup_start = Instant::now();

                // Clone handles for various closures
                let app_for_nav = app_handle.clone();
                let label_for_nav = label.clone();
                let auth_completed_nav = auth_completed.clone();
                let popup_closed_nav = popup_closed.clone();

                let app_for_timeout = app_handle.clone();
                let label_for_timeout = label.clone();
                let auth_completed_timeout = auth_completed.clone();
                let popup_closed_timeout = popup_closed.clone();

                let popup = WebviewWindowBuilder::new(
                    &app_handle,
                    &label,
                    WebviewUrl::External(url.clone()),
                )
                .title(url.host_str().unwrap_or("Authentication"))
                .window_features(features)
                .inner_size(500.0, 600.0)
                .center()
                .focused(true)
                .always_on_top(true)
                // Detect auth completion via navigation events (fires before page load)
                .on_navigation(move |nav_url| {
                    let url_str = nav_url.to_string();
                    debug!("Auth popup navigating to: {}", url_str);

                    // Firebase auth callback patterns:
                    // - /__/auth/handler?code=... (OAuth success)
                    // - /__/auth/handler?error=... (OAuth error/cancel)
                    let is_auth_callback = url_str.contains("/__/auth/handler");
                    let has_code = url_str.contains("code=");
                    let has_error = url_str.contains("error=");

                    if is_auth_callback && (has_code || has_error) {
                        if has_code {
                            debug!("Auth success detected, scheduling popup close");
                        } else {
                            debug!("Auth cancelled/error detected, scheduling popup close");
                        }

                        // Mark auth as completed
                        auth_completed_nav.store(true, Ordering::SeqCst);

                        // Close popup after a brief delay to allow redirect to complete
                        if !popup_closed_nav.swap(true, Ordering::SeqCst) {
                            let app = app_for_nav.clone();
                            let label = label_for_nav.clone();
                            std::thread::spawn(move || {
                                // Short delay to let the auth flow complete
                                std::thread::sleep(Duration::from_millis(300));
                                if let Some(win) = app.get_webview_window(&label) {
                                    match win.close() {
                                        Ok(_) => debug!("Auth popup {} closed successfully", label),
                                        Err(e) => warn!("Failed to close auth popup {}: {}", label, e),
                                    }
                                }
                            });
                        }
                    }

                    true // Allow all navigation
                })
                .on_page_load(move |_webview, payload| {
                    debug!("Auth popup page loaded: {}", payload.url());
                })
                .build();

                match popup {
                    Ok(window) => {
                        // Start timeout watchdog thread to prevent orphaned popups
                        std::thread::spawn(move || {
                            const POPUP_TIMEOUT: Duration = Duration::from_secs(300); // 5 minutes
                            const CHECK_INTERVAL: Duration = Duration::from_secs(10);

                            loop {
                                std::thread::sleep(CHECK_INTERVAL);

                                // Exit if popup already closed or auth completed
                                if popup_closed_timeout.load(Ordering::SeqCst) {
                                    debug!("Popup timeout watchdog: popup already closed");
                                    break;
                                }

                                if auth_completed_timeout.load(Ordering::SeqCst) {
                                    debug!("Popup timeout watchdog: auth completed normally");
                                    break;
                                }

                                // Check if timeout exceeded
                                if popup_start.elapsed() >= POPUP_TIMEOUT {
                                    warn!("Auth popup {} timed out after {:?}, force closing",
                                          label_for_timeout, popup_start.elapsed());

                                    if !popup_closed_timeout.swap(true, Ordering::SeqCst) {
                                        if let Some(win) = app_for_timeout.get_webview_window(&label_for_timeout) {
                                            match win.close() {
                                                Ok(_) => info!("Orphaned auth popup closed"),
                                                Err(e) => warn!("Failed to close orphaned popup: {}", e),
                                            }
                                        }
                                    }
                                    break;
                                }
                            }
                        });

                        NewWindowResponse::Create { window }
                    },
                    Err(e) => {
                        warn!("Failed to create auth popup: {}", e);
                        NewWindowResponse::Deny
                    }
                }
            })
            .build()
            .expect("Failed to create main window");

            // Apply window optimizations
            performance::optimize_window(&window);

            // Start performance monitor
            let monitor = performance::PerformanceMonitor::new();
            app.manage(monitor);

            // Initialize pending update state for updater
            app.manage(commands::PendingUpdate(std::sync::Mutex::new(None)));

            info!("Application ready");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_performance_stats,
            commands::get_system_info,
            commands::toggle_fullscreen,
            commands::get_webview_telemetry,
            commands::get_gpu_stats,
            commands::get_hdr_status,
            commands::set_window_mode,
            commands::get_window_mode,
            commands::check_for_updates,
            commands::install_update,
            commands::restart_app,
        ])
        .run(tauri::generate_context!())
        .expect("Failed to run application");
}
