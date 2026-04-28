// Windows subsystem - no console in release (Windows only)
#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod localhost_server;

use pac_deluxe_lib::{commands, performance, PerformanceMonitor};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::webview::{NewWindowFeatures, NewWindowResponse};
use tauri::{
    AppHandle, Emitter, Listener, Manager, Runtime, Url, WebviewUrl, WebviewWindowBuilder,
    WindowEvent,
};
use tracing::{debug, info, warn, Level};
use tracing_subscriber::FmtSubscriber;

/// Clean up problematic files from old installations (Windows)
/// Runs on every startup to ensure clean state
#[cfg(target_os = "windows")]
fn cleanup_old_installation() {
    // Get the executable directory
    let exe_dir = match std::env::current_exe() {
        Ok(path) => path.parent().map(|p| p.to_path_buf()),
        Err(_) => None,
    };

    // Get AppData directories (Windows-specific)
    let local_appdata = std::env::var("LOCALAPPDATA").ok().map(PathBuf::from);
    let appdata = std::env::var("APPDATA").ok().map(PathBuf::from);

    let mut cleaned = Vec::new();

    // List of known problematic files/directories to remove
    // Add patterns here as issues are discovered
    let problematic_patterns: Vec<(&str, Option<&PathBuf>)> = vec![
        // Old cache files that may have incompatible formats
        ("PACDeluxe/cache_v0", local_appdata.as_ref()),
        ("PACDeluxe/old_config.json", appdata.as_ref()),
        // Stale WebView2 data that can cause issues
        ("PACDeluxe/EBWebView/stale_lock", local_appdata.as_ref()),
    ];

    for (pattern, base_dir) in problematic_patterns {
        if let Some(base) = base_dir {
            let full_path = base.join(pattern);
            if full_path.exists() {
                match if full_path.is_dir() {
                    std::fs::remove_dir_all(&full_path)
                } else {
                    std::fs::remove_file(&full_path)
                } {
                    Ok(_) => {
                        cleaned.push(full_path.display().to_string());
                    }
                    Err(e) => {
                        warn!("Failed to clean up {}: {}", full_path.display(), e);
                    }
                }
            }
        }
    }

    // Check for old DLLs in exe directory that shouldn't exist
    if let Some(exe_path) = exe_dir {
        let old_dlls = ["old_webview.dll", "deprecated_helper.dll"];
        for dll in old_dlls {
            let dll_path = exe_path.join(dll);
            if dll_path.exists() {
                if let Err(e) = std::fs::remove_file(&dll_path) {
                    warn!("Failed to remove old DLL {}: {}", dll, e);
                } else {
                    cleaned.push(dll_path.display().to_string());
                }
            }
        }
    }

    if !cleaned.is_empty() {
        info!(
            "Cleaned up {} old installation artifacts: {:?}",
            cleaned.len(),
            cleaned
        );
    } else {
        debug!("No old installation artifacts to clean up");
    }
}

/// Clean up problematic files from old installations (Linux)
/// Runs on every startup to ensure clean state
#[cfg(target_os = "linux")]
fn cleanup_old_installation() {
    // Get XDG directories for Linux (with fallbacks to ~/.cache, ~/.config, ~/.local/share)
    let home = std::env::var("HOME").ok().map(PathBuf::from);
    let cache_home = std::env::var("XDG_CACHE_HOME")
        .ok()
        .map(PathBuf::from)
        .or_else(|| home.as_ref().map(|h| h.join(".cache")));
    let config_home = std::env::var("XDG_CONFIG_HOME")
        .ok()
        .map(PathBuf::from)
        .or_else(|| home.as_ref().map(|h| h.join(".config")));

    let mut cleaned = Vec::new();

    // List of known problematic files/directories to remove on Linux
    let problematic_patterns: Vec<(&str, Option<&PathBuf>)> = vec![
        // Old cache files
        ("pacdeluxe/cache_v0", cache_home.as_ref()),
        ("PACDeluxe/cache_v0", cache_home.as_ref()),
        // Old config files
        ("pacdeluxe/old_config.json", config_home.as_ref()),
        ("PACDeluxe/old_config.json", config_home.as_ref()),
    ];

    for (pattern, base_dir) in problematic_patterns {
        if let Some(base) = base_dir {
            let full_path = base.join(pattern);
            if full_path.exists() {
                match if full_path.is_dir() {
                    std::fs::remove_dir_all(&full_path)
                } else {
                    std::fs::remove_file(&full_path)
                } {
                    Ok(_) => {
                        cleaned.push(full_path.display().to_string());
                    }
                    Err(e) => {
                        warn!("Failed to clean up {}: {}", full_path.display(), e);
                    }
                }
            }
        }
    }

    if !cleaned.is_empty() {
        info!(
            "Cleaned up {} old installation artifacts: {:?}",
            cleaned.len(),
            cleaned
        );
    } else {
        debug!("No old installation artifacts to clean up");
    }
}

