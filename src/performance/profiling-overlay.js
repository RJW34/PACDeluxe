/**
 * Profiling Overlay
 *
 * Displays performance metrics in a non-intrusive overlay.
 * This is a diagnostic tool that does NOT affect gameplay.
 *
 * CRITICAL: This overlay ONLY displays metrics.
 * It does NOT modify any game behavior.
 */

import { tauriBridge } from '../bridge/tauri-bridge.js';
import { frameMonitor } from './frame-monitor.js';

/**
 * CHUNGUS MODE: Network Jitter Tracker
 */
class NetworkJitterTracker {
    constructor(windowSize = 30) {
        this.samples = [];
        this.windowSize = windowSize;
    }

    addSample(rtt) {
        this.samples.push({
            rtt: rtt,
            timestamp: performance.now(),
        });

        if (this.samples.length > this.windowSize) {
            this.samples.shift();
        }
    }

    /**
     * Calculate jitter as mean absolute deviation between consecutive samples
     */
    getJitter() {
        if (this.samples.length < 2) return 0;

        let totalDiff = 0;
        for (let i = 1; i < this.samples.length; i++) {
            totalDiff += Math.abs(this.samples[i].rtt - this.samples[i - 1].rtt);
        }

        return totalDiff / (this.samples.length - 1);
    }

    /**
     * Get min/max/avg RTT
     */
    getStats() {
        if (this.samples.length === 0) {
            return { min: 0, max: 0, avg: 0, jitter: 0, samples: 0 };
        }

        const rtts = this.samples.map(s => s.rtt);
        const sum = rtts.reduce((a, b) => a + b, 0);

        return {
            min: Math.min(...rtts),
            max: Math.max(...rtts),
            avg: sum / rtts.length,
            jitter: this.getJitter(),
            samples: this.samples.length,
        };
    }

    reset() {
        this.samples = [];
    }
}

/**
 * @typedef {Object} OverlayConfig
 * @property {boolean} showFps
 * @property {boolean} showFrameTime
 * @property {boolean} showMemory
 * @property {boolean} showCpu
 * @property {boolean} showNetwork
 * @property {boolean} showGraph
 * @property {'minimal' | 'standard' | 'detailed'} mode
 */

export class ProfilingOverlay {
  constructor() {
    /** @type {HTMLDivElement|null} */
    this.container = null;

    /** @type {boolean} */
    this.isVisible = false;

    /** @type {OverlayConfig} */
    this.config = {
      showFps: true,
      showFrameTime: true,
      showMemory: true,
      showCpu: true,
      showNetwork: true,
      showGraph: true,
      mode: 'standard',
    };

    /** @type {number[]} */
    this.fpsHistory = [];
    this.maxHistoryLength = 60;

    /** @type {number|null} */
    this.updateInterval = null;

    // Network metrics
    this.lastNetworkCheck = 0;
    this.networkRtt = 0;
    this.rttCheckInterval = 5000; // Check RTT every 5 seconds

    // CHUNGUS MODE: Network jitter tracker
    this.jitterTracker = new NetworkJitterTracker(30);
  }

