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

        // === SCROLLBAR FIX ===
        // Fix 100vw overflow causing unwanted scrollbar on pack/booster screen
        // Only hide horizontal overflow to preserve vertical scrolling (needed for tier list maker)
        const scrollbarFix = document.createElement('style');
        scrollbarFix.textContent = 'html { overflow-x: hidden !important; }';
        document.head.appendChild(scrollbarFix);
        console.log('[PACDeluxe] Scrollbar fix applied (horizontal only)');

        // === CONTEXT MENU FIX ===
        // Disable default WebView2 context menu to prevent interference with game UI
        // (Tier list maker and other features use mouse events that conflict with context menu)
        document.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            return false;
        });
        console.log('[PACDeluxe] Context menu disabled');

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
            /* Note: game-items-proposition and game-pokemons-proposition excluded -
               transform creates stacking context that breaks absolute positioning of choice menus */
            .game-pokemon-detail,
            .game-player-detail,
            .my-box,
            .nes-container {
                transform: translateZ(0);
                backface-visibility: hidden;
            }

            /* Optimize synergy and item displays that show on hover */
            .synergy-detail,
            .item-detail,
            .pokemon-detail {
                contain: layout style paint;
                will-change: opacity, visibility;
            }


            /* Optimize filters that run on hover (grayscale, contrast, etc) */
            [class*="-portrait-hint"],
            [class*="-locked"] {
                transform: translateZ(0);
                backface-visibility: hidden;
            }
        `;
        document.head.appendChild(perfStyles);
        console.log('[PACDeluxe] Tooltip performance optimizations applied');

        // Remove any existing overlay (from HTML template)
        const existingOverlay = document.getElementById('pac-perf');
        if (existingOverlay) existingOverlay.remove();

        // Create overlay element
        const overlay = document.createElement('div');
        overlay.id = 'pac-perf-rust';
        overlay.innerHTML = `
            <div style="color:#0f8;font-weight:bold;margin-bottom:6px;border-bottom:1px solid #0f03;padding-bottom:4px;">⚡ PACDeluxe</div>
            <div>FPS: <span class="fps-val">--</span></div>
            <div>CPU: <span class="cpu-val">--</span>%</div>
            <div>GPU: <span class="gpu-val">--</span>%</div>
            <div>MEM: <span class="mem-val">--</span> GB</div>
            <div>HDR: <span class="hdr-val">--</span></div>
        `;
        overlay.style.cssText = 'display:none;position:fixed;top:8px;right:8px;background:rgba(0,0,0,0.9);color:#0f0;font:12px/1.4 monospace;padding:10px 14px;border-radius:6px;z-index:99999;border:1px solid #0f04;min-width:140px;box-shadow:0 2px 10px rgba(0,0,0,0.5);';
        document.body.appendChild(overlay);

        // Store element references (not IDs)
        const fpsEl = overlay.querySelector('.fps-val');
        const cpuEl = overlay.querySelector('.cpu-val');
        const gpuEl = overlay.querySelector('.gpu-val');
        const memEl = overlay.querySelector('.mem-val');
        const hdrEl = overlay.querySelector('.hdr-val');

        let visible = false;
        let frameCount = 0;
        let lastTime = performance.now();
        let fps = 0;

        // FPS counter
        function countFrame() {
            frameCount++;
            const now = performance.now();
            if (now - lastTime >= 1000) {
                fps = Math.round(frameCount * 1000 / (now - lastTime));
                frameCount = 0;
                lastTime = now;
            }
            requestAnimationFrame(countFrame);
        }
        countFrame();

        // Update overlay using stored element references
        async function updateOverlay() {
            if (!visible) return;
            if (fpsEl) fpsEl.textContent = fps;

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
        document.addEventListener('keydown', async e => {
            if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'p') {
                e.preventDefault();
                visible = !visible;
                overlay.style.display = visible ? 'block' : 'none';
                if (visible) updateOverlay();
            }
            // F11 for exclusive fullscreen
            if (e.key === 'F11') {
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

        console.log('[PACDeluxe] Ready - Ctrl+Shift+P: overlay, F11: fullscreen');
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

    // Apply system optimizations
    performance::apply_system_optimizations();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
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
        ])
        .run(tauri::generate_context!())
        .expect("Failed to run application");
}
