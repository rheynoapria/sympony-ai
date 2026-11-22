//! Local on-device STT engines: Qwen3-ASR (`transcribe-cpp`, Metal/CPU) and Zipformer2-id (`sherpa-onnx`, static CPU).
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use sherpa_onnx::{OnlineRecognizer, OnlineRecognizerConfig, OnlineStream};
use transcribe_cpp::{Backend, KvType, Model, ModelOptions, RunOptions, Session, SessionOptions};

use crate::engine::{Engine, EngineInfo, Hints, Stream, StreamEngine, Transcript, VoiceError};

pub const ZIPFORMER_ENCODER: &str = "encoder-iter-100000-avg-15-chunk-32-left-256.int8.onnx";
pub const ZIPFORMER_DECODER: &str = "decoder-iter-100000-avg-15-chunk-32-left-256.int8.onnx";
pub const ZIPFORMER_JOINER: &str = "joiner-iter-100000-avg-15-chunk-32-left-256.int8.onnx";
pub const ZIPFORMER_TOKENS: &str = "tokens.txt";

const SILENCE_RMS_THRESHOLD: f32 = 0.0015;
const TAIL_PAD_SAMPLES: usize = 12_800; // 0.8 s at 16 kHz (matches sherpa-onnx CLI)
const LEFT_PAD_SAMPLES: usize = 8_000; // 0.5 s at 16 kHz (batch mode)

pub fn pcm_rms(pcm: &[f32]) -> f32 {
    if pcm.is_empty() {
        return 0.0;
    }
    let sum_sq: f64 = pcm.iter().map(|&x| (x as f64) * (x as f64)).sum();
    (sum_sq / pcm.len() as f64).sqrt() as f32
}

pub struct LocalQwen {
    session: Mutex<Session>,
    backend: String,
    variant: String,
}

impl LocalQwen {
    pub fn load(model: &Path, threads: usize, n_ctx: u32) -> Result<Self, VoiceError> {
        Self::load_with_backend(model, threads, n_ctx, false)
    }

    pub fn load_with_backend(
        model: &Path,
        threads: usize,
        n_ctx: u32,
        cpu_only: bool,
    ) -> Result<Self, VoiceError> {
        if !model.exists() {
            return Err(VoiceError::NoModel);
        }
        transcribe_cpp::disable_logging();
        let opts = ModelOptions {
            backend: if cpu_only { Backend::Cpu } else { Backend::Auto },
            device: None,
            no_mmap: false,
        };
        let loaded = Model::load_with(model, &opts)
            .map_err(|e| VoiceError::Engine(format!("model load: {e}")))?;
        let backend = loaded.backend();
        let variant = loaded.variant();
        let sess_opts = SessionOptions {
            n_threads: threads as i32,
            kv_type: KvType::Auto,
            n_ctx: n_ctx as i32,
        };
        let session = loaded
            .session_with(&sess_opts)
            .map_err(|e| VoiceError::Engine(format!("session init: {e}")))?;
        Ok(Self {
            session: Mutex::new(session),
            backend,
            variant,
        })
    }

    pub fn idle_unload_after(&self) -> Duration {
        Duration::from_secs(120)
    }
}

impl Engine for LocalQwen {
    fn transcribe(&self, pcm16k: &[f32], hints: &Hints) -> Result<Transcript, VoiceError> {
        if pcm16k.is_empty() || pcm_rms(pcm16k) < SILENCE_RMS_THRESHOLD {
            return Err(VoiceError::Silence);
        }
        let run_opts = RunOptions {
            language: hints.language.code().map(str::to_string),
            vocabulary: hints.terms.clone(),
            ..Default::default()
        };
        let t0 = Instant::now();
        let mut sess = self
            .session
            .lock()
            .map_err(|_| VoiceError::Engine("session lock poisoned".into()))?;
        let res = sess
            .run(pcm16k, &run_opts)
            .map_err(|e| VoiceError::Engine(format!("transcribe: {e}")))?;
        let ms = t0.elapsed().as_millis() as u32;
        let text = res.text.trim().to_string();
        if text.is_empty() {
            return Err(VoiceError::Silence);
        }
        Ok(Transcript { text, ms })
    }

