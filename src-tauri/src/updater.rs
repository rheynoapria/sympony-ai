//! Dual-channel (Stable + Beta) auto-updater backed by `tauri-plugin-updater` and GitHub Releases manifests.
//!
//! Endpoints:
//! - Stable: `https://github.com/rheynoapria/sympony-ai/releases/latest/download/latest.json`
//! - Beta:   `https://github.com/rheynoapria/sympony-ai/releases/download/beta-channel/latest.json`
//!
//! Beta builds (`-beta` / prerelease SemVer) default to watching Beta; Stable builds default to Stable.
//! Turning Beta off never downgrades: Beta users graduate seamlessly to the next Stable release.

use crate::commands::App;
use serde::Serialize;
use serde_json::{json, Value};
use services::Registry;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

pub const RELEASES_URL: &str = "https://github.com/rheynoapria/sympony-ai/releases";
pub const STABLE_ENDPOINT: &str = "https://github.com/rheynoapria/sympony-ai/releases/latest/download/latest.json";
pub const BETA_ENDPOINT: &str = "https://github.com/rheynoapria/sympony-ai/releases/download/beta-channel/latest.json";

const INITIAL_DELAY_SECS: u64 = 15;
const CHECK_INTERVAL_SECS: u64 = 6 * 60 * 60;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSnapshot {
    pub status: String,
    pub current_version: String,
    pub current_channel: String,
    pub watch_beta: bool,
    pub available_version: Option<String>,
    pub available_channel: Option<String>,
    pub notes: String,
    pub pub_date: Option<String>,
    pub downloaded: u64,
    pub total: Option<u64>,
    pub percent: Option<u8>,
    pub dismissed_version: String,
    pub last_checked: Option<i64>,
    pub error: Option<String>,
    pub preview: bool,
}

struct PendingUpdate {
    update: Update,
    bytes: Option<Vec<u8>>,
}

struct Inner {
    snapshot: UpdateSnapshot,
    pending: Option<PendingUpdate>,
    checking: bool,
    installing: bool,
}

#[derive(Clone)]
pub struct UpdaterState {
    inner: Arc<Mutex<Inner>>,
}

/// Returns true if a SemVer string contains a prerelease suffix (e.g. `0.2.0-beta.1`).
pub fn is_prerelease(version: &str) -> bool {
    version.trim().trim_start_matches('v').contains('-')
}

/// Returns `"beta"` for prerelease SemVer strings and `"stable"` otherwise.
pub fn channel_of(version: &str) -> &'static str {
    if is_prerelease(version) {
        "beta"
    } else {
        "stable"
    }
}

/// Resolves whether Beta channel watching is active from settings (`updateBeta`),
/// defaulting to `true` on prerelease builds and `false` on Stable builds when unset (`null`).
pub fn effective_watch_beta(settings: &Value, current_version: &str) -> bool {
    match settings.get("updateBeta").and_then(Value::as_bool) {
        Some(b) => b,
        None => is_prerelease(current_version),
    }
}

/// Determines which manifest endpoints to query in priority order for the given beta setting.
pub fn endpoints_for(watch_beta: bool, override_url: Option<&str>) -> Vec<String> {
    if let Some(u) = override_url.map(str::trim).filter(|s| !s.is_empty()) {
        return vec![u.to_string()];
    }
    if watch_beta {
        // Try floating beta pointer first; fall back to Stable if beta-channel hasn't been published yet.
        vec![BETA_ENDPOINT.to_string(), STABLE_ENDPOINT.to_string()]
    } else {
        vec![STABLE_ENDPOINT.to_string()]
    }
}

