//! Tauri Commands - Windows Only
//!
//! IPC commands for performance monitoring and window control.
//! No game state access.

use crate::performance::{
    PerformanceMonitor, PerformanceStats, ElevationTelemetry, get_elevation_telemetry,
    GpuStats, get_gpu_stats as get_gpu_stats_impl,
    HdrInfo, get_hdr_info,
};
use serde::Serialize;
use tauri::{State, Manager, AppHandle};
use tracing::{debug, warn};

#[derive(Debug, Clone, Serialize)]
pub struct SystemInfo {
    pub os: String,
    pub cpu_cores: usize,
    pub total_memory_mb: u64,
    pub gpu_name: Option<String>,
}

/// Get performance stats
#[tauri::command]
pub async fn get_performance_stats(
    monitor: State<'_, PerformanceMonitor>,
) -> Result<PerformanceStats, String> {
    let stats = monitor.get_stats();
    debug!("Performance stats: CPU={:.1}%, MEM={}MB", stats.cpu_usage, stats.memory_usage_mb);
    Ok(stats)
}

/// Get system info
#[tauri::command]
pub async fn get_system_info() -> Result<SystemInfo, String> {
    use sysinfo::System;
    debug!("Querying system info");

    let mut system = System::new_all();
    system.refresh_all();

    let gpu_name = detect_gpu();
    let info = SystemInfo {
        os: "Windows".to_string(),
        cpu_cores: system.cpus().len(),
        total_memory_mb: system.total_memory() / 1024 / 1024,
        gpu_name: gpu_name.clone(),
    };

    debug!("System info: {} cores, {}MB RAM, GPU: {:?}",
           info.cpu_cores, info.total_memory_mb, gpu_name);
    Ok(info)
}

fn detect_gpu() -> Option<String> {
    use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIFactory1};

    unsafe {
        match CreateDXGIFactory1::<IDXGIFactory1>() {
            Ok(factory) => {
                let mut i = 0u32;
                while let Ok(adapter) = factory.EnumAdapters1(i) {
                    if let Ok(desc) = adapter.GetDesc1() {
                        let name: String = desc.Description.iter()
                            .take_while(|&&c| c != 0)
                            .map(|&c| char::from_u32(c as u32).unwrap_or('?'))
                            .collect();

                        if !name.contains("Basic") && !name.contains("Microsoft") {
                            let vram_mb = desc.DedicatedVideoMemory / (1024 * 1024);
                            let gpu = format!("{} ({}MB)", name.trim(), vram_mb);
                            debug!("Detected GPU: {}", gpu);
                            return Some(gpu);
                        }
                    }
                    i += 1;
                }
                debug!("No dedicated GPU found, using integrated graphics");
            }
            Err(e) => {
                warn!("Failed to create DXGI factory for GPU detection: {:?}", e);
            }
        }
    }
    None
}

/// Toggle exclusive fullscreen mode
#[tauri::command]
pub async fn toggle_fullscreen(app: AppHandle) -> Result<bool, String> {
    debug!("Toggle fullscreen requested");

    let window = app.get_webview_window("main")
        .ok_or_else(|| {
            warn!("Main window not found for fullscreen toggle");
            "Main window not found".to_string()
        })?;

    let is_fullscreen = window.is_fullscreen()
        .map_err(|e| {
            warn!("Failed to get fullscreen state: {}", e);
            e.to_string()
        })?;

    window.set_fullscreen(!is_fullscreen)
        .map_err(|e| {
            warn!("Failed to set fullscreen to {}: {}", !is_fullscreen, e);
            e.to_string()
        })?;

    debug!("Fullscreen toggled: {} -> {}", is_fullscreen, !is_fullscreen);
    Ok(!is_fullscreen)
}

/// Get WebView2 process elevation telemetry
/// Returns information about the optimizer status and elevated process count
#[tauri::command]
pub fn get_webview_telemetry() -> ElevationTelemetry {
    let telemetry = get_elevation_telemetry();
    debug!(
        "Elevation telemetry: mode={}, elevated={}, active={}",
        telemetry.mode, telemetry.processes_elevated, telemetry.is_active
    );
    telemetry
}

/// Get GPU usage statistics
/// Uses Windows Performance Counters (PDH API) for GPU engine utilization
#[tauri::command]
pub fn get_gpu_stats() -> GpuStats {
    let stats = get_gpu_stats_impl();
    debug!(
        "GPU stats: usage={:.1}%, available={}, gpu={:?}",
        stats.usage_percent, stats.available, stats.name
    );
    stats
}

/// Get HDR display status
/// Detects HDR capability and current status via DXGI 1.6
#[tauri::command]
pub fn get_hdr_status() -> HdrInfo {
    let info = get_hdr_info();
    debug!(
        "HDR status: supported={}, enabled={}, color_space={}, max_nits={}",
        info.supported, info.enabled, info.color_space, info.max_luminance
    );
    info
}
