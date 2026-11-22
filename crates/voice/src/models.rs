//! Model registry, paths, RAM gating, thread sizing, and resumable verified downloads.
use std::ffi::OsString;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use sha2::{Digest, Sha256};

use crate::engine::VoiceError;
use crate::engine_local::{ZIPFORMER_DECODER, ZIPFORMER_ENCODER, ZIPFORMER_JOINER, ZIPFORMER_TOKENS};

const GIB_16: u64 = 16 * 1024 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ModelFile {
    pub name: &'static str,
    pub url: &'static str,
    pub size: u64,
    pub sha256: &'static str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ModelSpec {
    pub id: &'static str,
    pub file: &'static str,
    pub url: &'static str,
    pub size: u64,
    pub sha256: &'static str,
    pub tier: &'static str,
    pub licence: &'static str,
    pub files: &'static [ModelFile],
}

const ZF_FILES: &[ModelFile] = &[
    ModelFile {
        name: ZIPFORMER_ENCODER,
        url: "https://huggingface.co/spacewave/sherpa-onnx-streaming-zipformer2-id/resolve/main/encoder-iter-100000-avg-15-chunk-32-left-256.int8.onnx",
        size: 70_103_186,
        sha256: "3a6f85f5d199ad0d495562988af017a75d4ae81b51126db240d959b065d6eaad",
    },
    ModelFile {
        name: ZIPFORMER_DECODER,
        url: "https://huggingface.co/spacewave/sherpa-onnx-streaming-zipformer2-id/resolve/main/decoder-iter-100000-avg-15-chunk-32-left-256.int8.onnx",
        size: 540_688,
        sha256: "6544848ca80b557ec3c8569169522dc6243b5bc9b296ea73791728510caacb4a",
    },
    ModelFile {
        name: ZIPFORMER_JOINER,
        url: "https://huggingface.co/spacewave/sherpa-onnx-streaming-zipformer2-id/resolve/main/joiner-iter-100000-avg-15-chunk-32-left-256.int8.onnx",
        size: 259_417,
        sha256: "4b89d96292460a92dedcb39e0b17904f10dbad335a8ab11015e567b4864102e0",
    },
    ModelFile {
        name: ZIPFORMER_TOKENS,
        url: "https://huggingface.co/spacewave/sherpa-onnx-streaming-zipformer2-id/resolve/main/tokens.txt",
        size: 5_403,
        sha256: "f0b6f5bf602d96f60d79bb17192c51eeffb6189250f132b1dfdf72b130d66968",
    },
];

const REGISTRY: &[ModelSpec] = &[
    ModelSpec {
        id: "zf-id",
        file: "zipformer2-id",
        url: "https://huggingface.co/spacewave/sherpa-onnx-streaming-zipformer2-id",
        size: 70_103_186 + 540_688 + 259_417 + 5_403,
        sha256: "",
        tier: "light",
        licence: "MIT",
        files: ZF_FILES,
    },
    ModelSpec {
        id: "0.6b",
        file: "Qwen3-ASR-0.6B-Q4_K_M.gguf",
        url: "https://huggingface.co/handy-computer/Qwen3-ASR-0.6B-gguf/resolve/main/Qwen3-ASR-0.6B-Q4_K_M.gguf",
        size: 589_560_480,
        sha256: "5b58f32a58ffa2c8783e0b0963485623e286e6272d953dfc9e28bc3447dee0c0",
        tier: "hybrid",
        licence: "Apache-2.0",
        files: &[],
    },
    ModelSpec {
        id: "1.7b",
        file: "Qwen3-ASR-1.7B-Q4_K_M.gguf",
        url: "https://huggingface.co/handy-computer/Qwen3-ASR-1.7B-gguf/resolve/main/Qwen3-ASR-1.7B-Q4_K_M.gguf",
        size: 1_319_830_496,
        sha256: "b7afe3674f653fa84f712ed2440353c6e7cf7f93697fef76b05a26538b24844e",
        tier: "1.7b",
        licence: "Apache-2.0",
        files: &[],
    },
];

pub fn registry() -> &'static [ModelSpec] {
    REGISTRY
}

pub fn find(id: &str) -> Option<&'static ModelSpec> {
    REGISTRY.iter().find(|m| m.id == id)
}

pub fn models_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".sympony")
        .join("models")
}

pub fn path(id: &str) -> PathBuf {
    path_in(&models_dir(), id)
}

pub fn path_in(base: &Path, id: &str) -> PathBuf {
    match find(id) {
        Some(spec) => base.join(spec.file),
        None => base.join(id),
    }
}

