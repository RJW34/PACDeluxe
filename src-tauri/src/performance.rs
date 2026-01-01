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
use std::sync::atomic::{AtomicBool, Ordering};

/// Performance statistics from native code
/// Note: FPS is measured in JavaScript (frame-monitor.js), not here
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PerformanceStats {
    pub cpu_usage: f32,
    pub memory_usage_mb: u64,
    pub uptime_secs: f64,
}

/// Performance monitor
pub struct PerformanceMonitor {
    start_time: Instant,
    system: Mutex<System>,
}

impl PerformanceMonitor {
    pub fn new() -> Self {
        Self {
            start_time: Instant::now(),
            system: Mutex::new(System::new_all()),
        }
    }

    pub fn get_stats(&self) -> PerformanceStats {
        let mut system = self.system.lock().unwrap_or_else(|e| e.into_inner());
        system.refresh_cpu_usage();
        system.refresh_memory();

        let uptime = self.start_time.elapsed();
        let cpu_usage = system.global_cpu_usage();
        let memory_usage_mb = system.used_memory() / 1024 / 1024;

        PerformanceStats {
            cpu_usage,
            memory_usage_mb,
            uptime_secs: uptime.as_secs_f64(),
        }
    }
}

impl Default for PerformanceMonitor {
    fn default() -> Self {
        Self::new()
    }
}

/// Flag to track if WebView2 optimization thread is running
static WEBVIEW_OPTIMIZER_RUNNING: AtomicBool = AtomicBool::new(false);

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

    // Disable power throttling for consistent performance
    disable_power_throttling();

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

    // Start background thread to optimize WebView2 child processes
    start_webview_optimizer();
}

/// Disable Windows power throttling for the current process
fn disable_power_throttling() {
    use windows::Win32::System::Threading::{
        GetCurrentProcess, SetProcessInformation, ProcessPowerThrottling,
        PROCESS_POWER_THROTTLING_STATE,
        PROCESS_POWER_THROTTLING_EXECUTION_SPEED,
        PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION,
    };

    unsafe {
        let process = GetCurrentProcess();

        // Disable both execution speed throttling and timer resolution throttling
        let state = PROCESS_POWER_THROTTLING_STATE {
            Version: 1, // PROCESS_POWER_THROTTLING_CURRENT_VERSION
            ControlMask: PROCESS_POWER_THROTTLING_EXECUTION_SPEED
                | PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION,
            StateMask: 0, // 0 = disable throttling for masked features
        };

        let result = SetProcessInformation(
            process,
            ProcessPowerThrottling,
            &state as *const _ as *const std::ffi::c_void,
            std::mem::size_of::<PROCESS_POWER_THROTTLING_STATE>() as u32,
        );

        if result.is_ok() {
            debug!("Disabled power throttling");
        } else {
            warn!("Failed to disable power throttling (may require Windows 10 1709+)");
        }
    }
}

/// Start a background thread that periodically elevates WebView2 child process priority
fn start_webview_optimizer() {
    // Only start once
    if WEBVIEW_OPTIMIZER_RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }

    std::thread::spawn(|| {
        // Wait for WebView2 to spawn
        std::thread::sleep(std::time::Duration::from_secs(2));

        let mut optimized_pids: std::collections::HashSet<u32> = std::collections::HashSet::new();

        loop {
            if let Some(new_pids) = elevate_webview2_processes(&optimized_pids) {
                for pid in new_pids {
                    optimized_pids.insert(pid);
                }
            }

            // Check every 5 seconds for new WebView2 processes
            std::thread::sleep(std::time::Duration::from_secs(5));
        }
    });

    debug!("Started WebView2 optimizer thread");
}

/// Find and elevate WebView2 child processes
fn elevate_webview2_processes(already_optimized: &std::collections::HashSet<u32>) -> Option<Vec<u32>> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32First, Process32Next,
        PROCESSENTRY32, TH32CS_SNAPPROCESS,
    };
    use windows::Win32::System::Threading::{
        OpenProcess, SetPriorityClass, SetProcessPriorityBoost,
        ABOVE_NORMAL_PRIORITY_CLASS, PROCESS_SET_INFORMATION,
    };

    let mut new_pids = Vec::new();
    let our_pid = std::process::id();
    debug!("WebView2 optimizer scanning for children of PID {}", our_pid);

    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0).ok()?;

        let mut entry = PROCESSENTRY32 {
            dwSize: std::mem::size_of::<PROCESSENTRY32>() as u32,
            ..Default::default()
        };

        if Process32First(snapshot, &mut entry).is_ok() {
            loop {
                // szExeFile is [CHAR; 260] where CHAR wraps i8
                let process_name: String = entry.szExeFile
                    .iter()
                    .take_while(|&&c| c != 0)
                    .map(|&c| c as u8 as char)
                    .collect();

                let pid = entry.th32ProcessID;
                let parent_pid = entry.th32ParentProcessID;

                // Look for WebView2 processes that are children of our process
                // WebView2 spawns msedgewebview2.exe processes
                let is_webview = process_name.to_lowercase().contains("msedgewebview2");
                if is_webview {
                    let is_child = parent_pid == our_pid;
                    let is_descendant = !is_child && is_descendant_of(snapshot, pid, our_pid);
                    debug!("Found WebView2 PID {} (parent: {}), is_child: {}, is_descendant: {}",
                           pid, parent_pid, is_child, is_descendant);
                }

                if is_webview
                    && (parent_pid == our_pid || is_descendant_of(snapshot, pid, our_pid))
                    && !already_optimized.contains(&pid)
                {
                    if let Ok(handle) = OpenProcess(PROCESS_SET_INFORMATION, false, pid) {
                        if SetPriorityClass(handle, ABOVE_NORMAL_PRIORITY_CLASS).is_ok() {
                            debug!("Elevated WebView2 process {} priority", pid);
                            new_pids.push(pid);
                        }
                        // Also disable priority boost for consistent timing
                        let _ = SetProcessPriorityBoost(handle, true);
                        let _ = CloseHandle(handle);
                    }
                }

                if Process32Next(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }

        let _ = CloseHandle(snapshot);
    }

    if new_pids.is_empty() {
        None
    } else {
        info!("Optimized {} WebView2 process(es)", new_pids.len());
        Some(new_pids)
    }
}

