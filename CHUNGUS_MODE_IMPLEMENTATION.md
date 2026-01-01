# CHUNGUS MODE - Advanced Performance Optimization Implementation Guide

## Agent Instructions

**IMPORTANT: Read this entire document before beginning work.**

When you receive instructions to implement this guide, follow these steps:

### Step 1: Create the Branch
```bash
cd pokemonautochessdeluxe
git checkout -b chungus-mode
```

### Step 2: Implementation Order
Work through the sections below in the order specified by the priority numbers. Each section contains:
- **Context**: Why this optimization matters
- **Files to Modify/Create**: Exact file paths
- **Code**: Complete implementation code
- **Verification**: How to confirm it works

### Step 3: Commit Strategy
Make atomic commits after each major section:
```bash
git add -A && git commit -m "feat(chungus): [section name] - [brief description]"
```

---

## Priority 1: WebView2 GPU Acceleration Flags

### Context
WebView2 defaults to conservative GPU settings. Forcing hardware acceleration and enabling advanced features significantly improves rendering performance.

### Files to Modify
- `src-tauri/src/main.rs`

### Implementation

Find the `main()` function and add these environment variables **before** `tauri::Builder`:

```rust
// Add at the very start of main(), before any Tauri initialization
fn main() {
    // CHUNGUS MODE: Force GPU acceleration and advanced rendering features
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

    // Rest of existing main() code...
```

### Verification
- Launch the app and press Ctrl+Shift+P to open overlay
- FPS should be more stable with fewer dropped frames
- Check Windows Task Manager > GPU tab to confirm GPU utilization

---

## Priority 2: Canvas Context Optimization Hints

### Context
Intercepting canvas context creation allows us to inject performance hints before Phaser initializes its rendering pipeline.

### Files to Modify
- `src-tauri/src/main.rs` (add to OVERLAY_SCRIPT)

### Implementation

In `main.rs`, locate the `OVERLAY_SCRIPT` constant and add this block **at the very beginning** (before any other code):

```rust
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

    // ... rest of existing OVERLAY_SCRIPT code continues here ...
"#;
```

**Note:** Merge this with the existing OVERLAY_SCRIPT content - don't replace it entirely.

### Verification
- Open browser DevTools (F12) in the app
- Look for `[Chungus] Canvas context optimized` messages in console
- Rendering should feel smoother

---

## Priority 3: Predictive Asset Prefetching

### Context
The game has predictable phase transitions. Prefetching assets for the next phase during idle time eliminates loading stutters.

### Files to Create
- `src/performance/asset-prefetcher.js`

### Files to Modify
- `src/index.js`

### Implementation

**Create `src/performance/asset-prefetcher.js`:**

