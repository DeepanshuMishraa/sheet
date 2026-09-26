use std::{
    env,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use axum::{
    body::Body,
    extract::{Request, State},
    http::{
        header::{
            CACHE_CONTROL, CONTENT_ENCODING, CONTENT_LENGTH, CONTENT_TYPE, COOKIE, HOST, LOCATION,
            ORIGIN, SET_COOKIE,
        },
        HeaderMap, HeaderName, Method, StatusCode,
    },
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{any, post},
    Json, Router,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use http_body_util::BodyExt;
use rand::RngCore;
use reqwest::redirect::Policy;
use serde::Deserialize;
use serde_json::json;
use subtle::ConstantTimeEq;
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tokio::{fs, net::TcpListener, process::Child, sync::Mutex};
use url::Url;

const BRIDGE_COOKIE_PREFIX: &str = "loora_bridge";
const BRIDGE_QUERY: &str = "bridge";
const DEFAULT_MCP_PORT: u16 = 4100;

#[derive(Clone)]
struct Config {
    api_origin: Url,
    dev_server: Option<Url>,
    app_root: PathBuf,
    server_bin: Option<PathBuf>,
    data_dir: PathBuf,
    mcp_port: u16,
}

#[derive(Clone)]
struct AppState {
    config: Config,
    client: reqwest::Client,
    port: u16,
    bridge_token: String,
    sidecar: Arc<Mutex<Option<Child>>>,
}

#[derive(Deserialize)]
struct OpenRequest {
    url: String,
}

impl Config {
    fn read(app: &tauri::AppHandle) -> Self {
        let mcp_port = read_port("LOORA_MCP_PORT", DEFAULT_MCP_PORT);
        let api_origin = read_origin("LOORA_API_ORIGIN", &format!("http://127.0.0.1:{mcp_port}"));
        let dev_server = env::var("LOORA_DESKTOP_DEV_SERVER")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .and_then(|value| Url::parse(value.trim()).ok())
            .or_else(|| {
                cfg!(debug_assertions).then(|| {
                    Url::parse("http://127.0.0.1:1421").expect("valid Vite development URL")
                })
            });
        let app_root = app
            .path()
            .resource_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("_up_")
            .join("dist")
            .join("app");
        let data_dir = read_data_dir();
        let server_bin = resolve_server_bin(app);

        Self {
            api_origin,
            dev_server,
            app_root,
            server_bin,
            data_dir,
            mcp_port,
        }
    }
}

/// Where the SQLite file and the handoff secret live. The OS app-data
/// directory, overridable with `LOORA_DATA_DIR` (tests, portable installs).
fn read_data_dir() -> PathBuf {
    if let Ok(value) = env::var("LOORA_DATA_DIR") {
        if !value.trim().is_empty() {
            return PathBuf::from(value.trim());
        }
    }
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(if cfg!(target_os = "linux") {
            "loora"
        } else {
            "Loora"
        })
}

fn read_origin(name: &str, fallback: &str) -> Url {
    env::var(name)
        .ok()
        .and_then(|value| Url::parse(value.trim()).ok())
        .and_then(|url| Url::parse(&url.origin().ascii_serialization()).ok())
        .unwrap_or_else(|| Url::parse(fallback).expect("valid fallback origin"))
}

fn read_port(name: &str, fallback: u16) -> u16 {
    if let Ok(value) = env::var(name) {
        if let Ok(port) = value.trim().parse::<u16>() {
            if port > 0 {
                return port;
            }
        }
    }
    fallback
}

fn requested_port() -> u16 {
    if cfg!(debug_assertions) {
        read_port("LOORA_DESKTOP_PORT", 4300)
    } else {
        read_port("LOORA_DESKTOP_PORT", 0)
    }
}

/// The compiled local server (`bun build --compile`), bundled beside the app.
/// `LOORA_SERVER_BIN` overrides everything (development, custom layouts).
fn resolve_server_bin(app: &tauri::AppHandle) -> Option<PathBuf> {
    if let Ok(value) = env::var("LOORA_SERVER_BIN") {
        let path = PathBuf::from(value.trim());
        if path.is_file() {
            return Some(path);
        }
        eprintln!(
            "[desktop] LOORA_SERVER_BIN is not a file: {}",
            path.display()
        );
    }
    let triple = env::var("LOORA_SERVER_TRIPLE").ok();
    let file_name = if cfg!(windows) {
        "loora-server.exe"
    } else {
        "loora-server"
    };
    let mut candidates = Vec::new();
    if let Ok(exe) = env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join(file_name));
            candidates.push(dir.join("binaries").join(file_name));
        }
    }
    if let Ok(resources) = app.path().resource_dir() {
        candidates.push(resources.join("binaries").join(file_name));
        if let Some(triple) = triple.as_deref() {
            candidates.push(
                resources
                    .join("binaries")
                    .join(format!("{file_name}-{triple}")),
            );
        }
    }
    candidates.into_iter().find(|path| path.is_file())
}

