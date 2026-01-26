//! Tauri Commands - Cross-platform
//!
//! IPC commands for performance monitoring and window control.
//! No game state access.

use crate::performance::{
    PerformanceMonitor, PerformanceStats, ElevationTelemetry, get_elevation_telemetry,
    GpuStats, get_gpu_stats as get_gpu_stats_impl,
    HdrInfo, get_hdr_info,
};
use serde::{Serialize, Deserialize};
use tauri::{State, Manager, AppHandle};
use tauri_plugin_updater::UpdaterExt;
use tracing::{debug, warn, info};
use std::sync::Mutex;

/// Window display mode
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub enum WindowMode {
    Windowed,
    Fullscreen,
    BorderlessWindowed,
}

/// Stored window mode state (avoids fragile window property queries)
pub static CURRENT_WINDOW_MODE: std::sync::atomic::AtomicU8 = std::sync::atomic::AtomicU8::new(0);
// 0 = Windowed, 1 = Fullscreen, 2 = BorderlessWindowed

impl WindowMode {
    fn to_u8(self) -> u8 {
        match self {
            WindowMode::Windowed => 0,
            WindowMode::Fullscreen => 1,
            WindowMode::BorderlessWindowed => 2,
        }
    }

    fn from_u8(v: u8) -> Self {
        match v {
            1 => WindowMode::Fullscreen,
            2 => WindowMode::BorderlessWindowed,
            _ => WindowMode::Windowed,
        }
    }
}

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
    let os_name = get_os_name();
    let info = SystemInfo {
        os: os_name,
        cpu_cores: system.cpus().len(),
        total_memory_mb: system.total_memory() / 1024 / 1024,
        gpu_name: gpu_name.clone(),
    };

    debug!("System info: {} cores, {}MB RAM, GPU: {:?}",
           info.cpu_cores, info.total_memory_mb, gpu_name);
    Ok(info)
}

/// Get the operating system name
fn get_os_name() -> String {
    #[cfg(target_os = "windows")]
    { "Windows".to_string() }
    #[cfg(target_os = "linux")]
    { "Linux".to_string() }
    #[cfg(target_os = "macos")]
    { "macOS".to_string() }
    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    { "Unknown".to_string() }
}

/// Detect GPU name (Windows - via DXGI)
#[cfg(target_os = "windows")]
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

/// Detect GPU name (Linux - via sysfs)
#[cfg(target_os = "linux")]
fn detect_gpu() -> Option<String> {
    // Try to read GPU info from /sys/class/drm
    if let Ok(entries) = std::fs::read_dir("/sys/class/drm") {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            // Look for card* directories (not card*-*)
            if name.starts_with("card") && !name.contains('-') {
                let device_path = entry.path().join("device");
                let vendor_path = device_path.join("vendor");
                let device_id_path = device_path.join("device");

                if let (Ok(vendor), Ok(device_id)) = (
                    std::fs::read_to_string(&vendor_path),
                    std::fs::read_to_string(&device_id_path),
                ) {
                    let vendor = vendor.trim();
                    let device_id = device_id.trim();
                    let gpu_name = match vendor {
                        "0x10de" => format!("NVIDIA GPU ({})", device_id),
                        "0x1002" => format!("AMD GPU ({})", device_id),
                        "0x8086" => format!("Intel GPU ({})", device_id),
                        _ => format!("GPU (vendor: {}, device: {})", vendor, device_id),
                    };
                    debug!("Detected GPU: {}", gpu_name);
                    return Some(gpu_name);
                }
            }
        }
    }
    debug!("No GPU detected via sysfs");
    None
}