```javascript
/**
 * CHUNGUS MODE: Predictive Asset Prefetcher
 * Preloads assets for upcoming game phases during idle time
 */

// Asset patterns needed for each game phase
const PHASE_ASSET_PATTERNS = {
    // Picking phase - need shop and champion assets
    pick: [
        '/assets/avatar',
        '/assets/emotions',
        '/assets/item',
        '/assets/types',
    ],
    // Battle phase - need ability and effect assets
    fight: [
        '/assets/abilities',
        '/assets/attacks',
        '/assets/status',
    ],
    // Carousel/minigame phases
    minigame: [
        '/assets/item',
        '/assets/portal',
    ],
};

// Map of phase transitions (current -> next likely phases)
const PHASE_TRANSITIONS = {
    'pick': ['fight'],
    'fight': ['pick', 'minigame'],
    'minigame': ['pick'],
};

export class AssetPrefetcher {
    constructor(assetCache) {
        this.cache = assetCache;
        this.currentPhase = null;
        this.prefetchedUrls = new Set();
        this.isEnabled = true;
        this.observer = null;
        this.prefetchQueue = [];
        this.isPrefetching = false;
    }

    /**
     * Initialize the prefetcher and start monitoring game state
     */
    init() {
        this.setupGameStateObserver();
        console.log('[Chungus Prefetcher] Initialized');
        return this;
    }

    /**
     * Monitor DOM for game phase changes
     */
    setupGameStateObserver() {
        // Watch for phase indicator elements in the game UI
        this.observer = new MutationObserver((mutations) => {
            this.detectPhaseChange();
        });

        // Start observing once game container exists
        const startObserving = () => {
            const gameContainer = document.querySelector('#game') ||
                                  document.querySelector('.game-container') ||
                                  document.body;

            this.observer.observe(gameContainer, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['class', 'data-phase'],
            });
        };

        if (document.readyState === 'complete') {
            startObserving();
        } else {
            window.addEventListener('load', startObserving);
        }
    }

    /**
     * Detect current game phase from DOM state
     */
    detectPhaseChange() {
        let detectedPhase = null;

        // Try to detect phase from various UI indicators
        const phaseIndicators = {
            'pick': ['.shop-container', '.nes-container.shop', '[class*="shop"]'],
            'fight': ['.battle-indicator', '[class*="fight"]', '[class*="battle"]'],
            'minigame': ['.carousel', '.minigame', '[class*="carousel"]'],
        };

        for (const [phase, selectors] of Object.entries(phaseIndicators)) {
            for (const selector of selectors) {
                if (document.querySelector(selector)) {
                    detectedPhase = phase;
                    break;
                }
            }
            if (detectedPhase) break;
        }

        if (detectedPhase && detectedPhase !== this.currentPhase) {
            this.onPhaseChange(detectedPhase);
        }
    }

    /**
     * Handle phase transition - queue prefetch for next phases
     */
    onPhaseChange(newPhase) {
        const previousPhase = this.currentPhase;
        this.currentPhase = newPhase;

        console.log(`[Chungus Prefetcher] Phase: ${previousPhase} -> ${newPhase}`);

        if (!this.isEnabled) return;

        // Get likely next phases
        const nextPhases = PHASE_TRANSITIONS[newPhase] || [];

        // Queue assets for prefetching
        nextPhases.forEach(nextPhase => {
            const patterns = PHASE_ASSET_PATTERNS[nextPhase] || [];
            patterns.forEach(pattern => {
                this.queuePrefetch(pattern);
            });
        });

        // Start prefetching during idle time
        this.schedulePrefetch();
    }

    /**
     * Add URL pattern to prefetch queue
     */
    queuePrefetch(urlPattern) {
        if (!this.prefetchQueue.includes(urlPattern)) {
            this.prefetchQueue.push(urlPattern);
        }
    }

    /**
     * Schedule prefetching during browser idle time
     */
    schedulePrefetch() {
        if (this.isPrefetching || this.prefetchQueue.length === 0) return;

        const prefetchTask = (deadline) => {
            this.isPrefetching = true;

            while (this.prefetchQueue.length > 0 && deadline.timeRemaining() > 5) {
                const pattern = this.prefetchQueue.shift();
                this.prefetchPattern(pattern);
            }

            this.isPrefetching = false;

            // Continue if more items in queue
            if (this.prefetchQueue.length > 0) {
                requestIdleCallback(prefetchTask, { timeout: 3000 });
            }
        };

        if ('requestIdleCallback' in window) {
            requestIdleCallback(prefetchTask, { timeout: 3000 });
        } else {
            // Fallback for older browsers
            setTimeout(() => prefetchTask({ timeRemaining: () => 50 }), 100);
        }
    }

    /**
     * Prefetch assets matching a URL pattern
     */
    async prefetchPattern(urlPattern) {
        // Generate likely asset URLs based on pattern
        // This is a simplified version - in production, use an asset manifest
        const baseUrl = window.location.origin;
        const testUrls = [
            `${baseUrl}${urlPattern}`,
        ];

        for (const url of testUrls) {
            if (this.prefetchedUrls.has(url)) continue;

            try {
                // Use link preload for browser-level optimization
                const link = document.createElement('link');
                link.rel = 'prefetch';
                link.href = url;
                link.as = this.getAssetType(url);
                document.head.appendChild(link);

                this.prefetchedUrls.add(url);
            } catch (e) {
                // Silently ignore prefetch failures
            }
        }
    }

    /**
     * Determine asset type from URL for proper prefetch hints
     */
    getAssetType(url) {
        if (/\.(png|jpg|jpeg|gif|webp|svg)$/i.test(url)) return 'image';
        if (/\.(mp3|ogg|wav|m4a)$/i.test(url)) return 'audio';
        if (/\.(json)$/i.test(url)) return 'fetch';
        if (/\.(js)$/i.test(url)) return 'script';
        if (/\.(css)$/i.test(url)) return 'style';
        return 'fetch';
    }

    /**
     * Get prefetcher statistics
     */
    getStats() {
        return {
            enabled: this.isEnabled,
            currentPhase: this.currentPhase,
            prefetchedCount: this.prefetchedUrls.size,
            queueLength: this.prefetchQueue.length,
            isPrefetching: this.isPrefetching,
        };
    }

    /**
     * Enable/disable prefetching
     */
    setEnabled(enabled) {
        this.isEnabled = enabled;
        console.log(`[Chungus Prefetcher] ${enabled ? 'Enabled' : 'Disabled'}`);
    }

    /**
     * Cleanup
     */
    destroy() {
        if (this.observer) {
            this.observer.disconnect();
        }
        this.prefetchQueue = [];
        this.prefetchedUrls.clear();
    }
}

export default AssetPrefetcher;
```