/// Compares two SemVer 2.0.0 version strings (`0.2.0 > 0.2.0-beta.4 > 0.2.0-beta.3 > 0.1.0`).
pub fn compare_semver(a: &str, b: &str) -> std::cmp::Ordering {
    fn parse(raw: &str) -> ((u64, u64, u64), bool, Vec<(bool, u64, String)>) {
        let clean = raw.trim().trim_start_matches('v').split('+').next().unwrap_or("");
        let (core_s, pre_s) = match clean.split_once('-') {
            Some((c, p)) => (c, Some(p)),
            None => (clean, None),
        };
        let mut nums = core_s.split('.').map(|s| s.parse::<u64>().unwrap_or(0));
        let core = (
            nums.next().unwrap_or(0),
            nums.next().unwrap_or(0),
            nums.next().unwrap_or(0),
        );
        let is_stable = pre_s.is_none();
        let pre = pre_s
            .map(|p| {
                p.split('.')
                    .map(|part| match part.parse::<u64>() {
                        Ok(n) => (false, n, String::new()),
                        Err(_) => (true, 0, part.to_string()),
                    })
                    .collect()
            })
            .unwrap_or_default();
        (core, is_stable, pre)
    }
    parse(a).cmp(&parse(b))
}

/// Returns true when an updater error indicates a missing/unpublished manifest (HTTP 404 or empty release)
/// or that the release manifest does not include a binary for this OS/architecture (`TargetNotFound`),
/// which should be treated gracefully as "up to date" rather than alarming the user with a red error.
pub fn is_missing_manifest_error(err: &str) -> bool {
    let e = err.to_ascii_lowercase();
    e.contains("404")
        || e.contains("not found")
        || e.contains("was not found in the response")
        || e.contains("were found in the response")
        || e.contains("could not fetch a valid release json")
        || e.contains("valid release json")
        || e.contains("empty response")
}

impl UpdaterState {
    pub fn new() -> Self {
        let current = env!("CARGO_PKG_VERSION").to_string();
        let current_channel = channel_of(&current).to_string();
        let watch_beta = is_prerelease(&current);
        Self {
            inner: Arc::new(Mutex::new(Inner {
                snapshot: UpdateSnapshot {
                    status: "idle".into(),
                    current_version: current,
                    current_channel,
                    watch_beta,
                    available_version: None,
                    available_channel: None,
                    notes: String::new(),
                    pub_date: None,
                    downloaded: 0,
                    total: None,
                    percent: None,
                    dismissed_version: String::new(),
                    last_checked: None,
                    error: None,
                    preview: false,
                },
                pending: None,
                checking: false,
                installing: false,
            })),
        }
    }

    pub fn snapshot(&self, settings: &Value) -> UpdateSnapshot {
        let mut g = self.inner.lock().unwrap();
        g.snapshot.watch_beta = effective_watch_beta(settings, &g.snapshot.current_version);
        g.snapshot.dismissed_version = settings
            .get("dismissedUpdateVersion")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        g.snapshot.clone()
    }
}

fn emit_state(app: &AppHandle, snap: &UpdateSnapshot) {
    let _ = app.emit("update:state", snap);
}

fn current_snapshot(app: &AppHandle) -> UpdateSnapshot {
    let settings = app.state::<App>().settings.get();
    app.state::<UpdaterState>().snapshot(&settings)
}

pub fn state_json(app: &AppHandle) -> Value {
    serde_json::to_value(current_snapshot(app)).unwrap_or_else(|_| json!({ "status": "idle" }))
}

fn log_line(app: &AppHandle, msg: &str) {
    app.state::<App>().log.line(msg);
}

