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
export { RenderOptimizer, renderOptimizer } from './performance/render-optimizer.js';
export { FramePacer, framePacer, getHighResTimestamp, smoothDelta } from './performance/frame-pacer.js';
export { InputOptimizer, inputOptimizer, requestHighPriorityCallback, getInputTimestamp } from './performance/input-optimizer.js';
export { AssetCache, assetCache } from './performance/asset-cache.js';
export { ProfilingOverlay, profilingOverlay } from './performance/profiling-overlay.js';

// Bridge modules
export { TauriBridge, tauriBridge, isTauri } from './bridge/tauri-bridge.js';

/**
 * Initialize all performance optimizations
 * @param {Object} options - Configuration options
 */
export async function initializePerformanceOptimizations(options = {}) {
  console.log('[PAC Deluxe] Initializing performance optimizations...');

  const {
    enableRenderOptimizer = true,
    enableFramePacer = false, // Optional, Phaser handles this
    enableInputOptimizer = true,
    enableAssetCache = true,
    showProfilingOverlay = false,
  } = options;

  // Initialize Tauri bridge
  const { tauriBridge } = await import('./bridge/tauri-bridge.js');
  await tauriBridge.init();

  // Render optimizer will be initialized when Phaser game is ready
  // It needs the game instance, so we expose it for manual init
  if (enableRenderOptimizer && typeof window !== 'undefined') {
    const { renderOptimizer } = await import('./performance/render-optimizer.js');
    // Wait for Phaser game to be available
    const initRenderOptimizer = () => {
      if (window.game?.isBooted) {
        renderOptimizer.init(window.game);
      } else {
        setTimeout(initRenderOptimizer, 100);
      }
    };
    initRenderOptimizer();
  }

  // Frame pacer is optional - Phaser has its own loop
  // Only enable if explicitly requested for custom frame timing
  if (enableFramePacer && typeof window !== 'undefined') {
    const { framePacer } = await import('./performance/frame-pacer.js');
    // Start the frame pacer for timing measurements
    // The callback receives frame timing data that can be used for analysis
    framePacer.start((timestamp, elapsed) => {
      // Frame timing data is recorded internally by framePacer
      // Emit custom event for any listeners that want frame timing
      if (window.dispatchEvent) {
        window.dispatchEvent(new CustomEvent('pac-frame', {
          detail: { timestamp, elapsed }
        }));
      }
    });
  }

  // Initialize performance modules
  if (enableAssetCache) {
    const { assetCache } = await import('./performance/asset-cache.js');
    await assetCache.init({
      maxSizeMB: options.cacheSizeMB || 512,
    });
  }

  if (enableInputOptimizer) {
    const { inputOptimizer } = await import('./performance/input-optimizer.js');
    inputOptimizer.init();
  }

  if (showProfilingOverlay) {
    const { profilingOverlay } = await import('./performance/profiling-overlay.js');
    profilingOverlay.show();
  }

  // Set high-performance mode if running in Tauri
  if (tauriBridge.hasNativeFeatures()) {
    await tauriBridge.setPowerMode('high_performance');
  }

  console.log('[PAC Deluxe] Performance optimizations initialized');

  return {
    tauriBridge,
    isNative: tauriBridge.hasNativeFeatures(),
  };
}

/**
 * Get the current performance status
 * @returns {Object}
 */
export async function getPerformanceStatus() {
  const { tauriBridge } = await import('./bridge/tauri-bridge.js');
  const { framePacer } = await import('./performance/frame-pacer.js');
  const { inputOptimizer } = await import('./performance/input-optimizer.js');
  const { assetCache } = await import('./performance/asset-cache.js');

  return {
    isNative: tauriBridge.hasNativeFeatures(),
    nativeStats: await tauriBridge.getPerformanceStats(),
    frameMetrics: framePacer.getMetrics(),
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
