/**
 * Network Monitor
 *
 * Provides real-time network metrics using PerformanceObserver.
 * Passively monitors game traffic without injecting requests.
 *
 * CRITICAL: This module ONLY observes network timing.
 * It does NOT modify, intercept, or inject network traffic.
 */

/**
 * @typedef {Object} NetworkMetrics
 * @property {number} rtt - Current RTT in milliseconds
 * @property {number} rttJitter - RTT jitter (standard deviation)
 * @property {number} rttMin - Minimum RTT observed
 * @property {number} rttMax - Maximum RTT observed
 * @property {number} bandwidth - Estimated bandwidth in bits per second
 * @property {string} bandwidthFormatted - Human-readable bandwidth (e.g., "1.5 Mbps")
 * @property {'good' | 'fair' | 'poor' | 'unknown'} quality - Connection quality
 * @property {number} sampleCount - Number of RTT samples collected
 * @property {number} lastUpdate - Timestamp of last update
 */

/**
 * Patterns to identify game-related network traffic
 */
const GAME_TRAFFIC_PATTERNS = [
  /colyseus/i,
  /pokemon-auto-chess/i,
  /socket\.io/i,
  /\.pokemon\./i,
  /wss?:\/\//i,
];

/**
 * Patterns to exclude from monitoring (non-game traffic)
 */
const EXCLUDE_PATTERNS = [
  /google/i,
  /analytics/i,
  /facebook/i,
  /twitter/i,
  /\.png$/i,
  /\.jpg$/i,
  /\.gif$/i,
  /\.css$/i,
  /\.js$/i,
  /fonts\./i,
];

export class NetworkMonitor {
  constructor() {
    /** @type {number[]} */
    this.rttSamples = [];

    /** @type {{bps: number, time: number}[]} */
    this.bandwidthSamples = [];

    /** @type {number} */
    this.maxSamples = 50;

    /** @type {number} */
    this.lastUpdate = 0;

    /** @type {PerformanceObserver|null} */
    this.observer = null;

    /** @type {boolean} */
    this.isRunning = false;

    // RTT thresholds for quality assessment (in ms)
    this.qualityThresholds = {
      good: 50,      // < 50ms = good
      fair: 100,     // 50-100ms = fair
      // > 100ms = poor
    };

    // Statistics
    this.stats = {
      packetsObserved: 0,
      gamePackets: 0,
      lastRtt: 0,
      lastBandwidth: 0,
    };
  }

