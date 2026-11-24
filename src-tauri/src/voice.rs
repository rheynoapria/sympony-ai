//! Sympony Voice V1 runtime: state machine wiring, lazy local/cloud engines,
//! global modifier triggers, `voice.*` svc handlers, and `voice:*` events.
//! Kept outside `crates/contract/contract.json` so core parity stays 216/216.
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime};

use platform::os::voice::mic_status;
#[cfg(target_os = "macos")]
use platform::os::voice::{MacInsert as NativeInsert, MacTrigger as NativeTrigger};
#[cfg(target_os = "windows")]
use platform::os::voice::{WinInsert as NativeInsert, WinTrigger as NativeTrigger};
use platform::voice::{Capture, CpalCapture, Insert, InsertResult, Trigger, TriggerEvent, VoiceKey};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use voice::dictionary::UserDict;
use voice::engine::{Engine, Hints, Lang, Stream, StreamEngine, VoiceError};
use voice::engine_cloud::{CloudRegion, DashScope};
use voice::engine_local::{pcm_rms, LocalQwen, LocalZipformer};
use voice::models;
use voice::normalize::{NormOptions, UnitsStyle};
use voice::pipeline::{prompt_terms, Pipeline};
use voice::postcorrect::PostcorrectIndex;
use voice::session::{Action, Session, TriggerEv, VState};
use voice::vocab::{Category, Term, Vocab};

use crate::commands::App;

const HISTORY_MAX_LINES: usize = 1_000;
const PROMPT_CAP: usize = 150;

fn sympony_home() -> PathBuf {
    services::pony::home()
}

fn dict_path() -> PathBuf {
    sympony_home().join("dictionary.json")
}

fn history_path() -> PathBuf {
    sympony_home().join("voice-history.jsonl")
}