/// Toggle exclusive fullscreen mode
#[tauri::command]
pub async fn toggle_fullscreen(app: AppHandle) -> Result<bool, String> {
    debug!("Toggle fullscreen requested");
    use std::sync::atomic::Ordering;

    let window = app.get_webview_window("main")
        .ok_or_else(|| {
            warn!("Main window not found for fullscreen toggle");
            "Main window not found".to_string()
        })?;

    let current_mode = WindowMode::from_u8(CURRENT_WINDOW_MODE.load(Ordering::SeqCst));

    if current_mode == WindowMode::Fullscreen {
        // Exit fullscreen -> go to Windowed
        window.set_fullscreen(false).map_err(|e| e.to_string())?;
        std::thread::sleep(std::time::Duration::from_millis(50));
        window.set_decorations(true).map_err(|e| e.to_string())?;
        CURRENT_WINDOW_MODE.store(WindowMode::Windowed.to_u8(), Ordering::SeqCst);
        debug!("Fullscreen toggled: Fullscreen -> Windowed");
        Ok(false)
    } else {
        // Enter fullscreen from any mode
        if current_mode == WindowMode::BorderlessWindowed {
            // First restore from borderless
            window.set_decorations(true).map_err(|e| e.to_string())?;
            window.unmaximize().map_err(|e| e.to_string())?;
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        window.set_fullscreen(true).map_err(|e| e.to_string())?;
        CURRENT_WINDOW_MODE.store(WindowMode::Fullscreen.to_u8(), Ordering::SeqCst);
        debug!("Fullscreen toggled: {:?} -> Fullscreen", current_mode);
        Ok(true)
    }
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

/// Set window display mode (windowed, fullscreen, or borderless)
#[tauri::command]
pub async fn set_window_mode(app: AppHandle, mode: WindowMode) -> Result<WindowMode, String> {
    debug!("Setting window mode to {:?}", mode);
    use std::sync::atomic::Ordering;

    let window = app.get_webview_window("main")
        .ok_or_else(|| {
            warn!("Main window not found for window mode change");
            "Main window not found".to_string()
        })?;

    let current_mode = WindowMode::from_u8(CURRENT_WINDOW_MODE.load(Ordering::SeqCst));

    // Skip if already in requested mode
    if current_mode == mode {
        debug!("Already in {:?} mode, skipping", mode);
        return Ok(mode);
    }

    // Delay between window operations to let Windows process them
    let delay = || std::thread::sleep(std::time::Duration::from_millis(50));

    match mode {
        WindowMode::Windowed => {
            // Exit fullscreen if needed
            if current_mode == WindowMode::Fullscreen {
                window.set_fullscreen(false).map_err(|e| e.to_string())?;
                delay();
            }
            // Restore decorations
            window.set_decorations(true).map_err(|e| e.to_string())?;
            delay();
            // Unmaximize if we were borderless
            if current_mode == WindowMode::BorderlessWindowed {
                window.unmaximize().map_err(|e| e.to_string())?;
            }
            debug!("Window mode set to Windowed");
        }
        WindowMode::Fullscreen => {
            // Clean up borderless state first
            if current_mode == WindowMode::BorderlessWindowed {
                window.set_decorations(true).map_err(|e| e.to_string())?;
                window.unmaximize().map_err(|e| e.to_string())?;
                delay();
            }
            window.set_fullscreen(true).map_err(|e| e.to_string())?;
            debug!("Window mode set to Fullscreen");
        }
        WindowMode::BorderlessWindowed => {
            // Exit fullscreen first if needed
            if current_mode == WindowMode::Fullscreen {
                window.set_fullscreen(false).map_err(|e| e.to_string())?;
                delay();
            }
            // Remove decorations then maximize
            window.set_decorations(false).map_err(|e| e.to_string())?;
            delay();
            window.maximize().map_err(|e| e.to_string())?;
            debug!("Window mode set to BorderlessWindowed");
        }
    }

    CURRENT_WINDOW_MODE.store(mode.to_u8(), Ordering::SeqCst);
    Ok(mode)
}

/// Get current window display mode
#[tauri::command]
pub async fn get_window_mode(_app: AppHandle) -> Result<WindowMode, String> {
    use std::sync::atomic::Ordering;
    let mode = WindowMode::from_u8(CURRENT_WINDOW_MODE.load(Ordering::SeqCst));
    debug!("Current window mode: {:?}", mode);
    Ok(mode)
}

/// Update info returned to JavaScript
#[derive(Debug, Clone, Serialize)]
pub struct UpdateInfo {
    pub available: bool,
    pub version: Option<String>,
    pub body: Option<String>,
}

/// Global state to store pending update for download
pub struct PendingUpdate(pub Mutex<Option<tauri_plugin_updater::Update>>);

/// Check for available updates
/// Returns update info if available, or indicates no update needed
#[tauri::command]
pub async fn check_for_updates(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
) -> Result<UpdateInfo, String> {
    info!("Checking for updates...");

    let updater = app.updater_builder().build().map_err(|e| {
        warn!("Failed to build updater: {}", e);
        e.to_string()
    })?;

    match updater.check().await {
        Ok(Some(update)) => {
            let version = update.version.clone();
            let body = update.body.clone();
            info!("Update available: v{}", version);

            // Store the update for later download
            *pending.0.lock().unwrap() = Some(update);

            Ok(UpdateInfo {
                available: true,
                version: Some(version),
                body,
            })
        }
        Ok(None) => {
            info!("App is up to date");
            Ok(UpdateInfo {
                available: false,
                version: None,
                body: None,
            })
        }
        Err(e) => {
            warn!("Update check failed: {}", e);
            Err(e.to_string())
        }
    }
}

/// Download and install the pending update
#[tauri::command]
pub async fn install_update(
    pending: State<'_, PendingUpdate>,
) -> Result<(), String> {
    info!("Installing update...");

    let update = pending.0.lock().unwrap().take()
        .ok_or_else(|| "No pending update to install".to_string())?;

    // Download and install
    update.download_and_install(|_chunk, _total| {}, || {}).await
        .map_err(|e| {
            warn!("Update installation failed: {}", e);
            e.to_string()
        })?;

    info!("Update installed successfully");
    Ok(())
}

/// Restart the application
#[tauri::command]
pub async fn restart_app(app: AppHandle) -> Result<(), String> {
    info!("Restarting application...");
    app.restart();
}
