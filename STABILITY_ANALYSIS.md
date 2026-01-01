# PACDeluxe Stability & Memory Leak Analysis

**Version:** 1.0.0
**Analysis Date:** 2026-01-01
**Analyst:** Automated Code Review

---

## Executive Summary

The PACDeluxe codebase is generally well-structured with good defensive practices. However, several potential memory leaks and stability concerns were identified that should be addressed before production release.

**Risk Level:** Medium
**Critical Issues:** 1
**High Priority Issues:** 2
**Low Priority Issues:** 4

---

## Critical Issues

### 1. Unbounded PID Tracking in WebView Optimizer (CRITICAL)

**Location:** `src-tauri/src/performance.rs:156-168`

**Description:** The background thread that optimizes WebView2 process priorities maintains a `HashSet<u32>` of optimized PIDs that grows indefinitely. PIDs are added but never removed, even when processes terminate.

```rust
let mut optimized_pids: std::collections::HashSet<u32> = std::collections::HashSet::new();

loop {
    if let Some(new_pids) = elevate_webview2_processes(&optimized_pids) {
        for pid in new_pids {
            optimized_pids.insert(pid);  // Only adds, never removes
        }
    }
    std::thread::sleep(std::time::Duration::from_secs(5));
}
```

**Impact:**
- Memory leak: ~4-8 bytes per WebView2 process spawn
- Long-running sessions with many auth popup cycles will accumulate dead PIDs
- In extreme cases (weeks of use with constant popups), could cause memory pressure

**Recommendation:**
```rust
// Add periodic cleanup of dead PIDs
fn elevate_webview2_processes(already_optimized: &mut std::collections::HashSet<u32>) -> Option<Vec<u32>> {
    // First, remove PIDs that no longer exist
    already_optimized.retain(|&pid| process_exists(pid));
    // ... rest of function
}
```

---

## High Priority Issues

### 2. Infinite Loop Thread Never Terminates

**Location:** `src-tauri/src/performance.rs:152-168`

**Description:** The WebView optimizer thread runs an infinite loop with no shutdown mechanism.

```rust
std::thread::spawn(|| {
    loop {  // Infinite loop with no exit condition
        // ...
        std::thread::sleep(std::time::Duration::from_secs(5));
    }
});
```

**Impact:**
- Thread continues running even after main window closes (until process exits)
- Prevents clean shutdown in testing scenarios
- Minor resource waste

**Recommendation:**
```rust
use std::sync::atomic::{AtomicBool, Ordering};
static SHOULD_STOP: AtomicBool = AtomicBool::new(false);

// In the thread:
while !SHOULD_STOP.load(Ordering::Relaxed) {
    // ... work
    std::thread::sleep(std::time::Duration::from_secs(5));
}

// On app shutdown:
SHOULD_STOP.store(true, Ordering::Relaxed);
```

---

### 3. Timer Resolution Not Released on Panic

**Location:** `src-tauri/src/performance.rs:94-104, 306-324`

**Description:** The `timeBeginPeriod(1)` call sets the system timer resolution to 1ms, but the cleanup only runs via `atexit`. If the process crashes or panics, the timer resolution may not be restored.

**Impact:**
- System-wide timer resolution remains at 1ms after crash
- Increased power consumption system-wide
- Affects all processes on the system

**Recommendation:**
Consider using RAII pattern with `Drop` trait, or adding a custom panic hook:
```rust
std::panic::set_hook(Box::new(|_| {
    unsafe { timeEndPeriod(1); }
}));
```

---

## Low Priority Issues

### 4. Asset Cache Response Cloning

**Location:** `src/performance/asset-cache.js:228-230`

**Description:** The asset cache stores cloned Response objects. While the LRU eviction prevents unbounded growth, cached Response bodies consume memory.

```javascript
const clonedResponse = response.clone();
this.set(url, clonedResponse);
```

**Impact:**
- With 256MB default limit, cache can consume significant memory
- Response bodies aren't released until eviction

**Recommendation:**
- Consider storing ArrayBuffers instead of Response objects for large assets
- Add configuration to reduce cache size on low-memory systems

---

### 5. Frame Times Array Shift Operation

**Location:** `src/performance/frame-monitor.js:103-106`

**Description:** The frame monitor uses `Array.shift()` to remove old entries, which is O(n) for arrays.

```javascript
this.frameTimes.push(elapsed);
if (this.frameTimes.length > 60) {
    this.frameTimes.shift();  // O(n) operation
}
```

**Impact:**
- Minor: With only 60 elements, the performance impact is negligible
- Called once per frame (~60 times/second)

