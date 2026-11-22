//! Sympony `pony.*` svc handlers: Agent Skills CRUD/import/export and visible memory (`~/.sympony/`).
//! Kept outside `crates/contract/contract.json` so core parity stays 216/216.
use serde_json::{json, Map, Value};
use services::pony::{
    create_skill_dir, edit_fact, ensure_dir, export_skill, facts, forget, forget_all, home, import_skill,
    inspect_import_skill, load_skills, parse_skill, read_skill_file, restore_builtins, save_skill_checked, skill_path,
    skill_tree, validate_name, write_skill_file,
};
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Manager};

use crate::commands::App;

pub(crate) fn skills_root() -> PathBuf {
    home().join("skills")
}

pub(crate) fn memory_file() -> PathBuf {
    home().join("memory.json")
}

pub(crate) fn skills_off_from(settings: &Value) -> Vec<String> {
    settings
        .get("ponySkillsOff")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).map(String::from).collect())
        .unwrap_or_default()
}

pub(crate) fn skills_off(app: &AppHandle) -> Vec<String> {
    skills_off_from(&app.state::<App>().settings.get())
}

/// Opens a macOS panel that accepts either a folder or a `.zip` / `.skill` archive.
fn pick_import_source() -> Option<String> {
    let jxa = r#"
ObjC.import('AppKit');
const p = $.NSOpenPanel.openPanel;
p.setCanChooseFiles(true);
p.setCanChooseDirectories(true);
p.setAllowsMultipleSelection(false);
p.setPrompt($('Import'));
p.setMessage($('Choose a skill folder, .skill or .zip file'));
if (p.runModal == $.NSModalResponseOK) {
  p.URL.path.js;
} else {
  '';
}
"#;
    let out = Command::new("/usr/bin/osascript")
        .args(["-l", "JavaScript", "-e", jxa])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!s.is_empty()).then_some(s)
}

fn pick_export_dest(default_name: &str) -> Option<String> {
    let script = format!(
        "POSIX path of (choose file name with prompt \"Export skill\" default name {:?})",
        format!("{default_name}.skill")
    );
    let out = Command::new("/usr/bin/osascript")
        .args(["-e", &script])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!s.is_empty()).then_some(s)
}

