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
 * @property {number} cpu_usage - CPU usage percentage (global)
 * @property {number} memory_usage_mb - Memory usage in MB
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
}

// Singleton instance
export const tauriBridge = new TauriBridge();

// Auto-initialize
if (typeof window !== 'undefined') {
  tauriBridge.init().catch(console.error);
}

// Export utilities
export { isTauri };
