/**
 * Frame Pacer
 *
 * Provides frame pacing optimization for consistent frame delivery.
 * This is a rendering-only optimization that does NOT affect gameplay timing.
 *
 * CRITICAL: Frame pacing ONLY affects visual smoothness.
 * Game logic timing remains unchanged and server-authoritative.
 */

export class FramePacer {
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

    /** @type {Function|null} */
    this.callback = null;

    // Performance metrics
    this.metrics = {
      droppedFrames: 0,
      totalFrames: 0,
      jitter: 0,
    };
  }

  /**
   * Set target frame rate
   * @param {number} fps - Target frames per second
   */
  setTargetFps(fps) {
    this.targetFps = Math.max(1, Math.min(240, fps));
    this.frameInterval = 1000 / this.targetFps;
    console.log(`[FramePacer] Target FPS set to ${this.targetFps}`);
  }

  /**
   * Start the frame pacer
   * @param {Function} callback - Function to call each frame
   */
  start(callback) {
    if (this.isRunning) {
      console.warn('[FramePacer] Already running');
      return;
    }

    this.callback = callback;
    this.isRunning = true;
    this.lastFrameTime = performance.now();

    console.log('[FramePacer] Started');
    this.scheduleFrame();
  }

  /**
   * Stop the frame pacer
   */
  stop() {
    this.isRunning = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    console.log('[FramePacer] Stopped');
  }

  /**
   * Schedule the next frame
   */
  scheduleFrame() {
    if (!this.isRunning) return;

    this.rafId = requestAnimationFrame((timestamp) => {
      this.processFrame(timestamp);
    });
  }

  /**
   * Process a frame
   * @param {number} timestamp - Current timestamp from requestAnimationFrame
   */
  processFrame(timestamp) {
    if (!this.isRunning) return;

    const elapsed = timestamp - this.lastFrameTime;

    // Track frame timing
    this.frameTimes.push(elapsed);
    if (this.frameTimes.length > 60) {
      this.frameTimes.shift();
    }

    // Calculate jitter (variance in frame times)
    if (this.frameTimes.length > 1) {
      const avg =
        this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
      const variance =
        this.frameTimes.reduce((sum, t) => sum + (t - avg) ** 2, 0) /
        this.frameTimes.length;
      this.metrics.jitter = Math.sqrt(variance);
    }

    // Detect dropped frames
    if (elapsed > this.frameInterval * 1.5) {
      const dropped = Math.floor(elapsed / this.frameInterval) - 1;
      this.metrics.droppedFrames += dropped;
    }

    this.metrics.totalFrames++;

    // Execute callback
    if (this.callback) {
      try {
        this.callback(timestamp, elapsed);
      } catch (error) {
        console.error('[FramePacer] Callback error:', error);
      }
    }

    this.lastFrameTime = timestamp;
    this.frameCount++;

    // Schedule next frame
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
export const framePacer = new FramePacer();

/**
 * Utility: High-resolution timestamp
 * Uses performance.now() for sub-millisecond precision
 */
export function getHighResTimestamp() {
  return performance.now();
}

/**
 * Utility: Calculate smooth delta time
 * Clamps delta to prevent physics explosions on frame drops
 * @param {number} delta - Raw delta time
 * @param {number} maxDelta - Maximum allowed delta (default: 100ms)
 * @returns {number} Clamped delta time
 */
export function smoothDelta(delta, maxDelta = 100) {
  return Math.min(delta, maxDelta);
}