#[cfg(target_os = "macos")]
fn check_install_location() -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let s = exe.to_string_lossy();
    if s.starts_with("/Volumes/") || s.contains("/AppTranslocation/") {
        return Err(
            "Move Sympony.app into your Applications folder first so it can update automatically.".into(),
        );
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn check_install_location() -> Result<(), String> {
    Ok(())
}

fn write_whats_new(data_dir: &Path, version: &str, channel: &str, notes: &str) {
    let path = data_dir.join("whats-new.json");
    let payload = json!({
        "version": version.trim_start_matches('v'),
        "channel": channel,
        "notes": notes,
    });
    if let Ok(bytes) = serde_json::to_vec_pretty(&payload) {
        let _ = std::fs::write(path, bytes);
    }
}

fn read_whats_new(data_dir: &Path) -> Value {
    let path = data_dir.join("whats-new.json");
    let Ok(bytes) = std::fs::read(&path) else {
        return Value::Null;
    };
    let Ok(v) = serde_json::from_slice::<Value>(&bytes) else {
        return Value::Null;
    };
    let current = env!("CARGO_PKG_VERSION").trim_start_matches('v');
    if v.get("version").and_then(Value::as_str) == Some(current) {
        v
    } else {
        Value::Null
    }
}

/// Checks for an update against the active channel (Beta or Stable).
/// When `install` is true and an update is found, immediately starts downloading and installing it.
/// When `silent` is true (background timer), network errors are logged without surfacing an error banner.
pub async fn check_now(app: AppHandle, install: bool, silent: bool) -> Value {
    let st = app.state::<UpdaterState>().inner().clone();
    let settings = app.state::<App>().settings.get();
    let current_ver = env!("CARGO_PKG_VERSION").to_string();
    let watch_beta = effective_watch_beta(&settings, &current_ver);
    let auto_download = settings.get("autoUpdate").and_then(Value::as_bool).unwrap_or(false);
    let dismissed = settings
        .get("dismissedUpdateVersion")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();

    {
        let mut g = st.inner.lock().unwrap();
        if g.checking || g.installing {
            return serde_json::to_value(&g.snapshot).unwrap_or(Value::Null);
        }
        g.checking = true;
        g.snapshot.watch_beta = watch_beta;
        g.snapshot.dismissed_version = dismissed.clone();
        g.snapshot.preview = false;
        g.snapshot.error = None;
        if !silent || g.snapshot.status == "idle" || g.snapshot.status == "error" {
            g.snapshot.status = "checking".into();
        }
        let snap = g.snapshot.clone();
        emit_state(&app, &snap);
    }

    let env_override = std::env::var("SYMPONY_UPDATE_ENDPOINT").ok();
    let endpoints = endpoints_for(watch_beta, env_override.as_deref());
    let mut found: Option<Update> = None;
    let mut last_err: Option<String> = None;
    let mut checked_any = false;

    for ep in &endpoints {
        let parsed = match url::Url::parse(ep) {
            Ok(u) => u,
            Err(e) => {
                last_err = Some(format!("Invalid update URL: {e}"));
                continue;
            }
        };
        let allow_pre = watch_beta;
        let builder = match app.updater_builder().endpoints(vec![parsed]) {
            Ok(b) => b.version_comparator(move |current, remote| {
                if !allow_pre && !remote.version.pre.is_empty() {
                    return false;
                }
                remote.version > current
            }),
            Err(e) => {
                last_err = Some(e.to_string());
                continue;
            }
        };
        let updater = match builder.build() {
            Ok(u) => u,
            Err(e) => {
                last_err = Some(e.to_string());
                continue;
            }
        };

        match updater.check().await {
            Ok(Some(upd)) => {
                checked_any = true;
                last_err = None;
                let replace = match found.as_ref() {
                    None => true,
                    Some(best) => compare_semver(&upd.version, &best.version).is_gt(),
                };
                if replace {
                    found = Some(upd);
                }
            }
            Ok(None) => {
                checked_any = true;
                last_err = None;
            }
            Err(e) => {
                let msg = e.to_string();
                log_line(&app, &format!("updater: check {ep} failed: {msg}"));
                if is_missing_manifest_error(&msg) {
                    last_err = Some(msg);
                    continue;
                }
                last_err = Some(msg);
                if found.is_none() {
                    break;
                }
            }
        }
    }

    let now_ms = chrono::Utc::now().timestamp_millis();
    let mut trigger_install = false;
    let mut trigger_auto_download = false;

    let snap = {
        let mut g = st.inner.lock().unwrap();
        g.checking = false;
        g.snapshot.last_checked = Some(now_ms);
        g.snapshot.watch_beta = watch_beta;
        g.snapshot.dismissed_version = dismissed;

        if let Some(upd) = found {
            let ver = upd.version.trim_start_matches('v').to_string();
            let chan = channel_of(&ver).to_string();
            let notes = upd.body.clone().unwrap_or_default();
            let pub_date = upd.date.map(|d| d.to_string());

            let already_ready = g
                .pending
                .as_ref()
                .is_some_and(|p| p.update.version.trim_start_matches('v') == ver && p.bytes.is_some());

            if !already_ready {
                g.pending = Some(PendingUpdate { update: upd, bytes: None });
                g.snapshot.downloaded = 0;
                g.snapshot.total = None;
                g.snapshot.percent = None;
                g.snapshot.status = "available".into();
            } else {
                g.snapshot.status = "ready".into();
            }

            g.snapshot.available_version = Some(ver.clone());
            g.snapshot.available_channel = Some(chan.clone());
            g.snapshot.notes = notes;
            g.snapshot.pub_date = pub_date;
            g.snapshot.error = None;
            log_line(&app, &format!("updater: found v{ver} ({chan})"));

            if install {
                trigger_install = true;
            } else if auto_download && !already_ready {
                trigger_auto_download = true;
            }
        } else if checked_any || last_err.as_deref().is_some_and(is_missing_manifest_error) {
            g.pending = None;
            g.snapshot.status = "upToDate".into();
            g.snapshot.available_version = None;
            g.snapshot.available_channel = None;
            g.snapshot.notes.clear();
            g.snapshot.pub_date = None;
            g.snapshot.downloaded = 0;
            g.snapshot.total = None;
            g.snapshot.percent = None;
            g.snapshot.error = None;
            if let Some(err) = last_err {
                log_line(&app, &format!("updater: no manifest published yet ({err})"));
            }
        } else if let Some(err) = last_err {
            if silent {
                // Keep background failures quiet unless user already had an update pending.
                if g.snapshot.available_version.is_none() {
                    g.snapshot.status = "idle".into();
                }
            } else {
                g.snapshot.status = "error".into();
                g.snapshot.error = Some(friendly_error(&err));
            }
        }
        g.snapshot.clone()
    };

    emit_state(&app, &snap);

    if trigger_install {
        return install_now(app).await;
    }
    if trigger_auto_download {
        let h = app.clone();
        tauri::async_runtime::spawn(async move {
            let _ = download_only(h).await;
        });
    }

    serde_json::to_value(&snap).unwrap_or(Value::Null)
}

fn friendly_error(raw: &str) -> String {
    let low = raw.to_ascii_lowercase();
    if low.contains("dns") || low.contains("connect") || low.contains("timed out") || low.contains("network") {
        "Couldn’t reach GitHub to check for updates. Check your internet connection.".into()
    } else if low.contains("signature") || low.contains("pubkey") {
        "Update signature verification failed. Please download the latest installer manually.".into()
    } else {
        raw.to_string()
    }
}

/// Downloads the pending update in the background without restarting (used when `autoUpdate` is on).
async fn download_only(app: AppHandle) -> Result<(), String> {
    let st = app.state::<UpdaterState>().inner().clone();
    let update = {
        let mut g = st.inner.lock().unwrap();
        if g.installing {
            return Ok(());
        }
        let update = match g.pending.as_ref() {
            Some(p) if p.bytes.is_some() => return Ok(()),
            Some(p) => p.update.clone(),
            None => return Err("No update available".into()),
        };
        g.installing = true;
        g.snapshot.status = "downloading".into();
        g.snapshot.downloaded = 0;
        g.snapshot.total = None;
        g.snapshot.percent = Some(0);
        g.snapshot.error = None;
        let snap = g.snapshot.clone();
        emit_state(&app, &snap);
        update
    };

    match stream_download(&app, &st, &update).await {
        Ok(bytes) => {
            let snap = {
                let mut g = st.inner.lock().unwrap();
                g.installing = false;
                if let Some(p) = g.pending.as_mut() {
                    p.bytes = Some(bytes);
                }
                g.snapshot.status = "ready".into();
                g.snapshot.percent = Some(100);
                g.snapshot.clone()
            };
            emit_state(&app, &snap);
            log_line(&app, "updater: background download ready to install on restart");
            Ok(())
        }
        Err(e) => {
            log_line(&app, &format!("updater: background download failed: {e}"));
            let snap = {
                let mut g = st.inner.lock().unwrap();
                g.installing = false;
                g.snapshot.status = "available".into();
                g.snapshot.downloaded = 0;
                g.snapshot.percent = None;
                g.snapshot.clone()
            };
            emit_state(&app, &snap);
            Err(e)
        }
    }
}

async fn stream_download(app: &AppHandle, st: &UpdaterState, update: &Update) -> Result<Vec<u8>, String> {
    let st_prog = st.clone();
    let app_prog = app.clone();
    let downloaded_acc = Arc::new(Mutex::new((0u64, Instant::now() - Duration::from_secs(1))));
    let downloaded_clone = downloaded_acc.clone();

    update
        .download(
            move |chunk_len, content_len| {
                let mut d = downloaded_clone.lock().unwrap();
                d.0 = d.0.saturating_add(chunk_len as u64);
                let total = content_len;
                let pct = total
                    .filter(|&t| t > 0)
                    .map(|t| ((d.0.saturating_mul(100)) / t).min(100) as u8);
                let should_emit = d.1.elapsed() >= Duration::from_millis(80) || pct == Some(100);
                if should_emit {
                    d.1 = Instant::now();
                    let snap = {
                        let mut g = st_prog.inner.lock().unwrap();
                        g.snapshot.downloaded = d.0;
                        g.snapshot.total = total;
                        g.snapshot.percent = pct;
                        g.snapshot.clone()
                    };
                    emit_state(&app_prog, &snap);
                }
            },
            || {},
        )
        .await
        .map_err(|e| friendly_error(&e.to_string()))
}

/// Downloads (if not already downloaded), verifies, installs in-place, and restarts Sympony.
pub async fn install_now(app: AppHandle) -> Value {
    let st = app.state::<UpdaterState>().inner().clone();

    // Handle local UI preview simulation cleanly without touching disk/network.
    let is_preview = st.inner.lock().unwrap().snapshot.preview;
    if is_preview {
        return run_preview_install(app, st).await;
    }

    if let Err(msg) = check_install_location() {
        let snap = {
            let mut g = st.inner.lock().unwrap();
            g.snapshot.status = "error".into();
            g.snapshot.error = Some(msg);
            g.snapshot.clone()
        };
        emit_state(&app, &snap);
        return serde_json::to_value(&snap).unwrap_or(Value::Null);
    }

    let (update, existing_bytes, ver, chan, notes) = {
        let mut g = st.inner.lock().unwrap();
        if g.installing {
            return serde_json::to_value(&g.snapshot).unwrap_or(Value::Null);
        }
        let (update, bytes) = match g.pending.as_mut() {
            Some(p) => (p.update.clone(), p.bytes.take()),
            None => return serde_json::to_value(&g.snapshot).unwrap_or(Value::Null),
        };
        g.installing = true;
        let ver = g.snapshot.available_version.clone().unwrap_or_else(|| update.version.clone());
        let chan = g.snapshot.available_channel.clone().unwrap_or_else(|| channel_of(&ver).to_string());
        let notes = g.snapshot.notes.clone();
        if bytes.is_none() {
            g.snapshot.status = "downloading".into();
            g.snapshot.downloaded = 0;
            g.snapshot.total = None;
            g.snapshot.percent = Some(0);
        } else {
            g.snapshot.status = "installing".into();
            g.snapshot.percent = Some(100);
        }
        g.snapshot.error = None;
        let snap = g.snapshot.clone();
        emit_state(&app, &snap);
        (update, bytes, ver, chan, notes)
    };

    let bytes = match existing_bytes {
        Some(b) => b,
        None => match stream_download(&app, &st, &update).await {
            Ok(b) => b,
            Err(e) => {
                log_line(&app, &format!("updater: download failed: {e}"));
                let snap = {
                    let mut g = st.inner.lock().unwrap();
                    g.installing = false;
                    g.snapshot.status = "error".into();
                    g.snapshot.error = Some(e);
                    g.snapshot.clone()
                };
                emit_state(&app, &snap);
                return serde_json::to_value(&snap).unwrap_or(Value::Null);
            }
        },
    };

    {
        let mut g = st.inner.lock().unwrap();
        g.snapshot.status = "installing".into();
        g.snapshot.percent = Some(100);
        let snap = g.snapshot.clone();
        emit_state(&app, &snap);
    }

    let data_dir = app.state::<App>().data_dir.clone();
    write_whats_new(&data_dir, &ver, &chan, &notes);
    log_line(&app, &format!("updater: installing v{ver} ({chan})..."));

    let install_res = tauri::async_runtime::spawn_blocking(move || update.install(bytes))
        .await
        .map_err(|e| e.to_string())
        .and_then(|r| r.map_err(|e| friendly_error(&e.to_string())));

    match install_res {
        Ok(()) => {
            log_line(&app, &format!("updater: installed v{ver}, restarting"));
            app.restart();
        }
        Err(e) => {
            log_line(&app, &format!("updater: install failed: {e}"));
            let snap = {
                let mut g = st.inner.lock().unwrap();
                g.installing = false;
                g.snapshot.status = "error".into();
                g.snapshot.error = Some(e);
                g.snapshot.clone()
            };
            emit_state(&app, &snap);
            serde_json::to_value(&snap).unwrap_or(Value::Null)
        }
    }
}

async fn run_preview_install(app: AppHandle, st: UpdaterState) -> Value {
    let total = 44_200_000u64;
    for step in [8u8, 24, 46, 68, 86, 100] {
        let snap = {
            let mut g = st.inner.lock().unwrap();
            g.snapshot.status = "downloading".into();
            g.snapshot.total = Some(total);
            g.snapshot.downloaded = (total * step as u64) / 100;
            g.snapshot.percent = Some(step);
            g.snapshot.clone()
        };
        emit_state(&app, &snap);
        std::thread::sleep(Duration::from_millis(220));
    }
    let snap = {
        let mut g = st.inner.lock().unwrap();
        g.snapshot.status = "ready".into();
        g.snapshot.percent = Some(100);
        g.snapshot.clone()
    };
    emit_state(&app, &snap);
    serde_json::to_value(&snap).unwrap_or(Value::Null)
}

/// Dismisses the currently available update banner & notch badge until a newer version ships.
pub fn dismiss_current(app: &AppHandle) -> Value {
    let st = app.state::<UpdaterState>().inner().clone();
    let ver = st.inner.lock().unwrap().snapshot.available_version.clone().unwrap_or_default();
    if !ver.is_empty() {
        let _ = crate::commands::apply_settings_patch(app, json!({ "dismissedUpdateVersion": ver }));
    }
    let snap = current_snapshot(app);
    emit_state(app, &snap);
    serde_json::to_value(&snap).unwrap_or(Value::Null)
}

/// Opens the release page for the available update (or all releases if none).
pub fn open_release_page(app: &AppHandle) -> Value {
    let snap = current_snapshot(app);
    let url = match snap.available_version.as_deref() {
        Some(v) if !v.is_empty() && !snap.preview => {
            format!("{RELEASES_URL}/tag/v{}", v.trim_start_matches('v'))
        }
        _ => RELEASES_URL.to_string(),
    };
    std::thread::spawn(move || {
        let _ = platform::os::shell::open(&url);
    });
    json!({ "ok": true })
}

/// Local UI preview helper (`notch.svc('update', 'preview', 'beta' | 'stable' | 'downloading' | 'ready' | 'error' | 'clear')`)
/// so banners, notch dot badges, toasts, and progress states can be verified before publishing a release.
fn set_preview(app: &AppHandle, mode: &str) -> Value {
    let st = app.state::<UpdaterState>().inner().clone();
    let settings = app.state::<App>().settings.get();
    let current = env!("CARGO_PKG_VERSION").to_string();
    let watch_beta = effective_watch_beta(&settings, &current);

    let snap = {
        let mut g = st.inner.lock().unwrap();
        g.pending = None;
        g.checking = false;
        g.installing = false;
        g.snapshot.watch_beta = watch_beta;
        g.snapshot.dismissed_version.clear();
        g.snapshot.last_checked = Some(chrono::Utc::now().timestamp_millis());
        match mode {
            "stable" => {
                g.snapshot.status = "available".into();
                g.snapshot.available_version = Some("0.2.0".into());
                g.snapshot.available_channel = Some("stable".into());
                g.snapshot.notes = "- New: Dual-channel in-app auto-updater (Stable & Beta)\n- Improved: Faster multi-step Pony Eyes & Hands automation\n- Fixed: Slimmer camera notch clock layout".into();
                g.snapshot.pub_date = Some(chrono::Utc::now().to_rfc3339());
                g.snapshot.downloaded = 0;
                g.snapshot.total = None;
                g.snapshot.percent = None;
                g.snapshot.error = None;
                g.snapshot.preview = true;
            }
            "beta" => {
                g.snapshot.status = "available".into();
                g.snapshot.available_version = Some("0.2.0-beta.1".into());
                g.snapshot.available_channel = Some("beta".into());
                g.snapshot.notes = "- New: Early preview of dual-channel auto-updater\n- Improved: Expressive Pony voice eyes and floating open-notch pill\n- Fixed: Accessibility auto-recovery on macOS".into();
                g.snapshot.pub_date = Some(chrono::Utc::now().to_rfc3339());
                g.snapshot.downloaded = 0;
                g.snapshot.total = None;
                g.snapshot.percent = None;
                g.snapshot.error = None;
                g.snapshot.preview = true;
            }
            "downloading" => {
                g.snapshot.status = "downloading".into();
                if g.snapshot.available_version.is_none() {
                    g.snapshot.available_version = Some("0.2.0-beta.1".into());
                    g.snapshot.available_channel = Some("beta".into());
                }
                g.snapshot.downloaded = 25_600_000;
                g.snapshot.total = Some(44_200_000);
                g.snapshot.percent = Some(58);
                g.snapshot.error = None;
                g.snapshot.preview = true;
            }
            "ready" => {
                g.snapshot.status = "ready".into();
                if g.snapshot.available_version.is_none() {
                    g.snapshot.available_version = Some("0.2.0".into());
                    g.snapshot.available_channel = Some("stable".into());
                }
                g.snapshot.downloaded = 44_200_000;
                g.snapshot.total = Some(44_200_000);
                g.snapshot.percent = Some(100);
                g.snapshot.error = None;
                g.snapshot.preview = true;
            }
            "error" => {
                g.snapshot.status = "error".into();
                g.snapshot.error = Some("Move Sympony.app into your Applications folder first so it can update automatically.".into());
                g.snapshot.preview = true;
            }
            _ => {
                g.snapshot.status = "upToDate".into();
                g.snapshot.available_version = None;
                g.snapshot.available_channel = None;
                g.snapshot.notes.clear();
                g.snapshot.pub_date = None;
                g.snapshot.downloaded = 0;
                g.snapshot.total = None;
                g.snapshot.percent = None;
                g.snapshot.error = None;
                g.snapshot.preview = false;
            }
        }
        g.snapshot.clone()
    };
    emit_state(app, &snap);
    serde_json::to_value(&snap).unwrap_or(Value::Null)
}

/// Registers `update.*` service handlers (`whatsNew`, `install`, `dismiss`, `preview`).
pub fn register(reg: &mut Registry, app: &AppHandle) {
    {
        let h = app.clone();
        reg.add(
            "update.whatsNew",
            Box::new(move |_, _| {
                let dir = h.state::<App>().data_dir.clone();
                Ok(read_whats_new(&dir))
            }),
        );
    }
    {
        let h = app.clone();
        reg.add(
            "update.install",
            Box::new(move |_, _| {
                let app = h.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = install_now(app).await;
                });
                Ok(state_json(&h))
            }),
        );
    }
    {
        let h = app.clone();
        reg.add("update.dismiss", Box::new(move |_, _| Ok(dismiss_current(&h))));
    }
    {
        let h = app.clone();
        reg.add(
            "update.preview",
            Box::new(move |_, args| {
                let mode = args.first().and_then(Value::as_str).unwrap_or("clear");
                Ok(set_preview(&h, mode))
            }),
        );
    }
}