/// Counter for unique popup window labels
static POPUP_COUNTER: AtomicU32 = AtomicU32::new(0);

/// Script injected into auth popup windows to bridge Firebase's postMessage
/// back to the main window via Tauri events, and to forward messages sent
/// from the main window into the popup as synthetic MessageEvents.
///
/// Problem: Tauri opens popups as independent WebviewWindows that share no
/// `window.opener` relationship with the main WebView. Firebase's popup auth
/// flow depends on `window.opener.postMessage()` to return OAuth results, and
/// the main window depends on posting messages back to the popup during the
/// iframe-acknowledge phase of auth.
///
/// Solution:
///   - Mock `window.opener` so popup-side posts are forwarded via Tauri events.
///   - Listen for main->popup events and dispatch them as MessageEvents in
///     the popup's window so Firebase's handler receives them.
///   - Provide `window.opener.location.replace` so the upstream `index.tsx`
///     "block opening main app in popup" check does not throw when the popup
///     navigates to a page that runs the upstream bundle.
const AUTH_POPUP_BRIDGE_SCRIPT: &str = include_str!("runtime/auth-popup-bridge.js");

/// Performance runtime injected into the game page.
/// This is the canonical frontend runtime for PACDeluxe.
const OVERLAY_SCRIPT: &str = include_str!("runtime/overlay.js");

