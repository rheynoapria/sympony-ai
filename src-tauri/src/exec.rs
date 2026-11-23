//! Pony's commands & files (services::exec), run by the app for the own engine. Anything that changes something
//! waits for the user's answer on a card in the chat (`pony:approve` → svc `pony.approve`): once, always (that
//! command's prefix, `ponyExecAllow`) or no. What services::exec::blocked names never runs, and secret places are
//! never read or written.
use serde_json::{json, Value};
use services::exec;
use std::collections::HashMap;
use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::{apply_settings_patch, App};

/// How long a card waits for the user.
const ASK_WAIT: Duration = Duration::from_secs(300);
/// The largest file read or written whole.
const MAX_FILE: u64 = 2 << 20;

#[derive(Default)]
pub struct Exec {
    waits: Mutex<HashMap<u64, Sender<String>>>,
    next: AtomicU64,
}

/// Whether the user turned Commands & files on.
pub fn on(app: &AppHandle) -> bool {
    app.state::<App>().settings.get()["ponyExec"] == true
}

fn home() -> String {
    std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).unwrap_or_else(|_| "/".into())
}

/// The user's answer to a card: "once", "always" or "deny" (also when nobody answers in time).
pub(crate) fn approve(app: &AppHandle, session: &str, card: Value) -> String {
    let x = app.state::<Exec>();
    let id = x.next.fetch_add(1, Ordering::SeqCst) + 1;
    let (tx, rx) = channel();
    x.waits.lock().unwrap().insert(id, tx);
    let mut card = card;
    card["session"] = json!(session);
    card["id"] = json!(id);
    let _ = app.emit("pony:approve", card);
    let r = rx.recv_timeout(ASK_WAIT).unwrap_or_else(|_| "deny".into());
    x.waits.lock().unwrap().remove(&id);
    let _ = app.emit("pony:approved", json!({"session": session, "id": id}));
    r
}

/// YOLO (Settings → Commands & files): nothing asks but deleting files.
fn yolo(app: &AppHandle) -> bool {
    app.state::<App>().settings.get()["ponyExecMode"] == "yolo"
}

/// Resolves `pb` to its real canonical target path even when the target does not exist yet — including dangling
/// symlinks (e.g. `/tmp/link` → `~/.ssh/authorized_keys` before `authorized_keys` exists) and `..` segments.
fn resolve_path(pb: &std::path::Path) -> Result<std::path::PathBuf, String> {
    let mut current = pb.to_path_buf();
    for _ in 0..40 {
        if let Ok(canon) = std::fs::canonicalize(&current) {
            return Ok(canon);
        }
        let mut probe = current.clone();
        let mut tail = Vec::new();
        loop {
            match std::fs::symlink_metadata(&probe) {
                Ok(meta) if meta.file_type().is_symlink() => {
                    let target = std::fs::read_link(&probe).map_err(|e| format!("{}: {e}", probe.display()))?;
                    let parent = probe.parent().unwrap_or_else(|| std::path::Path::new("/"));
                    let mut next = if target.is_absolute() { target } else { parent.join(target) };
                    for seg in tail.into_iter().rev() {
                        next.push(seg);
                    }
                    current = next;
                    break;
                }
                Ok(_) => {
                    let mut base = std::fs::canonicalize(&probe).unwrap_or(probe);
                    for seg in tail.into_iter().rev() {
                        base.push(seg);
                    }
                    return Ok(std::path::PathBuf::from(exec::normalize_lexical(&base.to_string_lossy())));
                }
                Err(_) => {
                    if let Some(name) = probe.file_name() {
                        tail.push(name.to_os_string());
                    }
                    if !probe.pop() {
                        return Ok(std::path::PathBuf::from(exec::normalize_lexical(&current.to_string_lossy())));
                    }
                }
            }
        }
    }
    Err("Too many levels of symbolic links".into())
}

/// Validates and expands a file-tool path against `secret_place` on both the requested and resolved target paths
/// (including dangling symlinks). Returns `(expanded_path, resolved_canonical_path)`.
fn check_file_path(raw: &str, home: &str, name: &str) -> Result<(String, String), String> {
    let p = exec::expand(raw, home);
    if p.is_empty() {
        return Err(format!("{name} needs path"));
    }
    let pb = std::path::Path::new(&p);
    if !pb.is_absolute() {
        return Err(format!("{name} needs an absolute path or ~"));
    }
    if let Some(s) = exec::secret_place_in(&p, Some(home)) {
        return Err(format!("Sympony keeps Pony away from {s}, where keys and passwords live"));
    }
    let canon = resolve_path(pb)?;
    let canon_str = canon.to_string_lossy().to_string();
    if let Some(s) = exec::secret_place_in(&canon_str, Some(home)) {
        return Err(format!("Sympony keeps Pony away from {s}, where keys and passwords live"));
    }
    Ok((p, canon_str))
}