fn resolve_vocab_dir(app: &AppHandle) -> PathBuf {
    if let Ok(res_dir) = app.path().resource_dir() {
        let bundled = res_dir.join("voice").join("data");
        if bundled.join("vocab").is_dir() {
            return bundled;
        }
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("crates")
        .join("voice")
        .join("data");
    if dev.join("vocab").is_dir() {
        return dev;
    }
    PathBuf::from("crates/voice/data")
}

fn total_ram_bytes() -> u64 {
    #[cfg(target_os = "macos")]
    {
        let mut mem: u64 = 0;
        let mut len = std::mem::size_of::<u64>();
        let name = b"hw.memsize\0";
        unsafe {
            libc::sysctlbyname(
                name.as_ptr() as *const libc::c_char,
                &mut mem as *mut u64 as *mut libc::c_void,
                &mut len,
                std::ptr::null_mut(),
                0,
            );
        }
        mem
    }
    #[cfg(not(target_os = "macos"))]
    {
        8 * 1024 * 1024 * 1024
    }
}

fn physical_cores() -> usize {
    thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum VoiceMode {
    Dictate,
    Command,
}

struct LoadedQwen {
    tier: String,
    engine: Arc<LocalQwen>,
    last_used: Instant,
}

struct LoadedZipformer {
    engine: Arc<LocalZipformer>,
    last_used: Instant,
}

#[derive(Clone, Default)]
struct ActiveDownload {
    id: String,
    done: u64,
    total: u64,
    status: String,
}

type DictStamp = Option<(Option<SystemTime>, u64)>;

struct CachedPostIndex {
    stamp: DictStamp,
    dict: Arc<UserDict>,
    index: Arc<PostcorrectIndex>,
}

fn dict_stamp(path: &std::path::Path) -> DictStamp {
    fs::metadata(path).ok().map(|m| (m.modified().ok(), m.len()))
}

pub struct VoiceRuntime {
    app: AppHandle,
    vocab_dir: PathBuf,
    vocab: OnceLock<Arc<Vocab>>,
    vocab_warming: AtomicBool,
    post_cache: Mutex<Option<CachedPostIndex>>,
    epoch: Instant,
    session: Mutex<Session>,
    mode: Mutex<VoiceMode>,
    /// For a spoken command: the app and window the user was in when they spoke (with Eyes on).
    screen: Mutex<Option<(String, String)>>,
    /// The app that had keyboard focus when dictation started, so synthetic ⌘V never pastes into a switched app.
    target_pid: Mutex<Option<i32>>,
    trigger: NativeTrigger,
    cmd_trigger: NativeTrigger,
    capture: CpalCapture,
    insert: NativeInsert,
    qwen: Mutex<Option<LoadedQwen>>,
    zipformer: Mutex<Option<LoadedZipformer>>,
    active_stream: Mutex<Option<Box<dyn Stream>>>,
    stream_stop: Arc<AtomicBool>,
    download_cancel: Arc<AtomicBool>,
    active_download: Mutex<Option<ActiveDownload>>,
    light_suggested: AtomicBool,
    ax_waiting: AtomicBool,
}

impl VoiceRuntime {
    fn new(app: AppHandle) -> Arc<Self> {
        let vocab_dir = resolve_vocab_dir(&app);
        let ram = total_ram_bytes();
        let light_suggested = ram < 8 * 1024 * 1024 * 1024;
        let rt = Arc::new(Self {
            app,
            vocab_dir,
            vocab: OnceLock::new(),
            vocab_warming: AtomicBool::new(false),
            post_cache: Mutex::new(None),
            epoch: Instant::now(),
            session: Mutex::new(Session::new(false, false)),
            mode: Mutex::new(VoiceMode::Dictate),
            screen: Mutex::new(None),
            target_pid: Mutex::new(None),
            trigger: NativeTrigger::new(),
            cmd_trigger: NativeTrigger::new(),
            capture: CpalCapture::new(),
            insert: NativeInsert::new(),
            qwen: Mutex::new(None),
            zipformer: Mutex::new(None),
            active_stream: Mutex::new(None),
            stream_stop: Arc::new(AtomicBool::new(false)),
            download_cancel: Arc::new(AtomicBool::new(false)),
            active_download: Mutex::new(None),
            light_suggested: AtomicBool::new(light_suggested),
            ax_waiting: AtomicBool::new(false),
        });
        Self::start_idle_reaper(Arc::clone(&rt));
        rt
    }

    fn now_ms(&self) -> u64 {
        self.epoch.elapsed().as_millis() as u64
    }

    fn vocab(&self) -> &Arc<Vocab> {
        self.vocab.get_or_init(|| Arc::new(Vocab::load(&self.vocab_dir)))
    }

    /// Warms `Vocab` and `PostcorrectIndex` on a background thread at `LoadModel`/`OpenMic` so the first dictation
    /// doesn't pay dictionary parsing + phonetic indexing latency after the user stops speaking.
    fn warm_vocab_bg(self: &Arc<Self>) {
        if self.vocab.get().is_some() || self.vocab_warming.swap(true, Ordering::AcqRel) {
            return;
        }
        let rt = Arc::clone(self);
        thread::spawn(move || {
            let _ = rt.cached_dict_and_index();
        });
    }

    fn vocab_missing(&self) -> Vec<String> {
        match self.vocab.get() {
            Some(v) => v.missing.clone(),
            None => Vocab::check_missing(&self.vocab_dir),
        }
    }

    fn invalidate_post_cache(&self) {
        if let Ok(mut c) = self.post_cache.lock() {
            *c = None;
        }
    }

    fn cached_dict_and_index(&self) -> (Arc<UserDict>, Arc<PostcorrectIndex>) {
        let path = dict_path();
        let stamp = dict_stamp(&path);
        if let Ok(guard) = self.post_cache.lock() {
            if let Some(ref cached) = *guard {
                if cached.stamp == stamp {
                    return (Arc::clone(&cached.dict), Arc::clone(&cached.index));
                }
            }
        }
        let dict = Arc::new(UserDict::load(&path));
        let vocab = self.vocab();
        let extra: Vec<Term> = dict
            .terms
            .iter()
            .map(|t| Term {
                text: t.text.clone(),
                category: Category::User,
            })
            .collect();
        let index = Arc::new(PostcorrectIndex::build(vocab, &extra));
        if let Ok(mut guard) = self.post_cache.lock() {
            *guard = Some(CachedPostIndex {
                stamp,
                dict: Arc::clone(&dict),
                index: Arc::clone(&index),
            });
        }
        (dict, index)
    }

    fn settings(&self) -> Arc<Value> {
        self.app.state::<App>().settings.snapshot()
    }

    fn effective_tier(&self, s: &Value) -> String {
        match s.get("voiceTier").and_then(Value::as_str).unwrap_or("auto") {
            "auto" | "hybrid" => "hybrid".into(),
            "light" => "light".into(),
            "1.7b" => "1.7b".into(),
            "cloud" => "cloud".into(),
            _ => "hybrid".into(),
        }
    }

    fn effective_threads(&self, s: &Value) -> usize {
        let raw = s.get("voiceThreads").and_then(Value::as_u64).unwrap_or(0) as usize;
        if raw > 0 {
            raw.clamp(1, 8)
        } else {
            models::default_threads(physical_cores())
        }
    }

    fn has_required_model(&self, s: &Value) -> bool {
        match self.effective_tier(s).as_str() {
            "light" => models::is_downloaded("zf-id"),
            "1.7b" => models::is_downloaded("1.7b"),
            "cloud" => self
                .app
                .state::<App>()
                .settings
                .secret_value("voiceCloudKey")
                .is_some_and(|k| !k.trim().is_empty()),
            _ => models::is_downloaded("0.6b"),
        }
    }

    fn norm_options(&self, s: &Value) -> NormOptions {
        let mut opts = NormOptions::user_default();
        opts.units = match s
            .get("voiceUnits")
            .and_then(Value::as_str)
            .unwrap_or("symbols")
        {
            "words" => UnitsStyle::Words,
            _ => UnitsStyle::Symbols,
        };
        opts.spoken_punct = s
            .get("voiceSpokenPunct")
            .and_then(Value::as_bool)
            .unwrap_or(true);
        opts
    }

    fn format_live_partial(raw: &str) -> String {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return String::new();
        }
        let lower = trimmed.to_lowercase();
        let mut chars = lower.chars();
        match chars.next() {
            None => String::new(),
            Some(first) => {
                let mut out = String::with_capacity(lower.len());
                for c in first.to_uppercase() {
                    out.push(c);
                }
                out.push_str(chars.as_str());
                out
            }
        }
    }

    fn start_idle_reaper(rt: Arc<Self>) {
        thread::spawn(move || loop {
            thread::sleep(Duration::from_secs(15));
            let s = rt.settings();
            let keep_loaded = s
                .get("voiceKeepLoaded")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            if !keep_loaded {
                if let Ok(mut q) = rt.qwen.lock() {
                    if let Some(ref loaded) = *q {
                        if loaded.last_used.elapsed() >= loaded.engine.idle_unload_after() {
                            *q = None;
                        }
                    }
                }
            }
            if let Ok(mut z) = rt.zipformer.lock() {
                if let Some(ref loaded) = *z {
                    if loaded.last_used.elapsed() >= loaded.engine.idle_unload_after() {
                        *z = None;
                    }
                }
            }
        });
    }

    fn ensure_zipformer(&self, threads: usize) -> Option<Arc<LocalZipformer>> {
        if let Ok(mut g) = self.zipformer.lock() {
            if let Some(ref mut loaded) = *g {
                loaded.last_used = Instant::now();
                return Some(Arc::clone(&loaded.engine));
            }
        }
        let dir = models::path("zf-id");
        let loaded = LocalZipformer::load(&dir, threads.min(2)).ok()?;
        let arc = Arc::new(loaded);
        if let Ok(mut g) = self.zipformer.lock() {
            *g = Some(LoadedZipformer {
                engine: Arc::clone(&arc),
                last_used: Instant::now(),
            });
        }
        Some(arc)
    }

    fn ensure_qwen(&self, tier_id: &str, threads: usize) -> Result<Arc<LocalQwen>, VoiceError> {
        if let Ok(mut g) = self.qwen.lock() {
            if let Some(ref mut loaded) = *g {
                if loaded.tier == tier_id {
                    loaded.last_used = Instant::now();
                    return Ok(Arc::clone(&loaded.engine));
                }
            }
        }
        let model_id = if tier_id == "1.7b" { "1.7b" } else { "0.6b" };
        let p = models::path(model_id);
        let t0 = Instant::now();
        let loaded = LocalQwen::load(&p, threads, 2048);
        self.log(&format!("voice: loading {model_id} {} in {} ms", if loaded.is_ok() { "done" } else { "failed" }, t0.elapsed().as_millis()));
        let loaded = loaded?;
        let arc = Arc::new(loaded);
        if let Ok(mut g) = self.qwen.lock() {
            *g = Some(LoadedQwen {
                tier: tier_id.to_string(),
                engine: Arc::clone(&arc),
                last_used: Instant::now(),
            });
        }
        Ok(arc)
    }

    /// Whether the user is in a text field of another app now (Sympony's own notch counts as talking to Pony).
    fn typing(&self) -> bool {
        let me = std::process::id() as i32;
        platform::ax::front_pid().filter(|&p| p != me).is_some_and(platform::ax::typing_in)
    }

    fn log(&self, line: &str) {
        self.app.state::<App>().log.line(line);
    }

    pub fn sync_triggers(self: &Arc<Self>) {
        self.trigger.stop();
        self.cmd_trigger.stop();

        let s = self.settings();
        let enabled = s
            .get("voiceEnabled")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let tier = self.effective_tier(&s);
        let has_model = self.has_required_model(&s);
        let live = s.get("voiceLive").and_then(Value::as_bool).unwrap_or(true);

        if let Ok(mut sess) = self.session.lock() {
            sess.set_light_mode(tier == "light");
            sess.set_has_model(has_model);
        }

        // (the key is watched even before the model is here: holding it then shows "Model not downloaded" in the
        // notch, with a way to get it, instead of nothing at all)
        if !enabled {
            return;
        }

        // Warm Zipformer in background when live streaming or light mode is active.
        if (live || tier == "light") && models::is_downloaded("zf-id") {
            let rt = Arc::clone(self);
            let threads = self.effective_threads(&s);
            thread::spawn(move || {
                let _ = rt.ensure_zipformer(threads);
            });
        }

        let key_str = s
            .get("voiceKey")
            .and_then(Value::as_str)
            .unwrap_or("right_option");
        let (tx, rx) = mpsc::channel();
        match self.trigger.start(VoiceKey::from_setting(key_str), tx) {
            Ok(_) => {
                self.log(&format!("voice: listening for {key_str} (model {})", if has_model { "ready" } else { "not here yet" }));
                let rt = Arc::clone(self);
                thread::spawn(move || {
                    while let Ok(ev) = rx.recv() {
                        rt.handle_trigger(ev, VoiceMode::Dictate);
                    }
                });
            }
            Err(e) => {
                self.log(&format!("voice: can't watch {key_str}: {e:?}"));
                // (macOS: the key needs Accessibility, watched for until granted; Windows has no such permission)
                if cfg!(target_os = "macos") && !platform::os::banners::trusted(false) {
                    self.watch_for_accessibility();
                }
            }
        }

        let cmd_key = s
            .get("voiceCommandKey")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string();
        if !cmd_key.is_empty() {
            let (ctx, crx) = mpsc::channel();
            if self
                .cmd_trigger
                .start(VoiceKey::from_setting(&cmd_key), ctx)
                .is_ok()
            {
                self.log(&format!("voice: listening for command key {cmd_key}"));
                let rt = Arc::clone(self);
                thread::spawn(move || {
                    while let Ok(ev) = crx.recv() {
                        rt.handle_trigger(ev, VoiceMode::Command);
                    }
                });
            }
        }
    }

    fn watch_for_accessibility(self: &Arc<Self>) {
        if self
            .ax_waiting
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return;
        }
        let rt = Arc::clone(self);
        thread::spawn(move || {
            loop {
                thread::sleep(Duration::from_secs(2));
                let enabled = rt
                    .settings()
                    .get("voiceEnabled")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                if !enabled {
                    rt.ax_waiting.store(false, Ordering::SeqCst);
                    break;
                }
                if platform::os::banners::trusted(false) {
                    rt.ax_waiting.store(false, Ordering::SeqCst);
                    rt.log("voice: Accessibility granted — starting dictation trigger");
                    rt.sync_triggers();
                    let _ = rt.app.emit("voice:perm", json!({ "accessibility": "granted" }));
                    break;
                }
            }
        });
    }

    fn handle_trigger(self: &Arc<Self>, ev: TriggerEvent, mode: VoiceMode) {
        let mapped = match ev {
            TriggerEvent::Down => TriggerEv::Down,
            TriggerEvent::HoldStart => TriggerEv::HoldStart,
            TriggerEvent::Up => TriggerEv::Up,
            TriggerEvent::DoubleTap => TriggerEv::DoubleTap,
            TriggerEvent::Cancel => TriggerEv::Cancel,
        };
        if matches!(mapped, TriggerEv::HoldStart | TriggerEv::DoubleTap) {
            let s = self.settings();
            // (one key, two ways: typing in a text field dictates there; anywhere else — or while Pony is
            // actively running so the user can steer Pony mid-run even if Hands just focused a text field —
            // what's said goes straight to Pony)
            let active_chat = crate::agents::has_active_chat(&self.app);
            let mode = if mode == VoiceMode::Dictate
                && s.get("voiceAgentAuto").and_then(Value::as_bool).unwrap_or(true)
                && (active_chat || !self.typing())
            {
                VoiceMode::Command
            } else {
                mode
            };
            let skip: Vec<String> = s
                .get("ponyEyesSkip")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|v| v.as_str().map(String::from))
                .collect();
            let screen = (mode == VoiceMode::Command && s.get("ponyEyes").and_then(Value::as_bool) == Some(true))
                .then(|| platform::ax::front_app(std::process::id() as i32))
                .flatten()
                .filter(|(_, _, bundle)| !services::eyes::skipped(bundle, &skip))
                .map(|(pid, name, _)| (name, platform::ax::window(pid).map(|w| w.text("AXTitle")).unwrap_or_default()));
            if let Ok(mut g) = self.screen.lock() {
                *g = screen;
            }
            if let Ok(mut m) = self.mode.lock() {
                *m = mode;
            }
            if let Ok(mut sess) = self.session.lock() {
                sess.set_light_mode(self.effective_tier(&s) == "light");
                sess.set_has_model(self.has_required_model(&s));
            }
        }
        let actions = {
            let Ok(mut sess) = self.session.lock() else {
                return;
            };
            sess.on_trigger(mapped, self.now_ms())
        };
        self.exec_actions(actions, mapped == TriggerEv::Cancel);
    }

    fn exec_actions(self: &Arc<Self>, actions: Vec<Action>, was_cancel: bool) {
        for act in actions {
            match act {
                Action::LoadModel => {
                    self.warm_vocab_bg();
                    let s = self.settings();
                    let tier = self.effective_tier(&s);
                    if tier == "hybrid" || tier == "1.7b" {
                        let rt = Arc::clone(self);
                        let threads = self.effective_threads(&s);
                        thread::spawn(move || {
                            let _ = rt.ensure_qwen(&tier, threads);
                        });
                    }
                }
                Action::OpenMic => {
                    self.warm_vocab_bg();
                    let me = std::process::id() as i32;
                    if let Ok(mut tp) = self.target_pid.lock() {
                        *tp = platform::ax::front_pid().filter(|&p| p != me);
                    }
                    self.start_capture_and_stream();
                }
                Action::StartStream => {
                    // Handled together with OpenMic so buffered audio feeds the stream immediately.
                }
                Action::Partial(text) => {
                    let display = Self::format_live_partial(&text);
                    if !display.is_empty() {
                        let _ = self.app.emit("voice:partial", json!({ "text": display }));
                    }
                }
                Action::CloseMic => {
                    self.stream_stop.store(true, Ordering::Relaxed);
                }
                Action::Transcribe => {
                    let pcm = self.capture.stop();
                    let stream = self.active_stream.lock().ok().and_then(|mut g| g.take());
                    let rt = Arc::clone(self);
                    thread::spawn(move || {
                        // (a panic here would leave the pill on "Writing…" for good: it ends as an error instead)
                        let secs = pcm.len() as f32 / 16_000.0;
                        let rt2 = Arc::clone(&rt);
                        if std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| rt2.run_transcribe(pcm, stream))).is_err() {
                            rt.log(&format!("voice: transcribing {secs:.1} s of audio panicked"));
                            let actions = rt.session.lock().map(|mut s| s.on_result(Err(VoiceError::Engine("crashed".into())))).unwrap_or_default();
                            rt.exec_actions(actions, false);
                        }
                    });
                }
                Action::Insert(text) => {
                    self.deliver_text(text);
                }
                Action::Notify(st) => {
                    self.emit_state(&st, was_cancel);
                }
                Action::Toast(msg) => {
                    let _ = self.app.emit(
                        "voice:state",
                        json!({
                            "state": "error",
                            "ms": self.now_ms(),
                            "error": msg,
                            "action": if msg == "Model not downloaded" { Some("download") } else { None },
                        }),
                    );
                }
            }
        }
    }

    fn start_capture_and_stream(self: &Arc<Self>) {
        let s = self.settings();
        let device = s
            .get("voiceDevice")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|d| !d.is_empty())
            .map(str::to_string);
        let live = s.get("voiceLive").and_then(Value::as_bool).unwrap_or(true);
        let tier = self.effective_tier(&s);
        let threads = self.effective_threads(&s);

        if (live || tier == "light") && models::is_downloaded("zf-id") {
            if let Some(zf) = self.ensure_zipformer(threads) {
                if let Ok(mut st) = self.active_stream.lock() {
                    *st = Some(zf.start());
                }
            }
        }

        let (tx, rx) = mpsc::channel::<Vec<f32>>();
        if let Err(e) = self.capture.start(device.as_deref(), tx) {
            let _ = self.app.emit(
                "voice:state",
                json!({
                    "state": "error",
                    "ms": self.now_ms(),
                    "error": e,
                    "action": "mic",
                }),
            );
            if let Ok(mut sess) = self.session.lock() {
                let _ = sess.on_trigger(TriggerEv::Cancel, self.now_ms());
            }
            return;
        }

        self.stream_stop.store(false, Ordering::Relaxed);
        let rt = Arc::clone(self);
        thread::spawn(move || {
            let mut last_level_emit = Instant::now() - Duration::from_millis(50);
            while !rt.stream_stop.load(Ordering::Relaxed) {
                match rx.recv_timeout(Duration::from_millis(50)) {
                    Ok(chunk) => {
                        let rms = pcm_rms(&chunk);
                        if last_level_emit.elapsed() >= Duration::from_millis(33) {
                            last_level_emit = Instant::now();
                            let _ = rt.app.emit("voice:level", json!({ "rms": rms }));
                        }
                        let partial = if let Ok(mut st_guard) = rt.active_stream.lock() {
                            if let Some(ref mut st) = *st_guard {
                                st.accept(&chunk);
                                Some(st.partial())
                            } else {
                                None
                            }
                        } else {
                            None
                        };
                        let actions = {
                            let Ok(mut sess) = rt.session.lock() else {
                                break;
                            };
                            sess.on_audio_chunk(rms, partial.as_deref(), rt.now_ms())
                        };
                        let stopped = actions.iter().any(|a| matches!(a, Action::CloseMic));
                        if stopped {
                            rt.trigger.reset_state();
                            rt.cmd_trigger.reset_state();
                        }
                        rt.exec_actions(actions, false);
                        if stopped {
                            break;
                        }
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {
                        // Still tick 55s / 60s / hands-free silence checks.
                        let actions = {
                            let Ok(mut sess) = rt.session.lock() else {
                                break;
                            };
                            sess.on_audio_chunk(0.0, None, rt.now_ms())
                        };
                        let stopped = actions.iter().any(|a| matches!(a, Action::CloseMic));
                        if stopped {
                            rt.trigger.reset_state();
                            rt.cmd_trigger.reset_state();
                        }
                        rt.exec_actions(actions, false);
                        if stopped {
                            break;
                        }
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                }
            }
        });
    }

    fn run_transcribe(self: &Arc<Self>, pcm: Vec<f32>, stream: Option<Box<dyn Stream>>) {
        let s = self.settings();
        let tier = self.effective_tier(&s);
        let threads = self.effective_threads(&s);
        let vocab = self.vocab();
        let (dict, post_index) = self.cached_dict_and_index();
        let jargon = s
            .get("voiceJargon")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let lang = Lang::from_setting(
            s.get("voiceLanguage")
                .and_then(Value::as_str)
                .unwrap_or("id"),
        );
        let hints = Hints {
            language: lang,
            terms: prompt_terms(vocab, &dict, jargon, PROMPT_CAP),
        };

        let t0 = Instant::now();
        self.log(&format!("voice: transcribing {:.1} s of audio with {tier}", pcm.len() as f32 / 16_000.0));
        let raw_res: Result<String, VoiceError> = match tier.as_str() {
            "light" => {
                if pcm.is_empty() || pcm_rms(&pcm) < 0.0015 {
                    Err(VoiceError::Silence)
                } else if let Some(st) = stream {
                    let txt = st.finish();
                    if txt.trim().is_empty() {
                        Err(VoiceError::Silence)
                    } else {
                        Ok(txt)
                    }
                } else if let Some(zf) = self.ensure_zipformer(threads) {
                    zf.transcribe(&pcm, &hints).map(|t| t.text)
                } else {
                    Err(VoiceError::NoModel)
                }
            }
            "cloud" => {
                let key = self
                    .app
                    .state::<App>()
                    .settings
                    .secret_value("voiceCloudKey")
                    .unwrap_or_default();
                let region = CloudRegion::from_setting(
                    s.get("voiceCloudRegion")
                        .and_then(Value::as_str)
                        .unwrap_or("intl"),
                );
                let engine = DashScope { key, region };
                engine.transcribe(&pcm, &hints).map(|t| t.text)
            }
            _ => {
                // hybrid (0.6b) or 1.7b
                drop(stream);
                match self.ensure_qwen(&tier, threads) {
                    Ok(qwen) => qwen.transcribe(&pcm, &hints).map(|t| t.text),
                    Err(e) => Err(e),
                }
            }
        };

        let elapsed_ms = t0.elapsed().as_millis() as u64;
        // (how long and how much, never what was said)
        self.log(&match &raw_res {
            Ok(t) => format!("voice: {tier} gave {} chars in {elapsed_ms} ms", t.chars().count()),
            Err(e) => format!("voice: {tier} failed in {elapsed_ms} ms: {e}"),
        });
        let norm_opts = self.norm_options(&s);
        let mut corrections_json: Vec<Value> = Vec::new();
        let final_res = raw_res.map(|raw| {
            let pipe = Pipeline {
                vocab,
                dict: &dict,
                norm: norm_opts,
            };
            let out = pipe.run_with_index(&raw, &post_index);
            corrections_json = out
                .corrections
                .iter()
                .map(|c| {
                    json!({
                        "from": c.from,
                        "to": c.to,
                        "category": format!("{:?}", c.category),
                    })
                })
                .collect();
            out.text
        });

        let actions = {
            let Ok(mut sess) = self.session.lock() else {
                return;
            };
            sess.on_result(final_res)
        };

        for act in actions {
            match act {
                Action::Insert(text) => {
                    self.deliver_text_with_meta(text, corrections_json.clone(), elapsed_ms);
                }
                other => self.exec_actions(vec![other], false),
            }
        }
    }

    fn deliver_text(self: &Arc<Self>, text: String) {
        self.deliver_text_with_meta(text, Vec::new(), 0);
    }

    fn deliver_text_with_meta(
        self: &Arc<Self>,
        text: String,
        corrections: Vec<Value>,
        ms: u64,
    ) {
        let s = self.settings();
        let mode = self
            .mode
            .lock()
            .map(|m| *m)
            .unwrap_or(VoiceMode::Dictate);

        if mode == VoiceMode::Command {
            let has_pony = s
                .get("chatAgent")
                .and_then(Value::as_str)
                .is_some_and(|a| !a.trim().is_empty())
                || matches!(s.get("ponyBrain").and_then(Value::as_str), Some("sympony" | "api"))
                || sympony_home().join("skills").is_dir();
            if has_pony {
                let screen = self.screen.lock().ok().and_then(|mut g| g.take()).map(|(app, title)| json!({"app": app, "title": title}));
                let hands_on = s.get("ponyEyes") == Some(&Value::Bool(true)) && s.get("ponyHands") == Some(&Value::Bool(true));
                let active_chat = crate::agents::has_active_chat(&self.app);

                if active_chat && services::hands::is_voice_stop_command(&text) {
                    crate::agents::stop_active_chats(&self.app);
                    self.log("voice: stop command ended active Pony run");
                    let _ = self.app.emit("voice:command", json!({ "text": text, "steer": true, "stop": true }));
                    let _ = self.app.emit(
                        "voice:result",
                        json!({
                            "text": text,
                            "inserted": "stop",
                            "corrections": corrections,
                        }),
                    );
                    let _ = self.app.emit(
                        "voice:state",
                        json!({
                            "state": "done",
                            "ms": self.now_ms(),
                            "text": text,
                        }),
                    );
                } else if active_chat {
                    let steered_session = crate::brain::steer_active(&self.app, &text);
                    let speech_ov = if hands_on { services::hands::parse_auto_ui_override(&text) } else { None };
                    if let (Some(sid), Some(ov)) = (&steered_session, speech_ov) {
                        crate::hands::set_session_auto_ui(&self.app, sid, ov);
                    }
                    let base_auto = self.voice_auto_ui(&s);
                    let auto_ui = if hands_on { speech_ov.unwrap_or(base_auto) } else { false };
                    self.log(&format!(
                        "voice: {} chars live-steered Pony (session={:?}, autoUi={auto_ui})",
                        text.chars().count(),
                        steered_session
                    ));
                    let _ = self.app.emit(
                        "voice:command",
                        json!({
                            "text": text,
                            "screen": screen,
                            "autoUi": auto_ui,
                            "steer": true,
                            "steeredSession": steered_session,
                        }),
                    );
                    let _ = self.app.emit(
                        "voice:result",
                        json!({
                            "text": text,
                            "inserted": "steer",
                            "corrections": corrections,
                        }),
                    );
                    let _ = self.app.emit(
                        "voice:state",
                        json!({
                            "state": "done",
                            "ms": self.now_ms(),
                            "text": text,
                        }),
                    );
                } else {
                    let base_auto = self.voice_auto_ui(&s);
                    let auto_ui = if hands_on {
                        services::hands::parse_auto_ui_override(&text).unwrap_or(base_auto)
                    } else {
                        false
                    };
                    self.log(&format!("voice: {} chars to Pony (autoUi={auto_ui})", text.chars().count()));
                    let _ = self.app.emit("voice:command", json!({ "text": text, "screen": screen, "autoUi": auto_ui, "steer": false }));
                    let _ = self.app.emit(
                        "voice:result",
                        json!({
                            "text": text,
                            "inserted": "command",
                            "corrections": corrections,
                        }),
                    );
                    let _ = self.app.emit(
                        "voice:state",
                        json!({
                            "state": "idle",
                            "ms": self.now_ms(),
                        }),
                    );
                }
            } else {
                let _ = self.app.emit(
                    "voice:state",
                    json!({
                        "state": "error",
                        "ms": self.now_ms(),
                        "error": "Pony isn't set up",
                    }),
                );
            }
        } else {
            let always_copy = s
                .get("voiceInsert")
                .and_then(Value::as_str)
                .unwrap_or("auto")
                == "copy";
            let started_pid = self.target_pid.lock().ok().and_then(|mut g| g.take());
            let me = std::process::id() as i32;
            let focus_changed = focus_switched(started_pid, platform::ax::front_pid(), me);
            let res = if always_copy || focus_changed {
                self.insert.copy_only(&text)
            } else {
                self.insert.insert(&text)
            };
            let inserted = match &res {
                InsertResult::Typed => "typed",
                InsertResult::Copied => "copied",
                InsertResult::Failed(_) => "failed",
            };
            self.log(&format!("voice: {} chars {inserted}", text.chars().count()));
            if s.get("voiceHistory")
                .and_then(Value::as_bool)
                .unwrap_or(false)
            {
                append_history(&text, ms);
            }
            let _ = self.app.emit(
                "voice:result",
                json!({
                    "text": text,
                    "inserted": inserted,
                    "corrections": corrections,
                }),
            );
            if matches!(res, InsertResult::Copied) && !always_copy {
                let _ = self.app.emit(
                    "voice:state",
                    json!({
                        "state": "error",
                        "ms": self.now_ms(),
                        "error": "Couldn't type here: copied",
                    }),
                );
            } else {
                let _ = self.app.emit(
                    "voice:state",
                    json!({
                        "state": "done",
                        "ms": self.now_ms(),
                        "text": text,
                    }),
                );
            }
        }

        if let Ok(mut sess) = self.session.lock() {
            let _ = sess.on_inserted();
        }
    }

    fn voice_auto_ui(&self, s: &Value) -> bool {
        let hands_on = s.get("ponyEyes") == Some(&Value::Bool(true)) && s.get("ponyHands") == Some(&Value::Bool(true));
        let chat_auto = s.get("ponyAutoUi") == Some(&Value::Bool(true));
        let pref = s.get("voiceAutoUi").and_then(Value::as_str).unwrap_or("follow");
        services::hands::voice_auto_ui_effective(hands_on, chat_auto, pref)
    }

    fn emit_state(&self, st: &VState, was_cancel: bool) {
        let payload = match st {
            VState::Idle => json!({
                "state": if was_cancel { "cancelled" } else { "idle" },
                "ms": self.now_ms(),
            }),
            VState::Listening { since_ms } => {
                let s = self.settings();
                let agent = self.mode.lock().map(|m| *m == VoiceMode::Command).unwrap_or(false);
                let steer = agent && crate::agents::has_active_chat(&self.app);
                json!({
                    "state": "listening",
                    "ms": since_ms,
                    "agent": agent,
                    "autoUi": agent && self.voice_auto_ui(&s),
                    "steer": steer,
                    "lang": s
                        .get("voiceLanguage")
                        .and_then(Value::as_str)
                        .unwrap_or("id")
                        .to_uppercase(),
                })
            }
            VState::Transcribing => json!({
                "state": "transcribing",
                "ms": self.now_ms(),
            }),
            VState::Inserting => json!({
                "state": "inserting",
                "ms": self.now_ms(),
            }),
            VState::Error(msg) => json!({
                "state": "error",
                "ms": self.now_ms(),
                "error": msg,
                "action": if msg == "Model not downloaded" { Some("download") } else { None },
            }),
        };
        let _ = self.app.emit("voice:state", payload);
    }

    fn models_json(&self) -> Vec<Value> {
        let ram = total_ram_bytes();
        let offered_ids: Vec<&str> = models::offered(ram).iter().map(|m| m.id).collect();
        models::registry()
            .iter()
            .map(|m| {
                json!({
                    "id": m.id,
                    "file": m.file,
                    "size": m.size,
                    "tier": m.tier,
                    "licence": m.licence,
                    "downloaded": models::is_downloaded(m.id),
                    "offered": offered_ids.contains(&m.id),
                    "path": models::path(m.id).to_string_lossy(),
                })
            })
            .collect()
    }
}

