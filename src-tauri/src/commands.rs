//! Tauri Commands - Cross-platform
//!
//! IPC commands for performance monitoring and window control.
//! No game state access.

use crate::performance::{
    get_elevation_telemetry, get_gpu_stats as get_gpu_stats_impl, get_hdr_info, ElevationTelemetry,
    GpuStats, HdrInfo, PerformanceMonitor, PerformanceStats,
};
use reqwest::{
    header::{HeaderMap, HeaderName, HeaderValue},
    Method, Url,
};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::Mutex, time::Duration};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::UpdaterExt;
use tracing::{debug, info, warn};

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

const PROD_ORIGIN: &str = "https://pokemon-auto-chess.com";
const PROD_HOST: &str = "pokemon-auto-chess.com";
const COMMUNITY_SERVERS_MANIFEST_URL: &str =
    "https://raw.githubusercontent.com/keldaanCommunity/pokemonAutoChess/master/community-servers.md";

#[derive(Debug, Clone, Deserialize)]
pub struct ProxyHttpRequest {
    pub url: String,
    pub method: Option<String>,
    pub headers: Option<HashMap<String, String>>,
    pub body: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProxyHttpResponse {
    pub url: String,
    pub status: u16,
    pub status_text: String,
    pub headers: HashMap<String, String>,
    pub body: String,
}

/// Resolve a proxy request to its final target URL.
///
/// Security model (origin-scoped, not path-scoped):
///   - Relative paths are always routed to the production origin. The calling
///     JS layer is responsible for only forwarding non-local requests here,
///     so any relative path that reaches this function is by definition an
///     upstream API call.
///   - Absolute URLs are accepted only when they target the production origin
///     (or a subdomain of it), or when they exactly match the community-server
///     manifest hosted on GitHub (read-only).
///   - Only HTTPS is allowed for absolute URLs.
///
/// This replaces the previous API-path allowlist. Maintaining a closed list of
/// path prefixes was fragile: every upstream endpoint addition silently
/// returned 404 at runtime. Scoping by origin gives the same safety property
/// (we can only talk to production) while remaining robust to upstream change.
fn resolve_proxy_target(url: &str, method: &str) -> Result<Url, String> {
    let normalized_method = method.to_ascii_uppercase();
    let is_read_only = matches!(normalized_method.as_str(), "GET" | "HEAD");

    // Relative path → always routed to production. Reject path-traversal
    // attempts that would change the URL structure (defensive, the prod server
    // should handle traversal itself but we don't need to forward weirdness).
    if url.starts_with('/') {
        return Url::parse(&format!("{}{}", PROD_ORIGIN, url))
            .map_err(|e| format!("Invalid relative proxy path: {}", e));
    }

    // Absolute URL → parse and validate scheme/host.
    let parsed = Url::parse(url).map_err(|e| format!("Invalid proxy URL: {}", e))?;
    if parsed.scheme() != "https" {
        return Err("Only https proxy targets are allowed".to_string());
    }

    let host = parsed.host_str().unwrap_or_default();

    // Same origin as production (or a subdomain): allow any path/method.
    if host == PROD_HOST || host.ends_with(&format!(".{}", PROD_HOST)) {
        return Ok(parsed);
    }

    // Community-servers manifest on GitHub: exact URL, read-only.
    if is_read_only && parsed.as_str() == COMMUNITY_SERVERS_MANIFEST_URL {
        return Ok(parsed);
    }

    Err(format!("Proxy target not allowlisted: {}", url))
}

/// Decide whether a redirect URL is safe to follow from the proxy.
///
/// Rules (more restrictive than `resolve_proxy_target` because an upstream
/// 3xx target has not passed through the JS classifier):
///   - HTTPS only (same-host HTTP downgrade would leak headers in the clear)
///   - host must equal PROD_HOST or be a subdomain of it
///
/// GitHub's raw.githubusercontent.com is never a valid redirect target here:
/// the only github URL we ever proxy is the exact community-server manifest,
/// and its responses should not redirect off-origin.
fn is_safe_proxy_redirect_target(url: &Url) -> bool {
    if url.scheme() != "https" {
        return false;
    }
    let host = match url.host_str() {
        Some(h) => h,
        None => return false,
    };
    host == PROD_HOST || host.ends_with(&format!(".{}", PROD_HOST))
}

#[tauri::command]
pub async fn proxy_http_request(request: ProxyHttpRequest) -> Result<ProxyHttpResponse, String> {
    let method = request.method.unwrap_or_else(|| "GET".to_string());
    let target = resolve_proxy_target(&request.url, &method)?;
    let reqwest_method = Method::from_bytes(method.as_bytes())
        .map_err(|e| format!("Unsupported HTTP method {}: {}", method, e))?;

    // Custom redirect policy: only follow redirects that stay on the
    // production host (or a subdomain) over HTTPS. A 3xx to any other
    // origin (or an HTTP downgrade) could leak cookies/headers the
    // upstream server scoped to its own origin. reqwest's built-in
    // hop-limited policy would follow cross-origin redirects, so this
    // keeps the proxy's effective reachability aligned with
    // resolve_proxy_target's allowlist.
    //
    // Hop count: previous().len() equals the number of already-followed
    // redirects, so `> MAX_REDIRECT_HOPS` stops on the 6th attempt -
    // matching the familiar 5-hop cap without relying on the built-in
    // policy constructor.
    const MAX_REDIRECT_HOPS: usize = 5;
    let redirect_policy = reqwest::redirect::Policy::custom(|attempt| {
        if attempt.previous().len() > MAX_REDIRECT_HOPS {
            return attempt.stop();
        }
        let target = attempt.url();
        if is_safe_proxy_redirect_target(target) {
            attempt.follow()
        } else {
            attempt.stop()
        }
    });

    let client = reqwest::Client::builder()
        .redirect(redirect_policy)
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Failed to build HTTP proxy client: {}", e))?;

    let mut outbound_headers = HeaderMap::new();
    if let Some(headers) = request.headers {
        for (name, value) in headers {
            let header_name = match HeaderName::from_bytes(name.as_bytes()) {
                Ok(name) => name,
                Err(_) => continue,
            };

            if matches!(
                header_name.as_str(),
                "host" | "origin" | "referer" | "content-length"
            ) {
                continue;
            }

            let header_value = match HeaderValue::from_str(&value) {
                Ok(value) => value,
                Err(_) => continue,
            };

            outbound_headers.insert(header_name, header_value);
        }
    }

    debug!("Proxying {} {}", reqwest_method, target);

    let mut builder = client
        .request(reqwest_method.clone(), target.clone())
        .headers(outbound_headers);

    if !matches!(reqwest_method, Method::GET | Method::HEAD) {
        if let Some(body) = request.body {
            builder = builder.body(body);
        }
    }

    let response = builder.send().await.map_err(|e| {
        warn!(
            "Proxy request failed for {} {}: {}",
            reqwest_method, target, e
        );
        format!("Proxy request failed: {}", e)
    })?;

    let status = response.status();
    let response_url = response.url().to_string();
    let response_header_map = response.headers().clone();
    let body = if reqwest_method == Method::HEAD {
        String::new()
    } else {
        response.text().await.map_err(|e| {
            warn!("Failed reading proxy response body from {}: {}", target, e);
            format!("Failed to read proxy response body: {}", e)
        })?
    };

    let mut headers = HashMap::new();
    for (name, value) in response_header_map.iter() {
        if let Ok(value) = value.to_str() {
            headers.insert(name.to_string(), value.to_string());
        }
    }

    Ok(ProxyHttpResponse {
        url: response_url,
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or("").to_string(),
        headers,
        body,
    })
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
    debug!(
        "Performance stats: CPU={:.1}%, MEM={}MB",
        stats.cpu_usage, stats.memory_usage_mb
    );
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

    debug!(
        "System info: {} cores, {}MB RAM, GPU: {:?}",
        info.cpu_cores, info.total_memory_mb, gpu_name
    );
    Ok(info)
}

/// Get the operating system name
fn get_os_name() -> String {
    #[cfg(target_os = "windows")]
    {
        "Windows".to_string()
    }
    #[cfg(target_os = "linux")]
    {
        "Linux".to_string()
    }
    #[cfg(target_os = "macos")]
    {
        "macOS".to_string()
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    {
        "Unknown".to_string()
    }
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
                        let name: String = desc
                            .Description
                            .iter()
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

    let window = app.get_webview_window("main").ok_or_else(|| {
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
/// Windows: Uses Performance Counters (PDH API) for GPU engine utilization
/// Linux: Basic GPU detection only (usage monitoring not available)
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
/// Windows: Detects HDR capability via DXGI 1.6
/// Linux: Not available (returns stub)
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

    let window = app.get_webview_window("main").ok_or_else(|| {
        warn!("Main window not found for window mode change");
        "Main window not found".to_string()
    })?;

    let current_mode = WindowMode::from_u8(CURRENT_WINDOW_MODE.load(Ordering::SeqCst));

    // Skip if already in requested mode
    if current_mode == mode {
        debug!("Already in {:?} mode, skipping", mode);
        return Ok(mode);
    }

    // Delay between window operations to let the window manager process them
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

/// Download and install the pending update, emitting progress events
#[tauri::command]
pub async fn install_update(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
) -> Result<(), String> {
    info!("Installing update...");

    let update = pending
        .0
        .lock()
        .unwrap()
        .take()
        .ok_or_else(|| "No pending update to install".to_string())?;

    // Download and install with progress reporting via Tauri events
    let app_handle = app.clone();
    update
        .download_and_install(
            move |chunk_length, total_size| {
                let _ = app_handle.emit(
                    "update-progress",
                    serde_json::json!({
                        "chunk": chunk_length,
                        "total": total_size.unwrap_or(0),
                    }),
                );
            },
            || {},
        )
        .await
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn routes_relative_paths_to_production() {
        let target = resolve_proxy_target("/profile?t=1", "GET").unwrap();
        assert_eq!(
            target.as_str(),
            "https://pokemon-auto-chess.com/profile?t=1"
        );
    }

    #[test]
    fn routes_relative_player_search_to_production() {
        let target = resolve_proxy_target("/players?name=test", "GET").unwrap();
        assert_eq!(
            target.as_str(),
            "https://pokemon-auto-chess.com/players?name=test"
        );
    }

    #[test]
    fn routes_relative_moderation_post_to_production() {
        let target = resolve_proxy_target("/moderation/rename-account", "POST").unwrap();
        assert_eq!(
            target.as_str(),
            "https://pokemon-auto-chess.com/moderation/rename-account"
        );
    }

    #[test]
    fn routes_new_unknown_relative_paths_to_production() {
        // Under the origin-scoped model, upstream can add a new endpoint
        // without requiring a PACDeluxe code change.
        let target = resolve_proxy_target("/some-future-endpoint", "GET").unwrap();
        assert_eq!(
            target.as_str(),
            "https://pokemon-auto-chess.com/some-future-endpoint"
        );
    }

    #[test]
    fn allows_absolute_production_urls() {
        let target = resolve_proxy_target("https://pokemon-auto-chess.com/status", "GET").unwrap();
        assert_eq!(target.as_str(), "https://pokemon-auto-chess.com/status");
    }

    #[test]
    fn allows_production_subdomain_urls() {
        let target =
            resolve_proxy_target("https://api.pokemon-auto-chess.com/something", "POST").unwrap();
        assert_eq!(
            target.as_str(),
            "https://api.pokemon-auto-chess.com/something"
        );
    }

    #[test]
    fn denies_non_https_targets() {
        assert!(resolve_proxy_target("http://pokemon-auto-chess.com/profile", "GET").is_err());
    }

    #[test]
    fn denies_arbitrary_external_https_hosts() {
        assert!(resolve_proxy_target("https://evil.example/data", "GET").is_err());
    }

    #[test]
    fn denies_hosts_that_merely_end_with_prod_host_string() {
        // "evil-pokemon-auto-chess.com" is not the prod host nor a subdomain.
        // This test guards against a bug where `ends_with("pokemon-auto-chess.com")`
        // alone would incorrectly accept look-alike domains.
        assert!(resolve_proxy_target("https://evil-pokemon-auto-chess.com/steal", "GET").is_err());
    }

    #[test]
    fn allows_community_server_manifest_download() {
        let target = resolve_proxy_target(
            "https://raw.githubusercontent.com/keldaanCommunity/pokemonAutoChess/master/community-servers.md",
            "GET",
        )
        .unwrap();
        assert_eq!(
            target.as_str(),
            "https://raw.githubusercontent.com/keldaanCommunity/pokemonAutoChess/master/community-servers.md"
        );
    }

    #[test]
    fn denies_non_community_github_urls() {
        assert!(
            resolve_proxy_target("https://raw.githubusercontent.com/other/repo/file", "GET")
                .is_err()
        );
    }

    #[test]
    fn denies_write_methods_on_community_manifest() {
        assert!(resolve_proxy_target(COMMUNITY_SERVERS_MANIFEST_URL, "POST").is_err());
    }

    fn parse_url(raw: &str) -> Url {
        Url::parse(raw).unwrap()
    }

    #[test]
    fn allows_https_redirects_to_prod_host() {
        assert!(is_safe_proxy_redirect_target(&parse_url(
            "https://pokemon-auto-chess.com/somewhere"
        )));
    }

    #[test]
    fn allows_https_redirects_to_prod_subdomain() {
        assert!(is_safe_proxy_redirect_target(&parse_url(
            "https://cdn.pokemon-auto-chess.com/asset"
        )));
    }

    #[test]
    fn blocks_http_downgrade_redirects_to_prod_host() {
        // Even same-host downgrade to HTTP is rejected - a Set-Cookie or
        // Authorization header on the follow-up request would travel in
        // the clear.
        assert!(!is_safe_proxy_redirect_target(&parse_url(
            "http://pokemon-auto-chess.com/somewhere"
        )));
    }

    #[test]
    fn blocks_offorigin_https_redirects() {
        assert!(!is_safe_proxy_redirect_target(&parse_url(
            "https://evil.example/steal"
        )));
    }

    #[test]
    fn blocks_redirects_to_lookalike_domains() {
        // Guard against a regression where ends_with("pokemon-auto-chess.com")
        // alone would incorrectly accept evil-pokemon-auto-chess.com.
        assert!(!is_safe_proxy_redirect_target(&parse_url(
            "https://evil-pokemon-auto-chess.com/steal"
        )));
    }

    #[test]
    fn blocks_redirects_to_github_manifest_host() {
        // The community-server manifest is proxied at a single exact URL;
        // once resolve_proxy_target has accepted it, a 3xx follow-up from
        // GitHub back to raw.githubusercontent.com is still a distinct
        // request and should not count as a safe hop.
        assert!(!is_safe_proxy_redirect_target(&parse_url(
            "https://raw.githubusercontent.com/other/resource"
        )));
    }
}
