//! Cross-platform Voice V1 traits (`Trigger`, `Capture`, `Insert`), key specs, pure `TriggerLogic`,
//! and `cpal`-based 16 kHz mono audio capture.
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

pub const TARGET_SAMPLE_RATE: u32 = 16_000;
const HOLD_THRESHOLD_MS: u64 = 250;
const DOUBLE_TAP_WINDOW_MS: u64 = 300;
const CHUNK_SAMPLES: usize = 1_600; // 100 ms at 16 kHz

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VoiceKey {
    RightOption,
    LeftOption,
    RightCommand,
    RightControl,
    RightShift,
    Fn,
    Combo(String),
}

impl VoiceKey {
    pub fn from_setting(s: &str) -> Self {
        match s.trim().to_ascii_lowercase().as_str() {
            "" | "right_option" => Self::RightOption,
            "left_option" => Self::LeftOption,
            "right_command" => Self::RightCommand,
            "right_control" => Self::RightControl,
            "right_shift" => Self::RightShift,
            "fn" => Self::Fn,
            other => Self::Combo(other.to_string()),
        }
    }

    pub fn as_setting(&self) -> String {
        match self {
            Self::RightOption => "right_option".into(),
            Self::LeftOption => "left_option".into(),
            Self::RightCommand => "right_command".into(),
            Self::RightControl => "right_control".into(),
            Self::RightShift => "right_shift".into(),
            Self::Fn => "fn".into(),
            Self::Combo(s) => s.clone(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TriggerEvent {
    Down,
    HoldStart,
    Up,
    DoubleTap,
    Cancel,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyInput {
    TargetDown,
    TargetUp,
    OtherKey,
    Esc,
    Tick,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LogicState {
    Idle,
    Pending { down_at: u64 },
    Suppressed,
    Holding,
    HandsFree,
    HandsFreeStopping,
}

/// Pure, platform-independent timing & solo-modifier state machine for dictation triggers.
#[derive(Debug)]
pub struct TriggerLogic {
    state: LogicState,
    last_tap_up: Option<u64>,
}

impl Default for TriggerLogic {
    fn default() -> Self {
        Self::new()
    }
}

impl TriggerLogic {
    pub fn new() -> Self {
        Self {
            state: LogicState::Idle,
            last_tap_up: None,
        }
    }

    /// True when the state machine is waiting on the 250 ms hold timer.
    pub fn is_pending(&self) -> bool {
        matches!(self.state, LogicState::Pending { .. })
    }

    /// External reset (e.g. when hands-free auto-stops after VAD silence or 60 s cap).
    pub fn reset(&mut self) {
        self.state = LogicState::Idle;
        self.last_tap_up = None;
    }

    pub fn on_event(&mut self, ev: KeyInput, t_ms: u64) -> Vec<TriggerEvent> {
        let mut out = Vec::new();
        match (self.state, ev) {
            (LogicState::Idle, KeyInput::TargetDown) => {
                self.state = LogicState::Pending { down_at: t_ms };
                out.push(TriggerEvent::Down);
            }
            (LogicState::Pending { .. }, KeyInput::OtherKey | KeyInput::Esc) => {
                self.state = LogicState::Suppressed;
                self.last_tap_up = None;
                out.push(TriggerEvent::Cancel);
            }
            (LogicState::Pending { down_at }, KeyInput::Tick) => {
                if t_ms.saturating_sub(down_at) >= HOLD_THRESHOLD_MS {
                    self.state = LogicState::Holding;
                    self.last_tap_up = None;
                    out.push(TriggerEvent::HoldStart);
                }
            }
            (LogicState::Pending { down_at }, KeyInput::TargetUp) => {
                if t_ms.saturating_sub(down_at) >= HOLD_THRESHOLD_MS {
                    // Released after threshold before tick arrived: treat as brief hold.
                    self.state = LogicState::Idle;
                    self.last_tap_up = None;
                    out.push(TriggerEvent::HoldStart);
                    out.push(TriggerEvent::Up);
                } else if let Some(prev_up) = self.last_tap_up {
                    if t_ms.saturating_sub(prev_up) <= DOUBLE_TAP_WINDOW_MS {
                        self.state = LogicState::HandsFree;
                        self.last_tap_up = None;
                        out.push(TriggerEvent::DoubleTap);
                    } else {
                        self.state = LogicState::Idle;
                        self.last_tap_up = Some(t_ms);
                    }
                } else {
                    self.state = LogicState::Idle;
                    self.last_tap_up = Some(t_ms);
                }
            }
            (LogicState::Suppressed, KeyInput::TargetUp) => {
                self.state = LogicState::Idle;
                self.last_tap_up = None;
            }
            (LogicState::Holding, KeyInput::Esc | KeyInput::OtherKey) => {
                self.state = LogicState::Suppressed;
                self.last_tap_up = None;
                out.push(TriggerEvent::Cancel);
            }
            (LogicState::Holding, KeyInput::TargetUp) => {
                self.state = LogicState::Idle;
                self.last_tap_up = None;
                out.push(TriggerEvent::Up);
            }
            (LogicState::HandsFree, KeyInput::Esc) => {
                self.state = LogicState::Idle;
                self.last_tap_up = None;
                out.push(TriggerEvent::Cancel);
            }
            (LogicState::HandsFree, KeyInput::TargetDown) => {
                self.state = LogicState::HandsFreeStopping;
            }
            (LogicState::HandsFreeStopping, KeyInput::TargetUp) => {
                self.state = LogicState::Idle;
                self.last_tap_up = None;
                out.push(TriggerEvent::Up);
            }
            (LogicState::HandsFreeStopping, KeyInput::Esc) => {
                self.state = LogicState::Idle;
                self.last_tap_up = None;
                out.push(TriggerEvent::Cancel);
            }
            _ => {}
        }
        out
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InsertResult {
    Typed,
    Copied,
    Failed(String),
}

pub trait Trigger: Send + Sync {
    fn start(&self, key: VoiceKey, tx: Sender<TriggerEvent>) -> Result<(), String>;
    fn stop(&self);
}

pub trait Capture: Send + Sync {
    fn start(&self, device: Option<&str>, tx: Sender<Vec<f32>>) -> Result<(), String>;
    fn stop(&self) -> Vec<f32>;
    fn devices(&self) -> Vec<String>;
}

pub trait Insert: Send + Sync {
    fn insert(&self, text: &str) -> InsertResult;
}

// ---------------------------------------------------------------------------
// Cross-platform `cpal` 16 kHz mono f32 audio capture
// ---------------------------------------------------------------------------

struct ActiveCapture {
    // Keep stream alive until `stop()` drops it (closing the mic immediately).
    _stream: cpal::Stream,
    buf: Arc<Mutex<Vec<f32>>>,
}

// SAFETY: `ActiveCapture` is only accessed through `CpalCapture`'s `Mutex` and dropped on `stop()`.
unsafe impl Send for ActiveCapture {}

#[derive(Default)]
pub struct CpalCapture {
    active: Mutex<Option<ActiveCapture>>,
}

impl CpalCapture {
    pub fn new() -> Self {
        Self::default()
    }
}

/// Simple streaming linear resampler from `in_rate` to `16_000` Hz mono.
struct LinearResampler {
    in_rate: f64,
    step: f64,
    pos: f64,
    prev: f32,
    has_prev: bool,
}

impl LinearResampler {
    fn new(in_rate: u32) -> Self {
        Self {
            in_rate: in_rate as f64,
            step: in_rate as f64 / TARGET_SAMPLE_RATE as f64,
            pos: 0.0,
            prev: 0.0,
            has_prev: false,
        }
    }

    fn push_mono(&mut self, mono: &[f32], out: &mut Vec<f32>) {
        if mono.is_empty() {
            return;
        }
        if (self.in_rate - TARGET_SAMPLE_RATE as f64).abs() < 1.0 {
            out.extend_from_slice(mono);
            return;
        }
        let mut idx_base = 0usize;
        if !self.has_prev {
            self.prev = mono[0];
            self.has_prev = true;
        }
        let len = mono.len() as f64;
        while self.pos < len {
            let i = self.pos.floor() as usize;
            let frac = (self.pos - i as f64) as f32;
            let s0 = if i == 0 { self.prev } else { mono[i - 1] };
            let s1 = mono[i.min(mono.len() - 1)];
            out.push(s0 + (s1 - s0) * frac);
            self.pos += self.step;
            idx_base = i;
        }
        let _ = idx_base;
        self.prev = *mono.last().unwrap();
        self.pos -= len;
    }
}

impl Capture for CpalCapture {
    fn devices(&self) -> Vec<String> {
        let host = cpal::default_host();
        let Ok(devs) = host.input_devices() else {
            return Vec::new();
        };
        let mut names = Vec::new();
        for d in devs {
            if let Ok(n) = d.name() {
                if !names.contains(&n) {
                    names.push(n);
                }
            }
        }
        names
    }

    fn start(&self, device: Option<&str>, tx: Sender<Vec<f32>>) -> Result<(), String> {
        let mut guard = self.active.lock().map_err(|_| "capture lock poisoned")?;
        // Ensure any previous stream is closed before opening a new one.
        *guard = None;

        let host = cpal::default_host();
        let dev = match device.filter(|s| !s.trim().is_empty()) {
            Some(wanted) => host
                .input_devices()
                .map_err(|e| format!("list input devices: {e}"))?
                .find(|d| d.name().ok().as_deref() == Some(wanted))
                .or_else(|| host.default_input_device())
                .ok_or_else(|| "no input microphone available".to_string())?,
            None => host
                .default_input_device()
                .ok_or_else(|| "no default microphone available".to_string())?,
        };

        let cfg = dev
            .default_input_config()
            .map_err(|e| format!("default input config: {e}"))?;
        let channels = cfg.channels() as usize;
        let in_rate = cfg.sample_rate().0;
        let buf = Arc::new(Mutex::new(Vec::<f32>::with_capacity(TARGET_SAMPLE_RATE as usize * 10)));
        let buf_cb = Arc::clone(&buf);
        let resampler = Arc::new(Mutex::new(LinearResampler::new(in_rate)));
        let pending = Arc::new(Mutex::new(Vec::<f32>::with_capacity(CHUNK_SAMPLES * 2)));

        let push_samples = move |mono: &[f32]| {
            let mut resampled = Vec::with_capacity(mono.len());
            if let Ok(mut rs) = resampler.lock() {
                rs.push_mono(mono, &mut resampled);
            }
            if resampled.is_empty() {
                return;
            }
            if let Ok(mut full) = buf_cb.lock() {
                full.extend_from_slice(&resampled);
            }
            if let Ok(mut pend) = pending.lock() {
                pend.extend_from_slice(&resampled);
                while pend.len() >= CHUNK_SAMPLES {
                    let chunk: Vec<f32> = pend.drain(..CHUNK_SAMPLES).collect();
                    let _ = tx.send(chunk);
                }
            }
        };

        let err_fn = |err| {
            eprintln!("cpal capture error: {err}");
        };

        let stream_cfg: cpal::StreamConfig = cfg.clone().into();
        let stream = match cfg.sample_format() {
            cpal::SampleFormat::F32 => dev
                .build_input_stream(
                    &stream_cfg,
                    move |data: &[f32], _| {
                        let mono = downmix_f32(data, channels);
                        push_samples(&mono);
                    },
                    err_fn,
                    None,
                )
                .map_err(|e| format!("build f32 stream: {e}"))?,
            cpal::SampleFormat::I16 => dev
                .build_input_stream(
                    &stream_cfg,
                    move |data: &[i16], _| {
                        let mono = downmix_i16(data, channels);
                        push_samples(&mono);
                    },
                    err_fn,
                    None,
                )
                .map_err(|e| format!("build i16 stream: {e}"))?,
            cpal::SampleFormat::U16 => dev
                .build_input_stream(
                    &stream_cfg,
                    move |data: &[u16], _| {
                        let mono = downmix_u16(data, channels);
                        push_samples(&mono);
                    },
                    err_fn,
                    None,
                )
                .map_err(|e| format!("build u16 stream: {e}"))?,
            other => return Err(format!("unsupported sample format: {other:?}")),
        };

        stream.play().map_err(|e| format!("start mic stream: {e}"))?;
        *guard = Some(ActiveCapture {
            _stream: stream,
            buf,
        });
        Ok(())
    }

    fn stop(&self) -> Vec<f32> {
        let active = self.active.lock().ok().and_then(|mut g| g.take());
        match active {
            Some(cap) => {
                // Dropping `cap._stream` closes the microphone immediately.
                drop(cap._stream);
                cap.buf
                    .lock()
                    .map(|mut b| std::mem::take(&mut *b))
                    .unwrap_or_default()
            }
            None => Vec::new(),
        }
    }
}

fn downmix_f32(data: &[f32], channels: usize) -> Vec<f32> {
    if channels <= 1 {
        return data.to_vec();
    }
    let inv = 1.0 / channels as f32;
    data.chunks_exact(channels)
        .map(|f| f.iter().sum::<f32>() * inv)
        .collect()
}

fn downmix_i16(data: &[i16], channels: usize) -> Vec<f32> {
    let scale = 1.0 / (32768.0 * channels.max(1) as f32);
    data.chunks_exact(channels.max(1))
        .map(|f| f.iter().map(|&s| s as f32).sum::<f32>() * scale)
        .collect()
}

fn downmix_u16(data: &[u16], channels: usize) -> Vec<f32> {
    let inv = 1.0 / channels.max(1) as f32;
    data.chunks_exact(channels.max(1))
        .map(|f| {
            f.iter()
                .map(|&s| (s as f32 - 32768.0) / 32768.0)
                .sum::<f32>()
                * inv
        })
        .collect()
}
