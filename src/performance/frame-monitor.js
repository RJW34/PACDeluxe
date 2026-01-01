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
