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
export { NetworkMonitor, networkMonitor } from './performance/network-monitor.js';

// Bridge modules
export { TauriBridge, tauriBridge, isTauri } from './bridge/tauri-bridge.js';

/**
 * Initialize all performance optimizations
 * @param {Object} options - Configuration options
 */
export async function initializePerformanceOptimizations(options = {}) {
  console.log('[PAC Deluxe] Initializing performance optimizations...');

  const {
    enableFrameMonitor = true,
    enableInputOptimizer = true,
    enableAssetCache = true,
    showProfilingOverlay = false,
  } = options;

  const status = {
    tauriBridge: false,
    frameMonitor: false,
    inputOptimizer: false,
    assetCache: false,
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
    } catch (error) {
      console.error('[PAC Deluxe] Input optimizer failed:', error.message);
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
  const { networkMonitor } = await import('./performance/network-monitor.js');

  return {
    isNative: tauriBridge.hasNativeFeatures(),
    nativeStats: await tauriBridge.getPerformanceStats(),
    frameMetrics: frameMonitor.getMetrics(),
    inputMetrics: inputOptimizer.getMetrics(),
    cacheStats: assetCache.getStats(),
    networkMetrics: networkMonitor.getMetrics(),
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