fn append_history(text: &str, ms: u64) {
    let path = history_path();
    if let Some(parent) = path.parent() {
        let _ = services::paths::ensure_private_dir(parent);
    }
    let line = json!({
        "at": chrono::Utc::now().to_rfc3339(),
        "text": text,
        "ms": ms,
    })
    .to_string();

    #[cfg(unix)]
    let opened = {
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        let res = OpenOptions::new().create(true).append(true).mode(0o600).open(&path);
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
        res
    };
    #[cfg(not(unix))]
    let opened = OpenOptions::new().create(true).append(true).open(&path);

    if let Ok(mut f) = opened {
        let _ = writeln!(f, "{line}");
    }

    // Cap to 1,000 lines.
    if let Ok(raw) = fs::read_to_string(&path) {
        let lines: Vec<&str> = raw.lines().collect();
        if lines.len() > HISTORY_MAX_LINES {
            let kept = lines[lines.len() - HISTORY_MAX_LINES..].join("\n") + "\n";
            let _ = services::paths::write_private(&path, kept.as_bytes());
        }
    }
}

pub fn settings_changed(app: &AppHandle, patch: &Value) {
    let keys = [
        "voiceEnabled",
        "voiceKey",
        "voiceCommandKey",
        "voiceTier",
        "voiceLive",
        "has_voiceCloudKey",
    ];
    if keys.iter().any(|k| patch.get(*k).is_some()) {
        if let Some(rt) = app.try_state::<Arc<VoiceRuntime>>() {
            rt.sync_triggers();
        }
    }
}

