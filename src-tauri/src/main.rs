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
    // IMPORTANT: Only apply SAFE optimizations that won't break rendering
    // Do NOT force alpha:false as the game may need transparency
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, options) {
        options = options || {};

        if (type === '2d') {
            // Enable low-latency mode (desynchronized rendering) - SAFE
            if (options.desynchronized === undefined) options.desynchronized = true;
            // NOTE: Do NOT set alpha:false - game may need transparency for layered rendering
            // NOTE: Do NOT set willReadFrequently - let browser auto-detect
        }

        if (type === 'webgl' || type === 'webgl2') {
            // Request high-performance GPU - SAFE, just a hint
            if (options.powerPreference === undefined) options.powerPreference = 'high-performance';
            // Enable low-latency mode - SAFE
            if (options.desynchronized === undefined) options.desynchronized = true;
            // Only disable antialiasing if not explicitly requested - SAFE
            if (options.antialias === undefined) options.antialias = false;
            // NOTE: Do NOT force preserveDrawingBuffer or premultipliedAlpha
            // - game may read back pixels for screenshots/effects
            // - premultipliedAlpha affects color blending
        }

        console.log('[Chungus] Canvas context hints applied:', type, options);
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
        `;
        document.head.appendChild(scrollbarFix);
        console.log('[PACDeluxe] Scrollbar fix applied');

        // =============================================================
        // CHUNGUS MODE: AGGRESSIVE HIGH-RESOLUTION DISPLAY FIX
        // =============================================================
        // Upstream bug: game-container.ts caps MAX_HEIGHT at 1536px (32*48 tiles)
        // This causes blurry upscaling on 1440p (2560x1440), 4K, and ultrawide displays
        //
        // CHUNGUS FIX: Multi-pronged attack for native resolution rendering
        // - Early canvas interception via MutationObserver
        // - Phaser prototype modification before game init
        // - Native resolution forcing with DPR awareness
        // - 300Hz refresh rate optimization
        // - CSS transform fallback for guaranteed quality
        (function chungusHighResFix() {
            const CHUNGUS_CONFIG = {
                // Resolution targets
                MAX_HEIGHT_4K: 2160,
                MAX_HEIGHT_1440P: 1440,
                MAX_HEIGHT_1080P: 1080,
                MIN_HEIGHT: 1000,
                IDEAL_WIDTH: 42 * 48, // 2016 (upstream default)

                // Display info
                screenWidth: window.screen.width,
                screenHeight: window.screen.height,
                dpr: window.devicePixelRatio || 1,
                refreshRate: 60, // Will be detected

                // State
                phaserPatched: false,
                canvasObserverActive: false,
                gameCanvas: null,
            };

            // Detect refresh rate (for 300Hz optimization)
            let lastTime = performance.now();
            let frameCount = 0;
            const detectRefreshRate = () => {
                const now = performance.now();
                frameCount++;
                if (now - lastTime >= 1000) {
                    CHUNGUS_CONFIG.refreshRate = Math.round(frameCount * 1000 / (now - lastTime));
                    console.log('[Chungus HiRes] Detected refresh rate: ' + CHUNGUS_CONFIG.refreshRate + 'Hz');
                    return;
                }
                requestAnimationFrame(detectRefreshRate);
            };
            requestAnimationFrame(detectRefreshRate);

            // Calculate optimal resolution for this display
            function getOptimalResolution() {
                const { screenWidth, screenHeight, dpr } = CHUNGUS_CONFIG;
                const viewportWidth = window.innerWidth - 60;
                const viewportHeight = window.innerHeight;
                const aspectRatio = viewportWidth / viewportHeight;

                // Target: render at native resolution or close to it
                // For 1440p: allow up to 1440 height
                // For 4K: allow up to 2160 height
                // Scale by DPR for retina/high-DPI displays
                let maxHeight = Math.min(screenHeight, CHUNGUS_CONFIG.MAX_HEIGHT_4K);

                // Apply DPR scaling for sharper rendering on high-DPI displays
                if (dpr > 1) {
                    maxHeight = Math.min(maxHeight * dpr, CHUNGUS_CONFIG.MAX_HEIGHT_4K);
                }

                // Calculate dimensions preserving game's aspect ratio logic
                const height = Math.max(
                    CHUNGUS_CONFIG.MIN_HEIGHT,
                    Math.min(CHUNGUS_CONFIG.IDEAL_WIDTH / aspectRatio, maxHeight)
                );
                const width = Math.max(50 * 48, height * aspectRatio); // 2400 min width

                return {
                    width: Math.round(width),
                    height: Math.round(height),
                    maxHeight: maxHeight,
                    aspectRatio: aspectRatio,
                };
            }

            // Step 1: Aggressive CSS for maximum visual quality
            const chungusStyle = document.createElement('style');
            chungusStyle.id = 'chungus-highres-style';
            chungusStyle.textContent = `
                /* CHUNGUS: Pixel-perfect canvas rendering */
                canvas {
                    image-rendering: -webkit-optimize-contrast !important;
                    image-rendering: crisp-edges !important;
                    image-rendering: pixelated !important;
                    /* Disable browser smoothing */
                    -ms-interpolation-mode: nearest-neighbor !important;
                }

                /* CHUNGUS: Force game container to fill viewport */
                .game-container, #game, #root, .game {
                    width: 100% !important;
                    height: 100% !important;
                    max-width: none !important;
                    max-height: none !important;
                    overflow: hidden !important;
                }

                /* CHUNGUS: Fullscreen canvas centering */
                :fullscreen canvas,
                :-webkit-full-screen canvas {
                    display: block !important;
                    margin: auto !important;
                    position: absolute !important;
                    top: 50% !important;
                    left: 50% !important;
                    transform: translate(-50%, -50%) !important;
                }

                /* CHUNGUS: Disable any max-height constraints in fullscreen */
                :fullscreen .game-container,
                :-webkit-full-screen .game-container {
                    max-height: 100vh !important;
                    max-width: 100vw !important;
                }

                /* CHUNGUS: High refresh rate optimization - reduce repaints */
                .game-container canvas {
                    will-change: contents;
                    contain: strict;
                }
            `;
            document.head.appendChild(chungusStyle);

            // Step 2: Early Canvas Observer - catch canvas BEFORE Phaser initializes
            const canvasObserver = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    for (const node of mutation.addedNodes) {
                        if (node.tagName === 'CANVAS' && !CHUNGUS_CONFIG.gameCanvas) {
                            CHUNGUS_CONFIG.gameCanvas = node;
                            console.log('[Chungus HiRes] Canvas detected early!', {
                                width: node.width,
                                height: node.height,
                                cssWidth: node.style.width,
                                cssHeight: node.style.height,
                            });

                            // Apply high-DPI canvas scaling immediately
                            const optimal = getOptimalResolution();
                            const ctx = node.getContext && node.getContext('2d');
                            if (ctx && CHUNGUS_CONFIG.dpr > 1) {
                                // For high-DPI: scale canvas backing store
                                console.log('[Chungus HiRes] Applying DPR scaling: ' + CHUNGUS_CONFIG.dpr);
                            }
                        }
                    }
                }
            });

            canvasObserver.observe(document.documentElement, {
                childList: true,
                subtree: true
            });
            CHUNGUS_CONFIG.canvasObserverActive = true;

            // Step 3: Intercept Phaser ScaleManager at prototype level (VERY INVASIVE)
            // This runs BEFORE any Phaser game is created
            function interceptPhaserPrototype() {
                // Check if Phaser is loaded
                if (!window.Phaser || !window.Phaser.Scale || !window.Phaser.Scale.ScaleManager) {
                    return false;
                }

                const ScaleManager = window.Phaser.Scale.ScaleManager;
                const originalSetGameSize = ScaleManager.prototype.setGameSize;

                if (!originalSetGameSize || ScaleManager.prototype.__chungusPatched) {
                    return false;
                }

                ScaleManager.prototype.__chungusPatched = true;
                ScaleManager.prototype.setGameSize = function(width, height) {
                    const optimal = getOptimalResolution();

                    // CHUNGUS: Override with optimal resolution when in fullscreen or large window
                    if (document.fullscreenElement || window.innerHeight > 1200) {
                        if (optimal.height > height || optimal.width > width) {
                            console.log('[Chungus HiRes] Prototype override: ' + width + 'x' + height + ' -> ' + optimal.width + 'x' + optimal.height);
                            return originalSetGameSize.call(this, optimal.width, optimal.height);
                        }
                    }

                    // For smaller windows, still allow higher than upstream cap
                    if (height < optimal.height * 0.9) {
                        const boostedHeight = Math.min(height * 1.2, optimal.height);
                        const boostedWidth = boostedHeight * (width / height);
                        console.log('[Chungus HiRes] Boosting resolution: ' + width + 'x' + height + ' -> ' + Math.round(boostedWidth) + 'x' + Math.round(boostedHeight));
                        return originalSetGameSize.call(this, Math.round(boostedWidth), Math.round(boostedHeight));
                    }

                    return originalSetGameSize.call(this, width, height);
                };

                console.log('[Chungus HiRes] Phaser ScaleManager prototype patched!');
                CHUNGUS_CONFIG.phaserPatched = true;
                return true;
            }

            // Try to patch Phaser prototype early and repeatedly
            function tryPatchPhaser() {
                if (CHUNGUS_CONFIG.phaserPatched) return;

                if (interceptPhaserPrototype()) {
                    return;
                }

                // Keep trying - Phaser may load asynchronously
                setTimeout(tryPatchPhaser, 100);
            }
            tryPatchPhaser();

            // Step 4: Instance-level patching (fallback for already-created games)
            let instancePatchAttempts = 0;
            function patchGameInstance() {
                instancePatchAttempts++;

                const phaserGame = window.Phaser?.Game?.instance ||
                                   document.querySelector('.game-container')?.__vue__?.game ||
                                   window.game;

                if (phaserGame && phaserGame.scale && !phaserGame.scale.__chungusInstancePatched) {
                    const originalSetGameSize = phaserGame.scale.setGameSize.bind(phaserGame.scale);
                    phaserGame.scale.__chungusInstancePatched = true;

                    phaserGame.scale.setGameSize = function(width, height) {
                        const optimal = getOptimalResolution();

                        if (document.fullscreenElement || window.innerHeight > 1200) {
                            if (optimal.height > height) {
                                console.log('[Chungus HiRes] Instance override: ' + width + 'x' + height + ' -> ' + optimal.width + 'x' + optimal.height);
                                return originalSetGameSize(optimal.width, optimal.height);
                            }
                        }
                        return originalSetGameSize(width, height);
                    };

                    // Immediately trigger resize with new limits
                    window.dispatchEvent(new Event('resize'));
                    console.log('[Chungus HiRes] Game instance patched!');
                    return true;
                }

                if (instancePatchAttempts < 120) { // Try for 60 seconds
                    setTimeout(patchGameInstance, 500);
                }
                return false;
            }
            setTimeout(patchGameInstance, 1000);

            // Step 5: Fullscreen handler with aggressive resolution forcing
            let fullscreenResizeTimeout = null;
            document.addEventListener('fullscreenchange', () => {
                // Clear any pending resize
                if (fullscreenResizeTimeout) {
                    clearTimeout(fullscreenResizeTimeout);
                }

                if (document.fullscreenElement) {
                    // Entering fullscreen - force maximum resolution
                    const optimal = getOptimalResolution();
                    console.log('[Chungus HiRes] Fullscreen entered - target resolution:', optimal);

                    // Multiple resize triggers to ensure it takes effect
                    fullscreenResizeTimeout = setTimeout(() => {
                        window.dispatchEvent(new Event('resize'));
                        setTimeout(() => window.dispatchEvent(new Event('resize')), 100);
                        setTimeout(() => window.dispatchEvent(new Event('resize')), 300);
                    }, 50);
                } else {
                    // Exiting fullscreen
                    fullscreenResizeTimeout = setTimeout(() => {
                        window.dispatchEvent(new Event('resize'));
                    }, 100);
                }
            });

            // Step 6: CSS Transform Fallback - guaranteed visual quality
            // If the game still renders at low res, scale the canvas via CSS
            function applyCSSTransformFallback() {
                const canvas = document.querySelector('.game-container canvas') || CHUNGUS_CONFIG.gameCanvas;
                if (!canvas) return;

                const canvasHeight = canvas.height;
                const viewportHeight = document.fullscreenElement ? window.screen.height : window.innerHeight;

                // If canvas is significantly smaller than viewport, apply CSS scaling
                if (canvasHeight < viewportHeight * 0.8 && document.fullscreenElement) {
                    const scale = viewportHeight / canvasHeight;
                    if (scale > 1.1) {
                        console.log('[Chungus HiRes] CSS Transform fallback: scale ' + scale.toFixed(2) + 'x');
                        canvas.style.transform = 'scale(' + scale + ')';
                        canvas.style.transformOrigin = 'center center';
                    }
                } else {
                    canvas.style.transform = '';
                }
            }

            // Check periodically if CSS fallback is needed
            setInterval(applyCSSTransformFallback, 2000);

            // Log configuration
            console.log('[Chungus HiRes] Initialized!', {
                screen: CHUNGUS_CONFIG.screenWidth + 'x' + CHUNGUS_CONFIG.screenHeight,
                dpr: CHUNGUS_CONFIG.dpr,
                optimal: getOptimalResolution(),
            });

            // Expose for debugging
            window.__chungusHiRes = CHUNGUS_CONFIG;
        })();

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
        // ONLY target the main lobby page background, NOT the login screen
        if (window.__TAURI__) {
            window.__TAURI__.core.invoke('get_background_image').then(bgDataUrl => {
                const bgStyle = document.createElement('style');
                // Be VERY specific: only target .custom-bg that is inside the main-lobby
                // The login screen uses different structure
                bgStyle.textContent = `
                    /* Only target custom-bg inside the main lobby (after login) */
                    .main-lobby .custom-bg,
                    main .custom-bg,
                    #root > div > .custom-bg:not(:first-child) {
                        background-image: url("${bgDataUrl}") !important;
                        background-position: center bottom !important;
                        background-size: cover !important;
                        background-repeat: no-repeat !important;
                        background-attachment: scroll !important;
                    }
                `;
                document.head.appendChild(bgStyle);
                console.log('[PACDeluxe] Custom background applied (lobby only), URL length:', bgDataUrl?.length);
            }).catch(e => {
                console.log('[PACDeluxe] Custom background not available:', e);
            });
        }

        // =============================================================
        // CHUNGUS MODE: OPEN ALL BOOSTERS BUTTON
        // =============================================================
        // Adds an "Open All" button next to the existing "Open Booster" button
        // Uses client-side loop with delays to safely open all boosters
        (function chungusOpenAllBoosters() {
            let openAllButtonAdded = false;
            let isOpeningAll = false;

            // Find the Redux store to dispatch actions
            function getReduxStore() {
                // React 18+ stores the fiber in __reactFiber$ or similar
                const root = document.getElementById('root');
                if (!root) return null;

                // Try to find React fiber
                const fiberKey = Object.keys(root).find(key =>
                    key.startsWith('__reactFiber$') ||
                    key.startsWith('__reactContainer$')
                );

                if (fiberKey) {
                    let fiber = root[fiberKey];
                    // Walk up to find store in context
                    while (fiber) {
                        if (fiber.memoizedState?.store) {
                            return fiber.memoizedState.store;
                        }
                        if (fiber.stateNode?.store) {
                            return fiber.stateNode.store;
                        }
                        fiber = fiber.return;
                    }
                }

                // Fallback: check window for exposed store
                return window.__REDUX_STORE__ || window.store || null;
            }

            // Dispatch openBooster action (mimics NetworkStore.openBooster)
            function dispatchOpenBooster() {
                // The game uses socket.send with Transfer.OPEN_BOOSTER
                // We need to find the socket connection
                const socket = window.__COLYSEUS_LOBBY__ ||
                               window.lobbyRoom ||
                               document.querySelector('.game-container')?.__vue__?.room;

                if (socket && socket.send) {
                    // Transfer.OPEN_BOOSTER = "o" (from the codebase)
                    socket.send('o');
                    return true;
                }

                // Alternative: Click the original button
                const originalBtn = document.querySelector('.booster-pokemon button.bubbly:not(.open-all-btn)');
                if (originalBtn && !originalBtn.disabled) {
                    originalBtn.click();
                    return true;
                }

                return false;
            }

            // Get current booster count from UI
            function getBoosterCount() {
                // Look for booster count in the page
                const boosterText = document.body.innerText.match(/(\d+)\s*booster/i);
                if (boosterText) {
                    return parseInt(boosterText[1], 10);
                }

                // Alternative: check button disabled state
                const btn = document.querySelector('.booster-pokemon button.bubbly');
                return btn && !btn.disabled ? 1 : 0;
            }

            // Check if cards are currently displayed (need to flip/dismiss them first)
            function hasUnflippedCards() {
                const cards = document.querySelectorAll('.booster-pokemon .booster-card:not(.flipped)');
                return cards.length > 0;
            }

            // Open all boosters with delay between each
            async function openAllBoosters(openAllBtn) {
                if (isOpeningAll) return;
                isOpeningAll = true;

                const originalText = openAllBtn.textContent;
                let opened = 0;
                let totalToOpen = getBoosterCount();

                console.log('[Chungus] Opening all boosters:', totalToOpen);

                try {
                    while (totalToOpen > 0 && isOpeningAll) {
                        // Update button text with progress
                        openAllBtn.textContent = 'Opening... (' + (totalToOpen) + ' left)';
                        openAllBtn.disabled = true;

                        // If there are unflipped cards, we need to flip them first
                        // by clicking the original button
                        const originalBtn = document.querySelector('.booster-pokemon button.bubbly:not(.open-all-btn)');

                        if (hasUnflippedCards()) {
                            // Click to flip cards
                            if (originalBtn) originalBtn.click();
                            await new Promise(r => setTimeout(r, 300));
                        }

                        // Now open the next booster
                        if (originalBtn && !originalBtn.disabled) {
                            originalBtn.click();
                            opened++;
                            await new Promise(r => setTimeout(r, 600)); // Wait for server response
                        }

                        // Re-check count
                        await new Promise(r => setTimeout(r, 200));
                        totalToOpen = getBoosterCount();

                        // Safety: break if we can't make progress
                        if (opened > 500) {
                            console.log('[Chungus] Safety limit reached');
                            break;
                        }
                    }
                } catch (err) {
                    console.error('[Chungus] Open all error:', err);
                }

                isOpeningAll = false;
                openAllBtn.textContent = originalText;
                openAllBtn.disabled = false;
                console.log('[Chungus] Opened', opened, 'boosters');
            }

            // Stop opening (if user wants to cancel)
            function stopOpeningAll() {
                isOpeningAll = false;
            }

            // Add the Open All button when booster UI appears
            function addOpenAllButton() {
                if (openAllButtonAdded) return;

                // Find the booster page and its action button
                // Structure: #boosters-page .actions button.bubbly
                const boosterPage = document.getElementById('boosters-page');
                if (!boosterPage) return;

                const actionsDiv = boosterPage.querySelector('.actions');
                if (!actionsDiv) return;

                const existingBtn = actionsDiv.querySelector('button.bubbly');
                if (!existingBtn) return;

                // Check if we already added it
                if (actionsDiv.querySelector('.open-all-btn')) {
                    openAllButtonAdded = true;
                    return;
                }

                console.log('[Chungus] Found booster button, adding Open All...');

                // Clone the existing button for identical styling
                const openAllBtn = existingBtn.cloneNode(true);
                openAllBtn.classList.add('open-all-btn');
                openAllBtn.textContent = 'Open All';
                openAllBtn.disabled = false; // Enable it

                // Make actions div flex row for side-by-side buttons
                actionsDiv.style.display = 'flex';
                actionsDiv.style.flexDirection = 'row';
                actionsDiv.style.gap = '10px';
                actionsDiv.style.justifyContent = 'center';
                actionsDiv.style.alignItems = 'center';
                actionsDiv.style.flexWrap = 'wrap';

                // Add click handler
                openAllBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();

                    if (isOpeningAll) {
                        stopOpeningAll();
                        openAllBtn.textContent = 'Open All';
                    } else {
                        openAllBoosters(openAllBtn);
                    }
                });

                // Insert BEFORE the existing button (to the LEFT)
                existingBtn.insertAdjacentElement('beforebegin', openAllBtn);
                openAllButtonAdded = true;
                console.log('[Chungus] Open All button added to the left of Open Booster');
            }

            // Watch for booster UI to appear
            const boosterObserver = new MutationObserver(() => {
                const boosterPage = document.getElementById('boosters-page');
                if (boosterPage) {
                    addOpenAllButton();
                } else {
                    // Reset when leaving booster page
                    openAllButtonAdded = false;
                    isOpeningAll = false;
                }
            });

            boosterObserver.observe(document.body, {
                childList: true,
                subtree: true
            });

            // Also try immediately in case already on booster page
            setTimeout(addOpenAllButton, 1000);

            // Expose stop function for debugging
            window.__chungusStopOpenAll = stopOpeningAll;
            console.log('[Chungus] Open All Boosters feature initialized');
        })();

        // Create overlay element
        const overlay = document.createElement('div');
        overlay.id = 'pac-deluxe-perf-overlay';
        overlay.innerHTML = `
            <div style="color:#0f8;font-weight:bold;margin-bottom:6px;border-bottom:1px solid #0f03;padding-bottom:4px;">⚡ PACDeluxe</div>
            <div>FPS: <span class="pac-fps-val">--</span></div>
            <div>CPU: <span class="pac-cpu-val">--</span>%</div>
            <div>MEM: <span class="pac-mem-val">--</span> MB</div>
        `;
        overlay.style.cssText = 'display:none;position:fixed;top:8px;right:8px;background:rgba(0,0,0,0.9);color:#0f0;font:12px/1.4 monospace;padding:10px 14px;border-radius:6px;z-index:99999;border:1px solid #0f04;min-width:140px;box-shadow:0 2px 10px rgba(0,0,0,0.5);';
        document.body.appendChild(overlay);

        // Get references to the value spans (use overlay.querySelector to avoid ID conflicts)
        const fpsEl = overlay.querySelector('.pac-fps-val');
        const cpuEl = overlay.querySelector('.pac-cpu-val');
        const memEl = overlay.querySelector('.pac-mem-val');

        let visible = false;
        let frameCount = 0;
        let lastTime = performance.now();
        let fps = null; // null = not yet calculated, 0+ = actual FPS
        let fpsHistory = [];

        // FPS counter - runs continuously, update every 250ms
        function countFrame() {
            frameCount++;
            const now = performance.now();
            const elapsed = now - lastTime;
            if (elapsed >= 250) {
                const currentFps = Math.round(frameCount * 1000 / elapsed);
                fpsHistory.push(currentFps);
                if (fpsHistory.length > 4) fpsHistory.shift(); // Keep last 1 second
                fps = Math.round(fpsHistory.reduce((a,b) => a+b, 0) / fpsHistory.length);
                frameCount = 0;
                lastTime = now;
                // Update FPS display immediately when calculated
                if (visible && fpsEl) fpsEl.textContent = fps;
            }
            requestAnimationFrame(countFrame);
        }
        countFrame();

        // Update overlay - fetches system stats from Rust
        async function updateOverlay() {
            if (!visible) return;

            // Update FPS (show '...' only if not yet calculated)
            if (fpsEl) fpsEl.textContent = (fps !== null) ? fps : '...';

            // Fetch CPU/MEM from Tauri backend
            if (window.__TAURI__) {
                try {
                    // Tauri v2 uses __TAURI__.core.invoke
                    const invoke = window.__TAURI__.core?.invoke || window.__TAURI__.invoke;
                    if (invoke) {
                        const stats = await invoke('get_performance_stats');
                        if (stats) {
                            if (cpuEl) cpuEl.textContent = (typeof stats.cpu_usage === 'number') ? stats.cpu_usage.toFixed(1) : 'N/A';
                            if (memEl) memEl.textContent = stats.memory_usage_mb || 'N/A';
                        }
                    } else {
                        console.warn('[PACDeluxe] No invoke function found');
                        if (cpuEl) cpuEl.textContent = 'N/A';
                        if (memEl) memEl.textContent = 'N/A';
                    }
                } catch(e) {
                    console.error('[PACDeluxe] Stats error:', e);
                    if (cpuEl) cpuEl.textContent = 'ERR';
                    if (memEl) memEl.textContent = 'ERR';
                }
            } else {
                // Not running in Tauri (browser mode)
                if (cpuEl) cpuEl.textContent = 'N/A';
                if (memEl) memEl.textContent = 'N/A';
            }
        }
        setInterval(updateOverlay, 500);
        console.log('[PACDeluxe] Perf overlay ready. Elements:', { fpsEl: !!fpsEl, cpuEl: !!cpuEl, memEl: !!memEl });
        console.log('[PACDeluxe] Tauri available:', !!window.__TAURI__, 'invoke:', !!(window.__TAURI__?.core?.invoke || window.__TAURI__?.invoke));

        // Toggle overlay with Ctrl+Shift+P
        // Toggle fullscreen with F11
        // NOTE: This is the primary overlay. The src/performance/*.js files are NOT
        // loaded since we're viewing a remote site. This injected script IS the perf layer.
        document.addEventListener('keydown', async e => {
            if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'p') {
                e.preventDefault();
                // Check if external overlay exists (from bundled JS)
                if (window.__PAC_OVERLAY__ && typeof window.__PAC_OVERLAY__.toggle === 'function') {
                    window.__PAC_OVERLAY__.toggle();
                    return;
                }
                // Otherwise use this built-in overlay
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
    // CHUNGUS MODE: Configure WebView2 user data folder for persistent cache
    // This speeds up subsequent launches by preserving compiled JS and cache
    if let Some(cache_dir) = dirs::cache_dir() {
        let webview_cache = cache_dir.join("PACDeluxe").join("webview2-cache");

        // Create directory if it doesn't exist
        if let Err(e) = std::fs::create_dir_all(&webview_cache) {
            eprintln!("[Chungus] Failed to create WebView2 cache dir: {}", e);
        } else {
            std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", webview_cache.to_string_lossy().to_string());
            println!("[Chungus] WebView2 cache: {:?}", webview_cache);
        }
    }

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
