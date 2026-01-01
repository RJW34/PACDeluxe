// Windows subsystem - no console in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod performance;
mod commands;

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri::webview::NewWindowResponse;
use tracing::{info, debug, Level};
use tracing_subscriber::FmtSubscriber;
use std::sync::atomic::{AtomicU32, Ordering};

/// Counter for unique popup window labels
static POPUP_COUNTER: AtomicU32 = AtomicU32::new(0);

/// Performance overlay script injected into the game page
const OVERLAY_SCRIPT: &str = r#"
(function() {
    'use strict';

    // ============================================
    // CHUNGUS MODE: Canvas Context Optimization
    // ============================================
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, options) {
        options = options || {};

        if (type === '2d') {
            // Disable alpha channel - major performance gain
            if (options.alpha === undefined) options.alpha = false;
            // Enable low-latency mode (desynchronized rendering)
            options.desynchronized = true;
            // We won't read pixels back frequently
            options.willReadFrequently = false;
        }

        if (type === 'webgl' || type === 'webgl2') {
            // Disable antialiasing for performance
            if (options.antialias === undefined) options.antialias = false;
            // Request high-performance GPU
            options.powerPreference = 'high-performance';
            // Enable low-latency mode
            options.desynchronized = true;
            // Don't preserve drawing buffer (allows optimizations)
            options.preserveDrawingBuffer = false;
            // Disable premultiplied alpha for speed
            options.premultipliedAlpha = false;
            // Request stencil buffer only if needed
            if (options.stencil === undefined) options.stencil = false;
        }

        console.log('[Chungus] Canvas context optimized:', type, options);
        return originalGetContext.call(this, type, options);
    };

    // ============================================
    // CHUNGUS MODE: Audio Context Low-Latency
    // ============================================
    const OriginalAudioContext = window.AudioContext || window.webkitAudioContext;
    if (OriginalAudioContext) {
        window.AudioContext = function(options) {
            options = options || {};
            options.latencyHint = 'interactive';
            options.sampleRate = 44100;
            console.log('[Chungus] AudioContext optimized:', options);
            return new OriginalAudioContext(options);
        };
        window.AudioContext.prototype = OriginalAudioContext.prototype;
    }

    // Wait for body to exist
    function init() {
        if (!document.body) {
            setTimeout(init, 50);
            return;
        }

        // === SCROLLBAR BUG FIX ===
        // Upstream bug: body/root use width:100vw which includes scrollbar width,
        // causing horizontal overflow and an unnecessary vertical scrollbar
        // Fix: hide overflow on html element
        const scrollbarFix = document.createElement('style');
        scrollbarFix.textContent = 'html { overflow: hidden !important; }';
        document.head.appendChild(scrollbarFix);
        console.log('[PACDeluxe] Scrollbar fix applied');

        // === FONT REPLACEMENT ===
        // Replace Jost font with Orbitron for a more distinctive look
        const fontLink = document.createElement('link');
        fontLink.href = 'https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500;600;700;800;900&display=swap';
        fontLink.rel = 'stylesheet';
        document.head.appendChild(fontLink);

        const fontOverride = document.createElement('style');
        fontOverride.textContent = `
            html, body, button, input, select, textarea {
                font-family: 'Orbitron', sans-serif !important;
            }
        `;
        document.head.appendChild(fontOverride);
        console.log('[PACDeluxe] Orbitron font applied');

        // === CUSTOM BACKGROUND ===
        // Replace homepage background with custom Grovyle image
        if (window.__TAURI__) {
            window.__TAURI__.core.invoke('get_background_image').then(bgDataUrl => {
                const bgStyle = document.createElement('style');
                bgStyle.textContent = `
                    .custom-bg {
                        background-image: url("${bgDataUrl}") !important;
                    }
                `;
                document.head.appendChild(bgStyle);
                console.log('[PACDeluxe] Custom background applied');
            }).catch(e => {
                console.log('[PACDeluxe] Custom background not available:', e);
            });
        }

        // Create overlay element
        const overlay = document.createElement('div');
        overlay.id = 'pac-perf';
        overlay.innerHTML = `
            <div style="color:#0f8;font-weight:bold;margin-bottom:6px;border-bottom:1px solid #0f03;padding-bottom:4px;">⚡ PACDeluxe</div>
            <div>FPS: <span id="pac-fps">--</span></div>
            <div>CPU: <span id="pac-cpu">--</span>%</div>
            <div>MEM: <span id="pac-mem">--</span> MB</div>
        `;
        overlay.style.cssText = 'display:none;position:fixed;top:8px;right:8px;background:rgba(0,0,0,0.9);color:#0f0;font:12px/1.4 monospace;padding:10px 14px;border-radius:6px;z-index:99999;border:1px solid #0f04;min-width:140px;box-shadow:0 2px 10px rgba(0,0,0,0.5);';
        document.body.appendChild(overlay);

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

        // Update overlay
        async function updateOverlay() {
            if (!visible) return;
            document.getElementById('pac-fps').textContent = fps;
            if (window.__TAURI__) {
                try {
                    const stats = await window.__TAURI__.core.invoke('get_performance_stats');
                    document.getElementById('pac-cpu').textContent = stats.cpu_usage.toFixed(1);
                    document.getElementById('pac-mem').textContent = stats.memory_usage_mb;
                } catch(e) { console.error('[PACDeluxe] Stats error:', e); }
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
    // CHUNGUS MODE: Force GPU acceleration and advanced rendering features
    // Must be set before any WebView2 initialization
    std::env::set_var(
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
        "--enable-gpu-rasterization \
         --enable-zero-copy \
         --enable-features=Vulkan,CanvasOopRasterization \
         --disable-gpu-driver-bug-workarounds \
         --force-gpu-mem-available-mb=1024 \
         --disable-background-timer-throttling \
         --disable-backgrounding-occluded-windows \
         --disable-renderer-backgrounding \
         --autoplay-policy=no-user-gesture-required"
    );

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
            .on_page_load(|webview, _payload| {
                let _ = webview.eval(OVERLAY_SCRIPT);
            })
            // Handle OAuth popup windows (Google/Firebase auth)
            .on_new_window(move |url, features| {
                let popup_id = POPUP_COUNTER.fetch_add(1, Ordering::SeqCst);
                let label = format!("auth-popup-{}", popup_id);
                debug!("Opening popup window: {} -> {}", label, url);

                let app_handle_clone = app_handle.clone();
                let label_clone = label.clone();

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
                // Close popup when Firebase auth callback completes
                .on_navigation(|url| {
                    // Allow all navigation in auth popup
                    debug!("Auth popup navigating to: {}", url);
                    true
                })
                .on_page_load(move |_webview, payload| {
                    let url = payload.url().to_string();
                    debug!("Auth popup loaded: {}", url);

                    // Firebase auth callback URL pattern - close after auth completes
                    // Check for the callback with auth code (successful login)
                    if url.contains("/__/auth/handler") && url.contains("code=") {
                        debug!("Auth complete, closing popup via Rust");
                        // Close from Rust side - window.close() doesn't work in WebView2
                        let app = app_handle_clone.clone();
                        let label = label_clone.clone();
                        std::thread::spawn(move || {
                            std::thread::sleep(std::time::Duration::from_millis(500));
                            if let Some(win) = app.get_webview_window(&label) {
                                let _ = win.close();
                                debug!("Popup {} closed", label);
                            }
                        });
                    }
                })
                .build();

                match popup {
                    Ok(window) => NewWindowResponse::Create { window },
                    Err(e) => {
                        debug!("Failed to create popup: {}", e);
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
            commands::get_background_image,
        ])
        .run(tauri::generate_context!())
        .expect("Failed to run application");
}
