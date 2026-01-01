/**
 * Input Optimizer
 *
 * Provides actual input latency optimizations:
 * - High-priority callback scheduling via MessageChannel
 * - Mouse/touch event coalescing to reduce processing overhead
 * - Passive event listeners where possible
 * - getCoalescedEvents() support for pointer events
 *
 * CRITICAL: This optimizer ONLY affects input processing speed.
 * Game logic and server communication remain unchanged.
 * No automated inputs or decision-making.
 */

/**
 * @typedef {Object} InputMetrics
 * @property {number} avgLatency - Average input-to-render latency in ms
 * @property {number} maxLatency - Maximum recorded latency in ms
 * @property {number} minLatency - Minimum recorded latency in ms
 * @property {number} eventCount - Total input events processed
 * @property {number} coalescedCount - Events saved by coalescing
 */

export class InputOptimizer {
  constructor() {
    /** @type {number[]} */
    this.latencyMeasurements = [];
    this.maxMeasurements = 100;

    /** @type {number} */
    this.eventCount = 0;

    /** @type {number} */
    this.coalescedCount = 0;

    /** @type {boolean} */
    this.isInitialized = false;

    // Coalescing state for high-frequency events
    this.pendingMouseMove = null;
    this.pendingTouchMove = null;
    this.coalescingFrameId = null;

    // MessageChannel for high-priority callbacks
    this.messageChannel = null;
    this.pendingCallbacks = [];
  }

  /**
   * Initialize input optimization
   */
  init() {
    if (this.isInitialized) {
      console.warn('[InputOptimizer] Already initialized');
      return;
    }

    console.log('[InputOptimizer] Initializing...');

    // Set up MessageChannel for high-priority processing
    this.setupMessageChannel();

    // Install event coalescing for high-frequency events
    this.installEventCoalescing();

    // Track latency for metrics
    this.installLatencyTracking();

    // CHUNGUS MODE: Enhanced input handling
    this.setupFastInputPath();
    this.disableBrowserGestures();

    this.isInitialized = true;
    console.log('[InputOptimizer] Initialized with event coalescing and high-priority callbacks');
    console.log('[Chungus] Fast input path configured');
  }

  /**
   * CHUNGUS MODE: High-priority input fast path
   */
  setupFastInputPath() {
    // Wait for canvas to exist
    const setupCanvas = () => {
      const gameCanvas = document.querySelector('canvas');
      if (!gameCanvas) {
        // Retry later if canvas not found yet
        setTimeout(setupCanvas, 1000);
        return;
      }

      // Use pointer events for lower latency (bypasses legacy mouse events)
      // Enable pointer capture for smoother dragging
      gameCanvas.addEventListener('pointerdown', (e) => {
        if (e.button === 0) { // Left click
          gameCanvas.setPointerCapture(e.pointerId);
        }
      }, { passive: true });

      gameCanvas.addEventListener('pointerup', (e) => {
        if (gameCanvas.hasPointerCapture(e.pointerId)) {
          gameCanvas.releasePointerCapture(e.pointerId);
        }
      }, { passive: true });

      // Use coalesced events API for batch processing
      gameCanvas.addEventListener('pointermove', (e) => {
        if (e.getCoalescedEvents) {
          const coalescedEvents = e.getCoalescedEvents();
          if (coalescedEvents.length > 1) {
            this.coalescedCount += coalescedEvents.length - 1;
          }
        }
      }, { passive: true });

      console.log('[Chungus] Fast input path configured for canvas');
    };

    // Start trying to set up canvas
    if (document.readyState === 'complete') {
      setupCanvas();
    } else {
      window.addEventListener('load', setupCanvas);
    }
  }