/// One of services::exec::NAMES. `after_web`: Pony read the web/screen/MCP earlier in this turn (then changes ask, also in YOLO).
pub fn run(app: &AppHandle, session: &str, after_web: bool, name: &str, args: &Value) -> Result<String, String> {
    let home = home();
    let step = |kind: &str, detail: &str| {
        let _ = app.emit("agent:step", json!({"session": session, "kind": kind, "detail": detail.chars().take(60).collect::<String>()}));
    };
    let path = || check_file_path(args["path"].as_str().unwrap_or(""), &home, name);
    let declined = || Err("The user said no. Don't try another way; ask them what they'd like instead.".to_string());
    let yolo = yolo(app);
    // (Taint from web/screen/MCP always requires confirmation, even in YOLO mode, to block indirect prompt injection.)
    match name {
        "run_command" => {
            let command = args["command"].as_str().unwrap_or("").trim().to_string();
            if command.is_empty() {
                return Err("run_command needs command".into());
            }
            let cwd = exec::expand(args["cwd"].as_str().filter(|c| !c.trim().is_empty()).unwrap_or("~"), &home);
            if !std::path::Path::new(&cwd).is_dir() {
                return Err(format!("{cwd} isn't a folder"));
            }
            let canon_cwd = std::fs::canonicalize(&cwd)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|_| cwd.clone());
            if let Some(why) = exec::blocked_at(&command, Some(&canon_cwd), Some(&home)) {
                return Err(format!("Sympony never runs this ({why}). Tell the user it has to be done by hand if they really want it."));
            }
            let secs = args["timeout"].as_u64().unwrap_or(120).clamp(1, 600);
            let allowed: Vec<String> = app.state::<App>().settings.get()["ponyExecAllow"]
                .as_array()
                .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or_default();
            let deletes = exec::deletes(&command);
            let touches_protected = exec::modifies_protected_config_at(&command, Some(&canon_cwd), Some(&home));
            // In YOLO mode, only file deletions and protected configs (shell profiles / LaunchAgents) ask;
            // in Ask mode, taint (`after_web`) or non-read-only commands ask.
            if deletes || touches_protected || (!yolo && (after_web || !exec::auto_ok_at(&command, &allowed, after_web, Some(&canon_cwd), Some(&home)))) {
                let prefix = exec::prefix(&command);
                // (deleting, shell profiles / LaunchAgents, shells/interpreters, and collapsed flag prefixes never offer "always allow")
                let can_always = exec::can_always_at(&command, Some(&canon_cwd), Some(&home));
                match approve(app, session, json!({"tool": if deletes { "delete" } else { "run_command" }, "detail": command, "cwd": cwd, "prefix": prefix, "canAlways": can_always})).as_str() {
                    "always" if can_always => {
                        let mut all = allowed.clone();
                        if !all.contains(&prefix) {
                            all.push(prefix);
                            apply_settings_patch(app, json!({"ponyExecAllow": all}));
                        }
                    }
                    "once" | "always" => {}
                    _ => return declined(),
                }
            }
            step("run", &command);
            let started = Instant::now();
            let r = shell(&command, &cwd, Duration::from_secs(secs), &|| crate::brain::stopped(app, session));
            app.state::<App>().log.line(&format!("pony exec: {:?} in {cwd} ({:.1} s)", command.chars().take(120).collect::<String>(), started.elapsed().as_secs_f32()));
            r
        }
        "read_file" => {
            let (p, _) = path()?;
            if !yolo && after_web && approve(app, session, json!({"tool": "read_file", "detail": p})) == "deny" {
                return declined();
            }
            step("read", p.rsplit('/').next().unwrap_or(&p));
            let text = read_text(&p)?;
            let offset = args["offset"].as_u64().unwrap_or(1) as usize;
            let limit = args["limit"].as_u64().unwrap_or(400).clamp(1, 2000) as usize;
            Ok(exec::numbered(&text, offset, limit))
        }
        "list_dir" => {
            let (p, _) = path()?;
            if !yolo && after_web && approve(app, session, json!({"tool": "list_dir", "detail": p})) == "deny" {
                return declined();
            }
            step("list", p.rsplit('/').next().unwrap_or(&p));
            let mut names: Vec<String> = std::fs::read_dir(&p)
                .map_err(|e| format!("{p}: {e}"))?
                .flatten()
                .map(|e| {
                    let n = e.file_name().to_string_lossy().to_string();
                    if e.file_type().is_ok_and(|t| t.is_dir()) { format!("{n}/") } else { n }
                })
                .collect();
            names.sort();
            let more = names.len().saturating_sub(500);
            names.truncate(500);
            Ok(if names.is_empty() { "(empty)".into() } else { names.join("\n") + &if more > 0 { format!("\n… {more} more") } else { String::new() } })
        }
        "write_file" => {
            let (p, canon) = path()?;
            let content = args["content"].as_str().unwrap_or("");
            if content.len() as u64 > MAX_FILE {
                return Err("That's too much for one file write (2 MB)".into());
            }
            let exists = std::path::Path::new(&p).exists();
            let preview: String = content.lines().take(30).collect::<Vec<_>>().join("\n");
            let detail = format!("{p}\n\n{preview}{}", if content.lines().count() > 30 { "\n…" } else { "" });
            let touches_protected = exec::protected_config_path_at(&p, None, Some(&home))
                || exec::protected_config_path_at(&canon, None, Some(&home));
            if (!yolo || touches_protected) && approve(app, session, json!({"tool": if exists { "overwrite_file" } else { "write_file" }, "detail": detail})) == "deny" {
                return declined();
            }
            step("write", p.rsplit('/').next().unwrap_or(&p));
            if let Some(dir) = std::path::Path::new(&p).parent() {
                std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
            }
            std::fs::write(&p, content).map_err(|e| format!("{p}: {e}"))?;
            Ok(format!("Wrote {p} ({} lines)", content.lines().count()))
        }
        "edit_file" => {
            let (p, canon) = path()?;
            let old = args["old"].as_str().unwrap_or("");
            let new = args["new"].as_str().unwrap_or("");
            let text = read_text(&p)?;
            let (out, n) = exec::edit(&text, old, new, args["replace_all"] == true)?;
            let clip = |s: &str, sign: char| s.lines().take(12).map(|l| format!("{sign} {l}")).collect::<Vec<_>>().join("\n");
            let detail = format!("{p}{}\n\n{}\n{}", if n > 1 { format!(" ({n}×)") } else { String::new() }, clip(old, '-'), clip(new, '+'));
            let touches_protected = exec::protected_config_path_at(&p, None, Some(&home))
                || exec::protected_config_path_at(&canon, None, Some(&home));
            if (!yolo || touches_protected) && approve(app, session, json!({"tool": "edit_file", "detail": detail})) == "deny" {
                return declined();
            }
            step("edit", p.rsplit('/').next().unwrap_or(&p));
            std::fs::write(&p, out).map_err(|e| format!("{p}: {e}"))?;
            Ok(format!("Edited {p} ({n} change{})", if n == 1 { "" } else { "s" }))
        }
        _ => Err(format!("Sympony has no tool {name}")),
    }
}

