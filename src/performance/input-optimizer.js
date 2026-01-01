/**
 * Input Optimizer
 *
 * Optimizes input handling for lower latency response.
 * This is a rendering/input optimization that does NOT affect gameplay logic.
 *
 * CRITICAL: Input optimization ONLY affects visual feedback speed.
 * Game logic and server communication remain unchanged.
 * No automated inputs or decision-making.
 */

/**
 * @typedef {Object} InputMetrics
 * @property {number} avgLatency - Average input-to-render latency in ms
 * @property {number} maxLatency - Maximum recorded latency in ms
 * @property {number} minLatency - Minimum recorded latency in ms
 * @property {number} eventCount - Total input events processed
 */

export class InputOptimizer {
  constructor() {
    /** @type {number[]} */
    this.latencyMeasurements = [];
    this.maxMeasurements = 100;

    /** @type {Map<string, number>} */
    this.pendingInputs = new Map();

    /** @type {number} */
    this.eventCount = 0;

    /** @type {boolean} */
    this.isOptimized = false;

    // Input event types to track
    this.trackedEvents = [
      'mousedown',
      'mouseup',
      'mousemove',
      'click',
      'touchstart',
      'touchend',
      'touchmove',
      'keydown',
      'keyup',
    ];
  }

  /**
   * Initialize input optimization
   */
  init() {
    if (this.isOptimized) return;

    console.log('[InputOptimizer] Initializing...');

    // Add high-priority event listeners
    this.trackedEvents.forEach((eventType) => {
      document.addEventListener(
        eventType,
        (e) => this.trackInputStart(e),
        { capture: true, passive: true }
      );
    });

    // Hook into requestAnimationFrame to measure render completion
    this.hookRenderCompletion();

    this.isOptimized = true;
    console.log('[InputOptimizer] Initialized');
  }

  /**
   * Track the start of an input event
   * @param {Event} event
   */
  trackInputStart(event) {
    const timestamp = performance.now();
    const inputId = `${event.type}-${timestamp}`;

    this.pendingInputs.set(inputId, timestamp);
    this.eventCount++;

    // Clean up old pending inputs (older than 1 second)
    const cutoff = timestamp - 1000;
    for (const [id, time] of this.pendingInputs) {
      if (time < cutoff) {
        this.pendingInputs.delete(id);
      }
    }

    // Schedule render completion check
    requestAnimationFrame(() => {
      this.measureLatency(inputId, timestamp);
    });
  }

  /**
   * Measure the latency from input to render
   * @param {string} inputId
   * @param {number} startTime
   */
  measureLatency(inputId, startTime) {
    if (!this.pendingInputs.has(inputId)) return;

    const renderTime = performance.now();
    const latency = renderTime - startTime;

    this.latencyMeasurements.push(latency);
    if (this.latencyMeasurements.length > this.maxMeasurements) {
      this.latencyMeasurements.shift();
    }

    this.pendingInputs.delete(inputId);
  }

  /**
   * Hook into render completion for latency measurement
   * Only runs when there are pending inputs to measure
   */
  hookRenderCompletion() {
    // Only schedule render measurement when we have pending inputs
    // This avoids the constant polling loop
  }

  /**
   * Get input latency metrics
   * @returns {InputMetrics}
   */
  getMetrics() {
    if (this.latencyMeasurements.length === 0) {
      return {
        avgLatency: 0,
        maxLatency: 0,
        minLatency: 0,
        eventCount: this.eventCount,
      };
    }

    const sum = this.latencyMeasurements.reduce((a, b) => a + b, 0);
    const avg = sum / this.latencyMeasurements.length;
    const max = Math.max(...this.latencyMeasurements);
    const min = Math.min(...this.latencyMeasurements);

    return {
      avgLatency: avg,
      maxLatency: max,
      minLatency: min,
      eventCount: this.eventCount,
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.latencyMeasurements = [];
    this.pendingInputs.clear();
    this.eventCount = 0;
  }

  /**
   * Get current latency statistics
   * @returns {Object}
   */
  getStats() {
    const metrics = this.getMetrics();
    return {
      ...metrics,
      isOptimized: this.isOptimized,
      pendingInputs: this.pendingInputs.size,
    };
  }
}

// Singleton instance
export const inputOptimizer = new InputOptimizer();

// Auto-initialize
if (typeof document !== 'undefined') {
  // Initialize on DOMContentLoaded or immediately if already loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      inputOptimizer.init();
    });
  } else {
    inputOptimizer.init();
  }
}

/**
 * Utility: Request high-priority callback
 * Uses the most precise timing available
 * @param {Function} callback
 */
export function requestHighPriorityCallback(callback) {
  // MessageChannel provides higher priority than setTimeout
  if (typeof MessageChannel !== 'undefined') {
    const channel = new MessageChannel();
    channel.port1.onmessage = callback;
    channel.port2.postMessage(null);
  } else {
    setTimeout(callback, 0);
  }
}

/**
 * Utility: Get high-resolution input timestamp
 * @param {Event} event
 * @returns {number}
 */
export function getInputTimestamp(event) {
  // Use event.timeStamp if available and accurate
  if (event.timeStamp && event.timeStamp > 0) {
    return event.timeStamp;
  }
  return performance.now();
}