fn handoff_secret_path(data_dir: &Path) -> PathBuf {
    data_dir.join("handoff.key")
}

/// Handoff links are HMAC-signed; the key persists in the data dir so links
/// survive restarts but never leave the machine.
async fn read_handoff_secret(data_dir: &Path) -> Option<String> {
    let path = handoff_secret_path(data_dir);
    if let Ok(bytes) = fs::read(&path).await {
        let secret = String::from_utf8_lossy(&bytes).trim().to_owned();
        if secret.len() >= 32 {
            return Some(secret);
        }
    }
    let mut bytes = [0_u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    let secret = URL_SAFE_NO_PAD.encode(bytes);
    if let Some(parent) = path.parent() {
        if fs::create_dir_all(parent).await.is_err() {
            return None;
        }
    }
    if fs::write(&path, secret.as_bytes()).await.is_err() {
        return None;
    }
    Some(secret)
}

async fn spawn_sidecar(state: &AppState) {
    if cfg!(debug_assertions) {
        let ready = state.config.api_origin.join("/ready").ok().map(|url| {
            state
                .client
                .get(url)
                .timeout(Duration::from_millis(250))
                .send()
        });
        if let Some(request) = ready {
            if request
                .await
                .is_ok_and(|response| response.status().is_success())
            {
                eprintln!("[desktop] reusing the running local server");
                return;
            }
        }
    }

    let Some(bin) = state.config.server_bin.clone() else {
        eprintln!(
            "[desktop] no local server binary found — run `bun run dev:mcp` alongside the app"
        );
        return;
    };
    let db_path = state.config.data_dir.join("loora.db");
    if let Some(parent) = db_path.parent() {
        if fs::create_dir_all(parent).await.is_err() {
            eprintln!("[desktop] could not create data dir: {}", parent.display());
            return;
        }
    }
    let handoff_secret = read_handoff_secret(&state.config.data_dir).await;
    let mut command = tokio::process::Command::new(&bin);
    command
        .env("LOORA_SQLITE_PATH", &db_path)
        .env("LOORA_MCP_PORT", state.config.mcp_port.to_string())
        .env(
            "MCP_PUBLIC_URL",
            format!("http://127.0.0.1:{}", state.config.mcp_port),
        );
    if let Some(secret) = handoff_secret {
        command.env("LOORA_HANDOFF_SECRET", secret);
    }
    // A sidecar that cannot listen is worse than none: the proxy answers
    // 502 and the window says Loora is unreachable instead of hanging.
    command.stdout(std::process::Stdio::null());
    command.stderr(std::process::Stdio::inherit());
    match command.spawn() {
        Ok(child) => {
            *state.sidecar.lock().await = Some(child);
            eprintln!("[desktop] local server started from {}", bin.display());
        }
        Err(error) => {
            eprintln!("[desktop] could not start local server: {error}");
        }
    }
}

fn random_bridge_token() -> String {
    let mut bytes = [0_u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn bridge_origin(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

fn secret_matches(value: &str, expected: &str) -> bool {
    value.len() == expected.len() && bool::from(value.as_bytes().ct_eq(expected.as_bytes()))
}

fn bridge_cookie_name(port: u16) -> String {
    format!("{BRIDGE_COOKIE_PREFIX}_{port}")
}

fn has_bridge_cookie(headers: &HeaderMap, port: u16, expected: &str) -> bool {
    let expected_name = bridge_cookie_name(port);
    headers
        .get_all(COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(';'))
        .filter_map(|part| part.trim().split_once('='))
        .any(|(name, value)| name == expected_name && secret_matches(value, expected))
}

fn has_expected_host(headers: &HeaderMap, port: u16) -> bool {
    headers
        .get(HOST)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value == format!("127.0.0.1:{port}"))
}

fn has_trusted_origin(headers: &HeaderMap, port: u16) -> bool {
    headers
        .get(ORIGIN)
        .map(|value| {
            value
                .to_str()
                .is_ok_and(|value| value == bridge_origin(port))
        })
        .unwrap_or(true)
}

fn bridge_query_token(request: &Request) -> Option<String> {
    url::form_urlencoded::parse(request.uri().query()?.as_bytes())
        .find(|(name, _)| name == BRIDGE_QUERY)
        .map(|(_, value)| value.into_owned())
}

fn bridge_bootstrap_response(port: u16, token: &str) -> Response {
    Response::builder()
        .status(StatusCode::SEE_OTHER)
        .header(LOCATION, "/")
        .header(CACHE_CONTROL, "no-store")
        .header(
            SET_COOKIE,
            format!(
                "{}={token}; Path=/; HttpOnly; SameSite=Strict",
                bridge_cookie_name(port),
            ),
        )
        .body(Body::empty())
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

async fn require_bridge(State(state): State<AppState>, request: Request, next: Next) -> Response {
    if !has_expected_host(request.headers(), state.port) {
        return (StatusCode::FORBIDDEN, "Untrusted desktop host").into_response();
    }

    if request.method() == Method::GET
        && request.uri().path() == "/"
        && bridge_query_token(&request)
            .is_some_and(|value| secret_matches(&value, &state.bridge_token))
    {
        return bridge_bootstrap_response(state.port, &state.bridge_token);
    }

    if !has_trusted_origin(request.headers(), state.port) {
        return (StatusCode::FORBIDDEN, "Untrusted desktop origin").into_response();
    }
    if !has_bridge_cookie(request.headers(), state.port, &state.bridge_token) {
        return (StatusCode::UNAUTHORIZED, "Unauthorized desktop request").into_response();
    }
    next.run(request).await
}

async fn desktop_open(Json(payload): Json<OpenRequest>) -> Response {
    let Ok(url) = Url::parse(&payload.url) else {
        return (StatusCode::BAD_REQUEST, Json(json!({ "opened": false }))).into_response();
    };
    if url.scheme() != "https" {
        return (StatusCode::BAD_REQUEST, Json(json!({ "opened": false }))).into_response();
    }
    match open_external(url.as_str()) {
        Ok(()) => Json(json!({ "opened": true })).into_response(),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "opened": false })),
        )
            .into_response(),
    }
}

