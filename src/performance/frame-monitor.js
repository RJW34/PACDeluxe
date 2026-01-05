/**
 * Frame Monitor
 *
 * Passively monitors frame timing and provides metrics.
 * This is a diagnostic tool that does NOT affect gameplay or frame pacing.
 *
 * IMPORTANT: This module only MEASURES frame timing.
 * It does NOT pace, throttle, or control frame delivery.
 * requestAnimationFrame timing is controlled by the browser/WebView.
 */

export class FrameMonitor {
  constructor() {
    /** @type {number} */
    this.targetFps = 60;

    /** @type {number} */
    this.frameInterval = 1000 / this.targetFps;

    /** @type {number} */
    this.lastFrameTime = 0;

    /** @type {number} */
    this.frameCount = 0;

    /** @type {number[]} */
    this.frameTimes = [];

    /** @type {boolean} */
    this.isRunning = false;

    /** @type {number|null} */
    this.rafId = null;

    // Performance metrics (passive observation only)
    this.metrics = {
      droppedFrames: 0,
      totalFrames: 0,
      jitter: 0,
    };

    // Histogram buckets for frame time distribution
    // Bucket thresholds in milliseconds
    this.histogramBuckets = {
      excellent: 0,  // 0-8ms (<120fps equivalent)
      good: 0,       // 8-16ms (60-120fps)
      acceptable: 0, // 16-33ms (30-60fps)
      poor: 0,       // 33ms+ (<30fps)
    };

    // Bucket thresholds
    this.bucketThresholds = {
      excellent: 8,
      good: 16,
      acceptable: 33,
    };
  }

  /**
   * Classify frame time into histogram bucket
   * @param {number} frameTime - Frame time in milliseconds
   * @returns {string} Bucket name
   */
  classifyFrameTime(frameTime) {
    if (frameTime <= this.bucketThresholds.excellent) return 'excellent';
    if (frameTime <= this.bucketThresholds.good) return 'good';
    if (frameTime <= this.bucketThresholds.acceptable) return 'acceptable';
    return 'poor';
  }

  /**
   * Set target frame rate for metric calculations
   * @param {number} fps - Target frames per second
   */
  setTargetFps(fps) {
    this.targetFps = Math.max(1, Math.min(240, fps));
    this.frameInterval = 1000 / this.targetFps;
    console.log(`[FrameMonitor] Target FPS set to ${this.targetFps}`);
  }

  /**
   * Start monitoring frames
   */
  start() {
    if (this.isRunning) {
      console.warn('[FrameMonitor] Already running');
      return;
    }

    this.isRunning = true;
    this.lastFrameTime = performance.now();
    this.resetMetrics();

    console.log('[FrameMonitor] Started monitoring');
    this.scheduleFrame();
  }

  /**
   * Stop monitoring
   */
  stop() {
    this.isRunning = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    console.log('[FrameMonitor] Stopped');
  }

  /**
   * Schedule the next frame observation
   */
  scheduleFrame() {
    if (!this.isRunning) return;

    this.rafId = requestAnimationFrame((timestamp) => {
      this.recordFrame(timestamp);
    });
  }

  /**
   * Record frame timing data
   * @param {number} timestamp - Current timestamp from requestAnimationFrame
   */
  recordFrame(timestamp) {
    if (!this.isRunning) return;

    const elapsed = timestamp - this.lastFrameTime;

    // Track frame timing
    this.frameTimes.push(elapsed);
    if (this.frameTimes.length > 60) {
      this.frameTimes.shift();
    }

    // Update histogram bucket
    const bucket = this.classifyFrameTime(elapsed);
    this.histogramBuckets[bucket]++;

    // Calculate jitter (standard deviation of frame times)
    if (this.frameTimes.length > 1) {
      const avg =
        this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
      const variance =
        this.frameTimes.reduce((sum, t) => sum + (t - avg) ** 2, 0) /
        this.frameTimes.length;
      this.metrics.jitter = Math.sqrt(variance);
    }

    // Detect missed frames (frame took longer than 1.5x target)
    if (elapsed > this.frameInterval * 1.5) {
      this.metrics.droppedFrames++;
    }

    this.metrics.totalFrames++;
    this.lastFrameTime = timestamp;
    this.frameCount++;

    // Continue monitoring
    this.scheduleFrame();
  }

  /**
   * Get performance metrics
   * @returns {Object} Performance metrics
   */
  getMetrics() {
    const avgFrameTime =
      this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length || 0;

    return {
      ...this.metrics,
      currentFps: avgFrameTime > 0 ? 1000 / avgFrameTime : 0,
      avgFrameTime,
      frameCount: this.frameCount,
      histogram: this.getHistogram(),
    };
  }

  /**
   * Get histogram data with percentages
   * @returns {Object} Histogram data with counts and percentages
   */
  getHistogram() {
    const total = Object.values(this.histogramBuckets).reduce((a, b) => a + b, 0);

    return {
      buckets: { ...this.histogramBuckets },
      percentages: {
        excellent: total > 0 ? (this.histogramBuckets.excellent / total) * 100 : 0,
        good: total > 0 ? (this.histogramBuckets.good / total) * 100 : 0,
        acceptable: total > 0 ? (this.histogramBuckets.acceptable / total) * 100 : 0,
        poor: total > 0 ? (this.histogramBuckets.poor / total) * 100 : 0,
      },
      total,
      // Calculate percentiles from raw frame times
      percentiles: this.calculatePercentiles(),
    };
  }

  /**
   * Calculate frame time percentiles (p50, p95, p99)
   * @returns {Object} Percentile values in milliseconds
   */
  calculatePercentiles() {
    if (this.frameTimes.length === 0) {
      return { p50: 0, p95: 0, p99: 0 };
    }

    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const getPercentile = (p) => {
      const index = Math.ceil((p / 100) * sorted.length) - 1;
      return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
    };

    return {
      p50: Math.round(getPercentile(50) * 10) / 10,
      p95: Math.round(getPercentile(95) * 10) / 10,
      p99: Math.round(getPercentile(99) * 10) / 10,
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.metrics = {
      droppedFrames: 0,
      totalFrames: 0,
      jitter: 0,
    };
    this.frameTimes = [];
    this.frameCount = 0;

    // Reset histogram buckets
    this.histogramBuckets = {
      excellent: 0,
      good: 0,
      acceptable: 0,
      poor: 0,
    };
  }
}

// Singleton instance
export const frameMonitor = new FrameMonitor();

/**
 * Utility: High-resolution timestamp
 * Uses performance.now() for sub-millisecond precision
 */
export function getHighResTimestamp() {
  return performance.now();
}
