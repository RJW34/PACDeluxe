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
//!   - falls back to `index.html` only for known React Router routes
//!   - returns explicit 404/501 responses for missing assets or upstream API
//!     paths, so stale service workers cannot cache HTML as game data

use std::net::{SocketAddr, TcpListener};

use tauri::{AppHandle, Asset, Runtime};
use tiny_http::{Header, Method, Response, Server, StatusCode};
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

const SPA_ROUTE_PREFIXES: &[&str] = &[
    "/lobby",
    "/preparation",
    "/game",
    "/after",
    "/bot-builder",
    "/bot-admin",
    "/sprite-viewer",
    "/map-viewer",
    "/gameboy",
    "/translations",
    "/auth",
];

const LOCAL_STATIC_FETCH_PREFIXES: &[&str] = &[
    "/assets/",
    "/tilemap/",
    "/style/",
    "/locales/",
    "/pokechess/",
    "/changelog/",
];

const LOCAL_STATIC_FETCH_EXTENSIONS: &[&str] = &[
    ".html", ".js", ".mjs", ".map", ".css", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg",
    ".ico", ".mp3", ".ogg", ".wav", ".m4a", ".woff", ".woff2", ".ttf", ".otf",
];

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

    // Classify before asking the resolver. Tauri's release AssetResolver can
    // itself return index.html for unknown paths, so calling it first would
    // still let `/assets/missing.json` or `/tilemap/Foo` masquerade as a
    // successful HTML response.
    if is_local_static_path(path) {
        let asset_key = normalize_asset_key(path);
        let asset = if is_tilemap_json_alias(path) {
            resolver.get(format!("{}.json", asset_key))
        } else {
            resolver.get(asset_key)
        };

        match asset {
            Some(asset) if asset_matches_request(path, &asset.mime_type) => {
                serve_asset(request, raw, asset, is_head);
            }
            Some(asset) => {
                warn!(
                    "localhost GET {} -> rejected HTML fallback for local asset ({})",
                    raw, asset.mime_type
                );
                respond_text(
                    request,
                    404,
                    "text/plain; charset=utf-8",
                    "Not Found",
                    is_head,
                );
            }
            None => {
                debug!("localhost GET {} -> missing local asset", raw);
                respond_text(
                    request,
                    404,
                    "text/plain; charset=utf-8",
                    "Not Found",
                    is_head,
                );
            }
        }
        return;
    }

    if is_spa_route_path(path) {
        match resolver.get("/index.html".to_string()) {
            Some(asset) => {
                serve_asset(request, raw, asset, is_head);
            }
            None => {
                warn!("localhost GET {} -> index.html fallback missing", raw);
                let _ = request.respond(Response::empty(500));
            }
        }
        return;
    }

    warn!(
        "localhost GET {} -> native proxy required before network",
        raw
    );
    respond_text(
        request,
        501,
        "application/json; charset=utf-8",
        &format!(
            r#"{{"error":"PACDeluxe native proxy required","path":"{}"}}"#,
            json_escape(path)
        ),
        is_head,
    );
}

fn serve_asset(request: tiny_http::Request, raw: String, asset: Asset, is_head: bool) {
    debug!(
        "localhost GET {} -> {} bytes ({})",
        raw,
        asset.bytes.len(),
        asset.mime_type
    );
    let clean_path = clean_url_path(&raw);
    let mime_type = if clean_path.starts_with("/tilemap/") {
        "application/json; charset=utf-8"
    } else {
        asset.mime_type.as_str()
    };
    let content_type = Header::from_bytes(&b"Content-Type"[..], mime_type.as_bytes()).unwrap();
    let cache_control = Header::from_bytes(&b"Cache-Control"[..], &b"no-cache"[..]).unwrap();
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

fn respond_text(
    request: tiny_http::Request,
    status: u16,
    content_type_value: &str,
    body: &str,
    is_head: bool,
) {
    let content_type =
        Header::from_bytes(&b"Content-Type"[..], content_type_value.as_bytes()).unwrap();
    let cache_control = Header::from_bytes(&b"Cache-Control"[..], &b"no-cache"[..]).unwrap();
    if is_head {
        let response = Response::empty(StatusCode(status))
            .with_header(content_type)
            .with_header(cache_control);
        let _ = request.respond(response);
    } else {
        let response = Response::from_string(body.to_string())
            .with_status_code(StatusCode(status))
            .with_header(content_type)
            .with_header(cache_control);
        let _ = request.respond(response);
    }
}

fn is_spa_route_path(path: &str) -> bool {
    let clean = clean_url_path(path);
    if clean == "/" || clean == "/index.html" {
        return true;
    }
    SPA_ROUTE_PREFIXES
        .iter()
        .any(|prefix| clean == *prefix || clean.starts_with(&format!("{}/", prefix)))
}

fn is_local_static_path(path: &str) -> bool {
    let clean = clean_url_path(path);
    if clean == "/" || clean == "/index.html" {
        return true;
    }
    if LOCAL_STATIC_FETCH_PREFIXES
        .iter()
        .any(|prefix| clean.starts_with(prefix))
    {
        return true;
    }
    let lower = clean.to_ascii_lowercase();
    if let Some(dot) = lower.rfind('.') {
        return LOCAL_STATIC_FETCH_EXTENSIONS
            .iter()
            .any(|ext| &lower[dot..] == *ext);
    }
    false
}

fn is_tilemap_json_alias(path: &str) -> bool {
    let clean = clean_url_path(path);
    if !clean.starts_with("/tilemap/") || clean.ends_with(".json") {
        return false;
    }
    let name = &clean["/tilemap/".len()..];
    !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

fn asset_matches_request(path: &str, mime_type: &str) -> bool {
    let clean = clean_url_path(path);
    if clean == "/" || clean.ends_with(".html") {
        return true;
    }
    !mime_type.to_ascii_lowercase().starts_with("text/html")
}

fn clean_url_path(path: &str) -> String {
    let clean = path
        .split('?')
        .next()
        .unwrap_or("/")
        .split('#')
        .next()
        .unwrap_or("/");
    if clean.is_empty() {
        "/".to_string()
    } else if clean.starts_with('/') {
        clean.to_string()
    } else {
        format!("/{}", clean)
    }
}

fn json_escape(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
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

    #[test]
    fn spa_routes_are_the_only_missing_paths_that_fallback_to_index() {
        assert!(is_spa_route_path("/"));
        assert!(is_spa_route_path("/lobby"));
        assert!(is_spa_route_path("/game/abc"));
        assert!(!is_spa_route_path("/tilemap/AmpPlains"));
        assert!(!is_spa_route_path("/profile"));
        assert!(!is_spa_route_path("/assets/pokemons/0001.json"));
    }

    #[test]
    fn local_static_classifier_matches_packaged_asset_paths() {
        assert!(is_local_static_path("/assets/pokemons/0001.json?v=1"));
        assert!(is_local_static_path("/locales/en/translation.json"));
        assert!(is_local_static_path("/tilemap/AmpPlains"));
        assert!(is_tilemap_json_alias("/tilemap/AmpPlains"));
        assert!(!is_tilemap_json_alias("/tilemap/AmpPlains.json"));
        assert!(!is_tilemap_json_alias("/tilemap/../secret"));
        assert!(is_local_static_path("/index.js"));
        assert!(is_local_static_path("/style/index.css"));

        assert!(!is_local_static_path("/profile"));
        assert!(!is_local_static_path("/leaderboards"));
    }
}