pub fn is_downloaded(id: &str) -> bool {
    is_downloaded_in(&models_dir(), id)
}

pub fn is_downloaded_in(base: &Path, id: &str) -> bool {
    let Some(spec) = find(id) else {
        return false;
    };
    let dest = base.join(spec.file);
    if spec.files.is_empty() {
        dest.is_file()
    } else {
        spec.files.iter().all(|f| dest.join(f.name).is_file())
    }
}

pub fn delete(id: &str) -> io::Result<()> {
    delete_in(&models_dir(), id)
}

pub fn delete_in(base: &Path, id: &str) -> io::Result<()> {
    let Some(spec) = find(id) else {
        return Ok(());
    };
    let dest = base.join(spec.file);
    if spec.files.is_empty() {
        let _ = fs::remove_file(&dest);
        let _ = fs::remove_file(part_path(&dest));
    } else if dest.exists() {
        fs::remove_dir_all(&dest)?;
    }
    Ok(())
}

/// Models offered for the machine's RAM: `1.7b` is only offered on >= 16 GiB.
pub fn offered(total_ram_bytes: u64) -> Vec<&'static ModelSpec> {
    REGISTRY
        .iter()
        .filter(|m| m.id != "1.7b" || total_ram_bytes >= GIB_16)
        .collect()
}

/// CPU thread default: `min(4, physical - 1)`, at least 2.
pub fn default_threads(physical: usize) -> usize {
    physical.saturating_sub(1).clamp(2, 4)
}

fn part_path(dest: &Path) -> PathBuf {
    let mut os = OsString::from(dest.as_os_str());
    os.push(".part");
    PathBuf::from(os)
}

pub fn sha256_file(path: &Path) -> io::Result<String> {
    let mut f = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 65_536];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn download_agent_config(connect: Duration, per_read: Duration) -> ureq::config::Config {
    ureq::Agent::config_builder()
        .timeout_connect(Some(connect))
        .timeout_recv_response(Some(per_read))
        .timeout_per_read(Some(per_read))
        .http_status_as_error(false)
        .build()
}

/// Download a single file with HTTP Range resume into `<dest>.part`, verify SHA-256, then rename.
pub fn download_file_resumable(
    url: &str,
    dest: &Path,
    expected_sha256: &str,
    progress: impl Fn(u64, u64),
    cancel: &AtomicBool,
) -> Result<PathBuf, VoiceError> {
    download_file_with_config(
        url,
        dest,
        expected_sha256,
        progress,
        cancel,
        download_agent_config(Duration::from_secs(20), Duration::from_secs(60)),
    )
}

fn download_file_with_config(
    url: &str,
    dest: &Path,
    expected_sha256: &str,
    progress: impl Fn(u64, u64),
    cancel: &AtomicBool,
    config: ureq::config::Config,
) -> Result<PathBuf, VoiceError> {
    if let Some(parent) = dest.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)
                .map_err(|e| VoiceError::Engine(format!("create dir: {e}")))?;
        }
    }

    let part = part_path(dest);
    let existing = fs::metadata(&part).map(|m| m.len()).unwrap_or(0);

    let agent: ureq::Agent = config.into();

    let mut req = agent.get(url);
    if existing > 0 {
        req = req.header("Range", &format!("bytes={existing}-"));
    }

    let resp = match req.call() {
        Ok(r) => match r.status().as_u16() {
            200..=299 => Some(r),
            416 => None, // Already completely downloaded in .part
            code => return Err(VoiceError::Engine(format!("download HTTP {code}"))),
        },
        Err(e) => {
            return Err(VoiceError::Engine(format!("download network error: {e}")));
        }
    };

    if let Some(resp) = resp {
        let status = resp.status().as_u16();
        let content_len = resp
            .headers()
            .get("Content-Length")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok());

        let (mut file, mut written, total) = if status == 206 && existing > 0 {
            let f = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&part)
                .map_err(|e| VoiceError::Engine(format!("open part: {e}")))?;
            let tot = content_len.map(|c| existing + c).unwrap_or(existing);
            (f, existing, tot)
        } else {
            let f = File::create(&part)
                .map_err(|e| VoiceError::Engine(format!("create part: {e}")))?;
            (f, 0u64, content_len.unwrap_or(0))
        };

        let mut reader = resp.into_body().into_reader();
        let mut buf = [0u8; 65_536];
        let mut received_this_req = 0u64;
        loop {
            if cancel.load(Ordering::Relaxed) {
                let _ = file.flush();
                return Err(VoiceError::Cancelled);
            }
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    file.write_all(&buf[..n])
                        .map_err(|e| VoiceError::Engine(format!("write part: {e}")))?;
                    written += n as u64;
                    received_this_req += n as u64;
                    progress(written, total.max(written));
                }
                Err(e) => {
                    let _ = file.flush();
                    return Err(VoiceError::Engine(format!("read stream: {e}")));
                }
            }
        }
        file.flush()
            .map_err(|e| VoiceError::Engine(format!("flush part: {e}")))?;

        if let Some(expected_len) = content_len {
            if received_this_req < expected_len {
                return Err(VoiceError::Engine(format!(
                    "download truncated ({received_this_req}/{expected_len} bytes)"
                )));
            }
        }
    }

    if !expected_sha256.is_empty() {
        let actual = sha256_file(&part)
            .map_err(|e| VoiceError::Engine(format!("hash part: {e}")))?;
        if !actual.eq_ignore_ascii_case(expected_sha256) {
            let _ = fs::remove_file(&part);
            return Err(VoiceError::Checksum);
        }
    }

    fs::rename(&part, dest).map_err(|e| VoiceError::Engine(format!("rename model: {e}")))?;
    Ok(dest.to_path_buf())
}