**Modify `src/index.js` to include the prefetcher:**

Add import at top:
```javascript
import { AssetPrefetcher } from './performance/asset-prefetcher.js';
```

Add to initialization (in `initializePerformanceOptimizations` function):
```javascript
// Initialize asset prefetcher
let assetPrefetcher = null;
try {
    assetPrefetcher = new AssetPrefetcher(assetCache);
    assetPrefetcher.init();
    console.log('[Chungus] Asset prefetcher initialized');
} catch (e) {
    console.warn('[Chungus] Asset prefetcher failed to initialize:', e);
}
```

Add to exports:
```javascript
export { AssetPrefetcher, assetPrefetcher };
```

### Verification
- Open DevTools console
- Look for `[Chungus Prefetcher]` messages during gameplay
- Phase transitions should feel smoother

---

## Priority 4: Core Parking and CPU Optimizations

### Context
Windows aggressively parks CPU cores to save power. This causes latency spikes when cores wake up. Disabling this ensures consistent performance.

### Files to Modify
- `src-tauri/src/performance.rs`

### Implementation

Add these functions to `performance.rs`:

```rust
use windows::Win32::System::Threading::*;
use windows::Win32::System::Power::*;

/// CHUNGUS MODE: Disable CPU core parking for consistent performance
pub fn disable_core_parking() {
    use std::process::Command;

    // Use powercfg to disable core parking on the active power scheme
    // This is the most reliable cross-system method
    let commands = [
        // Disable core parking (0 = 0% parked)
        ("powercfg", &["-setacvalueindex", "scheme_current", "sub_processor", "CPMINCORES", "100"]),
        ("powercfg", &["-setdcvalueindex", "scheme_current", "sub_processor", "CPMINCORES", "100"]),
        // Set minimum processor state to 100%
        ("powercfg", &["-setacvalueindex", "scheme_current", "sub_processor", "PROCTHROTTLEMIN", "100"]),
        ("powercfg", &["-setdcvalueindex", "scheme_current", "sub_processor", "PROCTHROTTLEMIN", "100"]),
        // Apply changes
        ("powercfg", &["-setactive", "scheme_current"]),
    ];

    for (cmd, args) in commands {
        match Command::new(cmd).args(args).output() {
            Ok(output) => {
                if !output.status.success() {
                    tracing::warn!(
                        "[Chungus] powercfg command failed: {} {:?}",
                        cmd,
                        String::from_utf8_lossy(&output.stderr)
                    );
                }
            }
            Err(e) => {
                tracing::warn!("[Chungus] Failed to run powercfg: {}", e);
            }
        }
    }

    tracing::info!("[Chungus] Core parking disabled");
}

/// CHUNGUS MODE: Set process to high performance mode
pub fn set_high_performance_mode() {
    unsafe {
        let process = GetCurrentProcess();

        // Set process priority class to HIGH (one below REALTIME)
        if SetPriorityClass(process, HIGH_PRIORITY_CLASS).is_err() {
            tracing::warn!("[Chungus] Failed to set HIGH_PRIORITY_CLASS, trying ABOVE_NORMAL");
            let _ = SetPriorityClass(process, ABOVE_NORMAL_PRIORITY_CLASS);
        }

        // Disable priority boost (more consistent timing)
        let _ = SetProcessPriorityBoost(process, true);

        tracing::info!("[Chungus] Process priority elevated");
    }
}

/// CHUNGUS MODE: Request high QoS for the game thread
pub fn set_thread_qos() {
    unsafe {
        let thread = GetCurrentThread();

        // Set thread priority to highest non-realtime level
        let _ = SetThreadPriority(thread, THREAD_PRIORITY_HIGHEST);

        // Disable dynamic thread priority boosting for consistency
        let _ = SetThreadPriorityBoost(thread, true);

        tracing::info!("[Chungus] Thread QoS configured");
    }
}
```

