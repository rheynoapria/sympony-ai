use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const MAX_LOG_BYTES: u64 = 5 << 20;

struct Inner {
    path: PathBuf,
    file: Option<File>,
    written: u64,
}

/// `sympony.log` in the data folder: one `[<UTC time, ms>] <message>` line per call (`0600`, rotated at 5 MB).
pub struct Log(Mutex<Inner>);

fn open_file(path: &Path) -> Option<File> {
    let mut opts = OpenOptions::new();
    opts.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let f = opts.open(path).ok()?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    Some(f)
}

fn sanitize(msg: &str) -> String {
    msg.chars()
        .map(|c| match c {
            '\r' | '\n' => ' ',
            c if c.is_control() && c != '\t' => ' ',
            c => c,
        })
        .collect()
}

impl Log {
    pub fn open(dir: &Path) -> Self {
        let _ = crate::paths::ensure_private_dir(dir);
        let path = dir.join("sympony.log");
        let existing = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        if existing >= MAX_LOG_BYTES {
            let _ = std::fs::rename(&path, dir.join("sympony.log.1"));
        }
        let file = open_file(&path);
        let written = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        Log(Mutex::new(Inner { path, file, written }))
    }

    pub fn line(&self, msg: &str) {
        let ts = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ");
        let clean = sanitize(msg);
        let mut inner = self.0.lock().unwrap();
        if inner.written >= MAX_LOG_BYTES {
            inner.file = None;
            let backup = inner.path.with_file_name("sympony.log.1");
            let _ = std::fs::rename(&inner.path, backup);
            inner.file = open_file(&inner.path);
            inner.written = 0;
        }
        if let Some(f) = inner.file.as_mut() {
            let line = format!("[{ts}] {clean}\n");
            if f.write_all(line.as_bytes()).is_ok() {
                inner.written += line.len() as u64;
            }
        }
        if cfg!(debug_assertions) {
            eprintln!("[{ts}] {clean}");
        }
    }
}
