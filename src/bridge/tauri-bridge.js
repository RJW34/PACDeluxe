/**
 * Tauri Bridge
 *
 * Provides communication between the web frontend and native Rust backend.
 * All commands are performance-focused and do NOT access game state.
 *
 * CRITICAL: This bridge NEVER:
 * - Reads or modifies game state
 * - Accesses opponent information
 * - Modifies RNG or timing logic
 * - Automates gameplay decisions
 */

// Check if running in Tauri
const isTauri = () => {
  return typeof window !== 'undefined' && window.__TAURI__ !== undefined;
};

// Get Tauri invoke function
const getInvoke = async () => {
  if (!isTauri()) {
    console.warn('[TauriBridge] Not running in Tauri environment');
    return null;
  }

  // Dynamic import for Tauri API v2
  try {
    // Tauri v2 uses @tauri-apps/api with invoke at root level
    const tauriApi = await import('@tauri-apps/api');
    return tauriApi.invoke;
  } catch (error) {
    // Fallback: try window.__TAURI__ which is always available in Tauri
    if (window.__TAURI__?.invoke) {
      return window.__TAURI__.invoke;
    }
    console.error('[TauriBridge] Failed to load Tauri API:', error);
    return null;
  }
};

/**
 * @typedef {Object} PerformanceStats
 * @property {number} fps - Frames per second
 * @property {number} frame_time_ms - Frame time in milliseconds
 * @property {number} cpu_usage - CPU usage percentage
 * @property {number} memory_usage_mb - Memory usage in MB
 * @property {number|null} gpu_usage - GPU usage percentage (if available)
 * @property {number} frame_count - Total frames rendered
 * @property {number} uptime_secs - Application uptime in seconds
 */

/**
 * @typedef {Object} SystemInfo
 * @property {string} os - Operating system
 * @property {string} arch - Architecture
 * @property {number} cpu_cores - Number of CPU cores
 * @property {number} total_memory_mb - Total memory in MB
 * @property {string|null} gpu_info - GPU information
 */

/**
 * Tauri Bridge class for native communication
 */
export class TauriBridge {
  constructor() {
    /** @type {Function|null} */
    this.invoke = null;

    /** @type {boolean} */
    this.isInitialized = false;

    /** @type {boolean} */
    this.isAvailable = isTauri();
  }

  /**
   * Initialize the bridge
   */
  async init() {
    if (this.isInitialized) return;

    this.invoke = await getInvoke();
    this.isInitialized = true;

    if (this.invoke) {
      console.log('[TauriBridge] Initialized successfully');
    } else {
      console.log('[TauriBridge] Running in browser mode (no native features)');
    }
  }

  /**
   * Check if native features are available
   * @returns {boolean}
   */
  hasNativeFeatures() {
    return this.invoke !== null;
  }

  /**
   * Get performance statistics from native code
   * @returns {Promise<PerformanceStats|null>}
   */
  async getPerformanceStats() {
    if (!this.invoke) return null;

    try {
      return await this.invoke('get_performance_stats');
    } catch (error) {
      console.error('[TauriBridge] Failed to get performance stats:', error);
      return null;
    }
  }

  /**
   * Get system information
   * @returns {Promise<SystemInfo|null>}
   */
  async getSystemInfo() {
    if (!this.invoke) return null;

    try {
      return await this.invoke('get_system_info');
    } catch (error) {
      console.error('[TauriBridge] Failed to get system info:', error);
      return null;
    }
  }

  /**
   * Set power mode
   * @param {'balanced' | 'high_performance' | 'power_saver'} mode
   * @returns {Promise<boolean>}
   */
  async setPowerMode(mode) {
    if (!this.invoke) return false;

    try {
      await this.invoke('set_power_mode', { mode });
      console.log(`[TauriBridge] Power mode set to: ${mode}`);
      return true;
    } catch (error) {
      console.error('[TauriBridge] Failed to set power mode:', error);
      return false;
    }
  }

  /**
   * Decode an image using native code
   * @param {string} path - Path to the image
   * @param {number} [targetWidth] - Target width for resizing
   * @param {number} [targetHeight] - Target height for resizing
   * @returns {Promise<{success: boolean, width: number, height: number, data: Uint8Array}|null>}
   */
  async decodeImage(path, targetWidth, targetHeight) {
    if (!this.invoke) return null;

    try {
      const result = await this.invoke('decode_image', {
        request: {
          path,
          target_width: targetWidth,
          target_height: targetHeight,
        },
      });

      return {
        ...result,
        data: new Uint8Array(result.data),
      };
    } catch (error) {
      console.error('[TauriBridge] Failed to decode image:', error);
      return null;
    }
  }

  /**
   * Preload assets into OS cache
   * @param {string[]} paths - Paths to preload
   * @returns {Promise<{success: boolean, loaded_count: number, failed_count: number, total_bytes: number}|null>}
   */
  async preloadAssets(paths) {
    if (!this.invoke) return null;

    try {
      return await this.invoke('preload_assets', { paths });
    } catch (error) {
      console.error('[TauriBridge] Failed to preload assets:', error);
      return null;
    }
  }
}

// Singleton instance
export const tauriBridge = new TauriBridge();

// Auto-initialize
if (typeof window !== 'undefined') {
  tauriBridge.init().catch(console.error);
}

// Export utilities
export { isTauri };