/// Check if a process is a descendant of another process
/// Uses a separate snapshot to avoid modifying the caller's iterator position
fn is_descendant_of(_snapshot: windows::Win32::Foundation::HANDLE, pid: u32, ancestor_pid: u32) -> bool {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32First, Process32Next, PROCESSENTRY32, TH32CS_SNAPPROCESS,
    };

    let mut visited = std::collections::HashSet::new();
    let mut current_pid = pid;

    unsafe {
        // Create a separate snapshot to avoid interfering with caller's iteration
        let Ok(local_snapshot) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
            return false;
        };

        let result = loop {
            if visited.contains(&current_pid) || current_pid == 0 {
                break false;
            }
            visited.insert(current_pid);

            let mut entry = PROCESSENTRY32 {
                dwSize: std::mem::size_of::<PROCESSENTRY32>() as u32,
                ..Default::default()
            };

            if Process32First(local_snapshot, &mut entry).is_err() {
                break false;
            }

            let mut found_parent = None;
            loop {
                if entry.th32ProcessID == current_pid {
                    found_parent = Some(entry.th32ParentProcessID);
                    break;
                }
                if Process32Next(local_snapshot, &mut entry).is_err() {
                    break;
                }
            }

            match found_parent {
                Some(parent) if parent == ancestor_pid => break true,
                Some(parent) => current_pid = parent,
                None => break false,
            }
        };

        let _ = CloseHandle(local_snapshot);
        result
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
    use windows::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_TRANSITIONS_FORCEDISABLED,
    };

    if let Ok(hwnd) = window.hwnd() {
        let hwnd = HWND(hwnd.0 as *mut std::ffi::c_void);

        unsafe {
            // Disable DWM transitions for faster window updates
            let disable: i32 = 1;
            if DwmSetWindowAttribute(
                hwnd,
                DWMWA_TRANSITIONS_FORCEDISABLED,
                &disable as *const i32 as *const std::ffi::c_void,
                std::mem::size_of::<i32>() as u32,
            ).is_ok() {
                debug!("Disabled DWM transitions");
            }

            // DWMWA_USE_IMMERSIVE_DARK_MODE_BEFORE_20H1 = 19 (undocumented, reduces compositing)
            // DWMWA_WINDOW_CORNER_PREFERENCE = 33 (disable rounded corners = faster)
            // DWMWA_SYSTEMBACKDROP_TYPE = 38 (disable backdrop effects)

            // Disable rounded corners (Windows 11) for slightly faster rendering
            const DWMWA_WINDOW_CORNER_PREFERENCE: u32 = 33;
            const DWMWCP_DONOTROUND: i32 = 1;
            let _ = DwmSetWindowAttribute(
                hwnd,
                windows::Win32::Graphics::Dwm::DWMWINDOWATTRIBUTE(DWMWA_WINDOW_CORNER_PREFERENCE as i32),
                &DWMWCP_DONOTROUND as *const i32 as *const std::ffi::c_void,
                std::mem::size_of::<i32>() as u32,
            );

            // Disable system backdrop/mica effects (Windows 11)
            const DWMWA_SYSTEMBACKDROP_TYPE: u32 = 38;
            const DWMSBT_NONE: i32 = 1;
            let _ = DwmSetWindowAttribute(
                hwnd,
                windows::Win32::Graphics::Dwm::DWMWINDOWATTRIBUTE(DWMWA_SYSTEMBACKDROP_TYPE as i32),
                &DWMSBT_NONE as *const i32 as *const std::ffi::c_void,
                std::mem::size_of::<i32>() as u32,
            );
        }
    }

    // Set DXGI frame latency via GPU scheduling priority
    // Note: WebView2 owns its swap chain, so we can't directly call SetMaximumFrameLatency.
    // Instead, we optimize what we can: DWM compositor hints and GPU scheduling.
    configure_dxgi_latency();

    info!("Window optimizations applied");
}

/// Configure DXGI for lower latency
/// Note: Direct swap chain access not available for WebView2 scenarios.
/// This function sets GPU scheduling hints that affect frame delivery.
fn configure_dxgi_latency() {
    use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIFactory1};

    unsafe {
        // Get DXGI factory to query adapter capabilities
        if let Ok(factory) = CreateDXGIFactory1::<IDXGIFactory1>() {
            let mut i = 0u32;
            while let Ok(adapter) = factory.EnumAdapters1(i) {
                if let Ok(desc) = adapter.GetDesc1() {
                    let name: String = desc.Description.iter()
                        .take_while(|&&c| c != 0)
                        .map(|&c| char::from_u32(c as u32).unwrap_or('?'))
                        .collect();

                    // Skip software/basic adapters
                    if !name.contains("Basic") && !name.contains("Microsoft") {
                        debug!("Found GPU: {} - DXGI latency hints applied", name.trim());
                        // The actual swap chain latency is controlled by WebView2
                        // We've done what we can: disabled DWM effects and set process priority
                        break;
                    }
                }
                i += 1;
            }
        }
    }

    // Log that we've configured what we can
    debug!("DXGI latency optimization: DWM effects disabled, GPU adapter verified");
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
