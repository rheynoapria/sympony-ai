//! Alibaba Cloud DashScope (`qwen3-asr-flash`) cloud STT engine.
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use crate::engine::{Engine, EngineInfo, Hints, Transcript, VoiceError};
use crate::engine_local::pcm_rms;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloudRegion {
    Intl,
    Cn,
}

impl CloudRegion {
    pub fn from_setting(s: &str) -> Self {
        match s.trim().to_lowercase().as_str() {
            "cn" => Self::Cn,
            _ => Self::Intl,
        }
    }

    pub fn endpoint(self) -> &'static str {
        match self {
            Self::Intl => "https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
            Self::Cn => "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
        }
    }
}

pub struct DashScope {
    pub key: String,
    pub region: CloudRegion,
}

impl Engine for DashScope {
    fn transcribe(&self, pcm16k: &[f32], hints: &Hints) -> Result<Transcript, VoiceError> {
        if self.key.trim().is_empty() {
            return Err(VoiceError::Cloud("DashScope API key is empty".into()));
        }
        if pcm16k.is_empty() || pcm_rms(pcm16k) < 0.0015 {
            return Err(VoiceError::Silence);
        }

        let wav = encode_wav_16k_mono(pcm16k);
        let b64 = base64_encode(&wav);
        let data_uri = format!("data:audio/wav;base64,{b64}");

        let mut messages = Vec::new();
        if !hints.terms.is_empty() {
            messages.push(json!({
                "role": "system",
                "content": [{ "text": hints.terms.join(", ") }]
            }));
        }
        messages.push(json!({
            "role": "user",
            "content": [{ "audio": data_uri }]
        }));

        let mut asr_options = serde_json::Map::new();
        asr_options.insert("enable_itn".into(), Value::Bool(false));
        if let Some(code) = hints.language.code() {
            asr_options.insert("language".into(), Value::String(code.into()));
        }

        let body = json!({
            "model": "qwen3-asr-flash",
            "input": { "messages": messages },
            "parameters": { "asr_options": Value::Object(asr_options) }
        });

        let t0 = Instant::now();
        let config = ureq::Agent::config_builder()
            .timeout_global(Some(Duration::from_secs(30)))
            .max_redirects(0)
            .http_status_as_error(false)
            .build();
        let agent: ureq::Agent = config.into();
        let payload = serde_json::to_string(&body)
            .map_err(|e| VoiceError::Cloud(format!("serialize JSON: {e}")))?;
        let resp = agent
            .post(self.region.endpoint())
            .header("Authorization", &format!("Bearer {}", self.key.trim()))
            .header("Content-Type", "application/json")
            .send(payload.as_str())
            .map_err(|e| VoiceError::Cloud(format!("network: {e}")))?;

        let status = resp.status().as_u16();
        let raw_resp = resp
            .into_body()
            .read_to_string()
            .map_err(|e| VoiceError::Cloud(format!("read response: {e}")))?;
        if !(200..300).contains(&status) {
            return Err(VoiceError::Cloud(format!("HTTP {status}: {raw_resp}")));
        }
        let val: Value = serde_json::from_str(&raw_resp)
            .map_err(|e| VoiceError::Cloud(format!("invalid JSON: {e}")))?;
        let text = extract_text(&val)
            .ok_or_else(|| VoiceError::Cloud(format!("unexpected response: {val}")))?;
        let text = text.trim().to_string();
        if text.is_empty() {
            return Err(VoiceError::Silence);
        }
        Ok(Transcript {
            text,
            ms: t0.elapsed().as_millis() as u32,
        })
    }

    fn info(&self) -> EngineInfo {
        EngineInfo {
            name: "dashscope-qwen3-asr-flash".into(),
            backend: match self.region {
                CloudRegion::Intl => "cloud-intl".into(),
                CloudRegion::Cn => "cloud-cn".into(),
            },
        }
    }
}

fn extract_text(v: &Value) -> Option<String> {
    if let Some(choices) = v
        .pointer("/output/choices")
        .and_then(|c| c.as_array())
    {
        for ch in choices {
            if let Some(content) = ch.pointer("/message/content") {
                if let Some(s) = content.as_str() {
                    return Some(s.to_string());
                }
                if let Some(arr) = content.as_array() {
                    let joined: String = arr
                        .iter()
                        .filter_map(|item| item.get("text").and_then(|t| t.as_str()))
                        .collect::<Vec<_>>()
                        .join(" ");
                    if !joined.is_empty() {
                        return Some(joined);
                    }
                }
            }
        }
    }
    v.pointer("/output/text")
        .and_then(|t| t.as_str())
        .map(str::to_string)
}

fn encode_wav_16k_mono(pcm: &[f32]) -> Vec<u8> {
    let data_bytes = (pcm.len() * 2) as u32;
    let mut out = Vec::with_capacity(44 + data_bytes as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_bytes).to_le_bytes());
    out.extend_from_slice(b"WAVE");
    out.extend_from_slice(b"fmt ");
    out.extend_from_slice(&16u32.to_le_bytes()); // PCM chunk size
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM format
    out.extend_from_slice(&1u16.to_le_bytes()); // mono
    out.extend_from_slice(&16000u32.to_le_bytes()); // sample rate
    out.extend_from_slice(&32000u32.to_le_bytes()); // byte rate
    out.extend_from_slice(&2u16.to_le_bytes()); // block align
    out.extend_from_slice(&16u16.to_le_bytes()); // bits per sample
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_bytes.to_le_bytes());
    for &s in pcm {
        let clamped = (s.clamp(-1.0, 1.0) * 32767.0).round() as i16;
        out.extend_from_slice(&clamped.to_le_bytes());
    }
    out
}

fn base64_encode(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[((triple >> 18) & 0x3f) as usize] as char);
        out.push(TABLE[((triple >> 12) & 0x3f) as usize] as char);
        out.push(if chunk.len() > 1 {
            TABLE[((triple >> 6) & 0x3f) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            TABLE[(triple & 0x3f) as usize] as char
        } else {
            '='
        });
    }
    out
}
