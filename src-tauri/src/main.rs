// Windows subsystem - no console in release (Windows only)
#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

mod performance;
mod commands;

use tauri::{Emitter, Listener, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri::webview::NewWindowResponse;
use tracing::{info, debug, warn, Level};
use tracing_subscriber::FmtSubscriber;
use std::sync::atomic::{AtomicU32, AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use std::path::PathBuf;

/// Clean up problematic files from old installations (Windows)
/// Runs on every startup to ensure clean state
#[cfg(target_os = "windows")]
fn cleanup_old_installation() {
    // Get the executable directory
    let exe_dir = match std::env::current_exe() {
        Ok(path) => path.parent().map(|p| p.to_path_buf()),
        Err(_) => None,
    };

    // Get AppData directories (Windows-specific)
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

/// Clean up problematic files from old installations (Linux)
/// Runs on every startup to ensure clean state
#[cfg(target_os = "linux")]
fn cleanup_old_installation() {
    // Get XDG directories for Linux (with fallbacks to ~/.cache, ~/.config, ~/.local/share)
    let home = std::env::var("HOME").ok().map(PathBuf::from);
    let cache_home = std::env::var("XDG_CACHE_HOME")
        .ok()
        .map(PathBuf::from)
        .or_else(|| home.as_ref().map(|h| h.join(".cache")));
    let config_home = std::env::var("XDG_CONFIG_HOME")
        .ok()
        .map(PathBuf::from)
        .or_else(|| home.as_ref().map(|h| h.join(".config")));

    let mut cleaned = Vec::new();

    // List of known problematic files/directories to remove on Linux
    let problematic_patterns: Vec<(&str, Option<&PathBuf>)> = vec![
        // Old cache files
        ("pacdeluxe/cache_v0", cache_home.as_ref()),
        ("PACDeluxe/cache_v0", cache_home.as_ref()),
        // Old config files
        ("pacdeluxe/old_config.json", config_home.as_ref()),
        ("PACDeluxe/old_config.json", config_home.as_ref()),
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

    if !cleaned.is_empty() {
        info!("Cleaned up {} old installation artifacts: {:?}", cleaned.len(), cleaned);
    } else {
        debug!("No old installation artifacts to clean up");
    }
}

/// Counter for unique popup window labels
static POPUP_COUNTER: AtomicU32 = AtomicU32::new(0);

/// Script injected into auth popup windows to bridge Firebase's postMessage
/// back to the main window via Tauri events, and to forward messages sent
/// from the main window into the popup as synthetic MessageEvents.
///
/// Problem: Tauri opens popups as independent WebviewWindows that share no
/// `window.opener` relationship with the main WebView. Firebase's popup auth
/// flow depends on `window.opener.postMessage()` to return OAuth results, and
/// the main window depends on posting messages back to the popup during the
/// iframe-acknowledge phase of auth.
///
/// Solution:
///   - Mock `window.opener` so popup-side posts are forwarded via Tauri events.
///   - Listen for main->popup events and dispatch them as MessageEvents in
///     the popup's window so Firebase's handler receives them.
///   - Provide `window.opener.location.replace` so the upstream `index.tsx`
///     "block opening main app in popup" check does not throw when the popup
///     navigates to a page that runs the upstream bundle.
const AUTH_POPUP_BRIDGE_SCRIPT: &str = r#"
(function() {
    if (!window.opener) {
        window.opener = {
            postMessage: function(data, targetOrigin) {
                try {
                    if (window.__TAURI__ && window.__TAURI__.event && window.__TAURI__.event.emit) {
                        window.__TAURI__.event.emit('pac-auth-popup-result', {
                            data: data,
                            origin: window.location.origin
                        });
                        console.log('[PACDeluxe Auth Bridge] Forwarded popup->main postMessage');
                    } else {
                        console.warn('[PACDeluxe Auth Bridge] Tauri event API not available');
                    }
                } catch(e) {
                    console.error('[PACDeluxe Auth Bridge] Failed to emit popup->main:', e);
                }
            },
            close: function() {
                try { window.close(); } catch(_e) {}
            },
            closed: false,
            focus: function() {},
            blur: function() {},
            location: {
                href: '',
                replace: function(newUrl) {
                    // Upstream index.tsx calls this when the popup loads a
                    // page that runs the main bundle (e.g. post-auth redirect
                    // to /lobby). In the local-build runtime the main window
                    // must not navigate externally - just inform the main
                    // side that auth is done so it can close the popup.
                    try {
                        if (window.__TAURI__ && window.__TAURI__.event && window.__TAURI__.event.emit) {
                            window.__TAURI__.event.emit('pac-popup-redirect-opener', { url: newUrl });
                        }
                    } catch(_e) {}
                }
            }
        };
        console.log('[PACDeluxe Auth Bridge] window.opener mock installed');
    }

    // Main -> popup MessageEvent dispatch is performed by the Rust side
    // via webview.eval() (see the pac-main-to-popup handler in main.rs).
    // That avoids registering a fresh JS listener on every cross-origin
    // navigation the popup performs during OAuth, which would otherwise
    // accumulate zombie handlers on the Rust event bus.
})();
"#;

/// Performance runtime injected into the game page.
/// This is the canonical frontend runtime for PACDeluxe.
const OVERLAY_SCRIPT: &str = r#"
(function() {
    // Wait for body to exist
    function init() {
        if (!document.body) {
            setTimeout(init, 50);
            return;
        }

        // Safe localStorage wrapper (setItem can throw QuotaExceededError)
        function lsSet(key, value) {
            try { localStorage.setItem(key, value); } catch(e) {}
        }

        // === SCROLLBAR BUG FIX ===
        // Hide all scrollbars and fix viewport sizing issues
        // Problem: 100vh/100vw can cause overflow due to browser UI
        // Solution: Use 100% sizing with overflow containment
        const scrollbarFix = document.createElement('style');
        scrollbarFix.textContent = `
            /* Hide all scrollbars globally */
            * {
                scrollbar-width: none !important;
                -ms-overflow-style: none !important;
            }
            *::-webkit-scrollbar {
                display: none !important;
                width: 0 !important;
                height: 0 !important;
            }
            /* Fix viewport sizing - use % instead of vh/vw to avoid browser UI issues */
            html {
                overflow: hidden !important;
                width: 100% !important;
                height: 100% !important;
                max-width: 100% !important;
                max-height: 100% !important;
            }
            body {
                overflow: hidden !important;
                width: 100% !important;
                height: 100% !important;
                max-width: 100% !important;
                max-height: 100% !important;
                margin: 0 !important;
                padding: 0 !important;
            }
            /* Ensure root container fills viewport without overflow */
            #root {
                overflow: hidden !important;
                width: 100% !important;
                height: 100% !important;
                max-width: 100vw !important;
                max-height: 100vh !important;
            }
            /* Fix game container to prevent horizontal overflow */
            /* Note: #game-wrapper must NOT have overflow:hidden - the sidebar
               is positioned at left:-60px inside it and would be clipped */
            #game {
                max-width: 100% !important;
                overflow: hidden !important;
            }
        `;
        document.head.appendChild(scrollbarFix);
        console.log('[PACDeluxe] Scrollbar/viewport fix applied');

        // === CONTEXT MENU FIX ===
        // Disable default WebView2 context menu on canvas elements.
        // Uses event delegation on document so it works even if Phaser
        // recreates the canvas - no setInterval, no duplicate listeners.
        document.addEventListener('contextmenu', (e) => {
            if (e.target && e.target.tagName === 'CANVAS') {
                e.preventDefault();
            }
        });
        console.log('[PACDeluxe] Canvas context menu disabled');

        // === NATIVE HTTP PROXY FOR LOCAL SERVING (origin-scoped) ===
        //
        // The locally-built game runs on the Tauri origin (tauri://localhost,
        // or http://localhost:1420 under `tauri dev`). Every request that is
        // not a local asset in dist/ must be routed to the production origin
        // through the native Rust proxy, because the browser security model
        // would otherwise treat it as a cross-origin call.
        //
        // Model: proxy everything that is NOT a local asset. This inverts the
        // previous allowlist approach - upstream can add new API endpoints
        // without requiring a PACDeluxe code change.
        (function() {
            const PROD_HOST = 'pokemon-auto-chess.com';
            const COMMUNITY_SERVERS_URL = 'https://raw.githubusercontent.com/keldaanCommunity/pokemonAutoChess/master/community-servers.md';
            const invoke = window.__TAURI__?.core?.invoke;

            if (!invoke) {
                console.warn('[PACDeluxe] Tauri invoke unavailable, native proxy disabled');
                return;
            }

            // Path prefixes for files bundled into dist/ (kept in sync with
            // scripts/proxy-manifest.js LOCAL_STATIC_FETCH_PREFIXES).
            const localAssetPrefixes = [
                '/assets/', '/style/', '/locales/', '/pokechess/', '/changelog/'
            ];

            // File extensions served locally from dist/. Deliberately excludes
            // .json: some upstream endpoints may respond as JSON at URLs that
            // happen to end in .json, and we don't want to misclassify them.
            const localAssetExtensions = new Set([
                '.html', '.js', '.mjs', '.map', '.css',
                '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico',
                '.mp3', '.ogg', '.wav', '.m4a',
                '.woff', '.woff2', '.ttf', '.otf'
            ]);

            function isLocalAssetPath(pathname) {
                if (pathname === '/' || pathname === '') return true;
                for (const prefix of localAssetPrefixes) {
                    if (pathname.startsWith(prefix)) return true;
                }
                const dot = pathname.lastIndexOf('.');
                if (dot >= 0) {
                    const ext = pathname.slice(dot).toLowerCase();
                    if (localAssetExtensions.has(ext)) return true;
                }
                return false;
            }

            function toAbsolute(url) {
                try { return new URL(url, window.location.origin); }
                catch (_error) { return null; }
            }

            function normalizeProxyUrl(absolute) {
                if (absolute.origin === window.location.origin) {
                    return absolute.pathname + absolute.search;
                }
                return absolute.toString();
            }

            function isProxyableUrl(absolute, method) {
                // Tauri-origin request → proxy unless it's a local asset
                if (absolute.origin === window.location.origin) {
                    return !isLocalAssetPath(absolute.pathname);
                }

                // Production origin or any of its subdomains → always proxy
                const host = absolute.host;
                if (host === PROD_HOST || host.endsWith('.' + PROD_HOST)) {
                    return true;
                }

                // Community-servers manifest on GitHub → read-only
                if (absolute.toString() === COMMUNITY_SERVERS_URL) {
                    return method === 'GET' || method === 'HEAD';
                }

                return false;
            }

            async function proxyFetch(request, effectiveUrl) {
                const method = (request.method || 'GET').toUpperCase();
                const headers = {};
                request.headers.forEach((value, key) => { headers[key] = value; });

                let body = null;
                if (method !== 'GET' && method !== 'HEAD') {
                    try { body = await request.clone().text(); }
                    catch (_error) { body = null; }
                }

                const proxied = await invoke('proxy_http_request', {
                    request: { url: effectiveUrl, method, headers, body }
                });

                const response = new Response(proxied.body, {
                    status: proxied.status,
                    statusText: proxied.statusText,
                    headers: proxied.headers
                });

                try {
                    Object.defineProperty(response, 'url', { value: proxied.url });
                } catch (_error) {}

                return response;
            }

            const nativeFetch = window.fetch.bind(window);
            window.fetch = async function(input, init) {
                const request = input instanceof Request
                    ? new Request(input, init)
                    : new Request(input, init);
                const method = (request.method || 'GET').toUpperCase();
                const absolute = toAbsolute(request.url);

                if (!absolute || !isProxyableUrl(absolute, method)) {
                    return nativeFetch(input, init);
                }

                if (request.signal?.aborted) {
                    throw request.signal.reason || new DOMException('The operation was aborted.', 'AbortError');
                }

                return proxyFetch(request, normalizeProxyUrl(absolute));
            };

            console.log('[PACDeluxe] Native proxy active (origin-scoped model)');
        })();

        // === AUTH POPUP BRIDGE (MAIN SIDE) ===
        //
        // Firebase's signInWithPopup() calls window.open() and uses the
        // returned Window reference to:
        //   - poll popup.closed for cancellation detection
        //   - post into the popup during the iframe-ack phase
        //   - close the popup after auth completes
        //   - verify event.source === popup on incoming MessageEvents
        //
        // In Tauri, the main window's native window.open() returns null when
        // on_new_window intercepts the creation, so Firebase would throw
        // auth/popup-blocked. We intercept window.open() to return a mock
        // Window that proxies every operation through Tauri events to the
        // actual popup webview.
        (function() {
            const emit = window.__TAURI__?.event?.emit;
            const listen = window.__TAURI__?.event?.listen;
            if (!emit || !listen) {
                console.warn('[PACDeluxe] Tauri event API unavailable, popup bridge inactive');
                return;
            }

            let activeMockPopup = null;

            function createMockPopup(initialUrl) {
                const mock = {
                    closed: false,
                    _href: initialUrl || '',
                    location: {
                        get href() { return mock._href; },
                        set href(v) { mock._href = v; }
                    },
                    postMessage: function(data, targetOrigin) {
                        try {
                            emit('pac-main-to-popup', { data: data, targetOrigin: targetOrigin });
                        } catch(e) {
                            console.error('[PACDeluxe] Failed to forward main->popup message:', e);
                        }
                    },
                    close: function() {
                        mock.closed = true;
                        try { emit('pac-close-auth-popup', {}); }
                        catch(e) { console.error('[PACDeluxe] Failed to request popup close:', e); }
                    },
                    focus: function() {},
                    blur: function() {}
                };
                return mock;
            }

            // Return a mock only for Firebase/OAuth popup URLs. The upstream
            // game also opens plain external links via window.open(url,
            // "_blank") (Discord, Patreon) - those need the old null-return
            // so they don't clobber activeMockPopup or accidentally inherit
            // auth-popup semantics in the listeners below.
            function isAuthPopupUrl(url) {
                if (!url) return false;
                const s = String(url).toLowerCase();
                return s.indexOf('/__/auth/') !== -1
                    || s.indexOf('firebaseapp.com') !== -1
                    || s.indexOf('accounts.google.com') !== -1
                    || s.indexOf('oauth') !== -1;
            }

            // Intercept window.open so Firebase gets a usable reference even
            // when Tauri's on_new_window suppresses the native window creation.
            const nativeOpen = window.open.bind(window);
            window.open = function(url, name, features) {
                // Let the native call go through - this is what triggers
                // Tauri's on_new_window handler that actually creates the
                // popup webview.
                try { nativeOpen(url, name, features); } catch(_e) {}

                if (!isAuthPopupUrl(url)) {
                    // Non-auth popup (external link) - preserve the
                    // pre-intercept null-return behavior.
                    return null;
                }

                activeMockPopup = createMockPopup(url);
                console.log('[PACDeluxe] window.open intercepted for auth popup:', url);
                return activeMockPopup;
            };

            // Popup -> main: auth result forwarded from popup's window.opener mock
            listen('pac-auth-popup-result', function(event) {
                console.log('[PACDeluxe] Received popup->main auth message');
                const payload = event && event.payload;
                if (!payload || payload.data === undefined) return;
                try {
                    window.dispatchEvent(new MessageEvent('message', {
                        data: payload.data,
                        origin: payload.origin || '',
                        source: activeMockPopup
                    }));
                } catch(e) {
                    console.error('[PACDeluxe] Failed to dispatch auth MessageEvent:', e);
                }
            });

            // Popup was destroyed (Tauri watchdog, user closed, or auth done)
            listen('pac-popup-closed', function(_event) {
                if (activeMockPopup && !activeMockPopup.closed) {
                    activeMockPopup.closed = true;
                    console.log('[PACDeluxe] Mock popup marked closed by Tauri event');
                }
            });

            // Upstream index.tsx calls window.opener.location.replace when a
            // popup loads the main bundle (post-auth). We don't navigate the
            // main window externally; the popup's Tauri watchdog already
            // closes it.
            listen('pac-popup-redirect-opener', function(event) {
                const url = event && event.payload && event.payload.url;
                console.log('[PACDeluxe] Popup requested opener redirect (ignored):', url);
            });

            console.log('[PACDeluxe] Auth popup bridge ready (window.open intercepted)');
        })();

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
            lsSet(CACHE_VERSION_KEY, currentVersion);

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

            // In-memory cache (128MB limit - safe for 4GB systems)
            const cache = new Map();
            let cacheSize = 0;
            const maxSize = 128 * 1024 * 1024;

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
                    lsSet(CACHE_ASSETS_KEY, JSON.stringify(urls));
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

        // === MINIMAL STYLING (kept intentionally small for upstream compatibility) ===
        const perfStyles = document.createElement('style');
        perfStyles.id = 'pac-perf-styles';
        perfStyles.textContent = `
            /* Fix Additional Picks popup - shift up so bottom row is fully visible */
            #game-additional-pokemons {
                transform: translateY(-25px) !important;
            }
        `;
        document.head.appendChild(perfStyles);
        console.log('[PACDeluxe] Minimal styling applied');

        // Prevent duplicate injection - remove any existing overlay and bail if already injected
        ['pac-perf', 'pac-perf-rust'].forEach(id => {
            const existing = document.getElementById(id);
            if (existing) existing.remove();
        });
        if (window._pacOverlayInjected) {
            console.log('[PACDeluxe] Overlay already initialized, skipping');
            return;
        }
        window._pacOverlayInjected = true;

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
            e.stopPropagation(); // Prevent game from receiving this event
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            e.stopPropagation(); // Prevent game interactions during drag
            const dx = e.clientX - dragStartX;
            const dy = e.clientY - dragStartY;
            overlay.style.left = (overlayStartX + dx) + 'px';
            overlay.style.top = (overlayStartY + dy) + 'px';
        });

        document.addEventListener('mouseup', (e) => {
            if (!isDragging) return;
            isDragging = false;
            e.stopPropagation(); // Prevent game from receiving drop event

            // Keep position where user dropped it
            const rect = overlay.getBoundingClientRect();

            // Persist position as x,y coordinates
            lsSet('pac_overlay_pos', JSON.stringify({
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

        // Helper: invoke with timeout to prevent hanging
        async function invokeWithTimeout(invoke, cmd, args, timeoutMs = 3000) {
            return Promise.race([
                invoke(cmd, args),
                new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs))
            ]);
        }

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
                    // Fetch CPU/Memory stats (with timeout)
                    const stats = await invokeWithTimeout(invoke, 'get_performance_stats');
                    if (stats) {
                        if (cpuEl) cpuEl.textContent = typeof stats.cpu_usage === 'number' ? stats.cpu_usage.toFixed(1) : '--';
                        if (memEl) memEl.textContent = typeof stats.memory_usage_mb === 'number' ? (stats.memory_usage_mb / 1024).toFixed(2) : '--';
                    }
                    // Fetch GPU stats (with timeout)
                    const gpuStats = await invokeWithTimeout(invoke, 'get_gpu_stats');
                    if (gpuStats && gpuEl) {
                        if (gpuStats.available) {
                            gpuEl.textContent = gpuStats.usage_percent.toFixed(1);
                        } else {
                            gpuEl.textContent = 'N/A';
                        }
                    }
                    // Fetch HDR status (only once, doesn't change often)
                    if (hdrEl && hdrEl.textContent === '--') {
                        const hdrInfo = await invokeWithTimeout(invoke, 'get_hdr_status');
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
        let windowModeChanging = false;
        document.addEventListener('keydown', async e => {
            if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'p') {
                e.preventDefault();
                visible = !visible;
                overlay.style.display = visible ? 'block' : 'none';
                lsSet('pac_overlay_visible', visible);
                if (visible) updateOverlay();
            }
            if (e.key === 'F11' && e.repeat) {
                e.preventDefault();
                return;
            }
            // Shift+F11 for borderless windowed
            if (e.shiftKey && e.key === 'F11') {
                e.preventDefault();
                if (windowModeChanging) return;
                if (window.__TAURI__) {
                    windowModeChanging = true;
                    try {
                        const currentMode = await window.__TAURI__.core.invoke('get_window_mode');
                        const newMode = currentMode === 'BorderlessWindowed' ? 'Windowed' : 'BorderlessWindowed';
                        await window.__TAURI__.core.invoke('set_window_mode', { mode: newMode });
                        console.log('[PACDeluxe] Window mode:', newMode);
                    } catch(e) { console.error('[PACDeluxe] Borderless error:', e); }
                    finally { windowModeChanging = false; }
                }
            }
            // F11 for exclusive fullscreen (only if Shift not pressed)
            else if (e.key === 'F11' && !e.shiftKey) {
                e.preventDefault();
                if (windowModeChanging) return;
                if (window.__TAURI__) {
                    windowModeChanging = true;
                    try {
                        await window.__TAURI__.core.invoke('toggle_fullscreen');
                    } catch(e) { console.error('[PACDeluxe] Fullscreen error:', e); }
                    finally { windowModeChanging = false; }
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

        // === BOOSTER "FLIP ALL" BUTTON ===
        // Adds a dedicated "Flip All" button instead of replacing "Open a Booster".
        // This keeps the original open-pack behavior and avoids modal close side effects.
        (function dynamicBoosterButton() {
            const FLIP_ALL_BUTTON_ID = 'pac-flip-all-btn';

            function flipAllCards(boostersPage) {
                const unflippedCards = boostersPage.querySelectorAll('.booster-card:not(.flipped)');
                if (unflippedCards.length === 0) return;

                console.log('[PACDeluxe] Flipping ' + unflippedCards.length + ' cards...');

                // Use pointer coordinates inside each card so the modal outside-click
                // handler does not interpret these synthetic clicks as backdrop clicks.
                unflippedCards.forEach((card) => {
                    const rect = card.getBoundingClientRect();
                    const clickEvent = new MouseEvent('click', {
                        bubbles: true,
                        cancelable: true,
                        view: window,
                        clientX: rect.left + (rect.width / 2),
                        clientY: rect.top + (rect.height / 2)
                    });
                    card.dispatchEvent(clickEvent);
                });
            }

            function ensureFlipAllButton(actions, openBoosterBtn) {
                let flipAllBtn = actions.querySelector('#' + FLIP_ALL_BUTTON_ID);

                if (!flipAllBtn) {
                    flipAllBtn = document.createElement('button');
                    flipAllBtn.id = FLIP_ALL_BUTTON_ID;
                    flipAllBtn.type = 'button';
                    flipAllBtn.className = 'bubbly blue';
                    flipAllBtn.textContent = 'Flip All';
                    flipAllBtn.style.position = 'absolute';
                    flipAllBtn.style.display = 'none';
                    flipAllBtn.style.zIndex = '1';
                    flipAllBtn.style.margin = '0';

                    flipAllBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();

                        const boostersPage = document.getElementById('boosters-page');
                        if (!boostersPage) return;

                        flipAllCards(boostersPage);
                    });

                    actions.appendChild(flipAllBtn);
                }

                const actionsRect = actions.getBoundingClientRect();
                const openBtnRect = openBoosterBtn.getBoundingClientRect();

                // Place Flip All directly to the left of Open Booster with ~50px spacing.
                flipAllBtn.style.left = (openBtnRect.left - actionsRect.left - 50) + 'px';
                flipAllBtn.style.top = (openBtnRect.top - actionsRect.top + (openBtnRect.height / 2)) + 'px';
                flipAllBtn.style.transform = 'translate(-100%, -50%)';

                return flipAllBtn;
            }

            function updateFlipAllButton() {
                const boostersPage = document.getElementById('boosters-page');
                if (!boostersPage) return;

                const actions = boostersPage.querySelector('.actions');
                if (!actions) return;

                const openBoosterBtn = actions.querySelector('button.bubbly:not(#' + FLIP_ALL_BUTTON_ID + ')');
                if (!openBoosterBtn) return;

                const boosterCards = boostersPage.querySelectorAll('.booster-card');
                const unflippedCards = boostersPage.querySelectorAll('.booster-card:not(.flipped)');
                const shouldShowFlipAll = boosterCards.length > 0 && unflippedCards.length > 0;

                const flipAllBtn = ensureFlipAllButton(actions, openBoosterBtn);
                flipAllBtn.style.display = shouldShowFlipAll ? '' : 'none';
                flipAllBtn.disabled = !shouldShowFlipAll;
            }

            updateFlipAllButton();
            setInterval(updateFlipAllButton, 250);
            console.log('[PACDeluxe] Booster Flip All button ready');
        })();

        // === AUTO-UPDATER ===
        // Check for updates on startup and show user-friendly notification
        // with release notes, progress bar, and clear messaging for major updates
        (async function checkForUpdates() {
            // Wait for Tauri to be fully initialized
            await new Promise(resolve => setTimeout(resolve, 5000));

            const invoke = window.__TAURI__?.core?.invoke;
            const listen = window.__TAURI__?.event?.listen;
            if (!invoke) {
                console.log('[PACDeluxe] Tauri not available, skipping update check');
                return;
            }

            try {
                const update = await invoke('check_for_updates');
                console.log('[PACDeluxe] Update check result:', update);

                if (update && update.available) {
                    console.log('[PACDeluxe] Update available:', update.version);

                    // Detect major version bump by comparing current vs target major version
                    const currentMajor = (document.title.match(/v(\d+)\./) || [])[1] || '0';
                    const targetMajor = (update.version.match(/^(\d+)\./) || [])[1] || '0';
                    const isMajor = targetMajor !== currentMajor;

                    // Build release notes summary (strip markdown, truncate)
                    let notes = '';
                    if (update.body) {
                        notes = update.body
                            .replace(/#{1,6}\s*/g, '')
                            .replace(/\*\*/g, '')
                            .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
                            .replace(/\n{2,}/g, '\n')
                            .trim();
                        if (notes.length > 300) notes = notes.substring(0, 297) + '...';
                    }

                    // Create update notification
                    const banner = document.createElement('div');
                    banner.id = 'pac-update-banner';
                    banner.style.cssText = 'position:fixed;top:0;left:50%;transform:translateX(-50%);background:linear-gradient(135deg,#1a3a5c,#1a5a1a);color:#fff;padding:0;border-radius:0 0 12px 12px;z-index:99998;font:13px/1.5 sans-serif;box-shadow:0 4px 20px rgba(0,0,0,0.4);max-width:480px;width:90vw;overflow:hidden;';

                    let bannerHTML = '<div style="padding:12px 16px;">';
                    bannerHTML += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">';
                    bannerHTML += '<span style="font-weight:bold;font-size:14px;">PACDeluxe v' + update.version + ' available</span>';
                    bannerHTML += '<button id="pac-update-dismiss" style="background:transparent;color:#fff8;border:none;padding:2px 6px;cursor:pointer;font-size:18px;line-height:1;" title="Dismiss">&times;</button>';
                    bannerHTML += '</div>';

                    if (isMajor) {
                        bannerHTML += '<div style="background:rgba(255,255,255,0.1);border-radius:6px;padding:8px 10px;margin-bottom:8px;font-size:12px;">';
                        bannerHTML += 'This is a major update. The download may be larger than usual.';
                        bannerHTML += '</div>';
                    }

                    if (notes) {
                        bannerHTML += '<div style="background:rgba(0,0,0,0.2);border-radius:6px;padding:8px 10px;margin-bottom:10px;font-size:11px;max-height:100px;overflow-y:auto;white-space:pre-wrap;line-height:1.4;color:#fffc;">';
                        bannerHTML += notes;
                        bannerHTML += '</div>';
                    }

                    // Progress bar (hidden initially)
                    bannerHTML += '<div id="pac-update-progress-wrap" style="display:none;margin-bottom:10px;">';
                    bannerHTML += '<div style="background:rgba(255,255,255,0.15);border-radius:4px;height:6px;overflow:hidden;">';
                    bannerHTML += '<div id="pac-update-progress-bar" style="background:#4ade80;height:100%;width:0%;transition:width 0.3s ease;border-radius:4px;"></div>';
                    bannerHTML += '</div>';
                    bannerHTML += '<div id="pac-update-progress-text" style="font-size:11px;color:#fffa;margin-top:4px;text-align:center;">Downloading...</div>';
                    bannerHTML += '</div>';

                    // Status text (shown during install)
                    bannerHTML += '<div id="pac-update-status" style="display:none;text-align:center;padding:4px 0;font-size:12px;color:#4ade80;"></div>';

                    // Buttons
                    bannerHTML += '<div id="pac-update-buttons" style="display:flex;gap:8px;justify-content:flex-end;">';
                    bannerHTML += '<button id="pac-update-later" style="background:rgba(255,255,255,0.1);color:#fff;border:1px solid rgba(255,255,255,0.2);padding:6px 14px;border-radius:6px;cursor:pointer;font-size:12px;">Later</button>';
                    bannerHTML += '<button id="pac-update-btn" style="background:#4ade80;color:#1a3a2a;border:none;padding:6px 14px;border-radius:6px;cursor:pointer;font-weight:bold;font-size:12px;">Update Now</button>';
                    bannerHTML += '</div>';

                    bannerHTML += '</div>';
                    banner.innerHTML = bannerHTML;
                    document.body.appendChild(banner);

                    // Dismiss / Later handlers
                    document.getElementById('pac-update-dismiss').onclick = () => banner.remove();
                    document.getElementById('pac-update-later').onclick = () => banner.remove();

                    // Update button handler with progress tracking
                    document.getElementById('pac-update-btn').onclick = async () => {
                        const buttons = document.getElementById('pac-update-buttons');
                        const progressWrap = document.getElementById('pac-update-progress-wrap');
                        const progressBar = document.getElementById('pac-update-progress-bar');
                        const progressText = document.getElementById('pac-update-progress-text');
                        const statusEl = document.getElementById('pac-update-status');

                        // Hide buttons, show progress
                        buttons.style.display = 'none';
                        progressWrap.style.display = 'block';

                        // Track download progress via Tauri events
                        let downloaded = 0;
                        let totalSize = 0;
                        let unlisten = null;

                        if (listen) {
                            try {
                                unlisten = await listen('update-progress', (event) => {
                                    const data = event.payload;
                                    downloaded += (data.chunk || 0);
                                    if (data.total > 0) totalSize = data.total;

                                    if (totalSize > 0) {
                                        const pct = Math.min(100, Math.round((downloaded / totalSize) * 100));
                                        progressBar.style.width = pct + '%';
                                        const dlMB = (downloaded / 1048576).toFixed(1);
                                        const totalMB = (totalSize / 1048576).toFixed(1);
                                        progressText.textContent = dlMB + ' / ' + totalMB + ' MB (' + pct + '%)';
                                    } else {
                                        const dlMB = (downloaded / 1048576).toFixed(1);
                                        progressText.textContent = dlMB + ' MB downloaded...';
                                        // Animate indeterminate progress
                                        progressBar.style.width = Math.min(90, (downloaded / 1048576) * 2) + '%';
                                    }
                                });
                            } catch(e) {
                                console.log('[PACDeluxe] Could not listen for progress events:', e);
                            }
                        }

                        try {
                            await invoke('install_update');

                            if (unlisten) unlisten();
                            progressWrap.style.display = 'none';
                            statusEl.style.display = 'block';
                            statusEl.textContent = 'Update installed! Restarting...';

                            setTimeout(async () => {
                                try { await invoke('restart_app'); } catch(e) {}
                            }, 1500);
                        } catch (e) {
                            if (unlisten) unlisten();
                            console.error('[PACDeluxe] Update failed:', e);
                            progressWrap.style.display = 'none';
                            statusEl.style.display = 'block';
                            statusEl.style.color = '#f87171';
                            statusEl.textContent = 'Update failed: ' + (e.message || e);
                            // Show buttons again so user can retry or dismiss
                            setTimeout(() => {
                                buttons.style.display = 'flex';
                                statusEl.style.display = 'none';
                            }, 5000);
                        }
                    };
                } else {
                    console.log('[PACDeluxe] App is up to date');
                }
            } catch (e) {
                console.log('[PACDeluxe] Update check failed:', e.message || e);
            }
        })();

        console.log('[PACDeluxe] Ready - Ctrl+Shift+P: overlay, F11: fullscreen, Shift+F11: borderless');
    }
    init();
})();
"#;

/// Resolve the local HTTP port for the in-process `tauri-plugin-localhost`
/// server. We prefer a fixed port so that the webview's origin
/// (`http://localhost:<PORT>`) is stable across sessions - changing the port
/// would reset cookies, IndexedDB, and localStorage every restart. If the
/// preferred port is taken we fall back to any free port rather than failing
/// to launch; the app then gets a fresh storage partition that session.
fn pick_localhost_port() -> u16 {
    const PREFERRED: u16 = 37529;
    if std::net::TcpListener::bind(("127.0.0.1", PREFERRED)).is_ok() {
        PREFERRED
    } else {
        portpicker::pick_unused_port().unwrap_or(PREFERRED)
    }
}

fn main() {
    // Initialize logging
    let subscriber = FmtSubscriber::builder()
        .with_max_level(if cfg!(debug_assertions) { Level::DEBUG } else { Level::INFO })
        .finish();
    tracing::subscriber::set_global_default(subscriber).ok();

    info!("Starting PACDeluxe");

    // Pick the port before building Tauri so the plugin and the main
    // window both agree on it. Firebase's OAuth flow requires an
    // authorized origin - the PAC Firebase project accepts `localhost`
    // at any port, but not `tauri.localhost` (the default Tauri origin
    // on Windows/Linux).
    let localhost_port = pick_localhost_port();
    info!("Serving frontend on http://localhost:{}", localhost_port);

    // Set WebView2 Chromium flags for real GPU performance gains
    // Must be set before any WebView2 instance is created
    #[cfg(target_os = "windows")]
    {
        // SAFETY: called at startup before any threads spawn, single-threaded context
        unsafe {
            std::env::set_var(
                "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
                "--enable-gpu-rasterization --enable-zero-copy --disable-background-timer-throttling --disable-renderer-backgrounding",
            );
        }
    }

    // Clean up any problematic files from old installations
    cleanup_old_installation();

    // Apply system optimizations
    performance::apply_system_optimizations();

    tauri::Builder::default()
        // Serve dist/ over a local HTTP server so the webview origin is
        // `http://localhost:<port>` - an authorized Firebase domain that
        // lets OAuth popup sign-in complete normally.
        .plugin(tauri_plugin_localhost::Builder::new(localhost_port).build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(move |app| {
            let app_handle = app.handle().clone();

            // Get version for window title (add Dev suffix in debug builds)
            let version = app.package_info().version.to_string();
            let title = if cfg!(debug_assertions) {
                format!("PACDeluxe v{} (Dev)", version)
            } else {
                format!("PACDeluxe v{}", version)
            };

            // Create window programmatically with on_page_load handler.
            // Load from the localhost plugin's HTTP server rather than the
            // custom tauri:// scheme so that Firebase accepts the origin
            // for OAuth popup sign-in.
            let main_url = format!("http://localhost:{}/", localhost_port)
                .parse()
                .expect("localhost URL must parse");
            let window = WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::External(main_url)
            )
            .title(&title)
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
                // Mock window.opener so Firebase's popup auth can bridge results
                // back to the main window via Tauri events
                .initialization_script(AUTH_POPUP_BRIDGE_SCRIPT)
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
                                // Wait for Firebase handler page to load, process
                                // the OAuth code, and call postMessage (our mock
                                // bridges it to the main window via Tauri events)
                                std::thread::sleep(Duration::from_millis(3000));
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
                        // Notify the main window when the popup is destroyed
                        // so the JS-side mock can mark its `closed` flag.
                        // Firebase polls popup.closed to detect user
                        // cancellation of the auth flow.
                        let app_for_close = app_handle.clone();
                        let label_for_close = label.clone();
                        let popup_closed_event = popup_closed.clone();
                        window.on_window_event(move |event| {
                            if let WindowEvent::Destroyed = event {
                                popup_closed_event.store(true, Ordering::SeqCst);
                                let _ = app_for_close.emit(
                                    "pac-popup-closed",
                                    serde_json::json!({ "label": label_for_close }),
                                );
                                debug!("Auth popup {} destroyed, notified main", label_for_close);
                            }
                        });

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

            // Global listener: when the main-window mock popup calls
            // popup.close() (Firebase SDK does this after auth), it emits
            // pac-close-auth-popup. Close every open auth-popup-* window.
            // Clone a fresh handle from `app` - the earlier `app_handle` was
            // already moved into the on_new_window closure.
            let app_for_close_listener = app.handle().clone();
            app.listen_any("pac-close-auth-popup", move |_event| {
                let windows = app_for_close_listener.webview_windows();
                for (label, webview_window) in windows {
                    if label.starts_with("auth-popup-") {
                        debug!("Closing auth popup {} at SDK request", label);
                        let _ = webview_window.close();
                    }
                }
            });

            // Main -> popup MessageEvent dispatch. The main window's mock
            // popup.postMessage() emits pac-main-to-popup; we find the
            // active auth-popup webview and eval a small dispatch script.
            //
            // Doing this via webview.eval (rather than a JS-side listener
            // in AUTH_POPUP_BRIDGE_SCRIPT) avoids accumulating zombie
            // handlers every time the popup navigates cross-origin during
            // the OAuth flow - the JS listener would be re-registered on
            // each new page load while the old Rust-side registration
            // persisted.
            let app_for_m2p = app.handle().clone();
            app.listen_any("pac-main-to-popup", move |event| {
                let payload_json = event.payload();
                let windows = app_for_m2p.webview_windows();
                for (label, webview_window) in windows {
                    if !label.starts_with("auth-popup-") {
                        continue;
                    }
                    // payload_json is JSON, which is valid JS syntax -
                    // interpolating it as an expression is safe.
                    let script = format!(
                        r#"(function() {{
  try {{
    var __pac_payload = {};
    window.dispatchEvent(new MessageEvent('message', {{
      data: __pac_payload && __pac_payload.data,
      origin: (__pac_payload && __pac_payload.targetOrigin) || '*',
      source: window.opener
    }}));
  }} catch (e) {{
    console.error('[PACDeluxe Auth Bridge] main->popup dispatch failed:', e);
  }}
}})();"#,
                        payload_json
                    );
                    if let Err(e) = webview_window.eval(&script) {
                        warn!("Failed to eval main->popup bridge in {}: {}", label, e);
                    }
                }
            });

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
            commands::proxy_http_request,
            commands::check_for_updates,
            commands::install_update,
            commands::restart_app,
        ])
        .run(tauri::generate_context!())
        .expect("Failed to run application");
}
