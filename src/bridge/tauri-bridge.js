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
 * @typedef {Object} ElevationTelemetry
 * @property {number} processes_elevated - Number of WebView2 processes elevated
 * @property {string} mode - Monitoring mode: "wmi" (event-driven) or "polling" (fallback)
 * @property {boolean} is_active - Whether the optimizer is currently running
 * @property {boolean} wmi_available - Whether WMI event subscription is working
 */

/**
 * @typedef {Object} GpuStats
 * @property {number} usage_percent - GPU utilization percentage (0-100)
 * @property {string|null} name - GPU name from DXGI
 * @property {number} vram_total_mb - Dedicated video memory in MB
 * @property {boolean} available - Whether GPU monitoring is available
 * @property {string|null} error - Error message if monitoring failed
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
   * Get WebView2 elevation telemetry
   * Shows optimizer status and how many processes have been elevated
   * @returns {Promise<ElevationTelemetry|null>}
   */
  async getElevationTelemetry() {
    if (!this.invoke) return null;

    try {
      return await this.invoke('get_webview_telemetry');
    } catch (error) {
      console.error('[TauriBridge] Failed to get elevation telemetry:', error);
      return null;
    }
  }

  /**
   * Get GPU usage statistics
   * Uses Windows Performance Counters (PDH API) for GPU engine utilization
   * @returns {Promise<GpuStats|null>}
   */
  async getGpuStats() {
    if (!this.invoke) return null;

    try {
      return await this.invoke('get_gpu_stats');
    } catch (error) {
      console.error('[TauriBridge] Failed to get GPU stats:', error);
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
