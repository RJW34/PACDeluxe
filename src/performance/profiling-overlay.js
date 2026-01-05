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

    // Network metrics with enhanced tracking
    this.lastNetworkCheck = 0;
    this.networkRtt = 0;
    this.rttCheckInterval = 2000; // Check RTT every 2 seconds (more responsive)

    /** @type {number[]} - RTT history for percentile/jitter calculation */
    this.rttHistory = [];
    this.maxRttHistory = 20; // Keep last 20 samples

    /** @type {number} - Calculated jitter (standard deviation of RTT) */
    this.rttJitter = 0;

    /** @type {Object} - RTT percentiles */
    this.rttPercentiles = { p50: 0, p95: 0, p99: 0 };

    /** @type {'line' | 'histogram'} - Current graph view mode */
    this.graphMode = 'line';
  }

  /**
   * Toggle between line chart and histogram view
   */
  toggleGraphMode() {
    this.graphMode = this.graphMode === 'line' ? 'histogram' : 'line';
    console.log(`[ProfilingOverlay] Graph mode: ${this.graphMode}`);
  }

  /**
   * Calculate standard deviation (jitter) from array of values
   * @param {number[]} values
   * @returns {number}
   */
  calculateStdDev(values) {
    if (values.length < 2) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
    const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
    return Math.sqrt(avgSquaredDiff);
  }

  /**
   * Calculate percentile from sorted array
   * @param {number[]} sorted - Sorted array of values
   * @param {number} p - Percentile (0-100)
   * @returns {number}
   */
  calculatePercentile(sorted, p) {
    if (sorted.length === 0) return 0;
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
  }

  /**
   * Update RTT statistics from history
   */
  updateRttStats() {
    if (this.rttHistory.length === 0) return;

    // Calculate jitter (standard deviation)
    this.rttJitter = Math.round(this.calculateStdDev(this.rttHistory));

    // Calculate percentiles
    const sorted = [...this.rttHistory].sort((a, b) => a - b);
    this.rttPercentiles = {
      p50: Math.round(this.calculatePercentile(sorted, 50)),
      p95: Math.round(this.calculatePercentile(sorted, 95)),
      p99: Math.round(this.calculatePercentile(sorted, 99)),
    };
  }

  /**
   * Measure RTT to game server using multiple detection methods
   * @returns {Promise<number>} RTT in milliseconds
   */
  async measureRtt() {
    const now = performance.now();

    // Only check every rttCheckInterval ms to avoid spamming
    if (now - this.lastNetworkCheck < this.rttCheckInterval) {
      return this.networkRtt;
    }

    this.lastNetworkCheck = now;
    let measuredRtt = 0;

    try {
      // Method 1: Check Colyseus room ping if available (most accurate)
      // Try multiple paths where the room object might be exposed
      if (typeof window !== 'undefined') {
        const roomPaths = [
          // Direct room object
          () => window.room,
          () => window.__COLYSEUS_ROOM__,
          // Via app object (common pattern)
          () => window.app?.room,
          () => window.app?.game?.room,
          // Via game object
          () => window.game?.room,
          () => window.game?.network?.room,
          // Via CC (Pokemon Auto Chess specific)
          () => window.CC?.room,
          () => window.CC?.game?.room,
          // Via store/state
          () => window.store?.getState?.()?.network?.room,
          () => window.__STORE__?.getState?.()?.room,
          // Via Colyseus client
          () => window.client?.rooms?.values?.().next?.()?.value,
          () => window.colyseus?.rooms?.[0],
        ];

        for (const getRoom of roomPaths) {
          try {
            const room = getRoom();
            if (room) {
              // Try different ping property names
              const ping = room.ping ?? room.latency ?? room.rtt ?? room._ping;
              if (typeof ping === 'number' && ping > 0 && ping < 5000) {
                measuredRtt = Math.round(ping);
                break;
              }
            }
          } catch {
            // Path doesn't exist, try next
          }
        }
      }

      // Method 2: Use Navigation Timing API for WebSocket connections
      if (measuredRtt === 0) {
        const entries = performance.getEntriesByType('resource');
        const wsEntries = entries.filter(e =>
          e.name.includes('colyseus') ||
          e.name.includes('socket') ||
          e.name.includes('pokemon-auto-chess') ||
          e.initiatorType === 'websocket' ||
          e.name.includes('ws:') ||
          e.name.includes('wss:')
        ).slice(-10);

        if (wsEntries.length > 0) {
          const rtts = wsEntries
            .map(e => {
              // For WebSockets, connectEnd - connectStart is connection time
              if (e.connectEnd && e.connectStart && e.connectEnd > e.connectStart) {
                return e.connectEnd - e.connectStart;
              }
              // Fallback to response time
              if (e.responseEnd && e.requestStart) {
                return e.responseEnd - e.requestStart;
              }
              return 0;
            })
            .filter(rtt => rtt > 0 && rtt < 5000);

          if (rtts.length > 0) {
            rtts.sort((a, b) => a - b);
            measuredRtt = Math.round(rtts[Math.floor(rtts.length / 2)]);
          }
        }
      }

      // Method 3: Check for any recent XHR/fetch requests to game server
      if (measuredRtt === 0) {
        const entries = performance.getEntriesByType('resource');
        const apiEntries = entries.filter(e =>
          (e.initiatorType === 'fetch' || e.initiatorType === 'xmlhttprequest') &&
          (e.name.includes('pokemon-auto-chess') || e.name.includes('colyseus'))
        ).slice(-5);

        if (apiEntries.length > 0) {
          const rtts = apiEntries
            .map(e => e.responseEnd - e.requestStart)
            .filter(rtt => rtt > 0 && rtt < 5000);

          if (rtts.length > 0) {
            rtts.sort((a, b) => a - b);
            measuredRtt = Math.round(rtts[Math.floor(rtts.length / 2)]);
          }
        }
      }

      // Update RTT if we got a valid measurement
      if (measuredRtt > 0) {
        this.networkRtt = measuredRtt;

        // Add to history for statistics
        this.rttHistory.push(measuredRtt);
        if (this.rttHistory.length > this.maxRttHistory) {
          this.rttHistory.shift();
        }

        // Update statistics
        this.updateRttStats();
      }
    } catch {
      // Keep previous RTT value on error
    }

    return this.networkRtt;
  }

  /**
   * Get RTT display string with jitter
   * @returns {string} Formatted RTT string like "45ms (±5ms)"
   */
  getRttDisplayString() {
    if (this.networkRtt === 0) {
      return '-- ms';
    }

    if (this.rttJitter > 0 && this.rttHistory.length >= 3) {
      return `${this.networkRtt}ms (±${this.rttJitter})`;
    }

    return `${this.networkRtt} ms`;
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
        <div class="pac-graph-header">
          <span class="pac-graph-label" id="pac-graph-label">FPS History</span>
          <button class="pac-graph-toggle" onclick="window.__PAC_OVERLAY__.toggleGraphMode()">⇄</button>
        </div>
        <div class="pac-graph-container" id="pac-graph">
          <canvas id="pac-fps-graph" width="200" height="50"></canvas>
        </div>
        <div class="pac-metric" id="pac-percentiles">
          <span class="pac-label">p50/p95/p99</span>
          <span class="pac-value">--/--/--</span>
        </div>
        <div class="pac-metric" id="pac-dropped">
          <span class="pac-label">Dropped</span>
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

      .pac-graph-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 6px;
        margin-bottom: 2px;
      }

      .pac-graph-label {
        color: #888;
        font-size: 10px;
      }

      .pac-graph-toggle {
        background: rgba(0, 255, 0, 0.2);
        border: 1px solid rgba(0, 255, 0, 0.3);
        border-radius: 3px;
        color: #00ff00;
        cursor: pointer;
        font-size: 10px;
        padding: 1px 6px;
      }

      .pac-graph-toggle:hover {
        background: rgba(0, 255, 0, 0.3);
      }

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

    // Update RTT with jitter display
    await this.measureRtt();
    this.updateMetric('pac-network', this.getRttDisplayString(), this.getRttClass(this.networkRtt));

    // Update frame time percentiles
    if (frameMetrics.histogram) {
      const p = frameMetrics.histogram.percentiles;
      this.updateMetric('pac-percentiles', `${p.p50}/${p.p95}/${p.p99} ms`);
    }

    // Update dropped frames
    this.updateMetric('pac-dropped', `${frameMetrics.droppedFrames}`);

    // Update graph label based on mode
    const graphLabel = this.container.querySelector('#pac-graph-label');
    if (graphLabel) {
      graphLabel.textContent = this.graphMode === 'line' ? 'FPS History' : 'Frame Distribution';
    }

    // Update graph (line or histogram based on mode)
    this.drawGraph(frameMetrics);
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
   * Draw the graph (line chart or histogram based on mode)
   * @param {Object} frameMetrics - Frame metrics from FrameMonitor
   */
  drawGraph(frameMetrics) {
    const canvas = this.container.querySelector('#pac-fps-graph');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    // Clear
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(0, 0, width, height);

    if (this.graphMode === 'histogram') {
      this.drawHistogram(ctx, width, height, frameMetrics.histogram);
    } else {
      this.drawLineChart(ctx, width, height);
    }
  }

  /**
   * Draw line chart (FPS history)
   */
  drawLineChart(ctx, width, height) {
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
   * Draw histogram (frame time distribution)
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} width
   * @param {number} height
   * @param {Object} histogram - Histogram data from FrameMonitor
   */
  drawHistogram(ctx, width, height, histogram) {
    if (!histogram || histogram.total === 0) {
      // Draw "no data" message
      ctx.fillStyle = '#666';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Collecting data...', width / 2, height / 2 + 3);
      return;
    }

    const buckets = ['excellent', 'good', 'acceptable', 'poor'];
    const colors = {
      excellent: '#00ff00', // Green - excellent (<8ms)
      good: '#88ff00',      // Yellow-green - good (8-16ms)
      acceptable: '#ffff00', // Yellow - acceptable (16-33ms)
      poor: '#ff4444',      // Red - poor (>33ms)
    };
    const labels = {
      excellent: '<8ms',
      good: '8-16',
      acceptable: '16-33',
      poor: '>33ms',
    };

    const barWidth = (width - 20) / buckets.length;
    const maxPercent = Math.max(...Object.values(histogram.percentages), 1);
    const labelHeight = 12;
    const graphHeight = height - labelHeight;

    buckets.forEach((bucket, i) => {
      const percent = histogram.percentages[bucket];
      const barHeight = (percent / maxPercent) * (graphHeight - 4);
      const x = 10 + i * barWidth;
      const y = graphHeight - barHeight;

      // Draw bar
      ctx.fillStyle = colors[bucket];
      ctx.fillRect(x + 2, y, barWidth - 4, barHeight);

      // Draw percentage on bar if tall enough
      if (barHeight > 12 && percent > 0) {
        ctx.fillStyle = '#000';
        ctx.font = '9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`${Math.round(percent)}%`, x + barWidth / 2, y + 10);
      }

      // Draw label below
      ctx.fillStyle = '#888';
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(labels[bucket], x + barWidth / 2, height - 2);
    });
  }

  /**
   * Draw the FPS graph (legacy - redirects to drawGraph)
   * @deprecated Use drawGraph instead
   */
  drawFpsGraph() {
    const frameMetrics = frameMonitor.getMetrics();
    this.drawGraph(frameMetrics);
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
   * Get CSS class for RTT value
   * @param {number} rtt
   * @returns {string}
   */
  getRttClass(rtt) {
    if (rtt === 0) return ''; // Unknown
    if (rtt < 50) return 'good';
    if (rtt < 100) return 'warning';
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