**Modify `apply_system_optimizations()` to call these:**

```rust
pub fn apply_system_optimizations() {
    tracing::info!("[Chungus] Applying system optimizations...");

    // Existing optimizations...
    enable_dpi_awareness();

    // CHUNGUS MODE additions
    disable_core_parking();
    set_high_performance_mode();
    set_thread_qos();
    disable_power_throttling();

    // Existing timer resolution code...
    set_timer_resolution();

    // Start WebView2 optimizer
    start_webview2_optimizer();

    tracing::info!("[Chungus] System optimizations applied");
}
```

### Verification
- Open Task Manager > Details tab
- Find PACDeluxe.exe, check Priority column shows "High" or "Above Normal"
- CPU usage should be more consistent during gameplay

---

## Priority 5: Frame Time Histogram and Percentile Tracking

### Context
Average FPS hides stutters. A frame histogram shows the true distribution, letting users see their p99 (worst 1%) frame times.

### Files to Modify
- `src/performance/frame-monitor.js`

### Implementation

Add this class to `frame-monitor.js`:

```javascript
/**
 * CHUNGUS MODE: Frame Time Histogram for percentile tracking
 */
class FrameHistogram {
    constructor(maxMs = 100, bucketCount = 100) {
        this.buckets = new Uint32Array(bucketCount);
        this.maxMs = maxMs;
        this.bucketSize = maxMs / bucketCount;
        this.totalSamples = 0;
        this.overflow = 0; // Frames > maxMs
    }

    /**
     * Record a frame time
     */
    record(frameTimeMs) {
        if (frameTimeMs >= this.maxMs) {
            this.overflow++;
        } else {
            const bucket = Math.floor(frameTimeMs / this.bucketSize);
            this.buckets[bucket]++;
        }
        this.totalSamples++;
    }

    /**
     * Get the frame time at a given percentile (0-1)
     */
    percentile(p) {
        if (this.totalSamples === 0) return 0;

        const target = Math.floor(this.totalSamples * p);
        let cumulative = 0;

        for (let i = 0; i < this.buckets.length; i++) {
            cumulative += this.buckets[i];
            if (cumulative >= target) {
                return (i + 0.5) * this.bucketSize; // Return bucket midpoint
            }
        }

        // If we get here, it's in overflow
        return this.maxMs;
    }

    /**
     * Get common percentiles
     */
    getPercentiles() {
        return {
            p50: this.percentile(0.50),
            p90: this.percentile(0.90),
            p95: this.percentile(0.95),
            p99: this.percentile(0.99),
            overflow: this.overflow,
            total: this.totalSamples,
        };
    }

    /**
     * Reset histogram
     */
    reset() {
        this.buckets.fill(0);
        this.totalSamples = 0;
        this.overflow = 0;
    }
}
```

