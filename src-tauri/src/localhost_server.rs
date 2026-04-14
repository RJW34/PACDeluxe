//! Local HTTP server for serving the bundled frontend at http://localhost:<port>.
//!
//! Replaces `tauri-plugin-localhost`. We observed that the plugin returns
//! HTTP 500 for paths that aren't direct files in `dist/` (including `/`,
//! `/lobby`, `/game` and every other React Router SPA route). WebView2
//! then displays its "This page isn't working" error page, which is what
//! broke v2.0.3 - v2.0.5 for end users - the main window couldn't even
//! load because `/` returned 500.
//!
//! Unlike the plugin, this server:
//!   - binds to [::1]:<port> (matching how WebView2 resolves `localhost`
//!     and making the webview origin http://localhost:<port>, which is
//!     an authorized Firebase domain)
//!   - uses Tauri's `AssetResolver` so assets work in both dev (read
//!     from frontendDist on disk) and release (embedded in the binary
//!     via `custom-protocol`)
//!   - falls back to `index.html` for any path the resolver can't find,
//!     so React Router owns the whole path space client-side

use std::net::SocketAddr;

use tauri::{AppHandle, Runtime};
use tiny_http::{Header, Method, Response, Server};
use tracing::{debug, info, warn};

/// Pick a stable preferred port so the webview origin
/// (`http://localhost:<port>`) is the same across sessions and cookies /
/// IndexedDB / localStorage all persist. Fall back to any free port only
/// if the preferred one is taken.
pub fn pick_localhost_port() -> u16 {
    const PREFERRED: u16 = 37529;
    if std::net::TcpListener::bind(("::1", PREFERRED)).is_ok() {
        PREFERRED
    } else {
        portpicker::pick_unused_port().unwrap_or(PREFERRED)
    }
}

/// Start the server on `port`, serving assets via Tauri's resolver.
/// Serving happens on a background thread; the caller only blocks while
/// the listener binds.
pub fn spawn<R: Runtime>(port: u16, app: AppHandle<R>) -> Result<(), String> {
    let addr: SocketAddr = format!("[::1]:{}", port)
        .parse()
        .map_err(|e| format!("invalid localhost address: {}", e))?;
    let server = Server::http(addr)
        .map_err(|e| format!("failed to bind localhost server on {}: {}", addr, e))?;

    info!("Localhost server listening on http://[::1]:{}", port);

    std::thread::spawn(move || {
        for request in server.incoming_requests() {
            handle(request, &app);
        }
    });

    Ok(())
}

fn handle<R: Runtime>(request: tiny_http::Request, app: &AppHandle<R>) {
    match request.method() {
        Method::Get | Method::Head => {}
        _ => {
            let _ = request.respond(Response::empty(405));
            return;
        }
    }

    let raw = request.url().to_string();
    let path = raw.split('?').next().unwrap_or("/");
    let path = path.split('#').next().unwrap_or("/");
    let is_head = matches!(request.method(), Method::Head);

    let resolver = app.asset_resolver();

    // Try the exact path; fall back to /index.html if the resolver
    // doesn't know about it. This is what makes React Router SPA routes
    // work: hitting /lobby directly (e.g. as the Firebase redirect
    // success URL) serves index.html and React takes over client-side.
    let primary = resolver.get(normalize_asset_key(path));
    let asset = primary.or_else(|| resolver.get("/index.html".to_string()));

    match asset {
        Some(asset) => {
            debug!(
                "localhost GET {} -> {} bytes ({})",
                raw,
                asset.bytes.len(),
                asset.mime_type
            );
            let content_type = Header::from_bytes(
                &b"Content-Type"[..],
                asset.mime_type.as_bytes(),
            )
            .unwrap();
            let cache_control =
                Header::from_bytes(&b"Cache-Control"[..], &b"no-cache"[..]).unwrap();
            let content_length = asset.bytes.len();

            if is_head {
                let response = Response::empty(200)
                    .with_header(content_type)
                    .with_header(cache_control)
                    .with_data(std::io::empty(), Some(content_length));
                let _ = request.respond(response);
            } else {
                let response = Response::from_data(asset.bytes)
                    .with_header(content_type)
                    .with_header(cache_control);
                let _ = request.respond(response);
            }
        }
        None => {
            warn!(
                "localhost GET {} -> asset resolver returned None (and index.html fallback also missing)",
                raw
            );
            let _ = request.respond(Response::empty(500));
        }
    }
}