  /**
   * Measure RTT to game server using Performance API
   * @returns {Promise<number>} RTT in milliseconds
   */
  async measureRtt() {
    const now = performance.now();

    // Only check every rttCheckInterval ms to avoid spamming
    if (now - this.lastNetworkCheck < this.rttCheckInterval) {
      return this.networkRtt;
    }

    this.lastNetworkCheck = now;

    try {
      // Method 1: Check Colyseus room ping if available (most accurate)
      if (typeof window !== 'undefined') {
        // Try to access Colyseus room's latency from global app state
        const room = window.room || window.__COLYSEUS_ROOM__ ||
          (window.app && window.app.room);
        if (room && typeof room.ping === 'number' && room.ping > 0) {
          this.networkRtt = room.ping;
          return this.networkRtt;
        }
      }

      // Method 2: Use Navigation Timing API for WebSocket connections
      const entries = performance.getEntriesByType('resource');
      const wsEntries = entries.filter(e =>
        e.name.includes('colyseus') ||
        e.name.includes('socket') ||
        e.initiatorType === 'websocket' ||
        e.name.includes('ws:') ||
        e.name.includes('wss:')
      ).slice(-10);

      if (wsEntries.length > 0) {
        // Use connect timing for WebSocket entries
        const rtts = wsEntries
          .map(e => {
            // For WebSockets, connectEnd - connectStart is connection time
            if (e.connectEnd && e.connectStart) {
              return e.connectEnd - e.connectStart;
            }
            // Fallback to response time
            return e.responseEnd - e.requestStart;
          })
          .filter(rtt => rtt > 0 && rtt < 5000);

        if (rtts.length > 0) {
          // Use median instead of average for more stable values
          rtts.sort((a, b) => a - b);
          this.networkRtt = Math.round(rtts[Math.floor(rtts.length / 2)]);
          return this.networkRtt;
        }
      }

      // Method 3: Check for any recent XHR/fetch requests
      const allEntries = entries.filter(e =>
        e.initiatorType === 'fetch' ||
        e.initiatorType === 'xmlhttprequest'
      ).slice(-5);

      if (allEntries.length > 0) {
        const rtts = allEntries
          .map(e => e.responseEnd - e.requestStart)
          .filter(rtt => rtt > 0 && rtt < 5000);

        if (rtts.length > 0) {
          rtts.sort((a, b) => a - b);
          this.networkRtt = Math.round(rtts[Math.floor(rtts.length / 2)]);
          return this.networkRtt;
        }
      }

      // If no data available, return 0 (unknown) rather than stale data
      if (this.networkRtt === 0) {
        return 0;
      }
    } catch {
      // Keep previous RTT value on error
    }

    return this.networkRtt;
  }

  /**
   * Initialize the overlay
   */
  init() {
    if (this.container) return;

    this.container = document.createElement('div');
    this.container.id = 'pac-profiling-overlay';
    this.container.innerHTML = this.createOverlayHTML();

    // Apply styles
    this.applyStyles();

    document.body.appendChild(this.container);
    console.log('[ProfilingOverlay] Initialized');
  }

  /**
   * Create the overlay HTML structure
   * @returns {string}
   */
  createOverlayHTML() {
    return `
      <div class="pac-overlay-header">
        <span class="pac-overlay-title">PAC Deluxe</span>
        <button class="pac-overlay-close" onclick="window.__PAC_OVERLAY__.hide()">×</button>
      </div>
      <div class="pac-overlay-content">
        <div class="pac-metric" id="pac-fps">
          <span class="pac-label">FPS</span>
          <span class="pac-value">--</span>
        </div>
        <div class="pac-metric" id="pac-frametime">
          <span class="pac-label">Frame</span>
          <span class="pac-value">-- ms</span>
        </div>
        <div class="pac-metric" id="pac-p99">
          <span class="pac-label">p99</span>
          <span class="pac-value">-- ms</span>
        </div>
        <div class="pac-metric" id="pac-memory">
          <span class="pac-label">Memory</span>
          <span class="pac-value">-- MB</span>
        </div>
        <div class="pac-metric" id="pac-cpu">
          <span class="pac-label">CPU</span>
          <span class="pac-value">--%</span>
        </div>
        <div class="pac-metric" id="pac-network">
          <span class="pac-label">RTT</span>
          <span class="pac-value">-- ms</span>
        </div>
        <div class="pac-graph-container" id="pac-graph">
          <canvas id="pac-fps-graph" width="200" height="40"></canvas>
        </div>
        <div class="pac-metric" id="pac-dropped">
          <span class="pac-label">Dropped</span>
          <span class="pac-value">0</span>
        </div>
        <div class="pac-metric" id="pac-stutters">
          <span class="pac-label">Stutters</span>
          <span class="pac-value">0</span>
        </div>
      </div>
    `;
  }