**Modify the `FrameMonitor` class to use the histogram:**

Add to constructor:
```javascript
constructor() {
    // ... existing code ...

    // CHUNGUS MODE: Frame histogram for percentile tracking
    this.histogram = new FrameHistogram(100, 100);
    this.stutterLog = [];
    this.stutterThreshold = 50; // ms - frames longer than this are "stutters"
}
```

Modify the frame callback to record to histogram:
```javascript
frameCallback(timestamp) {
    if (this.lastTimestamp !== null) {
        const frameTime = timestamp - this.lastTimestamp;

        // Existing frame time tracking...
        this.frameTimes.push(frameTime);
        if (this.frameTimes.length > this.maxSamples) {
            this.frameTimes.shift();
        }

        // CHUNGUS MODE: Record to histogram
        this.histogram.record(frameTime);

        // CHUNGUS MODE: Detect and log stutters
        if (frameTime > this.stutterThreshold) {
            this.logStutter(frameTime, timestamp);
        }

        // ... rest of existing code ...
    }

    this.lastTimestamp = timestamp;

    if (this.isRunning) {
        this.rafId = requestAnimationFrame((ts) => this.frameCallback(ts));
    }
}
```

Add stutter logging:
```javascript
/**
 * CHUNGUS MODE: Log stutter event with context
 */
logStutter(frameTime, timestamp) {
    const stutterEvent = {
        timestamp: timestamp,
        frameTime: frameTime,
        time: new Date().toISOString(),
    };

    // Add memory info if available
    if (performance.memory) {
        stutterEvent.heapUsed = performance.memory.usedJSHeapSize;
        stutterEvent.heapTotal = performance.memory.totalJSHeapSize;
    }

    this.stutterLog.push(stutterEvent);

    // Keep only last 100 stutters
    if (this.stutterLog.length > 100) {
        this.stutterLog.shift();
    }

    console.warn(`[Chungus] Stutter detected: ${frameTime.toFixed(1)}ms`, stutterEvent);
}
```

Update `getMetrics()` to include percentiles:
```javascript
getMetrics() {
    // ... existing metrics code ...

    return {
        currentFps: this.calculateFps(),
        avgFrameTime: this.calculateAverageFrameTime(),
        droppedFrames: this.droppedFrames,
        jitter: this.calculateJitter(),
        totalFrames: this.totalFrames,
        // CHUNGUS MODE additions
        percentiles: this.histogram.getPercentiles(),
        recentStutters: this.stutterLog.slice(-10),
        stutterCount: this.stutterLog.length,
    };
}
```

### Verification
- Call `frameMonitor.getMetrics()` in console
- Check `percentiles` object for p50/p90/p95/p99 values
- p99 should ideally be under 20ms for smooth gameplay

---

## Priority 6: Memory Working Set Locking

### Context
Windows may page out game memory to disk, causing massive stutters when accessed. Locking the working set prevents this.

### Files to Modify
- `src-tauri/src/performance.rs`

### Implementation

Add to `performance.rs`:

