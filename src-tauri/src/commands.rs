//! Tauri Commands - Windows Only
//!
//! IPC commands for performance monitoring.
//! No game state access.

use crate::performance::{PerformanceMonitor, PerformanceStats};
use serde::Serialize;
use tauri::State;

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
    Ok(monitor.get_stats())
}

/// Get system info
#[tauri::command]
pub async fn get_system_info() -> Result<SystemInfo, String> {
    use sysinfo::System;

    let mut system = System::new_all();
    system.refresh_all();

    let gpu_name = detect_gpu();

    Ok(SystemInfo {
        os: "Windows".to_string(),
        cpu_cores: system.cpus().len(),
        total_memory_mb: system.total_memory() / 1024 / 1024,
        gpu_name,
    })
}

fn detect_gpu() -> Option<String> {
    use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIFactory1};

    unsafe {
        if let Ok(factory) = CreateDXGIFactory1::<IDXGIFactory1>() {
            let mut i = 0u32;
            while let Ok(adapter) = factory.EnumAdapters1(i) {
                if let Ok(desc) = adapter.GetDesc1() {
                    let name: String = desc.Description.iter()
                        .take_while(|&&c| c != 0)
                        .map(|&c| char::from_u32(c as u32).unwrap_or('?'))
                        .collect();

                    if !name.contains("Basic") && !name.contains("Microsoft") {
                        let vram_mb = desc.DedicatedVideoMemory / (1024 * 1024);
                        return Some(format!("{} ({}MB)", name.trim(), vram_mb));
                    }
                }
                i += 1;
            }
        }
    }
    None
}