/// Reacts to settings changes affecting the updater (`updateBeta`, `updateCheck`, `autoUpdate`, `dismissedUpdateVersion`).
pub fn settings_changed(app: &AppHandle, patch: &Value) {
    let beta_changed = patch.get("updateBeta").is_some();
    let check_enabled = patch.get("updateCheck") == Some(&Value::Bool(true));
    let auto_enabled = patch.get("autoUpdate") == Some(&Value::Bool(true));
    let dismissed_changed = patch.get("dismissedUpdateVersion").is_some();

    if beta_changed || dismissed_changed {
        let snap = current_snapshot(app);
        emit_state(app, &snap);
    }

    if beta_changed || check_enabled {
        let h = app.clone();
        tauri::async_runtime::spawn(async move {
            let _ = check_now(h, false, true).await;
        });
    } else if auto_enabled {
        let should_download = {
            let st = app.state::<UpdaterState>();
            let g = st.inner.lock().unwrap();
            g.snapshot.status == "available" && g.pending.as_ref().is_some_and(|p| p.bytes.is_none())
        };
        if should_download {
            let h = app.clone();
            tauri::async_runtime::spawn(async move {
                let _ = download_only(h).await;
            });
        }
    }
}

/// Starts the background update scheduler (initial check 15s after boot, then every 6 hours while `updateCheck` is on).
pub fn start(app: &AppHandle) {
    let h = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(INITIAL_DELAY_SECS));
        loop {
            let enabled = h
                .state::<App>()
                .settings
                .get()
                .get("updateCheck")
                .and_then(Value::as_bool)
                .unwrap_or(true);
            if enabled {
                let h2 = h.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = check_now(h2, false, true).await;
                });
            }
            std::thread::sleep(Duration::from_secs(CHECK_INTERVAL_SECS));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prerelease_and_channel_detection() {
        assert!(!is_prerelease("0.1.0"));
        assert!(!is_prerelease("v1.2.3"));
        assert!(is_prerelease("0.2.0-beta.1"));
        assert!(is_prerelease("v0.2.0-rc.1"));
        assert_eq!(channel_of("0.2.0"), "stable");
        assert_eq!(channel_of("0.2.0-beta.2"), "beta");
    }

    #[test]
    fn effective_watch_beta_defaults_by_build() {
        let unset = json!({ "updateBeta": null });
        assert!(effective_watch_beta(&unset, "0.2.0-beta.1"));
        assert!(!effective_watch_beta(&unset, "0.2.0"));

        let forced_on = json!({ "updateBeta": true });
        assert!(effective_watch_beta(&forced_on, "0.2.0"));

        let forced_off = json!({ "updateBeta": false });
        assert!(!effective_watch_beta(&forced_off, "0.2.0-beta.1"));
    }

    #[test]
    fn endpoints_follow_channel_and_override() {
        assert_eq!(endpoints_for(false, None), vec![STABLE_ENDPOINT]);
        assert_eq!(endpoints_for(true, None), vec![BETA_ENDPOINT, STABLE_ENDPOINT]);
        assert_eq!(
            endpoints_for(false, Some("http://127.0.0.1:8787/latest.json")),
            vec!["http://127.0.0.1:8787/latest.json"]
        );
    }

    #[test]
    fn missing_manifest_errors_recognized() {
        assert!(is_missing_manifest_error("status code 404 Not Found"));
        assert!(is_missing_manifest_error("Could not fetch a valid release JSON from the remote"));
        assert!(is_missing_manifest_error("the platform `windows-x86_64` was not found in the response `platforms` object"));
        assert!(is_missing_manifest_error("None of the fallback platforms `[\"windows-x86_64\"]` were found in the response `platforms` object"));
        assert!(!is_missing_manifest_error("connection refused"));
    }

    #[test]
    fn semver_ordering_prefers_newest_across_beta_and_stable() {
        assert!(compare_semver("0.2.0", "0.2.0-beta.4").is_gt());
        assert!(compare_semver("0.2.0-beta.10", "0.2.0-beta.4").is_gt());
        assert!(compare_semver("0.2.0-beta.4", "0.2.0-beta.3").is_gt());
        assert!(compare_semver("0.2.0-beta.4", "0.1.0").is_gt());
        assert!(compare_semver("v0.2.0-beta.4", "0.2.0-beta.4").is_eq());
    }
}