```rust
/// CHUNGUS MODE: Lock process working set to prevent paging
pub fn lock_working_set() {
    unsafe {
        use windows::Win32::System::Memory::*;
        use windows::Win32::System::Threading::GetCurrentProcess;

        let process = GetCurrentProcess();

        // Set minimum working set to 256MB, maximum to 1GB
        let min_size = 256 * 1024 * 1024; // 256 MB
        let max_size = 1024 * 1024 * 1024; // 1 GB

        match SetProcessWorkingSetSizeEx(
            process,
            min_size,
            max_size,
            QUOTA_LIMITS_HARDWS_MIN_ENABLE | QUOTA_LIMITS_HARDWS_MAX_DISABLE,
        ) {
            Ok(_) => {
                tracing::info!(
                    "[Chungus] Working set locked: min={}MB, max={}MB",
                    min_size / 1024 / 1024,
                    max_size / 1024 / 1024
                );
            }
            Err(e) => {
                tracing::warn!("[Chungus] Failed to lock working set: {:?}", e);
            }
        }
    }
}

/// CHUNGUS MODE: Disable memory compression for the process
pub fn disable_memory_compression() {
    unsafe {
        use windows::Win32::System::Memory::*;
        use windows::Win32::System::Threading::GetCurrentProcess;

        let process = GetCurrentProcess();

        // Empty the working set first (forces pages to be properly mapped)
        let _ = EmptyWorkingSet(process);

        tracing::info!("[Chungus] Memory compression handling configured");
    }
}
```

Add calls to `apply_system_optimizations()`:
```rust
pub fn apply_system_optimizations() {
    // ... existing code ...

    // CHUNGUS MODE: Memory optimizations
    lock_working_set();
    disable_memory_compression();

    // ... rest of existing code ...
}
```

### Verification
- Open Resource Monitor > Memory tab
- Find PACDeluxe.exe
- Working Set should stay relatively stable during gameplay

---

## Priority 7: DNS Prefetching

### Context
DNS resolution can add 20-50ms latency on first connection. Prefetching game server hostnames eliminates this.

### Files to Modify
- `src/index.js`

### Implementation

Add this function to `src/index.js`:

```javascript
/**
 * CHUNGUS MODE: Prefetch DNS for game servers
 */
function prefetchGameDNS() {
    const gameHosts = [
        'pokemon-auto-chess.com',
        'www.pokemon-auto-chess.com',
        // Colyseus servers (common regions)
        'us-west1-pokemon-auto-chess.colyseus.dev',
        'us-east1-pokemon-auto-chess.colyseus.dev',
        'europe-west1-pokemon-auto-chess.colyseus.dev',
        // Firebase
        'pokemon-auto-chess.firebaseapp.com',
        'pokemon-auto-chess.web.app',
        'firebaseinstallations.googleapis.com',
        'identitytoolkit.googleapis.com',
        // CDN / Assets
        'fonts.googleapis.com',
        'fonts.gstatic.com',
    ];

    gameHosts.forEach(host => {
        // DNS prefetch hint
        const dnsLink = document.createElement('link');
        dnsLink.rel = 'dns-prefetch';
        dnsLink.href = `//${host}`;
        document.head.appendChild(dnsLink);

        // Preconnect for likely connections
        const preconnectLink = document.createElement('link');
        preconnectLink.rel = 'preconnect';
        preconnectLink.href = `https://${host}`;
        preconnectLink.crossOrigin = 'anonymous';
        document.head.appendChild(preconnectLink);
    });

    console.log(`[Chungus] DNS prefetched for ${gameHosts.length} hosts`);
}
```

Call it during initialization:
```javascript
export async function initializePerformanceOptimizations() {
    console.log('[Chungus] Initializing performance optimizations...');

    // CHUNGUS MODE: Prefetch DNS immediately
    prefetchGameDNS();

    // ... rest of existing initialization ...
}
```

### Verification
- Open DevTools > Network tab
- First connection to game servers should show lower TTFB (Time To First Byte)

---

## Priority 8: WebView2 User Data Cache

### Context
WebView2 compiles JavaScript on first load. Persisting this cache makes subsequent launches faster.

### Files to Modify
- `src-tauri/src/main.rs`

### Implementation

Add at the start of `main()`:

```rust
fn main() {
    // CHUNGUS MODE: Configure WebView2 user data folder for persistent cache
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

    // ... existing WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS ...
    // ... rest of main() ...
}
```

Add `dirs` to Cargo.toml if not present:
```toml
[dependencies]
dirs = "5.0"
```

### Verification
- Check `%LOCALAPPDATA%\PACDeluxe\webview2-cache` exists after first run
- Second launch should be noticeably faster

---

## Priority 9: Network Jitter Tracking

### Context
RTT alone doesn't tell the full story. Network jitter (variation in latency) causes game state desync and rubber-banding.

### Files to Modify
- `src/performance/profiling-overlay.js`

### Implementation

Add this class to `profiling-overlay.js`:

```javascript
/**
 * CHUNGUS MODE: Network Jitter Tracker
 */
