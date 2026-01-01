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

/**
 * CHUNGUS MODE: Frame Time Histogram for percentile tracking
 */
class FrameHistogram {
    constructor(maxMs = 100, bucketCount = 100) {
        this.buckets = new Uint32Array(bucketCount);
        this.maxMs = maxMs;
        this.bucketSize = maxMs / bucketCount;
        this.totalSamples = 0;
        this.overflow = 0; // Frames > maxMs
    }

    /**
     * Record a frame time
     */
    record(frameTimeMs) {
        if (frameTimeMs >= this.maxMs) {
            this.overflow++;
        } else {
            const bucket = Math.floor(frameTimeMs / this.bucketSize);
            this.buckets[bucket]++;
        }
        this.totalSamples++;
    }

    /**
     * Get the frame time at a given percentile (0-1)
     */
    percentile(p) {
        if (this.totalSamples === 0) return 0;

        const target = Math.floor(this.totalSamples * p);
        let cumulative = 0;

        for (let i = 0; i < this.buckets.length; i++) {
            cumulative += this.buckets[i];
            if (cumulative >= target) {
                return (i + 0.5) * this.bucketSize; // Return bucket midpoint
            }
        }

        // If we get here, it's in overflow
        return this.maxMs;
    }

    /**
     * Get common percentiles
     */
    getPercentiles() {
        return {
            p50: this.percentile(0.50),
            p90: this.percentile(0.90),
            p95: this.percentile(0.95),
            p99: this.percentile(0.99),
            overflow: this.overflow,
            total: this.totalSamples,
        };
    }

    /**
     * Reset histogram
     */
    reset() {
        this.buckets.fill(0);
        this.totalSamples = 0;
        this.overflow = 0;
    }
}

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

    // CHUNGUS MODE: Frame histogram for percentile tracking
    this.histogram = new FrameHistogram(100, 100);

    // CHUNGUS MODE: Stutter detection and logging
    this.stutterLog = [];
    this.stutterThreshold = 50; // ms - frames longer than this are "stutters"
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

    // CHUNGUS MODE: Record to histogram
    this.histogram.record(elapsed);

    // CHUNGUS MODE: Detect and log stutters
    if (elapsed > this.stutterThreshold) {
      this.logStutter(elapsed, timestamp);
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
   * CHUNGUS MODE: Log stutter event with context
   */
  logStutter(frameTime, timestamp) {
    const stutterEvent = {
      timestamp: timestamp,
      frameTime: frameTime,
      time: new Date().toISOString(),
    };

    // Add memory info if available
    if (performance.memory) {
      stutterEvent.heapUsed = performance.memory.usedJSHeapSize;
      stutterEvent.heapTotal = performance.memory.totalJSHeapSize;
    }

    this.stutterLog.push(stutterEvent);

    // Keep only last 100 stutters
    if (this.stutterLog.length > 100) {
      this.stutterLog.shift();
    }

    console.warn(`[Chungus] Stutter detected: ${frameTime.toFixed(1)}ms`, stutterEvent);
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
      // CHUNGUS MODE additions
      percentiles: this.histogram.getPercentiles(),
      recentStutters: this.stutterLog.slice(-10),
      stutterCount: this.stutterLog.length,
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
    // CHUNGUS MODE: Reset histogram and stutter log
    this.histogram.reset();
    this.stutterLog = [];
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
