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

use std::net::{SocketAddr, TcpListener};

use tauri::{AppHandle, Runtime};
use tiny_http::{Header, Method, Response, Server};
use tracing::{debug, info, warn};

const PREFERRED_LOCALHOST_PORT: u16 = 37529;

/// Start the localhost server, preferring a stable port for persisted auth
/// state but falling back to another free port when that one is unavailable.
/// Returns the actual bound port.
pub fn spawn<R: Runtime>(app: AppHandle<R>) -> Result<u16, String> {
    let mut bind_errors = Vec::new();

    match bind_server(PREFERRED_LOCALHOST_PORT) {
        Ok((server, port)) => return spawn_bound_server(server, port, app),
        Err(error) => {
            warn!(
                "Preferred localhost port {} unavailable: {}",
                PREFERRED_LOCALHOST_PORT, error
            );
            bind_errors.push(error);
        }
    }

    if let Some(fallback_port) =
        portpicker::pick_unused_port().filter(|port| *port != PREFERRED_LOCALHOST_PORT)
    {
        match bind_server(fallback_port) {
            Ok((server, port)) => return spawn_bound_server(server, port, app),
            Err(error) => {
                warn!(
                    "Fallback localhost port {} unavailable: {}",
                    fallback_port, error
                );
                bind_errors.push(error);
            }
        }
    }

    match bind_server(0) {
        Ok((server, port)) => spawn_bound_server(server, port, app),
        Err(error) => {
            bind_errors.push(error);
            Err(format!(
                "failed to start localhost server after exhausting preferred and fallback ports: {}",
                bind_errors.join(" | ")
            ))
        }
    }
}

fn bind_server(port: u16) -> Result<(Server, u16), String> {
    let listener = TcpListener::bind(("::1", port))
        .map_err(|e| format!("failed to bind [::1]:{}: {}", port, e))?;
    let bound_port = listener
        .local_addr()
        .map_err(|e| {
            format!(
                "failed to inspect localhost listener on [::1]:{}: {}",
                port, e
            )
        })?
        .port();
    let server = Server::from_listener(listener, None)
        .map_err(|e| format!("failed to start HTTP server on [::1]:{}: {}", bound_port, e))?;
    Ok((server, bound_port))
}

fn spawn_bound_server<R: Runtime>(
    server: Server,
    port: u16,
    app: AppHandle<R>,
) -> Result<u16, String> {
    let addr: SocketAddr = format!("[::1]:{}", port)
        .parse()
        .map_err(|e| format!("invalid localhost address: {}", e))?;

    info!(
        "Localhost server listening on http://localhost:{} ({})",
        port, addr
    );

    std::thread::spawn(move || {
        for request in server.incoming_requests() {
            handle(request, &app);
        }
    });

    Ok(port)
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
            let content_type =
                Header::from_bytes(&b"Content-Type"[..], asset.mime_type.as_bytes()).unwrap();
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
        assert_eq!(
            normalize_asset_key("/assets/ui/favicon.ico"),
            "/assets/ui/favicon.ico"
        );
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