class NetworkJitterTracker {
    constructor(windowSize = 30) {
        this.samples = [];
        this.windowSize = windowSize;
    }

    addSample(rtt) {
        this.samples.push({
            rtt: rtt,
            timestamp: performance.now(),
        });

        if (this.samples.length > this.windowSize) {
            this.samples.shift();
        }
    }

    /**
     * Calculate jitter as mean absolute deviation between consecutive samples
     */
    getJitter() {
        if (this.samples.length < 2) return 0;

        let totalDiff = 0;
        for (let i = 1; i < this.samples.length; i++) {
            totalDiff += Math.abs(this.samples[i].rtt - this.samples[i - 1].rtt);
        }

        return totalDiff / (this.samples.length - 1);
    }

    /**
     * Get min/max/avg RTT
     */
    getStats() {
        if (this.samples.length === 0) {
            return { min: 0, max: 0, avg: 0, jitter: 0, samples: 0 };
        }

        const rtts = this.samples.map(s => s.rtt);
        const sum = rtts.reduce((a, b) => a + b, 0);

        return {
            min: Math.min(...rtts),
            max: Math.max(...rtts),
            avg: sum / rtts.length,
            jitter: this.getJitter(),
            samples: this.samples.length,
        };
    }

    reset() {
        this.samples = [];
    }
}
```

**Integrate with ProfilingOverlay:**

Add to constructor:
```javascript
constructor() {
    // ... existing code ...
    this.jitterTracker = new NetworkJitterTracker(30);
}
```

Modify the RTT update section in `updateOverlay()`:
```javascript
// When updating RTT display
const rtt = await this.measureRTT();
if (rtt !== null) {
    this.jitterTracker.addSample(rtt);
    const netStats = this.jitterTracker.getStats();

    // Update display to show jitter
    this.rttElement.textContent = `RTT: ${rtt}ms (±${netStats.jitter.toFixed(1)}ms)`;
}
```

### Verification
- Enable overlay with Ctrl+Shift+P
- RTT should now show jitter value: `RTT: 45ms (±3.2ms)`

---

## Priority 10: Input Pipeline Optimization

### Context
Browser input events go through multiple layers of processing. We can create a faster path for critical inputs.

### Files to Modify
- `src/performance/input-optimizer.js`

### Implementation

Add to `InputOptimizer` class:

```javascript
/**
 * CHUNGUS MODE: High-priority input fast path
 */
setupFastInputPath() {
    // Use pointer events for lower latency (bypasses legacy mouse events)
    const gameCanvas = document.querySelector('canvas');
    if (!gameCanvas) {
        console.warn('[Chungus] Canvas not found for fast input path');
        return;
    }

    // Enable pointer capture for smoother dragging
    gameCanvas.addEventListener('pointerdown', (e) => {
        if (e.button === 0) { // Left click
            gameCanvas.setPointerCapture(e.pointerId);
        }
    }, { passive: true });

    gameCanvas.addEventListener('pointerup', (e) => {
        if (gameCanvas.hasPointerCapture(e.pointerId)) {
            gameCanvas.releasePointerCapture(e.pointerId);
        }
    }, { passive: true });

    // Use coalesced events API for batch processing
    gameCanvas.addEventListener('pointermove', (e) => {
        if (e.getCoalescedEvents) {
            const coalescedEvents = e.getCoalescedEvents();
            if (coalescedEvents.length > 1) {
                this.stats.coalescedCount += coalescedEvents.length - 1;
            }
        }
    }, { passive: true });

    console.log('[Chungus] Fast input path configured');
}

/**
 * CHUNGUS MODE: Disable browser's built-in gesture handling
 */