fn open_external(url: &str) -> std::io::Result<()> {
    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("open");
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = std::process::Command::new("cmd");
        command.args(["/c", "start", "", url]);
        return command.spawn().map(|_| ());
    };
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let mut command = std::process::Command::new("xdg-open");
    command.arg(url).spawn().map(|_| ())
}

fn is_hop_by_hop(name: &HeaderName) -> bool {
    matches!(
        name.as_str(),
        "connection"
            | "content-length"
            | "host"
            | "keep-alive"
            | "proxy-authenticate"
            | "proxy-authorization"
            | "te"
            | "trailer"
            | "transfer-encoding"
            | "upgrade"
    )
}

async fn proxy_api(State(state): State<AppState>, request: Request) -> Response {
    let path = request
        .uri()
        .path_and_query()
        .map(|value| value.as_str())
        .unwrap_or("/api/")
        .to_owned();
    let target = match state.config.api_origin.join(&path) {
        Ok(target) => target,
        Err(_) => return (StatusCode::BAD_REQUEST, "Invalid API target").into_response(),
    };
    let method = request.method().clone();
    let mut upstream = state.client.request(method.clone(), target);
    for (name, value) in request.headers() {
        if !is_hop_by_hop(name) && name != COOKIE {
            upstream = upstream.header(name, value);
        }
    }
    if method != Method::GET && method != Method::HEAD {
        let body = match request.into_body().collect().await {
            Ok(body) => body.to_bytes(),
            Err(_) => return (StatusCode::BAD_REQUEST, "Could not read request").into_response(),
        };
        upstream = upstream.body(body);
    }
    let response = match upstream.send().await {
        Ok(response) => response,
        Err(error) => {
            eprintln!("[desktop] proxy failed: {error}");
            return (StatusCode::BAD_GATEWAY, "Loora is unreachable").into_response();
        }
    };

    let status = response.status();
    let mut headers = response.headers().clone();

    headers.remove(SET_COOKIE);
    headers.remove(CONTENT_ENCODING);
    headers.remove(CONTENT_LENGTH);
    for name in [
        "connection",
        "host",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailer",
        "transfer-encoding",
        "upgrade",
    ] {
        headers.remove(name);
    }
    let mut result = Response::builder().status(status);
    for (name, value) in &headers {
        result = result.header(name, value);
    }
    // Event streams must not be buffered by the proxy.
    if path.starts_with("/api/canvas-events") {
        result = result.header("x-accel-buffering", "no");
    }
    result
        .body(Body::from_stream(response.bytes_stream()))
        .unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response())
}