/// Normalise a URL path into the key shape the asset resolver expects.
///
/// On Windows, Tauri's dev-mode asset resolver reads from disk via
/// `std::fs::read` and PathBuf component normalisation, which treats `\`
/// as a path separator. That means any URL containing `\` or `%5c` (in
/// any case) could escape frontendDist via traversal even if the plain
/// `..` segment check would reject it. Same concern for percent-encoded
/// dot-dot (`%2e%2e`). We refuse to resolve any such path and fall back
/// to index.html, which is what React Router would do for an
/// unrecognised path anyway.
fn normalize_asset_key(path: &str) -> String {
    if is_suspicious(path) {
        return "/index.html".to_string();
    }
    let trimmed = path.trim_matches('/');
    if trimmed.is_empty() {
        return "/index.html".to_string();
    }
    let safe = trimmed
        .split('/')
        .filter(|seg| !seg.is_empty() && *seg != ".." && *seg != ".")
        .collect::<Vec<_>>()
        .join("/");
    format!("/{}", safe)
}

fn is_suspicious(path: &str) -> bool {
    if path.bytes().any(|b| b == 0) {
        return true;
    }
    if path.contains('\\') {
        return true;
    }
    // Percent-encoded backslash or dot-dot in any case.
    let lower = path.to_ascii_lowercase();
    if lower.contains("%5c") || lower.contains("%2e%2e") {
        return true;
    }
    // Explicit parent-directory segment even when separators are normal.
    if path.contains("/../") || path.contains("/..\\") || path.ends_with("/..") {
        return true;
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_and_root_resolve_to_index() {
        assert_eq!(normalize_asset_key(""), "/index.html");
        assert_eq!(normalize_asset_key("/"), "/index.html");
    }

    #[test]
    fn simple_paths_keep_their_shape() {
        assert_eq!(normalize_asset_key("/index.js"), "/index.js");
        assert_eq!(normalize_asset_key("/assets/ui/favicon.ico"), "/assets/ui/favicon.ico");
    }

    #[test]
    fn spa_routes_return_their_path_for_resolver_lookup() {
        // The resolver will return None for /lobby and the caller falls
        // back to index.html; normalize_asset_key itself only strips
        // traversal, not existence.
        assert_eq!(normalize_asset_key("/lobby"), "/lobby");
        assert_eq!(normalize_asset_key("/game"), "/game");
    }

    #[test]
    fn backslash_traversal_is_rejected() {
        assert_eq!(normalize_asset_key("/..\\foo"), "/index.html");
        assert_eq!(normalize_asset_key("/assets\\..\\..\\etc"), "/index.html");
    }

    #[test]
    fn percent_encoded_traversal_is_rejected() {
        assert_eq!(normalize_asset_key("/%5C..%5Cetc"), "/index.html");
        assert_eq!(normalize_asset_key("/foo/%2e%2e/secret"), "/index.html");
        assert_eq!(normalize_asset_key("/%2E%2E/secret"), "/index.html");
    }

    #[test]
    fn dotdot_segment_is_rejected() {
        assert_eq!(normalize_asset_key("/foo/../secret"), "/index.html");
        assert_eq!(normalize_asset_key("/foo/.."), "/index.html");
    }

    #[test]
    fn null_byte_is_rejected() {
        assert_eq!(normalize_asset_key("/foo\0bar"), "/index.html");
    }
}
