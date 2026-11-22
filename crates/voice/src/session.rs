//! Pure dictation session state machine (trigger events + audio chunks -> actions).
use crate::engine::VoiceError;

const MIN_UTTERANCE_MS: u64 = 500;
const WARN_AT_MS: u64 = 55_000;
const MAX_UTTERANCE_MS: u64 = 60_000;
const PARTIAL_THROTTLE_MS: u64 = 200; // <= 5 per second
const HANDS_FREE_VAD_MIN_ELAPSED_MS: u64 = 1_500;
const HANDS_FREE_SILENCE_STOP_MS: u64 = 2_000;
const VAD_RMS_THRESHOLD: f32 = 0.01;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VState {
    Idle,
    Listening { since_ms: u64 },
    Transcribing,
    Inserting,
    Error(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TriggerEv {
    Down,
    HoldStart,
    Up,
    DoubleTap,
    Cancel,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Action {
    OpenMic,
    CloseMic,
    StartStream,
    Partial(String),
    LoadModel,
    Transcribe,
    Insert(String),
    Notify(VState),
    Toast(String),
}

#[derive(Debug)]
pub struct Session {
    state: VState,
    light_mode: bool,
    has_model: bool,
    hands_free: bool,
    warned_55s: bool,
    cancelled_inflight: bool,
    last_partial_ms: u64,
    last_partial_text: String,
    last_speech_ms: u64,
}

impl Session {
    pub fn new(light_mode: bool, has_model: bool) -> Self {
        Self {
            state: VState::Idle,
            light_mode,
            has_model,
            hands_free: false,
            warned_55s: false,
            cancelled_inflight: false,
            last_partial_ms: 0,
            last_partial_text: String::new(),
            last_speech_ms: 0,
        }
    }

    pub fn state(&self) -> &VState {
        &self.state
    }

    pub fn set_light_mode(&mut self, light: bool) {
        self.light_mode = light;
    }

    pub fn set_has_model(&mut self, has_model: bool) {
        self.has_model = has_model;
    }

    pub fn on_trigger(&mut self, ev: TriggerEv, now_ms: u64) -> Vec<Action> {
        let mut out = Vec::new();
        match ev {
            TriggerEv::Down => {
                if self.has_model
                    && !self.light_mode
                    && matches!(self.state, VState::Idle | VState::Error(_))
                {
                    out.push(Action::LoadModel);
                }
            }
            TriggerEv::HoldStart | TriggerEv::DoubleTap => {
                if !self.has_model {
                    let msg = "Model not downloaded".to_string();
                    self.state = VState::Error(msg.clone());
                    out.push(Action::Toast(msg.clone()));
                    out.push(Action::Notify(VState::Error(msg)));
                    return out;
                }
                if !matches!(self.state, VState::Idle | VState::Error(_)) {
                    return out;
                }
                self.hands_free = matches!(ev, TriggerEv::DoubleTap);
                self.warned_55s = false;
                self.cancelled_inflight = false;
                self.last_partial_ms = 0;
                self.last_partial_text.clear();
                self.last_speech_ms = now_ms;
                let st = VState::Listening { since_ms: now_ms };
                self.state = st.clone();
                out.push(Action::OpenMic);
                out.push(Action::StartStream);
                out.push(Action::Notify(st));
            }
            TriggerEv::Up => {
                if let VState::Listening { since_ms } = self.state {
                    self.hands_free = false;
                    if now_ms.saturating_sub(since_ms) < MIN_UTTERANCE_MS {
                        self.state = VState::Idle;
                        out.push(Action::CloseMic);
                        out.push(Action::Toast("Didn't hear anything".into()));
                        out.push(Action::Notify(VState::Idle));
                    } else {
                        self.state = VState::Transcribing;
                        self.cancelled_inflight = false;
                        out.push(Action::CloseMic);
                        out.push(Action::Transcribe);
                        out.push(Action::Notify(VState::Transcribing));
                    }
                }
            }
            TriggerEv::Cancel => match self.state {
                VState::Listening { .. } => {
                    self.hands_free = false;
                    self.state = VState::Idle;
                    out.push(Action::CloseMic);
                    out.push(Action::Notify(VState::Idle));
                }
                VState::Transcribing => {
                    self.cancelled_inflight = true;
                    self.state = VState::Idle;
                    out.push(Action::Notify(VState::Idle));
                }
                _ => {}
            },
        }
        out
    }

    pub fn on_audio_chunk(
        &mut self,
        rms: f32,
        partial: Option<&str>,
        now_ms: u64,
    ) -> Vec<Action> {
        let mut out = Vec::new();
        let VState::Listening { since_ms } = self.state else {
            return out;
        };

        if let Some(p) = partial {
            let trimmed = p.trim();
            if !trimmed.is_empty()
                && trimmed != self.last_partial_text
                && (self.last_partial_ms == 0
                    || now_ms.saturating_sub(self.last_partial_ms) >= PARTIAL_THROTTLE_MS)
            {
                self.last_partial_ms = now_ms;
                self.last_partial_text = trimmed.to_string();
                out.push(Action::Partial(trimmed.to_string()));
            }
        }

        let elapsed = now_ms.saturating_sub(since_ms);
        if !self.warned_55s && elapsed >= WARN_AT_MS {
            self.warned_55s = true;
            out.push(Action::Toast("5 seconds left".into()));
        }
        if elapsed >= MAX_UTTERANCE_MS {
            self.hands_free = false;
            self.state = VState::Transcribing;
            self.cancelled_inflight = false;
            out.push(Action::CloseMic);
            out.push(Action::Transcribe);
            out.push(Action::Notify(VState::Transcribing));
            return out;
        }

        if rms >= VAD_RMS_THRESHOLD {
            self.last_speech_ms = now_ms;
        } else if self.hands_free
            && elapsed >= HANDS_FREE_VAD_MIN_ELAPSED_MS
            && now_ms.saturating_sub(self.last_speech_ms) >= HANDS_FREE_SILENCE_STOP_MS
        {
            self.hands_free = false;
            self.state = VState::Transcribing;
            self.cancelled_inflight = false;
            out.push(Action::CloseMic);
            out.push(Action::Transcribe);
            out.push(Action::Notify(VState::Transcribing));
        }

        out
    }

    pub fn on_result(&mut self, res: Result<String, VoiceError>) -> Vec<Action> {
        if self.cancelled_inflight {
            self.cancelled_inflight = false;
            return Vec::new();
        }
        if !matches!(self.state, VState::Transcribing) {
            return Vec::new();
        }
        match res {
            Ok(text) if !text.trim().is_empty() => {
                self.state = VState::Inserting;
                vec![Action::Notify(VState::Inserting), Action::Insert(text)]
            }
            Ok(_) | Err(VoiceError::Silence) => {
                self.state = VState::Idle;
                vec![
                    Action::Toast("Didn't hear anything".into()),
                    Action::Notify(VState::Idle),
                ]
            }
            Err(VoiceError::NoModel) => {
                let msg = "Model not downloaded".to_string();
                self.state = VState::Error(msg.clone());
                vec![Action::Toast(msg.clone()), Action::Notify(VState::Error(msg))]
            }
            Err(VoiceError::Cancelled) => {
                self.state = VState::Idle;
                vec![Action::Notify(VState::Idle)]
            }
            Err(e) => {
                let msg = e.to_string();
                self.state = VState::Error(msg.clone());
                vec![Action::Toast(msg.clone()), Action::Notify(VState::Error(msg))]
            }
        }
    }

    pub fn on_inserted(&mut self) -> Vec<Action> {
        self.state = VState::Idle;
        vec![Action::Notify(VState::Idle)]
    }
}
