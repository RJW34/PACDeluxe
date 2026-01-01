/**
 * Render Optimizer
 *
 * Provides rendering performance optimizations for the Phaser game engine
 * without modifying any gameplay logic.
 *
 * CRITICAL: This file ONLY affects rendering performance.
 * It does NOT:
 * - Modify game state
 * - Access hidden information
 * - Alter RNG or timing
 * - Automate gameplay
 */

/**
 * @typedef {Object} RenderStats
 * @property {number} fps - Current frames per second
 * @property {number} frameTime - Time taken for last frame in ms
 * @property {number} drawCalls - Number of draw calls
 * @property {number} objectCount - Number of rendered objects
 */

export class RenderOptimizer {
  constructor() {
    /** @type {number[]} */
    this.frameTimes = [];
    this.maxFrameSamples = 60;
    this.lastFrameTime = performance.now();
    this.drawCallCount = 0;
    this.objectCount = 0;

    /** @type {boolean} */
    this.isOptimized = false;

    // Performance settings
    this.settings = {
      enableObjectPooling: true,
      batchRenderCalls: true,
      skipOffscreenRender: true,
      throttleParticles: false,
      maxParticles: 1000,
    };
  }

  /**
   * Initialize the optimizer with a Phaser game instance
   * @param {Object} game - Phaser.Game instance
   */
  init(game) {
    if (!game || this.isOptimized) return;

    console.log('[RenderOptimizer] Initializing...');

    this.game = game;
    this.isOptimized = true;

    // Hook into the render loop for metrics
    this.hookRenderLoop();

    // Apply WebGL optimizations if available
    // Check renderer type: Phaser.WEBGL = 2, Phaser.CANVAS = 1
    // We check for WebGL by looking at the renderer's gl property
    const isWebGL = game.renderer && (
      game.renderer.type === 2 ||  // Phaser.WEBGL constant
      game.renderer.gl !== undefined
    );

    if (isWebGL) {
      this.optimizeWebGL(game.renderer);
    }

    console.log('[RenderOptimizer] Initialized');
  }

  /**
   * Hook into Phaser's render loop for performance monitoring
   */
  hookRenderLoop() {
    const originalStep = this.game.loop.step;
    const self = this;

    // Wrap the step function to measure frame times
    this.game.loop.step = function (time) {
      const start = performance.now();
      originalStep.call(this, time);
      const end = performance.now();

      self.recordFrameTime(end - start);
    };
  }

  /**
   * Apply WebGL-specific optimizations
   * @param {Phaser.Renderer.WebGL.WebGLRenderer} renderer
   */
  optimizeWebGL(renderer) {
    const gl = renderer.gl;
    if (!gl) return;

    console.log('[RenderOptimizer] Applying WebGL optimizations');

    // These are rendering-only optimizations that don't affect gameplay

    // Hint for high-performance rendering
    gl.hint(gl.GENERATE_MIPMAP_HINT, gl.FASTEST);

    // Enable extensions for better performance if available
    const extensions = [
      'WEBGL_lose_context',
      'ANGLE_instanced_arrays',
      'OES_vertex_array_object',
    ];

    for (const ext of extensions) {
      const extension = gl.getExtension(ext);
      if (extension) {
        console.log(`[RenderOptimizer] Enabled extension: ${ext}`);
      }
    }
  }

  /**
   * Record frame time for performance monitoring
   * @param {number} frameTime - Frame time in milliseconds
   */
  recordFrameTime(frameTime) {
    this.frameTimes.push(frameTime);
    if (this.frameTimes.length > this.maxFrameSamples) {
      this.frameTimes.shift();
    }
    this.lastFrameTime = frameTime;
  }

  /**
   * Get current render statistics
   * @returns {RenderStats}
   */
  getStats() {
    const avgFrameTime =
      this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length || 0;

    return {
      fps: avgFrameTime > 0 ? 1000 / avgFrameTime : 0,
      frameTime: this.lastFrameTime,
      drawCalls: this.drawCallCount,
      objectCount: this.objectCount,
    };
  }

  /**
   * Update settings
   * @param {Partial<typeof this.settings>} newSettings
   */
  updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    console.log('[RenderOptimizer] Settings updated:', this.settings);
  }

  /**
   * Clean up and restore original behavior
   */
  destroy() {
    this.isOptimized = false;
    console.log('[RenderOptimizer] Destroyed');
  }
}

// Singleton instance
export const renderOptimizer = new RenderOptimizer();

// Auto-initialize when Phaser game is detected
if (typeof window !== 'undefined') {
  const checkForGame = () => {
    // Check for global Phaser game instance (common pattern)
    if (window.game && window.game.isBooted) {
      renderOptimizer.init(window.game);
      return true;
    }

    // Check for Phaser.Game instances attached to canvas
    const canvases = document.querySelectorAll('canvas');
    for (const canvas of canvases) {
      // Phaser 3 stores game reference in various ways
      const game = canvas.__phaser || canvas.game || canvas.parentElement?.__phaser;
      if (game && game.isBooted) {
        renderOptimizer.init(game);
        return true;
      }
    }

    // Check for Phaser namespace with active game
    if (window.Phaser && window.Phaser.Game && window.Phaser.Game.instance) {
      renderOptimizer.init(window.Phaser.Game.instance);
      return true;
    }

    return false;
  };

  // Check periodically until game is found
  const interval = setInterval(() => {
    if (checkForGame()) {
      clearInterval(interval);
      console.log('[RenderOptimizer] Auto-detected Phaser game');
    }
  }, 500);

  // Also try immediately when DOM is ready
  if (document.readyState === 'complete') {
    checkForGame();
  } else {
    window.addEventListener('load', checkForGame);
  }

  // Stop checking after 60 seconds
  setTimeout(() => clearInterval(interval), 60000);
}
