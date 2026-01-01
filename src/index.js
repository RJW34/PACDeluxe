/**
 * Pokemon Auto Chess Deluxe
 *
 * Native performance client for Pokemon Auto Chess.
 * This module provides performance optimizations ONLY.
 *
 * CRITICAL: No gameplay modifications.
 * All code in this module affects ONLY:
 * - Rendering performance
 * - Asset loading
 * - Input latency
 * - System resources
 */

// Performance modules
export { FrameMonitor, frameMonitor, getHighResTimestamp } from './performance/frame-monitor.js';
export { InputOptimizer, inputOptimizer, requestHighPriorityCallback, getInputTimestamp } from './performance/input-optimizer.js';
export { AssetCache, assetCache } from './performance/asset-cache.js';
export { ProfilingOverlay, profilingOverlay } from './performance/profiling-overlay.js';
export { AssetPrefetcher, assetPrefetcher, createAssetPrefetcher } from './performance/asset-prefetcher.js';

// CHUNGUS MODE: Startup metrics tracking
const startupMetrics = {
    scriptStart: typeof performance !== 'undefined' ? performance.now() : Date.now(),
    events: [],
};

function logStartupEvent(name) {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    startupMetrics.events.push({
        name,
        time: now,
        delta: now - startupMetrics.scriptStart,
    });
    console.log(`[Chungus Startup] ${name}: ${startupMetrics.events.at(-1).delta.toFixed(1)}ms`);
}

// Export for debugging
if (typeof window !== 'undefined') {
    window.__chungusStartupMetrics = startupMetrics;
}

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

// Bridge modules
export { TauriBridge, tauriBridge, isTauri } from './bridge/tauri-bridge.js';

/**
 * Initialize all performance optimizations
 * @param {Object} options - Configuration options
 */
export async function initializePerformanceOptimizations(options = {}) {
  console.log('[PAC Deluxe] Initializing performance optimizations...');
  logStartupEvent('Init start');

  // CHUNGUS MODE: Prefetch DNS immediately
  if (typeof document !== 'undefined') {
    prefetchGameDNS();
    logStartupEvent('DNS prefetch complete');
  }

  const {
    enableFrameMonitor = true,
    enableInputOptimizer = true,
    enableAssetCache = true,
    enableAssetPrefetcher = true,
    showProfilingOverlay = false,
  } = options;

  const status = {
    tauriBridge: false,
    frameMonitor: false,
    inputOptimizer: false,
    assetCache: false,
    assetPrefetcher: false,
    profilingOverlay: false,
  };

  // Initialize Tauri bridge
  try {
    const { tauriBridge } = await import('./bridge/tauri-bridge.js');
    await tauriBridge.init();
    status.tauriBridge = tauriBridge.hasNativeFeatures();
    if (!status.tauriBridge) {
      console.warn('[PAC Deluxe] Running in browser mode - native optimizations unavailable');
    }
  } catch (error) {
    console.error('[PAC Deluxe] Tauri bridge failed:', error.message);
  }

  // Start frame monitor for FPS/timing metrics
  if (enableFrameMonitor && typeof window !== 'undefined') {
    try {
      const { frameMonitor } = await import('./performance/frame-monitor.js');
      frameMonitor.start();
      status.frameMonitor = true;
    } catch (error) {
      console.error('[PAC Deluxe] Frame monitor failed:', error.message);
    }
  }

  // Initialize asset cache with fetch interception
  if (enableAssetCache) {
    try {
      const { assetCache } = await import('./performance/asset-cache.js');
      await assetCache.init({
        maxSizeMB: options.cacheSizeMB || 256,
      });
      status.assetCache = assetCache.isInitialized;
    } catch (error) {
      console.error('[PAC Deluxe] Asset cache failed:', error.message);
    }
  }

  // Initialize input optimizer
  if (enableInputOptimizer) {
    try {
      const { inputOptimizer } = await import('./performance/input-optimizer.js');
      inputOptimizer.init();
      status.inputOptimizer = inputOptimizer.isInitialized;
      logStartupEvent('Input optimizer initialized');
    } catch (error) {
      console.error('[PAC Deluxe] Input optimizer failed:', error.message);
    }
  }

  // CHUNGUS MODE: Initialize asset prefetcher
  if (enableAssetPrefetcher) {
    try {
      const { createAssetPrefetcher } = await import('./performance/asset-prefetcher.js');
      const prefetcher = createAssetPrefetcher(status.assetCache ? (await import('./performance/asset-cache.js')).assetCache : null);
      prefetcher.init();
      status.assetPrefetcher = true;
      logStartupEvent('Asset prefetcher initialized');
      console.log('[Chungus] Asset prefetcher initialized');
    } catch (error) {
      console.warn('[Chungus] Asset prefetcher failed to initialize:', error.message);
    }
  }

  // Show profiling overlay if requested
  if (showProfilingOverlay) {
    try {
      const { profilingOverlay } = await import('./performance/profiling-overlay.js');
      profilingOverlay.show();
      status.profilingOverlay = true;
    } catch (error) {
      console.error('[PAC Deluxe] Profiling overlay failed:', error.message);
    }
  }

  // Log initialization summary
  const activeFeatures = Object.entries(status)
    .filter(([_, v]) => v)
    .map(([k]) => k);
  const failedFeatures = Object.entries(status)
    .filter(([_, v]) => !v)
    .map(([k]) => k);

  console.log(`[PAC Deluxe] Initialized: ${activeFeatures.join(', ') || 'none'}`);
  if (failedFeatures.length > 0) {
    console.warn(`[PAC Deluxe] Not available: ${failedFeatures.join(', ')}`);
  }

  return {
    status,
    isNative: status.tauriBridge,
  };
}

/**
 * Get the current performance status
 * @returns {Object}
 */
export async function getPerformanceStatus() {
  const { tauriBridge } = await import('./bridge/tauri-bridge.js');
  const { frameMonitor } = await import('./performance/frame-monitor.js');
  const { inputOptimizer } = await import('./performance/input-optimizer.js');
  const { assetCache } = await import('./performance/asset-cache.js');

  return {
    isNative: tauriBridge.hasNativeFeatures(),
    nativeStats: await tauriBridge.getPerformanceStats(),
    frameMetrics: frameMonitor.getMetrics(),
    inputMetrics: inputOptimizer.getMetrics(),
    cacheStats: assetCache.getStats(),
  };
}

// Version information - synced from package.json at build time
// Fallback to hardcoded version if dynamic import fails
let _version = '1.0.0';
try {
  // In a build context, this would be replaced by the bundler
  if (typeof __VERSION__ !== 'undefined') {
    _version = __VERSION__;
  }
} catch {
  // Use default version
}

export const VERSION = _version;
export const BUILD_TYPE = typeof process !== 'undefined' && process.env.NODE_ENV === 'production'
  ? 'release'
  : 'debug';

// Only log in debug mode
if (BUILD_TYPE === 'debug') {
  console.log(`[PAC Deluxe] Version ${VERSION} (${BUILD_TYPE})`);
}