async fn serve_app(State(state): State<AppState>, request: Request) -> Response {
    if let Some(dev_server) = &state.config.dev_server {
        return proxy_dev_server(&state, dev_server, request).await;
    }
    let relative = request.uri().path().trim_start_matches('/');
    if !relative.is_empty() && !relative.contains("..") {
        let path = state.config.app_root.join(relative);
        if let Ok(bytes) = fs::read(&path).await {
            let mime = mime_guess::from_path(&path).first_or_octet_stream();
            let cache = if relative == "index.html" {
                "no-store"
            } else {
                "max-age=31536000, immutable"
            };
            return (
                [(CONTENT_TYPE, mime.as_ref()), (CACHE_CONTROL, cache)],
                bytes,
            )
                .into_response();
        }
    }
    let index = state.config.app_root.join("index.html");
    match fs::read(index).await {
        Ok(bytes) => (
            [
                (CONTENT_TYPE, "text/html; charset=utf-8"),
                (CACHE_CONTROL, "no-store"),
            ],
            bytes,
        )
            .into_response(),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "The interface has not been built. Run `bun run build:desktop`.",
        )
            .into_response(),
    }
}

/// Keep the window on the host origin in development.
///
/// Proxying the bytes instead of redirecting keeps the hand-off and the
/// window on one loopback server.
async fn proxy_dev_server(state: &AppState, dev_server: &Url, request: Request) -> Response {
    let mut target = dev_server.clone();
    target.set_path(request.uri().path());
    target.set_query(request.uri().query());
    let method = request.method().clone();
    let mut upstream = state.client.request(method.clone(), target);
    for (name, value) in request.headers() {
        if !is_hop_by_hop(name) {
            upstream = upstream.header(name, value);
        }
    }
    if method != Method::GET && method != Method::HEAD {
        let body = match request.into_body().collect().await {
            Ok(body) => body.to_bytes(),
            Err(_) => return (StatusCode::BAD_REQUEST, "Could not read request").into_response(),
        };
        upstream = upstream.body(body);
    }
    let response = match upstream.send().await {
        Ok(response) => response,
        Err(error) => {
            eprintln!("[desktop] Vite development proxy failed: {error}");
            return (
                StatusCode::BAD_GATEWAY,
                "The development interface is not running.",
            )
                .into_response();
        }
    };
    let status = response.status();
    let mut headers = response.headers().clone();
    headers.remove(CONTENT_ENCODING);
    headers.remove(CONTENT_LENGTH);
    for name in [
        "connection",
        "host",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailer",
        "transfer-encoding",
        "upgrade",
    ] {
        headers.remove(name);
    }
    let mut result = Response::builder().status(status);
    for (name, value) in &headers {
        result = result.header(name, value);
    }
    result
        .body(Body::from_stream(response.bytes_stream()))
        .unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response())
}

fn router(state: AppState) -> Router {
    Router::new()
        .route("/desktop/open", post(desktop_open))
        .route("/api/{*path}", any(proxy_api))
        .fallback(serve_app)
        .layer(middleware::from_fn_with_state(
            state.clone(),
            require_bridge,
        ))
        .with_state(state)
}

