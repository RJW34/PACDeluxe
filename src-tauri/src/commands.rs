//! Tauri Commands - Windows Only
//!
//! IPC commands for performance monitoring and window control.
//! No game state access.

use crate::performance::{PerformanceMonitor, PerformanceStats};
use serde::Serialize;
use tauri::{State, Manager, AppHandle};

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

/// Get custom background image as base64
#[tauri::command]
pub async fn get_background_image() -> Result<String, String> {
    use std::io::Read;
    use std::path::PathBuf;

    // Try to find the asset in various locations
    let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_dir = exe_path.parent().ok_or("No parent dir")?;

    let possible_paths = [
        exe_dir.join("assets").join("background.jpg"),
        exe_dir.join("background.jpg"),
        PathBuf::from("assets/background.jpg"),
        PathBuf::from("src-tauri/assets/background.jpg"),
    ];

    for path in &possible_paths {
        if path.exists() {
            let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
            let mut buffer = Vec::new();
            file.read_to_end(&mut buffer).map_err(|e| e.to_string())?;

            use base64::{Engine, engine::general_purpose::STANDARD};
            let encoded = STANDARD.encode(&buffer);
            return Ok(format!("data:image/jpeg;base64,{}", encoded));
        }
    }

    Err("Background image not found".to_string())
}

/// Toggle exclusive fullscreen mode
#[tauri::command]
pub async fn toggle_fullscreen(app: AppHandle) -> Result<bool, String> {
    let window = app.get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;

    let is_fullscreen = window.is_fullscreen()
        .map_err(|e| e.to_string())?;

    window.set_fullscreen(!is_fullscreen)
        .map_err(|e| e.to_string())?;

    Ok(!is_fullscreen)
}