    fn info(&self) -> EngineInfo {
        EngineInfo {
            name: if self.variant.is_empty() {
                "qwen3-asr".into()
            } else {
                format!("qwen3-asr-{}", self.variant)
            },
            backend: self.backend.clone(),
        }
    }
}

/// Streaming Indonesian Zipformer2 engine via the official `sherpa-onnx` crate (static linking on macOS).
pub struct LocalZipformer {
    recognizer: Arc<OnlineRecognizer>,
}

impl LocalZipformer {
    pub fn load(dir: &Path, threads: usize) -> Result<Self, VoiceError> {
        let enc = dir.join(ZIPFORMER_ENCODER);
        let dec = dir.join(ZIPFORMER_DECODER);
        let joi = dir.join(ZIPFORMER_JOINER);
        let tok = dir.join(ZIPFORMER_TOKENS);
        if !enc.exists() || !dec.exists() || !joi.exists() || !tok.exists() {
            return Err(VoiceError::NoModel);
        }

        let mut cfg = OnlineRecognizerConfig::default();
        cfg.feat_config.sample_rate = 16000;
        cfg.feat_config.feature_dim = 80;
        cfg.model_config.transducer.encoder = Some(enc.to_string_lossy().into_owned());
        cfg.model_config.transducer.decoder = Some(dec.to_string_lossy().into_owned());
        cfg.model_config.transducer.joiner = Some(joi.to_string_lossy().into_owned());
        cfg.model_config.tokens = Some(tok.to_string_lossy().into_owned());
        cfg.model_config.num_threads = threads.max(1) as i32;
        cfg.model_config.provider = Some("cpu".into());
        cfg.decoding_method = Some("greedy_search".into());
        cfg.enable_endpoint = false;

        let rec = OnlineRecognizer::create(&cfg)
            .ok_or_else(|| VoiceError::Engine("failed to create sherpa-onnx OnlineRecognizer".into()))?;
        Ok(Self {
            recognizer: Arc::new(rec),
        })
    }

    pub fn idle_unload_after(&self) -> Duration {
        Duration::from_secs(600)
    }
}

struct ZipformerStream {
    rec: Arc<OnlineRecognizer>,
    stream: OnlineStream,
}

impl StreamEngine for LocalZipformer {
    fn start(&self) -> Box<dyn Stream> {
        let stream = self.recognizer.create_stream();
        Box::new(ZipformerStream {
            rec: Arc::clone(&self.recognizer),
            stream,
        })
    }
}

impl Stream for ZipformerStream {
    fn accept(&mut self, pcm16k: &[f32]) {
        if pcm16k.is_empty() {
            return;
        }
        self.stream.accept_waveform(16000, pcm16k);
        while self.rec.is_ready(&self.stream) {
            self.rec.decode(&self.stream);
        }
    }

    fn partial(&self) -> String {
        self.rec
            .get_result(&self.stream)
            .map(|r| r.text.trim().to_string())
            .unwrap_or_default()
    }

    fn finish(self: Box<Self>) -> String {
        let tail = vec![0.0f32; TAIL_PAD_SAMPLES];
        self.stream.accept_waveform(16000, &tail);
        self.stream.input_finished();
        while self.rec.is_ready(&self.stream) {
            self.rec.decode(&self.stream);
        }
        self.rec
            .get_result(&self.stream)
            .map(|r| r.text.trim().to_string())
            .unwrap_or_default()
    }
}

impl Engine for LocalZipformer {
    fn transcribe(&self, pcm16k: &[f32], _hints: &Hints) -> Result<Transcript, VoiceError> {
        if pcm16k.is_empty() || pcm_rms(pcm16k) < SILENCE_RMS_THRESHOLD {
            return Err(VoiceError::Silence);
        }
        let t0 = Instant::now();
        let mut s = self.start();
        let lead = vec![0.0f32; LEFT_PAD_SAMPLES];
        s.accept(&lead);
        s.accept(pcm16k);
        let text = s.finish();
        let ms = t0.elapsed().as_millis() as u32;
        if text.is_empty() {
            return Err(VoiceError::Silence);
        }
        Ok(Transcript { text, ms })
    }

    fn info(&self) -> EngineInfo {
        EngineInfo {
            name: "zipformer2-id-int8".into(),
            backend: "cpu".into(),
        }
    }
}
