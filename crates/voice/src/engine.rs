//! STT engine traits, types, and test doubles.
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lang {
    Id,
    En,
    Auto,
}

impl Lang {
    pub fn from_setting(s: &str) -> Self {
        match s.trim().to_lowercase().as_str() {
            "en" => Self::En,
            "auto" => Self::Auto,
            _ => Self::Id,
        }
    }

    pub fn code(self) -> Option<&'static str> {
        match self {
            Self::Id => Some("id"),
            Self::En => Some("en"),
            Self::Auto => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Hints {
    pub language: Lang,
    pub terms: Vec<String>,
}

impl Default for Hints {
    fn default() -> Self {
        Self {
            language: Lang::Id,
            terms: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Transcript {
    pub text: String,
    pub ms: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EngineInfo {
    pub name: String,
    pub backend: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VoiceError {
    NoModel,
    Checksum,
    Engine(String),
    Cloud(String),
    Silence,
    Cancelled,
}

impl fmt::Display for VoiceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NoModel => write!(f, "model not downloaded"),
            Self::Checksum => write!(f, "checksum mismatch"),
            Self::Engine(m) => write!(f, "engine error: {m}"),
            Self::Cloud(m) => write!(f, "cloud error: {m}"),
            Self::Silence => write!(f, "silence"),
            Self::Cancelled => write!(f, "cancelled"),
        }
    }
}

impl std::error::Error for VoiceError {}

pub trait Engine: Send + Sync {
    fn transcribe(&self, pcm16k: &[f32], hints: &Hints) -> Result<Transcript, VoiceError>;
    fn info(&self) -> EngineInfo;
}

pub trait StreamEngine: Send + Sync {
    fn start(&self) -> Box<dyn Stream>;
}

pub trait Stream: Send {
    fn accept(&mut self, pcm16k: &[f32]);
    fn partial(&self) -> String;
    fn finish(self: Box<Self>) -> String;
}

/// Deterministic test engine returning a fixed transcript.
pub struct Fake(pub String);

impl Engine for Fake {
    fn transcribe(&self, _pcm16k: &[f32], _hints: &Hints) -> Result<Transcript, VoiceError> {
        if self.0.trim().is_empty() {
            return Err(VoiceError::Silence);
        }
        Ok(Transcript {
            text: self.0.clone(),
            ms: 1,
        })
    }

    fn info(&self) -> EngineInfo {
        EngineInfo {
            name: "fake".into(),
            backend: "fake".into(),
        }
    }
}

/// Deterministic test streaming engine replaying a sequence of partials.
pub struct FakeStream(pub Vec<String>);

struct FakeStreamHandle {
    partials: Vec<String>,
    idx: usize,
}

impl StreamEngine for FakeStream {
    fn start(&self) -> Box<dyn Stream> {
        Box::new(FakeStreamHandle {
            partials: self.0.clone(),
            idx: 0,
        })
    }
}

impl Stream for FakeStreamHandle {
    fn accept(&mut self, _pcm16k: &[f32]) {
        if self.idx + 1 < self.partials.len() {
            self.idx += 1;
        }
    }

    fn partial(&self) -> String {
        self.partials.get(self.idx).cloned().unwrap_or_default()
    }

    fn finish(self: Box<Self>) -> String {
        self.partials.last().cloned().unwrap_or_default()
    }
}

/// Read a 16-bit PCM mono 16 kHz WAV file into `[-1.0, 1.0]` f32 samples.
pub fn read_wav_16k(path: &std::path::Path) -> Result<Vec<f32>, VoiceError> {
    let bytes = std::fs::read(path).map_err(|e| VoiceError::Engine(format!("read wav: {e}")))?;
    if bytes.len() < 44 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err(VoiceError::Engine("not a WAV file".into()));
    }
    let mut pos = 12usize;
    let mut data_slice: Option<&[u8]> = None;
    while pos + 8 <= bytes.len() {
        let id = &bytes[pos..pos + 4];
        let sz = u32::from_le_bytes(bytes[pos + 4..pos + 8].try_into().unwrap()) as usize;
        pos += 8;
        if pos + sz > bytes.len() {
            break;
        }
        if id == b"data" {
            data_slice = Some(&bytes[pos..pos + sz]);
            break;
        }
        pos += sz + (sz & 1);
    }
    let data = data_slice.ok_or_else(|| VoiceError::Engine("WAV missing data chunk".into()))?;
    let mut out = Vec::with_capacity(data.len() / 2);
    for chunk in data.chunks_exact(2) {
        let s = i16::from_le_bytes([chunk[0], chunk[1]]);
        out.push(s as f32 / 32768.0);
    }
    Ok(out)
}
