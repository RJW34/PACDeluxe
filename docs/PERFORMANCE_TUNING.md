# Performance Tuning Guide

This document explains the performance optimizations in Pokemon Auto Chess Deluxe and how to configure them.

## Overview

All optimizations target these areas:

| Area | Goal | Method |
|------|------|--------|
| Rendering | Smoother frames | WebGL optimization, batch rendering |
| Input | Lower latency | High-priority handlers, timing |
| Memory | Reduced usage | Asset caching, pooling |
| CPU | Better utilization | Native helpers, async work |

---

## Rendering Optimizations

### WebGL Mode

The client forces WebGL rendering instead of falling back to Canvas:

```javascript
// game-container.ts equivalent configuration
const config = {
  type: Phaser.WEBGL, // Never AUTO
  // ...
}
```

**Benefits:**
- GPU-accelerated rendering
- Shader-based effects
- Better texture handling

### Frame Pacing

The FramePacer module provides consistent frame delivery:

```javascript
import { framePacer } from './performance/frame-pacer.js';

// Set target frame rate
framePacer.setTargetFps(60);

// Get metrics
const metrics = framePacer.getMetrics();
console.log(`FPS: ${metrics.currentFps}, Dropped: ${metrics.droppedFrames}`);
```

### Render Optimizer

Hooks into Phaser's render loop for monitoring:

```javascript
import { renderOptimizer } from './performance/render-optimizer.js';

// Get current stats
const stats = renderOptimizer.getStats();
// { fps: 60, frameTime: 16.67, drawCalls: 150, objectCount: 500 }
```

---

## Input Optimizations

### High-Priority Events

Input events are captured at the highest priority:

```javascript
document.addEventListener('mousedown', handler, {
  capture: true,  // Capture phase
  passive: true   // Non-blocking
});
```

### Latency Measurement

Track input-to-render latency:

```javascript
import { inputOptimizer } from './performance/input-optimizer.js';

const metrics = inputOptimizer.getMetrics();
console.log(`Avg Latency: ${metrics.avgLatency}ms`);
```

---

## Asset Caching

### Service Worker

The enhanced service worker provides:

- Aggressive precaching of static assets
- Cache-first strategy for assets
- Network-first for game data
- Never caches authentication or game state

### Memory Cache

In-memory caching for frequently accessed assets:

```javascript
import { assetCache } from './performance/asset-cache.js';

// Configure cache size
await assetCache.init({ maxSizeMB: 512 });

// Preload assets
await assetCache.preload([
  '/assets/pokemons/001.png',
  '/assets/abilities/thunderbolt.json'
]);

// Get from cache
const asset = assetCache.get('/assets/pokemons/001.png');
```

---

## Native Optimizations (Tauri)

### System Priority

The Rust backend sets process priority:

```rust
// Windows
SetPriorityClass(process, ABOVE_NORMAL_PRIORITY_CLASS);

// Disables dynamic priority boost for consistent timing
SetProcessPriorityBoost(process, false);
```

### High-Resolution Timer

Windows multimedia timer for 1ms precision:

```rust
timeBeginPeriod(1); // 1ms timer resolution
```

### Image Decoding

Native image decoding offloads work from JavaScript:

```javascript
import { tauriBridge } from './bridge/tauri-bridge.js';

const result = await tauriBridge.decodeImage('/path/to/image.png', 256, 256);
// Returns decoded RGBA data
```

---

## Configuration

### config.json

```json
{
  "performance": {
    "vsync": true,
    "target_fps": 60,
    "gpu_acceleration": true,
    "disable_background_throttle": true,
    "preload_assets": true,
    "cache_size_mb": 512
  }
}
```

### Settings Explained

| Setting | Default | Description |
|---------|---------|-------------|
| `vsync` | `true` | Synchronize with display refresh |
| `target_fps` | `60` | Target frame rate (0 = unlimited) |
| `gpu_acceleration` | `true` | Force GPU rendering |
| `disable_background_throttle` | `true` | Keep running when unfocused |
| `preload_assets` | `true` | Preload assets on startup |
| `cache_size_mb` | `512` | Maximum cache size |

---

## Profiling Overlay

Toggle with `F12 + P`:

```
┌─────────────────────┐
│ PAC Deluxe          │
├─────────────────────┤
│ FPS      60         │
│ Frame    16.7 ms    │
│ Memory   245 MB     │
│ CPU      15.2%      │
│ RTT      45 ms      │
│ Dropped  0          │
│ ▁▂▃▄▅▆▇█▇▆▅▄▃▂▁    │
└─────────────────────┘
```

---

## Troubleshooting

### Low FPS

1. Ensure GPU acceleration is enabled
2. Check for background applications
3. Verify power mode is set to high performance
4. Reduce cache size if memory-constrained

### Input Lag

1. Disable vsync for lowest latency (may cause tearing)
2. Enable high-performance power mode
3. Close other applications

### High Memory Usage

1. Reduce cache size
2. Clear cache periodically
3. Restart application if memory grows continuously

### Build Errors

1. Ensure Rust is installed: `rustc --version`
2. Install Tauri CLI: `npm install -g @tauri-apps/cli`
3. Check platform-specific requirements

---

## Benchmarking

### Run Benchmarks

```bash
# Compare with stock browser
npm run validate

# View results
cat validation/reports/latest.txt
```

### Expected Results

| Metric | Browser | Native Client |
|--------|---------|---------------|
| Avg FPS | 55-60 | 60 (stable) |
| Frame Jitter | 5-10ms | 1-2ms |
| Input Latency | 30-50ms | 15-25ms |
| Memory Usage | 400-600MB | 250-400MB |

*Results vary by hardware and game state.*

---

## Further Reading

- [Phaser 3 Performance Tips](https://phaser.io/tutorials/performance)
- [Tauri Performance Guide](https://tauri.app/v1/guides/performance)
- [WebGL Best Practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices)