fn read_text(p: &str) -> Result<String, String> {
    let meta = std::fs::metadata(p).map_err(|e| format!("{p}: {e}"))?;
    if meta.is_dir() {
        return Err(format!("{p} is a folder (use list_dir)"));
    }
    if meta.len() > MAX_FILE {
        return Err(format!("{p} is too big to read whole ({} MB); use run_command with head, tail or grep", meta.len() >> 20));
    }
    String::from_utf8(std::fs::read(p).map_err(|e| format!("{p}: {e}"))?).map_err(|_| format!("{p} isn't a text file"))
}

/// A command in the user's shell, its output read as it comes; stopped at `limit`.
fn shell(command: &str, cwd: &str, limit: Duration, stop: &dyn Fn() -> bool) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = Command::new("/bin/zsh");
        c.args(["-lc", command]);
        c
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = {
        let mut c = Command::new("/bin/sh");
        c.args(["-lc", command]);
        c
    };
    #[cfg(windows)]
    let mut cmd = {
        let mut c = Command::new("cmd");
        c.args(["/C", command]);
        c
    };
    let mut child = cmd
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("PAGER", "cat")
        .env("GIT_PAGER", "cat")
        .env("GIT_TERMINAL_PROMPT", "0")
        .spawn()
        .map_err(|e| format!("Couldn't start the shell: {e}"))?;
    // (pipes read on their own threads, so a chatty command never blocks; 4 MB each at most)
    let drain = |r: Option<Box<dyn Read + Send>>| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            if let Some(r) = r {
                let _ = r.take(4 << 20).read_to_end(&mut buf);
            }
            String::from_utf8_lossy(&buf).to_string()
        })
    };
    let out = drain(child.stdout.take().map(|s| Box::new(s) as Box<dyn Read + Send>));
    let err = drain(child.stderr.take().map(|s| Box::new(s) as Box<dyn Read + Send>));
    let start = Instant::now();
    let (code, timed_out) = loop {
        match child.try_wait() {
            Ok(Some(st)) => break (st.code(), false),
            // (Stop pressed in the chat: the command goes too)
            Ok(None) if stop() => {
                let _ = child.kill();
                let _ = child.wait();
                return Ok("Stopped by the user.".into());
            }
            Ok(None) if start.elapsed() >= limit => {
                let _ = child.kill();
                let _ = child.wait();
                break (None, true);
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
            Err(e) => return Err(e.to_string()),
        }
    };
    Ok(exec::report(code, &out.join().unwrap_or_default(), &err.join().unwrap_or_default(), timed_out))
}