**Recommendation:**
Consider using a circular buffer for true O(1) operations:
```javascript
class CircularBuffer {
    constructor(size) { this.data = new Array(size); this.idx = 0; }
    push(val) { this.data[this.idx++ % this.data.length] = val; }
}
```

---

### 6. Popup Counter Never Wraps

**Location:** `src-tauri/src/main.rs:14`

**Description:** The `POPUP_COUNTER` is an `AtomicU32` that increments but never wraps or resets.

```rust
static POPUP_COUNTER: AtomicU32 = AtomicU32::new(0);
let popup_id = POPUP_COUNTER.fetch_add(1, Ordering::SeqCst);
```

**Impact:**
- Theoretical: Would overflow after ~4.3 billion popups
- Practical: Not a real concern for normal usage

**Recommendation:** No action needed - would take years of constant popup creation.

---

### 7. Session Recovery Monitor Timeout

**Location:** `src-tauri/src/main.rs:141-143`

**Description:** The session recovery monitor stops after 5 minutes, which is good for resources but may miss late-occurring session corruption.

```javascript
if (checkCount > 300) {
    clearInterval(stateChecker);  // Stops after 5 minutes
}
```

**Impact:**
- Session corruption after 5 minutes won't trigger auto-recovery
- User would need to manually refresh

**Recommendation:** Consider extending timeout to 15-30 minutes, or implementing a lower-frequency check after the initial period.

---

## Stability Analysis Summary

### Thread Safety

| Component | Status | Notes |
|-----------|--------|-------|
| PerformanceMonitor | OK | Uses Mutex correctly with poison recovery |
| POPUP_COUNTER | OK | AtomicU32 is thread-safe |
| WEBVIEW_OPTIMIZER_RUNNING | OK | AtomicBool swap prevents double-start |
| Asset Cache | N/A | Single-threaded (JavaScript) |

### Resource Cleanup

| Resource | Cleanup Method | Status |
|----------|----------------|--------|
| Timer Resolution | atexit callback | Partial (no panic cleanup) |
| Windows Handles | CloseHandle after use | OK |
| Process Snapshots | CloseHandle after iteration | OK |
| setInterval timers | clearInterval | OK (5-minute limit) |
| requestAnimationFrame | cancelAnimationFrame on stop | OK |

### Error Handling

| Component | Strategy | Status |
|-----------|----------|--------|
| Windows API calls | Log warning, continue | OK |
| Mutex poisoning | Recover inner value | OK |
| Fetch failures | Fallback to cache | OK |
| Popup creation failure | Return Deny | OK |

---

## Recommended Fixes (Priority Order)

1. **[CRITICAL]** Add PID cleanup to WebView optimizer
2. **[HIGH]** Add shutdown mechanism for optimizer thread
3. **[HIGH]** Add panic hook for timer resolution cleanup
4. **[LOW]** Consider ArrayBuffer for large cached assets
5. **[LOW]** Use circular buffer for frame timing

---

## Performance Metrics

### Memory Footprint (Estimated)

| Component | Base | Growth Rate | Max |
|-----------|------|-------------|-----|
| Rust binary | ~15 MB | Static | 15 MB |
| WebView2 | ~100 MB | Per-tab | ~200 MB |
| Asset cache | 0 | Per-asset | 256 MB |
| Frame timing | ~2 KB | Static | 2 KB |
| PID tracker | ~64 B | Per-popup | Unbounded* |

*Unbounded due to identified memory leak

### CPU Usage

| Component | Frequency | Impact |
|-----------|-----------|--------|
| Performance stats polling | 500ms | Negligible |
| WebView optimizer scan | 5s | Very low |
| Frame monitor | Per-frame | Low |
| Session recovery check | 1s | Negligible |

---

## Testing Recommendations

### Memory Leak Testing

```bash
# Run for extended period with Process Explorer monitoring
npm run dev
# Monitor Private Bytes over time
# Create/close many auth popups to stress PID tracker
```

### Stress Testing

1. Open 50+ auth popups in sequence
2. Run for 24+ hours continuously
3. Monitor memory with Windows Task Manager
4. Check for handle leaks with Process Explorer

### Stability Testing

1. Kill WebView2 child processes while app running
2. Simulate network disconnections
3. Test rapid window resize/fullscreen toggle
4. Test with low memory conditions

---

## Conclusion

The PACDeluxe codebase demonstrates good engineering practices overall. The critical memory leak in the PID tracker should be addressed before production deployment, but it would only cause issues in extended sessions with frequent authentication cycles.

The recommended fixes are straightforward and can be implemented in under 2 hours of development time.