  /**
   * Apply CSS styles to the overlay
   */
  applyStyles() {
    const style = document.createElement('style');
    style.textContent = `
      #pac-profiling-overlay {
        position: fixed;
        top: 10px;
        right: 10px;
        background: rgba(0, 0, 0, 0.85);
        border: 1px solid rgba(0, 255, 0, 0.3);
        border-radius: 4px;
        padding: 8px;
        font-family: 'Consolas', 'Monaco', monospace;
        font-size: 12px;
        color: #00ff00;
        z-index: 99999;
        min-width: 180px;
        user-select: none;
        pointer-events: auto;
        display: none;
      }

      #pac-profiling-overlay.visible {
        display: block;
      }

      .pac-overlay-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
        padding-bottom: 4px;
        border-bottom: 1px solid rgba(0, 255, 0, 0.3);
      }

      .pac-overlay-title {
        font-weight: bold;
        color: #00ff88;
      }

      .pac-overlay-close {
        background: none;
        border: none;
        color: #ff4444;
        cursor: pointer;
        font-size: 16px;
        padding: 0 4px;
      }

      .pac-overlay-close:hover {
        color: #ff8888;
      }

      .pac-overlay-content {
        display: grid;
        grid-template-columns: 1fr;
        gap: 4px;
      }

      .pac-metric {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .pac-label {
        color: #888;
      }

      .pac-value {
        font-weight: bold;
        font-variant-numeric: tabular-nums;
      }

      .pac-value.good { color: #00ff00; }
      .pac-value.warning { color: #ffff00; }
      .pac-value.bad { color: #ff4444; }

      .pac-graph-container {
        margin: 8px 0;
        padding: 4px;
        background: rgba(0, 0, 0, 0.5);
        border-radius: 2px;
      }

      #pac-fps-graph {
        width: 100%;
        height: 40px;
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Show the overlay
   */
  show() {
    if (!this.container) this.init();

    this.container.classList.add('visible');
    this.isVisible = true;

    // Start update loop
    this.startUpdating();

    // Expose to global for close button
    window.__PAC_OVERLAY__ = this;

    console.log('[ProfilingOverlay] Shown');
  }

  /**
   * Hide the overlay
   */
  hide() {
    if (!this.container) return;

    this.container.classList.remove('visible');
    this.isVisible = false;

    // Stop update loop
    this.stopUpdating();

    console.log('[ProfilingOverlay] Hidden');
  }

  /**
   * Toggle overlay visibility
   */
  toggle() {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  /**
   * Start the update loop
   */
  startUpdating() {
    if (this.updateInterval) return;

    this.updateInterval = setInterval(() => {
      this.update();
    }, 100); // Update 10 times per second
  }

  /**
   * Stop the update loop
   */
  stopUpdating() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  /**
   * Update the overlay with current metrics
   */
  async update() {
    if (!this.isVisible || !this.container) return;

    // Get metrics from frame monitor and native stats
    const frameMetrics = frameMonitor.getMetrics();
    const nativeStats = await tauriBridge.getPerformanceStats();

    // Get FPS from frame monitor
    const fps = frameMetrics.currentFps || 0;

    // Update FPS history for graph
    this.fpsHistory.push(fps);
    if (this.fpsHistory.length > this.maxHistoryLength) {
      this.fpsHistory.shift();
    }

    // Update displayed values
    this.updateMetric('pac-fps', `${Math.round(fps)}`, this.getFpsClass(fps));
    this.updateMetric(
      'pac-frametime',
      `${frameMetrics.avgFrameTime.toFixed(1)} ms`,
      this.getFrameTimeClass(frameMetrics.avgFrameTime)
    );

    if (nativeStats) {
      this.updateMetric('pac-memory', `${nativeStats.memory_usage_mb} MB`);
      this.updateMetric(
        'pac-cpu',
        `${nativeStats.cpu_usage.toFixed(1)}%`,
        this.getCpuClass(nativeStats.cpu_usage)
      );
    }

    // CHUNGUS MODE: Update p99 frame time
    if (frameMetrics.percentiles) {
      const p99 = frameMetrics.percentiles.p99;
      const p99Class = p99 < 20 ? 'good' : p99 < 33 ? 'warning' : 'bad';
      this.updateMetric('pac-p99', `${p99.toFixed(1)} ms`, p99Class);
    }

    // CHUNGUS MODE: Update stutter count
    if (typeof frameMetrics.stutterCount !== 'undefined') {
      const stutterClass = frameMetrics.stutterCount === 0 ? 'good' : frameMetrics.stutterCount < 10 ? 'warning' : 'bad';
      this.updateMetric('pac-stutters', `${frameMetrics.stutterCount}`, stutterClass);
    }

    // Update RTT with jitter
    const rtt = await this.measureRtt();
    if (rtt > 0) {
      this.jitterTracker.addSample(rtt);
    }
    const netStats = this.jitterTracker.getStats();
    const rttDisplay = netStats.jitter > 0 ? `${rtt} ms (±${netStats.jitter.toFixed(1)})` : `${rtt} ms`;
    this.updateMetric('pac-network', rttDisplay, rtt < 50 ? 'good' : rtt < 100 ? 'warning' : 'bad');

    // Update dropped frames
    this.updateMetric('pac-dropped', `${frameMetrics.droppedFrames}`);

    // Update graph
    this.drawFpsGraph();
  }

  /**
   * Update a metric display
   * @param {string} id - Element ID
   * @param {string} value - Value to display
   * @param {string} [className] - Optional CSS class
   */
  updateMetric(id, value, className) {
    const element = this.container.querySelector(`#${id} .pac-value`);
    if (element) {
      element.textContent = value;
      element.className = `pac-value ${className || ''}`;
    }
  }

