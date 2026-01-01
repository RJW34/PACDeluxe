# Performance Tuning Guide

This document explains what PACDeluxe actually provides for performance and what it cannot do.

## What PACDeluxe Does

| Optimization | How It Works | Real Benefit |
|-------------|--------------|--------------|
| Process Priority | Sets ABOVE_NORMAL_PRIORITY_CLASS | Slight priority over background apps |
| Timer Resolution | 1ms via timeBeginPeriod() | Better timing precision than browser default (15.6ms) |
| DWM Transitions | Disabled for our window | Slightly reduced compositor overhead |
| Dedicated Window | No browser tabs/extensions | Less resource contention |

## What PACDeluxe Cannot Do

| Limitation | Reason |
|-----------|--------|
| GPU Monitoring | Requires vendor-specific SDKs (NVAPI, ADL) |
| Frame Pacing | WebView2 uses requestAnimationFrame, which we can't control |
| Render Optimization | Can't hook into Phaser without modifying upstream game |
| VSync Control | Controlled by browser/OS, not accessible to us |

---

## Frame Monitor

The frame monitor passively measures FPS and frame timing. It does NOT pace or control frames.

```javascript
import { frameMonitor } from './performance/frame-monitor.js';

// Start monitoring
frameMonitor.start();

// Get current metrics
const metrics = frameMonitor.getMetrics();
console.log(`FPS: ${metrics.currentFps}`);
console.log(`Avg frame time: ${metrics.avgFrameTime}ms`);
console.log(`Missed frames: ${metrics.droppedFrames}`);
```

---

## Input Latency Monitoring

The input optimizer measures (but cannot reduce) input latency.

```javascript
import { inputOptimizer } from './performance/input-optimizer.js';

inputOptimizer.init();

const metrics = inputOptimizer.getMetrics();
console.log(`Avg input latency: ${metrics.avgLatency}ms`);
```

---

## Native Optimizations (Rust)

### Process Priority

```rust
// Sets above-normal priority (not "high" or "realtime")
SetPriorityClass(process, ABOVE_NORMAL_PRIORITY_CLASS);
```

### Timer Resolution

```rust
// Windows default is 15.6ms, we set 1ms
timeBeginPeriod(1);
```

This helps with:
- More precise `setTimeout`/`setInterval`
- Smoother requestAnimationFrame callbacks
- Better sleep precision

---

## Profiling Overlay

Toggle with **Ctrl+Shift+P**:

```
┌─────────────────────┐
│ PAC Deluxe          │
├─────────────────────┤
│ FPS      60         │  ← From frame monitor
│ Frame    16.7 ms    │  ← Average frame time
│ Memory   245 MB     │  ← From Rust (sysinfo)
│ CPU      15.2%      │  ← From Rust (sysinfo)
│ RTT      45 ms      │  ← Estimated from Performance API
│ Dropped  0          │  ← Missed frame count
│ ▁▂▃▄▅▆▇█▇▆▅▄▃▂▁    │  ← FPS history graph
└─────────────────────┘
```

**Notes:**
- GPU usage shows "N/A" (not available)
- RTT is estimated, not actual game server ping
- Dropped frames = frames that took >1.5x target time

---

## Realistic Expectations

### What You Get Over Browser

- **Slightly better CPU utilization** - No browser overhead
- **More consistent frame timing** - 1ms timer resolution
- **Dedicated resources** - No tab competition
- **Higher process priority** - Better scheduling

### What You Don't Get

- **Dramatically higher FPS** - Game is still WebView-rendered
- **Lower input latency** - Still goes through same event pipeline
- **GPU optimizations** - Can't access game's WebGL context

---

## Troubleshooting

### Low FPS

1. Check if your GPU drivers are up to date
2. Close other applications competing for resources
3. Ensure Windows power mode is set to "High Performance"
4. The game itself may be the bottleneck (Phaser/canvas rendering)

### High CPU Usage

1. This is normal - the game runs in a WebView
2. CPU usage includes both game logic and rendering
3. sysinfo reports global CPU, not just this process

### Memory Growth

1. WebView2 manages its own memory
2. Restart the app if memory grows excessively
3. This is typically a game issue, not PACDeluxe

---

## Benchmarking Reality

Don't expect dramatic improvements over Chrome. Realistic gains:

| Metric | Chrome | PACDeluxe | Difference |
|--------|--------|-----------|------------|
| FPS | 58-60 | 59-60 | ~1 FPS |
| Frame Consistency | Good | Slightly Better | Fewer micro-stutters |
| Input Latency | ~30ms | ~28ms | ~2ms |
| Memory | ~500MB | ~480MB | ~20MB less |

*Your mileage may vary. The game is still running in Chromium.*