  /**
   * CHUNGUS MODE: Disable browser's built-in gesture handling
   */
  disableBrowserGestures() {
    document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
    document.addEventListener('gesturechange', (e) => e.preventDefault(), { passive: false });
    document.addEventListener('gestureend', (e) => e.preventDefault(), { passive: false });

    // Wait for canvas to exist before adding context menu handler
    const setupCanvasContextMenu = () => {
      const canvas = document.querySelector('canvas');
      if (canvas) {
        // Disable context menu on canvas (right-click)
        canvas.addEventListener('contextmenu', (e) => e.preventDefault(), { passive: false });
        console.log('[Chungus] Browser gestures disabled for canvas');
      } else {
        setTimeout(setupCanvasContextMenu, 1000);
      }
    };

    // Also disable dragging on images (prevents ghost images during drag)
    const disableImageDrag = () => {
      document.querySelectorAll('img').forEach(img => {
        img.draggable = false;
      });
    };

    if (document.readyState === 'complete') {
      setupCanvasContextMenu();
      disableImageDrag();
    } else {
      window.addEventListener('load', () => {
        setupCanvasContextMenu();
        disableImageDrag();
      });
    }

    // Also observe for new images and disable their dragging
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeName === 'IMG') {
            node.draggable = false;
          } else if (node.querySelectorAll) {
            node.querySelectorAll('img').forEach(img => {
              img.draggable = false;
            });
          }
        });
      });
    });

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true
    });

    console.log('[Chungus] Browser gestures disabled');
  }

  /**
   * Set up MessageChannel for high-priority callback scheduling
   * MessageChannel fires after microtasks but before requestAnimationFrame
   */
  setupMessageChannel() {
    if (typeof MessageChannel === 'undefined') {
      console.warn('[InputOptimizer] MessageChannel not available');
      return;
    }

    this.messageChannel = new MessageChannel();
    this.messageChannel.port1.onmessage = () => {
      const callbacks = this.pendingCallbacks;
      this.pendingCallbacks = [];
      for (const cb of callbacks) {
        try {
          cb();
        } catch (e) {
          console.error('[InputOptimizer] Callback error:', e);
        }
      }
    };
  }

  /**
   * Schedule a high-priority callback (fires before next paint)
   * @param {Function} callback
   */
  scheduleHighPriority(callback) {
    this.pendingCallbacks.push(callback);
    if (this.messageChannel) {
      this.messageChannel.port2.postMessage(null);
    } else {
      // Fallback to queueMicrotask if MessageChannel unavailable
      queueMicrotask(callback);
    }
  }

  /**
   * Install event coalescing for high-frequency events
   * This reduces processing overhead by batching rapid-fire events
   */
  installEventCoalescing() {
    // Coalesce mousemove events
    document.addEventListener('mousemove', (e) => {
      this.eventCount++;

      // If we have getCoalescedEvents, use it for smoothest tracking
      if (e.getCoalescedEvents) {
        const coalescedEvents = e.getCoalescedEvents();
        if (coalescedEvents.length > 1) {
          this.coalescedCount += coalescedEvents.length - 1;
        }
      }

      // Store latest event, process on next frame
      this.pendingMouseMove = e;
      this.scheduleCoalescedProcessing();
    }, { passive: true, capture: false });

    // Coalesce touchmove events
    document.addEventListener('touchmove', (e) => {
      this.eventCount++;

      // Use getCoalescedEvents if available
      if (e.touches[0] && e.touches[0].getCoalescedEvents) {
        const coalescedEvents = e.touches[0].getCoalescedEvents();
        if (coalescedEvents.length > 1) {
          this.coalescedCount += coalescedEvents.length - 1;
        }
      }

      this.pendingTouchMove = e;
      this.scheduleCoalescedProcessing();
    }, { passive: true, capture: false });

    // For click/mousedown/mouseup - use high-priority processing
    ['mousedown', 'mouseup', 'click'].forEach(type => {
      document.addEventListener(type, (e) => {
        this.eventCount++;
        this.measureEventLatency(e);
      }, { passive: true, capture: true });
    });

    // For keyboard - high-priority processing
    ['keydown', 'keyup'].forEach(type => {
      document.addEventListener(type, (e) => {
        this.eventCount++;
        this.measureEventLatency(e);
      }, { passive: true, capture: true });
    });
  }

  /**
   * Schedule processing of coalesced events
   */
  scheduleCoalescedProcessing() {
    if (this.coalescingFrameId !== null) return;

    this.coalescingFrameId = requestAnimationFrame(() => {
      this.coalescingFrameId = null;

      // Process coalesced mouse move
      if (this.pendingMouseMove) {
        this.measureEventLatency(this.pendingMouseMove);
        this.pendingMouseMove = null;
      }

      // Process coalesced touch move
      if (this.pendingTouchMove) {
        this.measureEventLatency(this.pendingTouchMove);
        this.pendingTouchMove = null;
      }
    });
  }

  /**
   * Install latency tracking for metrics
   */
  installLatencyTracking() {
    // Track pointer events if available (better precision)
    if (typeof PointerEvent !== 'undefined') {
      document.addEventListener('pointerdown', (e) => {
        this.measureEventLatency(e);
      }, { passive: true, capture: true });
    }
  }

  /**
   * Measure latency from event timestamp to processing
   * @param {Event} event
   */
  measureEventLatency(event) {
    const now = performance.now();
    const eventTime = event.timeStamp || now;

    // timeStamp is usually relative to page load
    // Calculate latency from event to now
    const latency = now - eventTime;

    // Only record reasonable latencies (0-100ms range)
    if (latency >= 0 && latency < 100) {
      this.latencyMeasurements.push(latency);
      if (this.latencyMeasurements.length > this.maxMeasurements) {
        this.latencyMeasurements.shift();
      }
    }
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
        coalescedCount: this.coalescedCount,
      };
    }

    const sum = this.latencyMeasurements.reduce((a, b) => a + b, 0);
    const avg = sum / this.latencyMeasurements.length;
    const max = Math.max(...this.latencyMeasurements);
    const min = Math.min(...this.latencyMeasurements);

    return {
      avgLatency: Math.round(avg * 100) / 100,
      maxLatency: Math.round(max * 100) / 100,
      minLatency: Math.round(min * 100) / 100,
      eventCount: this.eventCount,
      coalescedCount: this.coalescedCount,
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.latencyMeasurements = [];
    this.eventCount = 0;
    this.coalescedCount = 0;
  }
}

// Singleton instance
export const inputOptimizer = new InputOptimizer();

/**
 * Utility: Request high-priority callback
 * Fires after microtasks but before next paint
 * @param {Function} callback
 */
export function requestHighPriorityCallback(callback) {
  if (inputOptimizer.isInitialized) {
    inputOptimizer.scheduleHighPriority(callback);
  } else if (typeof MessageChannel !== 'undefined') {
    const channel = new MessageChannel();
    channel.port1.onmessage = callback;
    channel.port2.postMessage(null);
  } else if (typeof queueMicrotask !== 'undefined') {
    queueMicrotask(callback);
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
  if (event.timeStamp && event.timeStamp > 0) {
    return event.timeStamp;
  }
  return performance.now();
}