  /**
   * Draw the FPS graph
   */
  drawFpsGraph() {
    const canvas = this.container.querySelector('#pac-fps-graph');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    // Clear
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(0, 0, width, height);

    if (this.fpsHistory.length < 2) return;

    // Draw FPS line
    const maxFps = Math.max(60, ...this.fpsHistory);
    const stepX = width / (this.maxHistoryLength - 1);

    ctx.beginPath();
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 1;

    this.fpsHistory.forEach((fps, i) => {
      const x = i * stepX;
      const y = height - (fps / maxFps) * height;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });

    ctx.stroke();

    // Draw 60 FPS line
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255, 255, 0, 0.3)';
    ctx.setLineDash([2, 2]);
    const y60 = height - (60 / maxFps) * height;
    ctx.moveTo(0, y60);
    ctx.lineTo(width, y60);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /**
   * Get CSS class for FPS value
   * @param {number} fps
   * @returns {string}
   */
  getFpsClass(fps) {
    if (fps >= 58) return 'good';
    if (fps >= 30) return 'warning';
    return 'bad';
  }

  /**
   * Get CSS class for frame time
   * @param {number} frameTime
   * @returns {string}
   */
  getFrameTimeClass(frameTime) {
    if (frameTime <= 17) return 'good';
    if (frameTime <= 33) return 'warning';
    return 'bad';
  }

  /**
   * Get CSS class for CPU usage
   * @param {number} cpu
   * @returns {string}
   */
  getCpuClass(cpu) {
    if (cpu <= 50) return 'good';
    if (cpu <= 80) return 'warning';
    return 'bad';
  }

  /**
   * Destroy the overlay
   */
  destroy() {
    this.stopUpdating();
    if (this.container) {
      this.container.remove();
      this.container = null;
    }
    delete window.__PAC_OVERLAY__;
  }
}

// Singleton instance
export const profilingOverlay = new ProfilingOverlay();

// Keyboard shortcut to toggle overlay (Ctrl+Shift+P)
if (typeof window !== 'undefined') {
  document.addEventListener('keydown', (e) => {
    // Ctrl+Shift+P to toggle overlay (avoids F12 dev tools conflict)
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      profilingOverlay.toggle();
    }
  });
}