fn build_auth_popup<R: Runtime>(
    app_handle: &AppHandle<R>,
    url: Url,
    features: NewWindowFeatures,
) -> NewWindowResponse<R> {
    let popup_id = POPUP_COUNTER.fetch_add(1, Ordering::SeqCst);
    let label = format!("auth-popup-{}", popup_id);
    debug!("Opening popup window: {} -> {}", label, url);

    // Shared state for popup lifecycle management
    let auth_completed = Arc::new(AtomicBool::new(false));
    let popup_closed = Arc::new(AtomicBool::new(false));
    let popup_start = Instant::now();

    // Clone handles for various closures
    let app_for_nav = app_handle.clone();
    let label_for_nav = label.clone();
    let auth_completed_nav = auth_completed.clone();
    let popup_closed_nav = popup_closed.clone();

    let app_for_timeout = app_handle.clone();
    let label_for_timeout = label.clone();
    let auth_completed_timeout = auth_completed.clone();
    let popup_closed_timeout = popup_closed.clone();

    let popup = WebviewWindowBuilder::new(app_handle, &label, WebviewUrl::External(url.clone()))
        .title(url.host_str().unwrap_or("Authentication"))
        .window_features(features)
        .inner_size(500.0, 600.0)
        .center()
        .focused(true)
        .always_on_top(true)
        // Mock window.opener so Firebase's popup auth can bridge results
        // back to the main window via Tauri events
        .initialization_script(AUTH_POPUP_BRIDGE_SCRIPT)
        // Detect auth completion via navigation events (fires before page load)
        .on_navigation(move |nav_url| {
            let url_str = nav_url.to_string();
            debug!("Auth popup navigating to: {}", url_str);

            // Firebase auth callback patterns:
            // - /__/auth/handler?code=... (OAuth success)
            // - /__/auth/handler?error=... (OAuth error/cancel)
            let is_auth_callback = url_str.contains("/__/auth/handler");
            let has_code = url_str.contains("code=");
            let has_error = url_str.contains("error=");

            if is_auth_callback && (has_code || has_error) {
                if has_code {
                    debug!("Auth success detected, scheduling popup close");
                } else {
                    debug!("Auth cancelled/error detected, scheduling popup close");
                }

                // Mark auth as completed
                auth_completed_nav.store(true, Ordering::SeqCst);

                // Close popup after a brief delay to allow redirect to complete
                if !popup_closed_nav.swap(true, Ordering::SeqCst) {
                    let app = app_for_nav.clone();
                    let label = label_for_nav.clone();
                    std::thread::spawn(move || {
                        // Wait for Firebase handler page to load, process
                        // the OAuth code, and call postMessage (our mock
                        // bridges it to the main window via Tauri events)
                        std::thread::sleep(Duration::from_millis(3000));
                        if let Some(win) = app.get_webview_window(&label) {
                            match win.close() {
                                Ok(_) => debug!("Auth popup {} closed successfully", label),
                                Err(e) => warn!("Failed to close auth popup {}: {}", label, e),
                            }
                        }
                    });
                }
            }

            true // Allow all navigation
        })
        .on_page_load(move |_webview, payload| {
            debug!("Auth popup page loaded: {}", payload.url());
        })
        .build();

    match popup {
        Ok(window) => {
            // Notify the main window when the popup is destroyed so the
            // JS-side mock can mark its `closed` flag. Firebase polls
            // popup.closed to detect user cancellation of the auth flow.
            let app_for_close = app_handle.clone();
            let label_for_close = label.clone();
            let popup_closed_event = popup_closed.clone();
            window.on_window_event(move |event| {
                if let WindowEvent::Destroyed = event {
                    popup_closed_event.store(true, Ordering::SeqCst);
                    let _ = app_for_close.emit(
                        "pac-popup-closed",
                        serde_json::json!({ "label": label_for_close }),
                    );
                    debug!("Auth popup {} destroyed, notified main", label_for_close);
                }
            });

            // Start timeout watchdog thread to prevent orphaned popups
            std::thread::spawn(move || {
                const POPUP_TIMEOUT: Duration = Duration::from_secs(300); // 5 minutes
                const CHECK_INTERVAL: Duration = Duration::from_secs(10);

                loop {
                    std::thread::sleep(CHECK_INTERVAL);

                    // Exit if popup already closed or auth completed
                    if popup_closed_timeout.load(Ordering::SeqCst) {
                        debug!("Popup timeout watchdog: popup already closed");
                        break;
                    }

                    if auth_completed_timeout.load(Ordering::SeqCst) {
                        debug!("Popup timeout watchdog: auth completed normally");
                        break;
                    }

                    // Check if timeout exceeded
                    if popup_start.elapsed() >= POPUP_TIMEOUT {
                        warn!(
                            "Auth popup {} timed out after {:?}, force closing",
                            label_for_timeout,
                            popup_start.elapsed()
                        );

                        if !popup_closed_timeout.swap(true, Ordering::SeqCst) {
                            if let Some(win) =
                                app_for_timeout.get_webview_window(&label_for_timeout)
                            {
                                match win.close() {
                                    Ok(_) => info!("Orphaned auth popup closed"),
                                    Err(e) => warn!("Failed to close orphaned popup: {}", e),
                                }
                            }
                        }
                        break;
                    }
                }
            });

            NewWindowResponse::Create { window }
        }
        Err(e) => {
            warn!("Failed to create auth popup: {}", e);
            NewWindowResponse::Deny
        }
    }
}