fn move_to_trash(path: &Path) -> Result<(), String> {
    let path_str = path.to_string_lossy().to_string();
    // Try NSFileManager trashItemAtURL first via JXA (fast, doesn't launch/focus Finder)
    let jxa = format!(
        r#"ObjC.import('Foundation');
const fm = $.NSFileManager.defaultManager;
const url = $.NSURL.fileURLWithPath($({}));
const ok = fm.trashItemAtURLResultingItemURLError(url, null, null);
ok ? 'ok' : 'err';"#,
        serde_json::to_string(&path_str).unwrap_or_else(|_| "\"\"".into())
    );
    if let Ok(out) = Command::new("/usr/bin/osascript")
        .args(["-l", "JavaScript", "-e", &jxa])
        .output()
    {
        if out.status.success() && String::from_utf8_lossy(&out.stdout).trim() == "ok" && !path.exists() {
            return Ok(());
        }
    }
    // Fallback to Finder AppleScript
    let script = format!(
        "tell application \"Finder\" to delete POSIX file {}",
        serde_json::to_string(&path_str).unwrap_or_else(|_| "\"\"".into())
    );
    let out = Command::new("/usr/bin/osascript")
        .args(["-e", &script])
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() && !path.exists() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

pub fn register(reg: &mut services::Registry, app: &AppHandle) {
    // pony.skills()
    {
        let h = app.clone();
        reg.add(
            "pony.skills",
            Box::new(move |_, _| {
                let root = skills_root();
                let off = skills_off(&h);
                let list = load_skills(&root);
                Ok(Value::Array(
                    list.into_iter()
                        .map(|s| {
                            let enabled = !off.iter().any(|x| x == &s.name);
                            json!({
                                "name": s.name,
                                "description": s.description,
                                "enabled": enabled,
                                "problems": s.problems,
                                "hasScripts": s.has_scripts,
                                "bodyLines": s.body_lines,
                                "extra": s.extra,
                            })
                        })
                        .collect(),
                ))
            }),
        );
    }

    // pony.skill(name)
    reg.add(
        "pony.skill",
        Box::new(move |_, args| {
            let name = args.first().and_then(Value::as_str).unwrap_or("");
            if let Err(e) = validate_name(name) {
                return Ok(json!({"ok": false, "error": e}));
            }
            let dir = skills_root().join(name);
            let md = dir.join("SKILL.md");
            let Ok(raw) = std::fs::read_to_string(&md) else {
                return Ok(json!({"ok": false, "error": format!("Skill '{name}' not found")}));
            };
            let s = parse_skill(&dir, &raw);
            Ok(json!({
                "ok": true,
                "name": s.name,
                "description": s.description,
                "body": s.body,
                "extra": s.extra,
            }))
        }),
    );

    // pony.saveSkill({name, description, body, extra, renameFrom?, isNew?})
    reg.add(
        "pony.saveSkill",
        Box::new(move |_, args| {
            let Some(obj) = args.first().and_then(Value::as_object) else {
                return Ok(json!({"ok": false, "error": "Invalid skill payload"}));
            };
            let name = obj.get("name").and_then(Value::as_str).unwrap_or("").trim();
            let description = obj.get("description").and_then(Value::as_str).unwrap_or("");
            let body = obj.get("body").and_then(Value::as_str).unwrap_or("");
            let extra: Map<String, Value> = obj
                .get("extra")
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_default();
            let rename_from = obj
                .get("renameFrom")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty());
            let create_new = obj.get("isNew").and_then(Value::as_bool).unwrap_or(false);

            match save_skill_checked(&skills_root(), name, description, body, &extra, rename_from, create_new) {
                Ok(_) => Ok(json!({"ok": true, "name": name})),
                Err(e) => Ok(json!({"ok": false, "error": e})),
            }
        }),
    );

    // pony.deleteSkill(name)
    reg.add(
        "pony.deleteSkill",
        Box::new(move |_, args| {
            let name = args.first().and_then(Value::as_str).unwrap_or("");
            if let Err(e) = validate_name(name) {
                return Ok(json!({"ok": false, "error": e}));
            }
            let dir = skills_root().join(name);
            if !dir.exists() {
                return Ok(json!({"ok": false, "error": format!("Skill '{name}' not found")}));
            }
            match move_to_trash(&dir) {
                Ok(()) => Ok(json!({"ok": true})),
                Err(e) => Ok(json!({"ok": false, "error": e})),
            }
        }),
    );

    // pony.importSkill(path?, replace?)
    reg.add(
        "pony.importSkill",
        Box::new(move |_, args| {
            let explicit_path = args
                .first()
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(String::from);
            let replace_opt = args.get(1).and_then(Value::as_bool);

            let Some(src_str) = explicit_path.or_else(pick_import_source) else {
                return Ok(json!({"ok": false, "cancelled": true}));
            };
            let src = PathBuf::from(&src_str);
            let root = skills_root();

            if replace_opt.is_none() {
                match inspect_import_skill(&src) {
                    Ok(name) => {
                        if root.join(&name).exists() {
                            return Ok(json!({"ok": false, "clash": name, "path": src_str}));
                        }
                    }
                    Err(e) => return Ok(json!({"ok": false, "error": e})),
                }
            }
            match import_skill(&root, &src, replace_opt.unwrap_or(false)) {
                Ok(installed) => Ok(json!({"ok": true, "name": installed})),
                Err(e) => Ok(json!({"ok": false, "error": e})),
            }
        }),
    );

    // pony.exportSkill(name, destPath?)
    reg.add(
        "pony.exportSkill",
        Box::new(move |_, args| {
            let name = args.first().and_then(Value::as_str).unwrap_or("");
            if let Err(e) = validate_name(name) {
                return Ok(json!({"ok": false, "error": e}));
            }
            let dest_str = args
                .get(1)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(String::from)
                .or_else(|| pick_export_dest(name));
            let Some(dest) = dest_str else {
                return Ok(json!({"ok": false, "cancelled": true}));
            };
            match export_skill(&skills_root(), name, Path::new(&dest)) {
                Ok(()) => Ok(json!({"ok": true, "path": dest})),
                Err(e) => Ok(json!({"ok": false, "error": e})),
            }
        }),
    );

    // pony.revealSkill(name)
    reg.add(
        "pony.revealSkill",
        Box::new(move |_, args| {
            let name = args.first().and_then(Value::as_str).unwrap_or("");
            if let Err(e) = validate_name(name) {
                return Ok(json!({"ok": false, "error": e}));
            }
            let dir = skills_root().join(name);
            let target = if dir.join("SKILL.md").exists() {
                dir.join("SKILL.md")
            } else {
                dir
            };
            let _ = Command::new("/usr/bin/open").arg("-R").arg(&target).spawn();
            Ok(json!({"ok": true}))
        }),
    );

    // pony.openHome()
    reg.add(
        "pony.openHome",
        Box::new(move |_, _| {
            let dir = home();
            let _ = ensure_dir(&dir);
            let _ = ensure_dir(&skills_root());
            let _ = Command::new("/usr/bin/open").arg(&dir).spawn();
            Ok(json!({"ok": true, "path": dir.to_string_lossy()}))
        }),
    );

    // pony.restoreBuiltins()
    reg.add(
        "pony.restoreBuiltins",
        Box::new(move |_, _| match restore_builtins(&skills_root()) {
            Ok(restored) => Ok(json!({"ok": true, "restored": restored})),
            Err(e) => Ok(json!({"ok": false, "error": e.to_string()})),
        }),
    );

    // pony.tree(name): the skill folder's entries, for the Settings tree view
    reg.add(
        "pony.tree",
        Box::new(move |_, args| {
            let name = args.first().and_then(Value::as_str).unwrap_or("");
            Ok(match skill_tree(&skills_root(), name) {
                Ok(list) => json!({"ok": true, "entries": list}),
                Err(e) => json!({"ok": false, "error": e}),
            })
        }),
    );

    // pony.readFile(name, rel) / pony.writeFile(name, rel, text) / pony.newFolder(name, rel)
    reg.add(
        "pony.readFile",
        Box::new(move |_, args| {
            let name = args.first().and_then(Value::as_str).unwrap_or("");
            let rel = args.get(1).and_then(Value::as_str).unwrap_or("");
            Ok(match read_skill_file(&skills_root(), name, rel) {
                Ok(text) => json!({"ok": true, "text": text}),
                Err(e) => json!({"ok": false, "error": e}),
            })
        }),
    );
    reg.add(
        "pony.writeFile",
        Box::new(move |_, args| {
            let name = args.first().and_then(Value::as_str).unwrap_or("");
            let rel = args.get(1).and_then(Value::as_str).unwrap_or("");
            let text = args.get(2).and_then(Value::as_str).unwrap_or("");
            Ok(match write_skill_file(&skills_root(), name, rel, text) {
                Ok(()) => json!({"ok": true}),
                Err(e) => json!({"ok": false, "error": e}),
            })
        }),
    );
    reg.add(
        "pony.newFolder",
        Box::new(move |_, args| {
            let name = args.first().and_then(Value::as_str).unwrap_or("");
            let rel = args.get(1).and_then(Value::as_str).unwrap_or("");
            Ok(match create_skill_dir(&skills_root(), name, rel) {
                Ok(()) => json!({"ok": true}),
                Err(e) => json!({"ok": false, "error": e}),
            })
        }),
    );

    // pony.deleteFile(name, rel): a file or folder inside a skill, to the Trash
    reg.add(
        "pony.deleteFile",
        Box::new(move |_, args| {
            let name = args.first().and_then(Value::as_str).unwrap_or("");
            let rel = args.get(1).and_then(Value::as_str).unwrap_or("");
            let path = match skill_path(&skills_root(), name, rel) {
                Ok(p) if p.exists() => p,
                Ok(_) => return Ok(json!({"ok": false, "error": format!("'{rel}' not found")})),
                Err(e) => return Ok(json!({"ok": false, "error": e})),
            };
            Ok(match move_to_trash(&path) {
                Ok(()) => json!({"ok": true}),
                Err(e) => json!({"ok": false, "error": e}),
            })
        }),
    );

    // pony.revealFile(name, rel)
    reg.add(
        "pony.revealFile",
        Box::new(move |_, args| {
            let name = args.first().and_then(Value::as_str).unwrap_or("");
            let rel = args.get(1).and_then(Value::as_str).unwrap_or("");
            let root = skills_root();
            let target = if rel.eq_ignore_ascii_case("SKILL.md") || rel.is_empty() {
                if validate_name(name).is_err() {
                    return Ok(json!({"ok": false}));
                }
                root.join(name).join("SKILL.md")
            } else {
                match skill_path(&root, name, rel) {
                    Ok(p) => p,
                    Err(e) => return Ok(json!({"ok": false, "error": e})),
                }
            };
            let _ = Command::new("/usr/bin/open").arg("-R").arg(&target).spawn();
            Ok(json!({"ok": true}))
        }),
    );

    // pony.memory()
    reg.add(
        "pony.memory",
        Box::new(move |_, _| {
            let list = facts(&memory_file());
            Ok(Value::Array(
                list.into_iter()
                    .map(|f| json!({"id": f.id, "text": f.text, "added": f.at, "learned": f.by.as_deref() == Some("learned")}))
                    .collect(),
            ))
        }),
    );

    // pony.editFact(id, text)
    reg.add(
        "pony.editFact",
        Box::new(move |_, args| {
            let id = args.first().and_then(Value::as_str).unwrap_or("");
            let text = args.get(1).and_then(Value::as_str).unwrap_or("");
            match edit_fact(&memory_file(), id, text) {
                Ok(()) => Ok(json!({"ok": true})),
                Err(e) => Ok(json!({"ok": false, "error": e})),
            }
        }),
    );

    // pony.forget(id | "all")
    reg.add(
        "pony.forget",
        Box::new(move |_, args| {
            let id = args.first().and_then(Value::as_str).unwrap_or("");
            let path = memory_file();
            if id == "all" {
                forget_all(&path);
                Ok(json!({"ok": true}))
            } else {
                Ok(json!({"ok": forget(&path, id)}))
            }
        }),
    );
}