  /**
   * Start monitoring network traffic
   */
  start() {
    if (this.isRunning) {
      console.warn('[NetworkMonitor] Already running');
      return;
    }

    if (typeof PerformanceObserver === 'undefined') {
      console.warn('[NetworkMonitor] PerformanceObserver not available');
      return;
    }

    try {
      this.observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this.processEntry(entry);
        }
      });

      // Observe resource timing (network requests)
      this.observer.observe({
        entryTypes: ['resource'],
        buffered: true  // Get entries that occurred before observation started
      });

      this.isRunning = true;
      console.log('[NetworkMonitor] Started observing network traffic');
    } catch (error) {
      console.error('[NetworkMonitor] Failed to start:', error);
    }
  }

  /**
   * Stop monitoring
   */
  stop() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.isRunning = false;
    console.log('[NetworkMonitor] Stopped');
  }

  /**
   * Check if a URL is game-related traffic
   * @param {string} url
   * @returns {boolean}
   */
  isGameTraffic(url) {
    // First check exclusions
    for (const pattern of EXCLUDE_PATTERNS) {
      if (pattern.test(url)) {
        return false;
      }
    }

    // Then check inclusions
    for (const pattern of GAME_TRAFFIC_PATTERNS) {
      if (pattern.test(url)) {
        return true;
      }
    }

    // Also include XHR/fetch to same origin (likely game API)
    try {
      const urlObj = new URL(url, window.location.origin);
      if (urlObj.origin === window.location.origin) {
        // Check if it looks like an API call
        if (url.includes('/api/') || url.includes('/game/') || url.includes('/room/')) {
          return true;
        }
      }
    } catch {
      // Invalid URL, ignore
    }

    return false;
  }

  /**
   * Process a PerformanceResourceTiming entry
   * @param {PerformanceResourceTiming} entry
   */
  processEntry(entry) {
    this.stats.packetsObserved++;

    // Only process game-related traffic
    if (!this.isGameTraffic(entry.name)) {
      return;
    }

    this.stats.gamePackets++;
    this.lastUpdate = Date.now();

    // Calculate RTT from timing data
    const rtt = this.extractRtt(entry);
    if (rtt > 0 && rtt < 5000) {  // Sanity check: 0-5 seconds
      this.addRttSample(rtt);
      this.stats.lastRtt = rtt;
    }

    // Calculate bandwidth from transfer
    const bandwidth = this.extractBandwidth(entry);
    if (bandwidth > 0) {
      this.addBandwidthSample(bandwidth);
      this.stats.lastBandwidth = bandwidth;
    }
  }

  /**
   * Extract RTT from a performance entry
   * @param {PerformanceResourceTiming} entry
   * @returns {number} RTT in milliseconds
   */
  extractRtt(entry) {
    // For WebSocket/HTTP connections, use different timing strategies

    // Strategy 1: Full request-response time (most accurate for API calls)
    if (entry.responseEnd && entry.requestStart && entry.responseEnd > entry.requestStart) {
      const fullRtt = entry.responseEnd - entry.requestStart;

      // Subtract transfer time if we have it (to get network latency only)
      if (entry.responseStart && entry.responseStart > entry.requestStart) {
        // Time to first byte is closer to network RTT
        return entry.responseStart - entry.requestStart;
      }

      return fullRtt;
    }

    // Strategy 2: Connection time (for new connections)
    if (entry.connectEnd && entry.connectStart && entry.connectEnd > entry.connectStart) {
      // TCP handshake time is ~1.5x RTT
      return (entry.connectEnd - entry.connectStart) / 1.5;
    }

    // Strategy 3: DNS + Connection time
    if (entry.domainLookupEnd && entry.domainLookupStart) {
      const dnsTime = entry.domainLookupEnd - entry.domainLookupStart;
      if (dnsTime > 0) {
        return dnsTime;  // DNS lookup is roughly 1 RTT
      }
    }

    return 0;
  }

  /**
   * Extract bandwidth from a performance entry
   * @param {PerformanceResourceTiming} entry
   * @returns {number} Bandwidth in bits per second
   */
  extractBandwidth(entry) {
    // Get transfer size (prefer transferSize, fall back to encodedBodySize)
    const transferSize = entry.transferSize || entry.encodedBodySize || 0;

    if (transferSize <= 0) {
      return 0;
    }

    // Calculate transfer duration
    const duration = entry.responseEnd - entry.responseStart;

    if (duration <= 0) {
      return 0;
    }

    // Convert to bits per second
    // transferSize is in bytes, duration is in ms
    const bps = (transferSize * 8) / (duration / 1000);

    return bps;
  }

  /**
   * Add an RTT sample
   * @param {number} rtt
   */
  addRttSample(rtt) {
    this.rttSamples.push(rtt);

    // Keep only recent samples
    if (this.rttSamples.length > this.maxSamples) {
      this.rttSamples.shift();
    }
  }

  /**
   * Add a bandwidth sample
   * @param {number} bps
   */
  addBandwidthSample(bps) {
    this.bandwidthSamples.push({
      bps,
      time: Date.now(),
    });

    // Keep only recent samples (last 30 seconds)
    const cutoff = Date.now() - 30000;
    this.bandwidthSamples = this.bandwidthSamples.filter(s => s.time > cutoff);
  }

  /**
   * Calculate standard deviation
   * @param {number[]} values
   * @returns {number}
   */
  calculateStdDev(values) {
    if (values.length < 2) return 0;

    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;

    return Math.sqrt(variance);
  }

  /**
   * Determine connection quality based on RTT and jitter
   * @param {number} rtt
   * @param {number} jitter
   * @returns {'good' | 'fair' | 'poor' | 'unknown'}
   */
  assessQuality(rtt, jitter) {
    if (rtt === 0) return 'unknown';

    // High jitter is also a quality issue
    const effectiveRtt = rtt + jitter;

    if (effectiveRtt < this.qualityThresholds.good) {
      return 'good';
    } else if (effectiveRtt < this.qualityThresholds.fair) {
      return 'fair';
    } else {
      return 'poor';
    }
  }

  /**
   * Format bandwidth for display
   * @param {number} bps - Bits per second
   * @returns {string}
   */
  formatBandwidth(bps) {
    if (bps <= 0) return '--';

    if (bps >= 1000000000) {
      return `${(bps / 1000000000).toFixed(1)} Gbps`;
    } else if (bps >= 1000000) {
      return `${(bps / 1000000).toFixed(1)} Mbps`;
    } else if (bps >= 1000) {
      return `${(bps / 1000).toFixed(0)} Kbps`;
    } else {
      return `${Math.round(bps)} bps`;
    }
  }

  /**
   * Get current network metrics
   * @returns {NetworkMetrics}
   */
  getMetrics() {
    const rttValues = this.rttSamples.slice(-20);  // Use last 20 for calculations
    const bwValues = this.bandwidthSamples.slice(-10).map(s => s.bps);

    // Calculate RTT statistics
    let rtt = 0;
    let rttJitter = 0;
    let rttMin = 0;
    let rttMax = 0;

    if (rttValues.length > 0) {
      rtt = Math.round(rttValues.reduce((a, b) => a + b, 0) / rttValues.length);
      rttJitter = Math.round(this.calculateStdDev(rttValues));
      rttMin = Math.round(Math.min(...rttValues));
      rttMax = Math.round(Math.max(...rttValues));
    }

    // Calculate bandwidth (median of recent samples)
    let bandwidth = 0;
    if (bwValues.length > 0) {
      const sorted = [...bwValues].sort((a, b) => a - b);
      bandwidth = sorted[Math.floor(sorted.length / 2)];
    }

    // Assess quality
    const quality = this.assessQuality(rtt, rttJitter);

    return {
      rtt,
      rttJitter,
      rttMin,
      rttMax,
      bandwidth,
      bandwidthFormatted: this.formatBandwidth(bandwidth),
      quality,
      sampleCount: this.rttSamples.length,
      lastUpdate: this.lastUpdate,
    };
  }

  /**
   * Get formatted RTT string with jitter
   * @returns {string}
   */
  getRttString() {
    const metrics = this.getMetrics();

    if (metrics.rtt === 0) {
      return '-- ms';
    }

    if (metrics.rttJitter > 0 && metrics.sampleCount >= 3) {
      return `${metrics.rtt}ms (±${metrics.rttJitter})`;
    }

    return `${metrics.rtt} ms`;
  }

  /**
   * Get debug statistics
   * @returns {Object}
   */
  getDebugStats() {
    return {
      ...this.stats,
      isRunning: this.isRunning,
      rttSampleCount: this.rttSamples.length,
      bwSampleCount: this.bandwidthSamples.length,
    };
  }

  /**
   * Reset all samples and statistics
   */
  reset() {
    this.rttSamples = [];
    this.bandwidthSamples = [];
    this.stats = {
      packetsObserved: 0,
      gamePackets: 0,
      lastRtt: 0,
      lastBandwidth: 0,
    };
    this.lastUpdate = 0;
    console.log('[NetworkMonitor] Reset');
  }
}

// Singleton instance
export const networkMonitor = new NetworkMonitor();

// Auto-start when module loads
if (typeof window !== 'undefined') {
  // Start after a short delay to let the page initialize
  setTimeout(() => {
    networkMonitor.start();
  }, 1000);
}