fn main() {
    // Initialize logging
    let subscriber = FmtSubscriber::builder()
        .with_max_level(if cfg!(debug_assertions) {
            Level::DEBUG
        } else {
            Level::INFO
        })
        .finish();
    tracing::subscriber::set_global_default(subscriber).ok();

    info!("Starting PACDeluxe");

    // The localhost server is started inside setup() so the main window only
    // opens after we have a real bound port and a live asset server.

    // Set WebView2 Chromium flags for real GPU performance gains
    // Must be set before any WebView2 instance is created
    #[cfg(target_os = "windows")]
    {
        // SAFETY: called at startup before any threads spawn, single-threaded context
        unsafe {
            std::env::set_var(
                "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
                "--enable-gpu-rasterization --enable-zero-copy --disable-background-timer-throttling --disable-renderer-backgrounding",
            );
        }
    }

    // Clean up any problematic files from old installations
    cleanup_old_installation();

    // Apply system optimizations
    performance::apply_system_optimizations();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(move |app| {
            let app_handle = app.handle().clone();

            // Start our static HTTP server before creating the main window so
            // the first navigation always targets a live localhost origin.
            // Firebase accepts `localhost` (any port) as an authorized origin,
            // but not Tauri's default `tauri.localhost` origin.
            let localhost_port = localhost_server::spawn(app_handle.clone()).map_err(|e| {
                std::io::Error::other(format!("Failed to start localhost server: {}", e))
            })?;
            info!(
                "Frontend runtime bound to http://localhost:{}/",
                localhost_port
            );

            // Get version for window title (add Dev suffix in debug builds)
            let version = app.package_info().version.to_string();
            let title = if cfg!(debug_assertions) {
                format!("PACDeluxe v{} (Dev)", version)
            } else {
                format!("PACDeluxe v{}", version)
            };

            // Create window programmatically with on_page_load handler.
            // Load from the localhost plugin's HTTP server rather than the
            // custom tauri:// scheme so that Firebase accepts the origin
            // for OAuth popup sign-in.
            let main_url = format!("http://localhost:{}/", localhost_port)
                .parse()
                .expect("localhost URL must parse");
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(main_url))
                .title(&title)
                .inner_size(1280.0, 900.0)
                .min_inner_size(1024.0, 768.0)
                .resizable(true)
                .center()
                .focused(true)
                .visible(true)
                // Required for HTML5 drag & drop to work in WebView2 on Windows
                // (Tauri's default handler intercepts drag events, blocking tier list maker etc.)
                .disable_drag_drop_handler()
                .on_page_load(|webview, _payload| {
                    if let Err(e) = webview.eval(OVERLAY_SCRIPT) {
                        tracing::warn!("Failed to inject overlay script: {}", e);
                    } else {
                        tracing::debug!("Overlay script injected successfully");
                    }
                })
                // Handle OAuth popup windows (Google/Firebase auth)
                .on_new_window(move |url, features| build_auth_popup(&app_handle, url, features))
                .build()
                .expect("Failed to create main window");

            // Apply window optimizations
            performance::optimize_window(&window);

            // Start performance monitor
            let monitor = PerformanceMonitor::new();
            app.manage(monitor);

            // Initialize pending update state for updater
            app.manage(commands::PendingUpdate(std::sync::Mutex::new(None)));

            // Global listener: when the main-window mock popup calls
            // popup.close() (Firebase SDK does this after auth), it emits
            // pac-close-auth-popup. Close every open auth-popup-* window.
            // Clone a fresh handle from `app` - the earlier `app_handle` was
            // already moved into the on_new_window closure.
            let app_for_close_listener = app.handle().clone();
            app.listen_any("pac-close-auth-popup", move |_event| {
                let windows = app_for_close_listener.webview_windows();
                for (label, webview_window) in windows {
                    if label.starts_with("auth-popup-") {
                        debug!("Closing auth popup {} at SDK request", label);
                        let _ = webview_window.close();
                    }
                }
            });

            // Main -> popup MessageEvent dispatch. The main window's mock
            // popup.postMessage() emits pac-main-to-popup; we find the
            // active auth-popup webview and eval a small dispatch script.
            //
            // Doing this via webview.eval (rather than a JS-side listener
            // in AUTH_POPUP_BRIDGE_SCRIPT) avoids accumulating zombie
            // handlers every time the popup navigates cross-origin during
            // the OAuth flow - the JS listener would be re-registered on
            // each new page load while the old Rust-side registration
            // persisted.
            let app_for_m2p = app.handle().clone();
            app.listen_any("pac-main-to-popup", move |event| {
                let payload_json = event.payload();
                let windows = app_for_m2p.webview_windows();
                for (label, webview_window) in windows {
                    if !label.starts_with("auth-popup-") {
                        continue;
                    }
                    // payload_json is JSON, which is valid JS syntax -
                    // interpolating it as an expression is safe.
                    let script = format!(
                        r#"(function() {{
  try {{
    var __pac_payload = {};
    window.dispatchEvent(new MessageEvent('message', {{
      data: __pac_payload && __pac_payload.data,
      origin: (__pac_payload && __pac_payload.targetOrigin) || '*',
      source: window.opener
    }}));
  }} catch (e) {{
    console.error('[PACDeluxe Auth Bridge] main->popup dispatch failed:', e);
  }}
}})();"#,
                        payload_json
                    );
                    if let Err(e) = webview_window.eval(&script) {
                        warn!("Failed to eval main->popup bridge in {}: {}", label, e);
                    }
                }
            });

            info!("Application ready");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_performance_stats,
            commands::get_system_info,
            commands::toggle_fullscreen,
            commands::get_webview_telemetry,
            commands::get_gpu_stats,
            commands::get_hdr_status,
            commands::set_window_mode,
            commands::get_window_mode,
            commands::proxy_http_request,
            commands::check_for_updates,
            commands::install_update,
            commands::restart_app,
        ])
        .run(tauri::generate_context!())
        .expect("Failed to run application");
}
