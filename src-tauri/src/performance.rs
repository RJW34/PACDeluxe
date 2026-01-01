//! Performance Optimization Module - Windows Only
//!
//! System-level performance optimizations for the native client.
//! Affects only rendering and system performance, NOT gameplay.

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::Instant;
use sysinfo::System;
use tauri::WebviewWindow;
use tracing::{debug, info, warn};

/// Performance statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PerformanceStats {
    pub fps: f64,
    pub frame_time_ms: f64,
    pub cpu_usage: f32,
    pub memory_usage_mb: u64,
    pub gpu_usage: Option<f32>,
    pub frame_count: u64,
    pub uptime_secs: f64,
}

/// Performance monitor
pub struct PerformanceMonitor {
    start_time: Instant,
    system: Mutex<System>,
    gpu_cache: Mutex<(Instant, Option<f32>)>,
}

impl PerformanceMonitor {
    pub fn new() -> Self {
        Self {
            start_time: Instant::now(),
            system: Mutex::new(System::new_all()),
            gpu_cache: Mutex::new((Instant::now(), None)),
        }
    }

    pub fn get_stats(&self) -> PerformanceStats {
        let mut system = self.system.lock().unwrap();
        system.refresh_cpu_usage();
        system.refresh_memory();

        let uptime = self.start_time.elapsed();
        let cpu_usage = system.global_cpu_usage();
        let memory_usage_mb = system.used_memory() / 1024 / 1024;
        let gpu_usage = self.get_gpu_usage();

        PerformanceStats {
            fps: 0.0,  // FPS is measured in JavaScript now
            frame_time_ms: 0.0,
            cpu_usage,
            memory_usage_mb,
            gpu_usage,
            frame_count: 0,
            uptime_secs: uptime.as_secs_f64(),
        }
    }

    fn get_gpu_usage(&self) -> Option<f32> {
        use std::process::Command;

        let mut cache = self.gpu_cache.lock().unwrap();

        // Only query every 2 seconds
        if cache.0.elapsed().as_secs() < 2 {
            return cache.1;
        }

        // Query GPU using PowerShell (more reliable than wmic on Windows 11)
        let result = Command::new("powershell")
            .args([
                "-NoProfile", "-Command",
                "(Get-Counter '\\GPU Engine(*engtype_3D)\\Utilization Percentage' -ErrorAction SilentlyContinue).CounterSamples | Measure-Object -Property CookedValue -Maximum | Select-Object -ExpandProperty Maximum"
            ])
            .output();

        let usage = match result {
            Ok(output) if output.status.success() => {
                String::from_utf8_lossy(&output.stdout)
                    .trim()
                    .parse::<f32>()
                    .ok()
            }
            _ => None,
        };

        cache.0 = Instant::now();
        cache.1 = usage;
        usage
    }
}

impl Default for PerformanceMonitor {
    fn default() -> Self {
        Self::new()
    }
}

/// Apply Windows system optimizations
pub fn apply_system_optimizations() {
    info!("Applying Windows performance optimizations");

    use windows::Win32::System::Threading::{
        GetCurrentProcess, SetPriorityClass, SetProcessPriorityBoost,
        ABOVE_NORMAL_PRIORITY_CLASS,
    };

    unsafe {
        let process = GetCurrentProcess();

        // Set above-normal priority
        if let Err(e) = SetPriorityClass(process, ABOVE_NORMAL_PRIORITY_CLASS) {
            warn!("Failed to set process priority: {:?}", e);
        } else {
            debug!("Set process priority to above normal");
        }

        // Disable priority boost for consistent timing
        if let Err(e) = SetProcessPriorityBoost(process, true) {
            warn!("Failed to disable priority boost: {:?}", e);
        } else {
            debug!("Disabled priority boost");
        }
    }

    // Enable 1ms timer resolution
    #[link(name = "winmm")]
    extern "system" {
        fn timeBeginPeriod(uPeriod: u32) -> u32;
    }

    unsafe {
        if timeBeginPeriod(1) == 0 {
            debug!("Enabled 1ms timer resolution");
            register_timer_cleanup();
        }
    }
}

fn register_timer_cleanup() {
    use std::sync::Once;
    static REGISTERED: Once = Once::new();

    REGISTERED.call_once(|| {
        extern "C" fn cleanup() {
            #[link(name = "winmm")]
            extern "system" {
                fn timeEndPeriod(uPeriod: u32) -> u32;
            }
            unsafe { timeEndPeriod(1); }
        }

        extern "C" {
            fn atexit(f: extern "C" fn()) -> i32;
        }
        unsafe { atexit(cleanup); }
    });
}

/// Apply window optimizations
pub fn optimize_window(window: &WebviewWindow) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_TRANSITIONS_FORCEDISABLED};

    if let Ok(hwnd) = window.hwnd() {
        let hwnd = HWND(hwnd.0 as *mut std::ffi::c_void);

        unsafe {
            let disable: i32 = 1;
            if DwmSetWindowAttribute(
                hwnd,
                DWMWA_TRANSITIONS_FORCEDISABLED,
                &disable as *const i32 as *const std::ffi::c_void,
                std::mem::size_of::<i32>() as u32,
            ).is_ok() {
                debug!("Disabled DWM transitions");
            }
        }
    }

    info!("Window optimizations applied");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_performance_monitor() {
        let monitor = PerformanceMonitor::new();
        let stats = monitor.get_stats();
        assert!(stats.uptime_secs >= 0.0);
    }
}