pub fn register(reg: &mut services::Registry, app: &AppHandle) {
    app.manage(Exec::default());
    let h = app.clone();
    // (a card's answer: id, "once" | "always" | "deny")
    reg.add("pony.approve", Box::new(move |_, a| {
        let id = a.first().and_then(Value::as_u64).unwrap_or(0);
        let answer = a.get(1).and_then(Value::as_str).unwrap_or("deny").to_string();
        if let Some(tx) = h.state::<Exec>().waits.lock().unwrap().remove(&id) {
            let _ = tx.send(answer);
        }
        Ok(Value::Null)
    }));
    let h = app.clone();
    // (Settings: forget the "always" list)
    reg.add("pony.execForget", Box::new(move |_, _| Ok(apply_settings_patch(&h, json!({"ponyExecAllow": []})))));
}

#[cfg(test)]
mod tests {
    use super::{check_file_path, shell};
    use std::time::{Duration, Instant};

    #[test]
    fn runs_reads_both_streams_and_stops_at_the_limit() {
        let r = shell("echo hi; echo oops 1>&2; exit 3", "/tmp", Duration::from_secs(10), &|| false).unwrap();
        assert!(r.starts_with("Exit code 3"), "{r}");
        assert!(r.contains("stdout:\nhi") && r.contains("stderr:\noops"), "{r}");
        let t = Instant::now();
        let r = shell("sleep 5", "/tmp", Duration::from_millis(400), &|| false).unwrap();
        assert!(r.contains("time limit") && t.elapsed() < Duration::from_secs(3), "{r}");
        // (lots of output never blocks the pipe)
        let r = shell("yes | head -c 300000", "/tmp", Duration::from_secs(10), &|| false).unwrap();
        assert!(r.starts_with("Exit code 0") && r.contains("characters cut"), "{}", &r[..80]);
    }

    #[test]
    fn file_paths_allow_normal_symlinks_but_block_symlinks_into_secrets() {
        use std::os::unix::fs::symlink;
        // Standard macOS symlinks (/tmp -> /private/tmp, /etc -> /private/etc) must work.
        assert!(check_file_path("/tmp", "/Users/alice", "list_dir").is_ok());

        let base = std::env::temp_dir().join(format!("sy-exec-link-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let safe_dir = base.join("safe");
        let secret_dir = base.join(".ssh");
        std::fs::create_dir_all(&safe_dir).unwrap();
        std::fs::create_dir_all(&secret_dir).unwrap();
        std::fs::write(safe_dir.join("ok.txt"), "hi").unwrap();
        std::fs::write(secret_dir.join("id_rsa"), "secret").unwrap();

        let safe_link = base.join("link-ok");
        let secret_file_link = base.join("link-key");
        let secret_dir_link = base.join("link-ssh");
        symlink(safe_dir.join("ok.txt"), &safe_link).unwrap();
        symlink(secret_dir.join("id_rsa"), &secret_file_link).unwrap();
        symlink(&secret_dir, &secret_dir_link).unwrap();

        // Symlink to a normal file is allowed.
        assert!(check_file_path(&safe_link.to_string_lossy(), "/Users/alice", "read_file").is_ok());
        // Symlink directly to a secret file is blocked via canonicalization.
        assert!(check_file_path(&secret_file_link.to_string_lossy(), "/Users/alice", "read_file").is_err());
        // Writing a new (non-existent) file through a symlinked secret directory is also blocked.
        let new_in_secret = secret_dir_link.join("authorized_keys");
        assert!(check_file_path(&new_in_secret.to_string_lossy(), "/Users/alice", "write_file").is_err());

        // Dangling symlink (target doesn't exist yet) pointing to a secret file MUST be blocked (absolute and relative).
        let dangling_abs = base.join("dangling-abs");
        symlink(secret_dir.join("authorized_keys"), &dangling_abs).unwrap();
        assert!(check_file_path(&dangling_abs.to_string_lossy(), "/Users/alice", "write_file").is_err());

        let dangling_rel = safe_dir.join("dangling-rel");
        symlink("../.ssh/authorized_keys", &dangling_rel).unwrap();
        assert!(check_file_path(&dangling_rel.to_string_lossy(), "/Users/alice", "write_file").is_err());

        // Dangling symlink to a non-secret new file is allowed.
        let dangling_safe = base.join("dangling-safe");
        symlink(safe_dir.join("new.txt"), &dangling_safe).unwrap();
        assert!(check_file_path(&dangling_safe.to_string_lossy(), "/Users/alice", "write_file").is_ok());

        let _ = std::fs::remove_dir_all(&base);
    }
}