/// Starts the triggers if dictation is on and its model is here. Only after `App` is managed (they read the settings).
pub fn start(app: &AppHandle) {
    app.state::<Arc<VoiceRuntime>>().sync_triggers();
}

pub fn register(reg: &mut services::Registry, app: &AppHandle) {
    let rt = VoiceRuntime::new(app.clone());
    app.manage(Arc::clone(&rt));

    // voice.status
    {
        let rt = Arc::clone(&rt);
        reg.add(
            "voice.status",
            Box::new(move |_, _| {
                let s = rt.settings();
                let ram = total_ram_bytes();
                let state_str = match rt.session.lock().map(|g| g.state().clone()) {
                    Ok(VState::Idle) => "idle",
                    Ok(VState::Listening { .. }) => "listening",
                    Ok(VState::Transcribing) => "transcribing",
                    Ok(VState::Inserting) => "inserting",
                    Ok(VState::Error(_)) => "error",
                    Err(_) => "idle",
                };
                let dl = rt
                    .active_download
                    .lock()
                    .ok()
                    .and_then(|g| g.clone())
                    .map(|d| {
                        json!({
                            "id": d.id,
                            "done": d.done,
                            "total": d.total,
                            "status": d.status,
                        })
                    });
                Ok(json!({
                    "enabled": s.get("voiceEnabled").and_then(Value::as_bool).unwrap_or(false),
                    "state": state_str,
                    "tier": rt.effective_tier(&s),
                    "live": s.get("voiceLive").and_then(Value::as_bool).unwrap_or(true),
                    "ramGb": (ram as f64 / (1024.0 * 1024.0 * 1024.0)).round() as u64,
                    "lightSuggested": rt.light_suggested.load(Ordering::Relaxed),
                    "models": rt.models_json(),
                    "vocabMissing": rt.vocab_missing(),
                    "permissions": {
                        "microphone": mic_status(),
                        "accessibility": if platform::os::banners::trusted(false) { "granted" } else { "denied" },
                    },
                    "activeDownload": dl,
                }))
            }),
        );
    }

    // voice.models
    {
        let rt = Arc::clone(&rt);
        reg.add(
            "voice.models",
            Box::new(move |_, _| Ok(Value::Array(rt.models_json()))),
        );
    }

    // voice.download(id)
    {
        let rt = Arc::clone(&rt);
        reg.add(
            "voice.download",
            Box::new(move |_, args| {
                let id = args
                    .first()
                    .and_then(Value::as_str)
                    .unwrap_or("0.6b")
                    .to_string();
                let Some(spec) = models::find(&id) else {
                    return Err(anyhow::anyhow!("unknown model id: {id}"));
                };
                rt.download_cancel.store(false, Ordering::Relaxed);
                if let Ok(mut d) = rt.active_download.lock() {
                    *d = Some(ActiveDownload {
                        id: id.clone(),
                        done: 0,
                        total: spec.size,
                        status: "downloading".into(),
                    });
                }
                let rt_bg = Arc::clone(&rt);
                let id_bg = id.clone();
                thread::spawn(move || {
                    let last_emit = Mutex::new(Instant::now() - Duration::from_secs(1));
                    let res = models::download(
                        &id_bg,
                        |done, total| {
                            if let Ok(mut d) = rt_bg.active_download.lock() {
                                *d = Some(ActiveDownload {
                                    id: id_bg.clone(),
                                    done,
                                    total,
                                    status: "downloading".into(),
                                });
                            }
                            if let Ok(mut t) = last_emit.lock() {
                                if t.elapsed() >= Duration::from_millis(120) || done >= total {
                                    *t = Instant::now();
                                    let _ = rt_bg.app.emit(
                                        "voice:download",
                                        json!({
                                            "id": id_bg,
                                            "done": done,
                                            "total": total,
                                            "status": "downloading",
                                        }),
                                    );
                                }
                            }
                        },
                        &rt_bg.download_cancel,
                    );
                    if let Ok(mut d) = rt_bg.active_download.lock() {
                        *d = None;
                    }
                    match res {
                        Ok(_) => {
                            let _ = rt_bg.app.emit(
                                "voice:download",
                                json!({
                                    "id": id_bg,
                                    "done": spec.size,
                                    "total": spec.size,
                                    "status": "done",
                                }),
                            );
                            rt_bg.sync_triggers();
                        }
                        Err(VoiceError::Cancelled) => {
                            let _ = rt_bg.app.emit(
                                "voice:download",
                                json!({ "id": id_bg, "status": "cancelled" }),
                            );
                        }
                        Err(e) => {
                            let _ = rt_bg.app.emit(
                                "voice:download",
                                json!({
                                    "id": id_bg,
                                    "status": "error",
                                    "error": e.to_string(),
                                }),
                            );
                        }
                    }
                });
                Ok(json!({ "ok": true, "id": id }))
            }),
        );
    }

    // voice.cancelDownload
    {
        let rt = Arc::clone(&rt);
        reg.add(
            "voice.cancelDownload",
            Box::new(move |_, _| {
                rt.download_cancel.store(true, Ordering::Relaxed);
                Ok(json!({ "ok": true }))
            }),
        );
    }

    // voice.deleteModel(id)
    {
        let rt = Arc::clone(&rt);
        reg.add(
            "voice.deleteModel",
            Box::new(move |_, args| {
                let id = args.first().and_then(Value::as_str).unwrap_or("");
                if id == "zf-id" {
                    if let Ok(mut z) = rt.zipformer.lock() {
                        *z = None;
                    }
                } else if let Ok(mut q) = rt.qwen.lock() {
                    if q.as_ref().is_some_and(|l| l.tier == id || (id == "0.6b" && l.tier == "hybrid")) {
                        *q = None;
                    }
                }
                models::delete(id)?;
                rt.sync_triggers();
                Ok(json!({ "ok": true }))
            }),
        );
    }

    // voice.devices
    {
        let rt = Arc::clone(&rt);
        reg.add(
            "voice.devices",
            Box::new(move |_, _| Ok(json!(rt.capture.devices()))),
        );
    }

    // voice.dict
    {
        let rt = Arc::clone(&rt);
        reg.add(
            "voice.dict",
            Box::new(move |_, _| {
                let d = UserDict::load(&dict_path());
                let jargon = rt
                    .settings()
                    .get("voiceJargon")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                let prompt_used = prompt_terms(rt.vocab(), &d, jargon, PROMPT_CAP).len();
                Ok(json!({
                    "version": d.version,
                    "terms": d.terms,
                    "replacements": d.replacements,
                    "promptUsed": prompt_used,
                    "promptCap": PROMPT_CAP,
                }))
            }),
        );
    }

    // voice.dictSave(dict)
    {
        let rt = Arc::clone(&rt);
        reg.add(
            "voice.dictSave",
            Box::new(move |_, args| {
                let val = args.first().cloned().unwrap_or(Value::Null);
                let mut d: UserDict = serde_json::from_value(val)?;
                d.terms.truncate(voice::dictionary::MAX_ENTRIES);
                d.replacements.truncate(voice::dictionary::MAX_ENTRIES);
                d.save(&dict_path())?;
                rt.invalidate_post_cache();
                let jargon = rt
                    .settings()
                    .get("voiceJargon")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                let prompt_used = prompt_terms(rt.vocab(), &d, jargon, PROMPT_CAP).len();
                Ok(json!({
                    "ok": true,
                    "promptUsed": prompt_used,
                    "promptCap": PROMPT_CAP,
                }))
            }),
        );
    }

    // voice.dictImport(kind, text)
    {
        let rt = Arc::clone(&rt);
        reg.add(
            "voice.dictImport",
            Box::new(move |_, args| {
                let kind = args.first().and_then(Value::as_str).unwrap_or("csv");
                let text = args.get(1).and_then(Value::as_str).unwrap_or("");
                let mut d = UserDict::load(&dict_path());
                let rep = if kind.eq_ignore_ascii_case("txt") {
                    d.import_txt(text)
                } else {
                    d.import_csv(text)
                };
                d.save(&dict_path())?;
                rt.invalidate_post_cache();
                let jargon = rt
                    .settings()
                    .get("voiceJargon")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                let prompt_used = prompt_terms(rt.vocab(), &d, jargon, PROMPT_CAP).len();
                Ok(json!({
                    "report": rep,
                    "dict": d,
                    "promptUsed": prompt_used,
                    "promptCap": PROMPT_CAP,
                }))
            }),
        );
    }

    // voice.dictExport
    reg.add(
        "voice.dictExport",
        Box::new(move |_, _| {
            let d = UserDict::load(&dict_path());
            Ok(Value::String(d.export_csv()))
        }),
    );

    // voice.test(text?)
    {
        let rt = Arc::clone(&rt);
        reg.add(
            "voice.test",
            Box::new(move |_, args| {
                let raw = args.first().and_then(Value::as_str).unwrap_or("");
                let vocab = rt.vocab();
                let (d, post_index) = rt.cached_dict_and_index();
                let s = rt.settings();
                let pipe = Pipeline {
                    vocab,
                    dict: &d,
                    norm: rt.norm_options(&s),
                };
                let out = pipe.run_with_index(raw, &post_index);
                let corrs: Vec<Value> = out
                    .corrections
                    .iter()
                    .map(|c| {
                        json!({
                            "from": c.from,
                            "to": c.to,
                            "category": format!("{:?}", c.category),
                        })
                    })
                    .collect();
                Ok(json!({
                    "text": out.text,
                    "corrections": corrs,
                }))
            }),
        );
    }

    // voice.clearHistory
    reg.add(
        "voice.clearHistory",
        Box::new(move |_, _| {
            let p = history_path();
            if p.exists() {
                let _ = fs::remove_file(p);
            }
            Ok(json!({ "ok": true }))
        }),
    );

    // voice.history
    reg.add(
        "voice.history",
        Box::new(move |_, _| {
            let p = history_path();
            let items: Vec<Value> = fs::read_to_string(&p)
                .unwrap_or_default()
                .lines()
                .rev()
                .take(100)
                .filter_map(|l| serde_json::from_str::<Value>(l).ok())
                .collect();
            Ok(Value::Array(items))
        }),
    );
}

/// Whether the user switched to a different external app during dictation (ignores Sympony's own PID so clicking the
/// notch during dictation still pastes into the target app rather than falling back to copy-only).
fn focus_switched(started: Option<i32>, now: Option<i32>, self_pid: i32) -> bool {
    match (started, now) {
        (Some(s), Some(n)) if s != self_pid && n != self_pid => n != s,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::focus_switched;

    #[test]
    fn focus_switch_ignores_sympony_own_pid() {
        let me = 999;
        assert!(!focus_switched(Some(100), Some(100), me));
        assert!(!focus_switched(Some(100), Some(me), me));
        assert!(!focus_switched(Some(me), Some(200), me));
        assert!(!focus_switched(None, Some(200), me));
        assert!(!focus_switched(Some(100), None, me));
        assert!(focus_switched(Some(100), Some(200), me));
    }
}