disableBrowserGestures() {
    document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
    document.addEventListener('gesturechange', (e) => e.preventDefault(), { passive: false });
    document.addEventListener('gestureend', (e) => e.preventDefault(), { passive: false });

    // Disable context menu on canvas (right-click)
    const canvas = document.querySelector('canvas');
    if (canvas) {
        canvas.addEventListener('contextmenu', (e) => e.preventDefault(), { passive: false });
    }

    // Disable drag on images (prevents ghost images during drag)
    document.querySelectorAll('img').forEach(img => {
        img.draggable = false;
    });

    console.log('[Chungus] Browser gestures disabled');
}
```

Call these in the `init()` method:
```javascript
init() {
    // ... existing init code ...

    // CHUNGUS MODE: Enhanced input handling
    this.setupFastInputPath();
    this.disableBrowserGestures();

    return this;
}
```

### Verification
- Dragging pieces should feel more responsive
- No "ghost image" when dragging
- Right-click doesn't open context menu on game canvas

---

## Additional Enhancements

### A: Profiling Overlay Percentile Display

Update the overlay to show frame percentiles:

```javascript
// In profiling-overlay.js createOverlayElement()
// Add after FPS display
const p99Element = document.createElement('div');
p99Element.id = 'chungus-p99';
p99Element.style.cssText = 'font-size: 10px; color: #888;';
p99Element.textContent = 'p99: --ms';
container.appendChild(p99Element);
```

Update in `updateOverlay()`:
```javascript
// Update p99 display
const metrics = this.frameMonitor?.getMetrics();
if (metrics?.percentiles) {
    const p99El = document.getElementById('chungus-p99');
    if (p99El) {
        const p99 = metrics.percentiles.p99;
        const color = p99 < 20 ? '#0f0' : p99 < 33 ? '#ff0' : '#f00';
        p99El.style.color = color;
        p99El.textContent = `p99: ${p99.toFixed(1)}ms | stutters: ${metrics.stutterCount}`;
    }
}
```

### B: Startup Performance Logging

Add timing measurements to track optimization effectiveness:

```javascript
// In index.js
const startupMetrics = {
    scriptStart: performance.now(),
    events: [],
};

function logStartupEvent(name) {
    startupMetrics.events.push({
        name,
        time: performance.now(),
        delta: performance.now() - startupMetrics.scriptStart,
    });
    console.log(`[Chungus Startup] ${name}: ${startupMetrics.events.at(-1).delta.toFixed(1)}ms`);
}

// Call throughout initialization:
logStartupEvent('DNS prefetch complete');
logStartupEvent('Frame monitor initialized');
// etc.

// Export for debugging
window.__chungusStartupMetrics = startupMetrics;
```

---

## Final Checklist

After implementing all priorities, verify:

- [ ] App launches without errors
- [ ] Overlay shows FPS, p99, jitter
- [ ] Canvas rendering uses optimized settings
- [ ] Process runs at High priority
- [ ] WebView2 cache persists between launches
- [ ] DNS prefetching logs appear in console
- [ ] Stutter detection logs when frames drop
- [ ] Input feels more responsive
- [ ] Memory usage stays stable over time

### Commands to Run After Implementation

```bash
# Build and test
npm run build:frontend
npm run tauri:dev

# Check for errors
npm run lint

# Build release
npm run tauri:build
```

---

## Commit History (Expected)

After full implementation, git log should show:

```
feat(chungus): input pipeline optimization - fast path and gestures
feat(chungus): network jitter tracking
feat(chungus): webview2 cache persistence
feat(chungus): dns prefetching for game servers
feat(chungus): memory working set locking
feat(chungus): frame histogram and percentile tracking
feat(chungus): core parking and cpu optimizations
feat(chungus): predictive asset prefetching
feat(chungus): canvas context optimization hints
feat(chungus): webview2 gpu acceleration flags
chore: create chungus-mode branch
```

---

**END OF IMPLEMENTATION GUIDE**
