(function() {
    // Skip on cross-origin pages. on_page_load fires for every navigation
    // in the main webview, including cross-origin hops during Firebase
    // redirect auth (accounts.google.com, <project>.firebaseapp.com). Our
    // overlay installs a fetch interceptor that routes non-local requests
    // through the Rust proxy - running that on Google's auth page would
    // misroute Google's own fetches and break the login UI. The app's
    // own origin is always http://localhost:<port> (see
    // tauri-plugin-localhost setup in main.rs), so hostname === 'localhost'
    // identifies our pages uniquely.
    if (window.location.hostname !== 'localhost') {
        console.log('[PACDeluxe] Overlay skipped on external origin:', window.location.origin);
        return;
    }

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
                '/assets/', '/tilemap/', '/style/', '/locales/', '/pokechess/', '/changelog/'
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
                const contentType = (response.headers.get('content-type') || '').toLowerCase();
                if (response.ok && !contentType.includes('text/html')) {
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
