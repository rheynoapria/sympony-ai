//! Opening things the way Finder does: `/usr/bin/open` (a link in its app, a file in its app, a folder in Finder).
//! Each call waits for `open`, which returns once it has handed the target over: call it off the main thread.
use std::process::Command;

/// A link, file or folder in the app that handles it. False when `open` refused it.
pub fn open(target: &str) -> bool {
    !target.is_empty() && Command::new("/usr/bin/open").arg("--").arg(target).status().is_ok_and(|s| s.success())
}

/// `path` selected in a Finder window.
pub fn reveal(path: &str) -> bool {
    !path.is_empty() && Command::new("/usr/bin/open").args(["-R", "--"]).arg(path).status().is_ok_and(|s| s.success())
}

/// `files` opened with the app at `app` (a path from `files::choose("app", …)`): Err with `open`'s last word.
pub fn open_with(app: &str, files: &[String]) -> Result<(), String> {
    let out = Command::new("/usr/bin/open").arg("-a").arg(app).args(files).output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().lines().last().unwrap_or("failed").to_string())
    }
}