/// Download a registered model (`"zf-id"`, `"0.6b"`, `"1.7b"`) into `~/.sympony/models/`.
pub fn download(
    id: &str,
    progress: impl Fn(u64, u64),
    cancel: &AtomicBool,
) -> Result<PathBuf, VoiceError> {
    download_in(&models_dir(), id, progress, cancel)
}

pub fn download_in(
    base: &Path,
    id: &str,
    progress: impl Fn(u64, u64),
    cancel: &AtomicBool,
) -> Result<PathBuf, VoiceError> {
    let spec = find(id).ok_or(VoiceError::NoModel)?;
    let dest = base.join(spec.file);
    if spec.files.is_empty() {
        if dest.is_file() {
            if let Ok(actual) = sha256_file(&dest) {
                if actual.eq_ignore_ascii_case(spec.sha256) {
                    progress(spec.size, spec.size);
                    return Ok(dest);
                }
            }
        }
        return download_file_resumable(spec.url, &dest, spec.sha256, progress, cancel);
    }

    fs::create_dir_all(&dest).map_err(|e| VoiceError::Engine(format!("create model dir: {e}")))?;
    let total = spec.size;
    let mut done_before = 0u64;
    for f in spec.files {
        let fdest = dest.join(f.name);
        if fdest.is_file() {
            if let Ok(actual) = sha256_file(&fdest) {
                if actual.eq_ignore_ascii_case(f.sha256) {
                    done_before += f.size;
                    progress(done_before, total);
                    continue;
                }
            }
        }
        let base_done = done_before;
        download_file_resumable(
            f.url,
            &fdest,
            f.sha256,
            |cur, _| progress(base_done + cur, total),
            cancel,
        )?;
        done_before += f.size;
    }
    Ok(dest)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::net::TcpListener;

    #[test]
    fn download_timeout_is_per_read_not_total_body() {
        let cfg = download_agent_config(Duration::from_secs(20), Duration::from_secs(60));
        let timeouts = cfg.timeouts();
        assert_eq!(timeouts.connect, Some(Duration::from_secs(20)));
        assert_eq!(timeouts.recv_response, Some(Duration::from_secs(60)));
        assert_eq!(cfg.timeout_per_read(), Some(Duration::from_secs(60)));
        assert_eq!(timeouts.recv_body, None);
        assert_eq!(timeouts.global, None);

        // Stream 4 chunks spaced 80ms apart (~320ms total) with a 200ms per-read timeout:
        // would fail if timeout_recv_body were used, must succeed with timeout_per_read.
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let handle = std::thread::spawn(move || {
            let (mut sock, _) = listener.accept().unwrap();
            let mut req_buf = [0u8; 1024];
            let _ = sock.read(&mut req_buf);
            let _ = sock.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 16\r\nConnection: close\r\n\r\n");
            for chunk in [b"aaaa", b"bbbb", b"cccc", b"dddd"] {
                std::thread::sleep(Duration::from_millis(80));
                let _ = sock.write_all(chunk);
                let _ = sock.flush();
            }
        });

        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("model.bin");
        let cancel = AtomicBool::new(false);
        let cfg = download_agent_config(Duration::from_secs(5), Duration::from_millis(200));
        let url = format!("http://{addr}/model.bin");
        let out = download_file_with_config(&url, &dest, "", |_, _| {}, &cancel, cfg).unwrap();
        handle.join().unwrap();
        assert_eq!(fs::read(out).unwrap(), b"aaaabbbbccccdddd");
    }
}