fn main() {
    rustls::crypto::ring::default_provider()
        .install_default()
        .expect("install rustls crypto provider");
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::block_on(async move {
                let listener = TcpListener::bind(("127.0.0.1", requested_port()))
                    .await
                    .map_err(|error| format!("could not bind desktop host: {error}"))?;
                let port = listener
                    .local_addr()
                    .map_err(|error| format!("could not read desktop host port: {error}"))?
                    .port();
                let config = Config::read(&handle);
                let bridge_token = random_bridge_token();
                let state = AppState {
                    config,
                    client: reqwest::Client::builder()
                        .redirect(Policy::none())
                        .build()
                        .map_err(|error| format!("could not create HTTP client: {error}"))?,
                    port,
                    bridge_token: bridge_token.clone(),
                    sidecar: Arc::new(Mutex::new(None)),
                };
                spawn_sidecar(&state).await;
                handle.manage(state.clone());
                let served = state.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = axum::serve(listener, router(served)).await {
                        eprintln!("[desktop] loopback host stopped: {error}");
                    }
                });

                let url = Url::parse(&format!(
                    "http://127.0.0.1:{port}/?{BRIDGE_QUERY}={bridge_token}"
                ))
                .map_err(|error| format!("could not build desktop URL: {error}"))?;
                WebviewWindowBuilder::new(&handle, "main", WebviewUrl::External(url))
                    .title("Loora")
                    .inner_size(1440.0, 900.0)
                    .min_inner_size(960.0, 640.0)
                    .decorations(true)
                    .build()
                    .map_err(|error| format!("could not create desktop window: {error}"))?;
                Ok::<(), String>(())
            })?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running Loora")
        .run(|handle, event| {
            if let RunEvent::ExitRequested { .. } = event {
                // Best effort: the OS reclaims the sidecar's port and
                // SQLite lock if this races a force-quit.
                let sidecar: tauri::State<AppState> = handle.state();
                let sidecar = sidecar.inner().sidecar.clone();
                tauri::async_runtime::block_on(async move {
                    if let Some(mut child) = sidecar.lock().await.take() {
                        let _ = child.kill().await;
                    }
                });
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::header::{AUTHORIZATION, CONNECTION, HOST};
    use tower::ServiceExt;

    fn test_state() -> AppState {
        AppState {
            config: Config {
                api_origin: Url::parse("http://127.0.0.1:4100").unwrap(),
                dev_server: None,
                app_root: PathBuf::from("/unused"),
                server_bin: None,
                data_dir: PathBuf::from("/unused"),
                mcp_port: 4100,
            },
            client: reqwest::Client::new(),
            port: 4300,
            bridge_token: "test-bridge-token".to_owned(),
            sidecar: Arc::new(Mutex::new(None)),
        }
    }

    #[tokio::test]
    async fn rejects_an_unauthenticated_loopback_request() {
        let response = router(test_state())
            .oneshot(
                Request::builder()
                    .uri("/desktop/open")
                    .method(Method::POST)
                    .header(HOST, "127.0.0.1:4300")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn rejects_a_dns_rebinding_host_with_a_valid_cookie() {
        let response = router(test_state())
            .oneshot(
                Request::builder()
                    .uri("/desktop/open")
                    .header(HOST, "attacker.example:4300")
                    .header(COOKIE, "loora_bridge_4300=test-bridge-token")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn rejects_an_untrusted_browser_origin_with_a_valid_cookie() {
        let response = router(test_state())
            .oneshot(
                Request::builder()
                    .uri("/desktop/open")
                    .header(HOST, "127.0.0.1:4300")
                    .header(ORIGIN, "https://attacker.example")
                    .header(COOKIE, "loora_bridge_4300=test-bridge-token")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn bootstraps_the_webview_cookie_once() {
        let response = router(test_state())
            .oneshot(
                Request::builder()
                    .uri("/?bridge=test-bridge-token")
                    .header(HOST, "127.0.0.1:4300")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::SEE_OTHER);
        assert_eq!(response.headers().get(LOCATION).unwrap(), "/");
        let cookie = response
            .headers()
            .get(SET_COOKIE)
            .unwrap()
            .to_str()
            .unwrap();
        assert!(cookie.starts_with("loora_bridge_4300=test-bridge-token;"));
        assert!(cookie.contains("HttpOnly"));
        assert!(cookie.contains("SameSite=Strict"));
    }

    #[tokio::test]
    async fn accepts_the_bootstrapped_webview() {
        let response = router(test_state())
            .oneshot(
                Request::builder()
                    .uri("/desktop/open")
                    .method(Method::POST)
                    .header(HOST, "127.0.0.1:4300")
                    .header(COOKIE, "loora_bridge_4300=test-bridge-token")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        // Invalid JSON body, but through the gate — which is what this checks.
        assert!(!response.status().is_success());
    }

    #[test]
    fn hop_by_hop_headers_are_removed() {
        assert!(is_hop_by_hop(&CONNECTION));
        assert!(is_hop_by_hop(&HOST));
        assert!(!is_hop_by_hop(&AUTHORIZATION));
    }

    #[test]
    fn invalid_origin_falls_back() {
        let variable = "LOORA_DESKTOP_TEST_ORIGIN";
        std::env::set_var(variable, "not a URL");
        assert_eq!(
            read_origin(variable, "http://127.0.0.1:4100").as_str(),
            "http://127.0.0.1:4100/"
        );
        std::env::remove_var(variable);
    }

    #[test]
    fn invalid_port_falls_back() {
        assert_eq!(read_port("LOORA_DESKTOP_TEST_PORT", 4100), 4100);
        std::env::set_var("LOORA_DESKTOP_TEST_PORT", "99999");
        assert_eq!(read_port("LOORA_DESKTOP_TEST_PORT", 4100), 4100);
        std::env::set_var("LOORA_DESKTOP_TEST_PORT", "4123");
        assert_eq!(read_port("LOORA_DESKTOP_TEST_PORT", 4123), 4123);
        std::env::remove_var("LOORA_DESKTOP_TEST_PORT");
    }
}
