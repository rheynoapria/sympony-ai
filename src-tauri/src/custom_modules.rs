//! Tauri IPC & Pony MCP handlers for local Declarative OLED Custom Modules (`custommod.*` / `custommod:*`).
use serde_json::{json, Map, Value};
use services::custom_modules::{
    action_effect, apply_action, custom_id, delete_module, export_bundle, fetch_data_source,
    import_bundle, list_manifests, manifest_domains, read_config, read_manifest, read_state,
    save_manifest, secret_field_keys, starter_templates, validate_manifest, validate_slug,
    write_config, write_state, MIN_POLL_SECONDS,
};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::{apply_settings_patch, App};

const SECRETS_KEY: &str = "customModSecrets";
const APPROVED_KEY: &str = "customModApprovedDomains";
const PINNED_PILL_KEY: &str = "customModPinnedPill";

fn pinned_pill_slug(app: &AppHandle) -> String {
    app.state::<App>()
        .settings
        .get()
        .get(PINNED_PILL_KEY)
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string()
}

#[derive(Default)]
pub struct CustomModState {
    /// Cached fetch results per `(slug, dataSourceId)`: `(fetched_at, payload)`.
    cache: Mutex<HashMap<(String, String), (Instant, Value)>>,
}

fn approved_map(app: &AppHandle) -> Map<String, Value> {
    app.state::<App>()
        .settings
        .get()
        .get(APPROVED_KEY)
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default()
}

pub fn approved_domains(app: &AppHandle, slug: &str) -> Vec<String> {
    approved_map(app)
        .get(slug)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(|s| s.to_ascii_lowercase())
        .collect()
}

fn missing_domains(manifest: &Value, approved: &[String]) -> Vec<String> {
    manifest_domains(manifest)
        .into_iter()
        .filter(|d| !approved.iter().any(|a| a.eq_ignore_ascii_case(d)))
        .collect()
}

fn save_approved_domains(app: &AppHandle, slug: &str, domains: Vec<String>) {
    let mut map = approved_map(app);
    if domains.is_empty() {
        map.remove(slug);
    } else {
        map.insert(slug.to_string(), json!(domains));
    }
    apply_settings_patch(app, json!({ APPROVED_KEY: map }));
}

fn all_secrets(app: &AppHandle) -> Map<String, Value> {
    app.state::<App>()
        .settings
        .secret_value(SECRETS_KEY)
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default()
}

fn save_all_secrets(app: &AppHandle, map: &Map<String, Value>) {
    let serialized = if map.is_empty() {
        String::new()
    } else {
        serde_json::to_string(&Value::Object(map.clone())).unwrap_or_default()
    };
    let _ = app.state::<App>().settings.secret(SECRETS_KEY, &serialized);
}

fn module_secrets(app: &AppHandle, slug: &str) -> Value {
    all_secrets(app).get(slug).cloned().unwrap_or_else(|| json!({}))
}

fn configured_secret_keys(app: &AppHandle, slug: &str, manifest: &Value) -> Vec<String> {
    let allowed = secret_field_keys(manifest);
    let secs = module_secrets(app, slug);
    let mut out: Vec<String> = secs
        .as_object()
        .into_iter()
        .flatten()
        .filter(|(k, v)| allowed.contains(k.as_str()) && v.as_str().is_some_and(|s| !s.is_empty()))
        .map(|(k, _)| k.clone())
        .collect();
    out.sort();
    out
}

fn clear_cache(app: &AppHandle, slug: &str) {
    app.state::<CustomModState>()
        .cache
        .lock()
        .unwrap()
        .retain(|(s, _), _| s != slug);
}

fn ensure_in_settings_modules(app: &AppHandle, slug: &str, enable: bool) {
    let cid = custom_id(slug);
    let mut mods = app
        .state::<App>()
        .settings
        .get()
        .get("modules")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if let Some(item) = mods.iter_mut().find(|m| m["id"].as_str() == Some(cid.as_str())) {
        if enable {
            item["on"] = Value::Bool(true);
        }
    } else {
        mods.push(json!({ "id": cid, "on": enable }));
    }
    apply_settings_patch(app, json!({ "modules": mods }));
}

fn remove_from_settings_modules(app: &AppHandle, slug: &str) {
    let cid = custom_id(slug);
    let s = app.state::<App>().settings.get();
    let mut mods = s
        .get("modules")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let before = mods.len();
    mods.retain(|m| m["id"].as_str() != Some(cid.as_str()));
    let mut patch = Map::new();
    if mods.len() != before {
        patch.insert("modules".into(), Value::Array(mods));
    }
    if let Some(mut ms) = s.get("moduleStyles").and_then(Value::as_object).cloned() {
        if ms.remove(&cid).is_some() {
            patch.insert("moduleStyles".into(), Value::Object(ms));
        }
    }
    if !patch.is_empty() {
        apply_settings_patch(app, Value::Object(patch));
    }
}

fn emit_changed(app: &AppHandle, slug: &str, reason: &str) {
    let _ = app.emit(
        "custommod:changed",
        json!({
            "slug": slug,
            "id": custom_id(slug),
            "reason": reason,
        }),
    );
}

fn build_module_summary(app: &AppHandle, manifest: &Value) -> Value {
    let data_dir = &app.state::<App>().data_dir;
    let slug = manifest["slug"].as_str().unwrap_or("");
    let approved = approved_domains(app, slug);
    let missing = missing_domains(manifest, &approved);
    let state = read_state(data_dir, slug, manifest);
    let config = read_config(data_dir, slug, manifest);
    let secret_keys = configured_secret_keys(app, slug, manifest);
    json!({
        "manifest": manifest,
        "slug": slug,
        "id": custom_id(slug),
        "approvedDomains": approved,
        "missingDomains": missing,
        "secretKeysConfigured": secret_keys,
        "config": config,
        "state": state,
        "pinnedPill": pinned_pill_slug(app) == slug,
    })
}

fn fetch_all_sources(app: &AppHandle, slug: &str, force: bool) -> Result<Value, String> {
    let data_dir = app.state::<App>().data_dir.clone();
    let manifest = read_manifest(&data_dir, slug)?;
    let approved = approved_domains(app, slug);
    let missing = missing_domains(&manifest, &approved);
    let config = read_config(&data_dir, slug, &manifest);
    let secrets = module_secrets(app, slug);

    let mut data_map = Map::new();
    let mut errors_map = Map::new();

    for ds in manifest["dataSources"].as_array().into_iter().flatten() {
        let Some(ds_id) = ds["id"].as_str() else { continue };
        let poll_secs = ds["pollSeconds"].as_u64().unwrap_or(60).max(MIN_POLL_SECONDS);
        let ttl = if force { Duration::from_secs(5) } else { Duration::from_secs(poll_secs) };
        let cache_key = (slug.to_string(), ds_id.to_string());
        if let Some((at, cached)) = app.state::<CustomModState>().cache.lock().unwrap().get(&cache_key).cloned() {
            if at.elapsed() < ttl {
                data_map.insert(ds_id.to_string(), cached);
                continue;
            }
        }
        match fetch_data_source(ds, &approved, &config, &secrets) {
            Ok(val) => {
                app.state::<CustomModState>()
                    .cache
                    .lock()
                    .unwrap()
                    .insert(cache_key, (Instant::now(), val.clone()));
                data_map.insert(ds_id.to_string(), val);
            }
            Err(e) => {
                errors_map.insert(ds_id.to_string(), Value::from(e));
            }
        }
    }

    Ok(json!({
        "ok": true,
        "slug": slug,
        "data": data_map,
        "errors": errors_map,
        "missingDomains": missing,
        "updatedAt": chrono::Utc::now().timestamp_millis(),
    }))
}

fn delete_full(app: &AppHandle, slug: &str) -> Result<(), String> {
    let data_dir = app.state::<App>().data_dir.clone();
    delete_module(&data_dir, slug)?;
    clear_cache(app, slug);
    let mut secs = all_secrets(app);
    if secs.remove(slug).is_some() {
        save_all_secrets(app, &secs);
    }
    save_approved_domains(app, slug, vec![]);
    remove_from_settings_modules(app, slug);
    emit_changed(app, slug, "deleted");
    Ok(())
}

/// Registers all `custommod.*` service methods on the Tauri `Registry`.
pub fn register(reg: &mut services::Registry, app: &AppHandle) {
    app.manage(CustomModState::default());

    let h = app.clone();
    reg.add("custommod.list", Box::new(move |_, _| {
        let data_dir = h.state::<App>().data_dir.clone();
        let modules: Vec<Value> = list_manifests(&data_dir)
            .iter()
            .map(|m| build_module_summary(&h, m))
            .collect();
        Ok(json!({ "ok": true, "modules": modules }))
    }));

    let h = app.clone();
    reg.add("custommod.get", Box::new(move |_, a| {
        let slug = a.first().and_then(Value::as_str).unwrap_or("").trim();
        let data_dir = h.state::<App>().data_dir.clone();
        match read_manifest(&data_dir, slug) {
            Ok(m) => {
                let mut v = build_module_summary(&h, &m);
                v["ok"] = Value::Bool(true);
                Ok(v)
            }
            Err(e) => Ok(json!({ "ok": false, "error": e })),
        }
    }));

    let h = app.clone();
    reg.add("custommod.fetch", Box::new(move |_, a| {
        let slug = a.first().and_then(Value::as_str).unwrap_or("").trim();
        let force = a.get(1).and_then(Value::as_bool).unwrap_or(false);
        match fetch_all_sources(&h, slug, force) {
            Ok(v) => Ok(v),
            Err(e) => Ok(json!({ "ok": false, "error": e })),
        }
    }));

    let h = app.clone();
    reg.add("custommod.action", Box::new(move |_, a| {
        let slug = a.first().and_then(Value::as_str).unwrap_or("").trim();
        let action_name = a.get(1).and_then(Value::as_str).unwrap_or("").trim();
        let payload = a.get(2).cloned().unwrap_or_else(|| json!({}));
        let data_dir = h.state::<App>().data_dir.clone();
        let manifest = match read_manifest(&data_dir, slug) {
            Ok(m) => m,
            Err(e) => return Ok(json!({ "ok": false, "error": e })),
        };
        let cur = read_state(&data_dir, slug, &manifest);
        let now_ms = chrono::Utc::now().timestamp_millis();
        match apply_action(&manifest, &cur, action_name, &payload, now_ms)
            .and_then(|next| write_state(&data_dir, slug, &next).map(|_| next))
        {
            Ok(next) => Ok(json!({
                "ok": true,
                "state": next,
                "effect": action_effect(&manifest, action_name),
            })),
            Err(e) => Ok(json!({ "ok": false, "error": e })),
        }
    }));

    let h = app.clone();
    reg.add("custommod.resetState", Box::new(move |_, a| {
        let slug = a.first().and_then(Value::as_str).unwrap_or("").trim();
        let data_dir = h.state::<App>().data_dir.clone();
        let manifest = match read_manifest(&data_dir, slug) {
            Ok(m) => m,
            Err(e) => return Ok(json!({ "ok": false, "error": e })),
        };
        let init = manifest.get("initialState").cloned().unwrap_or_else(|| json!({}));
        match write_state(&data_dir, slug, &init) {
            Ok(()) => {
                emit_changed(&h, slug, "stateReset");
                Ok(json!({ "ok": true, "state": init }))
            }
            Err(e) => Ok(json!({ "ok": false, "error": e })),
        }
    }));

    let h = app.clone();
    reg.add("custommod.configSet", Box::new(move |_, a| {
        let slug = a.first().and_then(Value::as_str).unwrap_or("").trim();
        let patch = a.get(1).cloned().unwrap_or_else(|| json!({}));
        let secrets_patch = a.get(2).cloned().unwrap_or_else(|| json!({}));
        let data_dir = h.state::<App>().data_dir.clone();
        let manifest = match read_manifest(&data_dir, slug) {
            Ok(m) => m,
            Err(e) => return Ok(json!({ "ok": false, "error": e })),
        };
        let cfg = match write_config(&data_dir, slug, &manifest, &patch) {
            Ok(c) => c,
            Err(e) => return Ok(json!({ "ok": false, "error": e })),
        };
        let allowed_secrets = secret_field_keys(&manifest);
        if let Some(sp) = secrets_patch.as_object() {
            let mut all = all_secrets(&h);
            let mut mod_secs = all
                .get(slug)
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_default();
            let mut changed = false;
            for (k, v) in sp {
                if !allowed_secrets.contains(k) {
                    continue;
                }
                if let Some(s) = v.as_str() {
                    let trimmed = s.trim();
                    if trimmed.is_empty() {
                        mod_secs.remove(k);
                    } else {
                        mod_secs.insert(k.clone(), Value::from(trimmed));
                    }
                    changed = true;
                }
            }
            if changed {
                if mod_secs.is_empty() {
                    all.remove(slug);
                } else {
                    all.insert(slug.to_string(), Value::Object(mod_secs));
                }
                save_all_secrets(&h, &all);
            }
        }
        clear_cache(&h, slug);
        emit_changed(&h, slug, "config");
        Ok(json!({
            "ok": true,
            "config": cfg,
            "secretKeysConfigured": configured_secret_keys(&h, slug, &manifest),
        }))
    }));

    let h = app.clone();
    reg.add("custommod.approveDomains", Box::new(move |_, a| {
        let slug = a.first().and_then(Value::as_str).unwrap_or("").trim();
        let want: Vec<String> = a
            .get(1)
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(|s| s.trim().to_ascii_lowercase())
            .collect();
        let data_dir = h.state::<App>().data_dir.clone();
        let manifest = match read_manifest(&data_dir, slug) {
            Ok(m) => m,
            Err(e) => return Ok(json!({ "ok": false, "error": e })),
        };
        let declared = manifest_domains(&manifest);
        let filtered: Vec<String> = want
            .into_iter()
            .filter(|d| declared.iter().any(|decl| decl.eq_ignore_ascii_case(d)))
            .collect();
        save_approved_domains(&h, slug, filtered.clone());
        clear_cache(&h, slug);
        emit_changed(&h, slug, "permissions");
        Ok(json!({ "ok": true, "approvedDomains": filtered }))
    }));

    let h = app.clone();
    reg.add("custommod.delete", Box::new(move |_, a| {
        let slug = a.first().and_then(Value::as_str).unwrap_or("").trim();
        match delete_full(&h, slug) {
            Ok(()) => Ok(json!({ "ok": true })),
            Err(e) => Ok(json!({ "ok": false, "error": e })),
        }
    }));

    let h = app.clone();
    reg.add("custommod.openCreator", Box::new(move |_, a| {
        let prompt = a.first().and_then(Value::as_str).unwrap_or("").to_string();
        crate::floating_chat::open(&h);
        let h2 = h.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(220));
            let _ = h2.emit("pony:creator", json!({ "prompt": prompt }));
        });
        Ok(json!({ "ok": true }))
    }));

    let h = app.clone();
    reg.add("custommod.openInNotch", Box::new(move |_, a| {
        let slug = a.first().and_then(Value::as_str).unwrap_or("").trim();
        if let Err(e) = validate_slug(slug) {
            return Ok(json!({ "ok": false, "error": e }));
        }
        crate::floating_chat::open_notch_module(&h, &custom_id(slug));
        Ok(json!({ "ok": true }))
    }));

    let h = app.clone();
    reg.add("custommod.export", Box::new(move |_, a| {
        let slug = a.first().and_then(Value::as_str).unwrap_or("").trim();
        let data_dir = h.state::<App>().data_dir.clone();
        match read_manifest(&data_dir, slug) {
            Ok(m) => Ok(json!({ "ok": true, "bundle": export_bundle(&m) })),
            Err(e) => Ok(json!({ "ok": false, "error": e })),
        }
    }));

    let h = app.clone();
    reg.add("custommod.import", Box::new(move |_, a| {
        let raw = a.first().cloned().unwrap_or(Value::Null);
        let replace = a.get(1).and_then(Value::as_bool).unwrap_or(false);
        let data_dir = h.state::<App>().data_dir.clone();
        match import_bundle(&data_dir, &raw, replace) {
            Ok(saved) => {
                let slug = saved["slug"].as_str().unwrap_or("").to_string();
                // Security invariant: NEVER auto-approve outbound HTTP domains on import!
                save_approved_domains(&h, &slug, vec![]);
                clear_cache(&h, &slug);
                ensure_in_settings_modules(&h, &slug, true);
                emit_changed(&h, &slug, "imported");
                Ok(json!({
                    "ok": true,
                    "slug": slug,
                    "id": custom_id(&slug),
                    "requiresDomainApproval": manifest_domains(&saved),
                }))
            }
            Err(e) => Ok(json!({ "ok": false, "error": e })),
        }
    }));

    let h = app.clone();
    reg.add("custommod.pinPill", Box::new(move |_, a| {
        let slug = a.first().and_then(Value::as_str).unwrap_or("").trim().to_string();
        if !slug.is_empty() {
            if let Err(e) = validate_slug(&slug) {
                return Ok(json!({ "ok": false, "error": e }));
            }
        }
        apply_settings_patch(&h, json!({ PINNED_PILL_KEY: slug }));
        emit_changed(&h, &slug, "pin");
        Ok(json!({ "ok": true, "pinnedPill": slug }))
    }));

    reg.add("custommod.templates", Box::new(move |_, _| {
        Ok(json!({ "ok": true, "templates": starter_templates() }))
    }));

    let h = app.clone();
    reg.add("custommod.installTemplate", Box::new(move |_, a| {
        let want = a.first().and_then(Value::as_str).unwrap_or("").trim();
        let Some(tpl) = starter_templates()
            .into_iter()
            .find(|m| m["slug"].as_str() == Some(want))
        else {
            return Ok(json!({ "ok": false, "error": format!("Unknown template '{want}'") }));
        };
        let data_dir = h.state::<App>().data_dir.clone();
        match save_manifest(&data_dir, &tpl, true) {
            Ok(saved) => {
                let slug = saved["slug"].as_str().unwrap_or("").to_string();
                // Never auto-approve outbound HTTP domains silently; local-only templates have 0 domains.
                clear_cache(&h, &slug);
                ensure_in_settings_modules(&h, &slug, true);
                emit_changed(&h, &slug, "created");
                Ok(json!({ "ok": true, "slug": slug, "id": custom_id(&slug) }))
            }
            Err(e) => Ok(json!({ "ok": false, "error": e })),
        }
    }));
}

/// Rust-side Pony MCP tool dispatcher for Custom Modules (`cm_list`, `cm_read`, `cm_preview`, `cm_save`, `cm_delete`).
pub(crate) fn handle_pony_tool(app: &AppHandle, session: &str, kind: &str, args: &str) -> Option<Value> {
    let data_dir = app.state::<App>().data_dir.clone();
    match kind {
        "cm_list" => {
            let list: Vec<Value> = list_manifests(&data_dir)
                .into_iter()
                .map(|m| {
                    let slug = m["slug"].as_str().unwrap_or("");
                    json!({
                        "slug": slug,
                        "id": custom_id(slug),
                        "name": m["name"],
                        "description": m["description"],
                        "defaultSize": m["defaultSize"],
                        "httpDomains": manifest_domains(&m),
                        "approvedDomains": approved_domains(app, slug),
                    })
                })
                .collect();
            Some(json!({ "ok": true, "text": serde_json::to_string_pretty(&list).unwrap_or_else(|_| "[]".into()) }))
        }
        "cm_read" => {
            let Ok(v) = serde_json::from_str::<Value>(args) else {
                return Some(json!({ "ok": false, "error": "invalid read_custom_module arguments" }));
            };
            let slug = v["slug"].as_str().unwrap_or("").trim();
            match read_manifest(&data_dir, slug) {
                Ok(m) => {
                    let out = json!({
                        "manifest": m,
                        "config": read_config(&data_dir, slug, &m),
                        "secretKeysConfigured": configured_secret_keys(app, slug, &m),
                        "approvedDomains": approved_domains(app, slug),
                    });
                    Some(json!({ "ok": true, "text": serde_json::to_string_pretty(&out).unwrap_or_default() }))
                }
                Err(e) => Some(json!({ "ok": false, "error": e })),
            }
        }
        "cm_preview" => {
            let Ok(v) = serde_json::from_str::<Value>(args) else {
                return Some(json!({ "ok": false, "error": "invalid preview_custom_module arguments" }));
            };
            let manifest_raw = v.get("manifest").unwrap_or(&Value::Null);
            let dry_run = v["dryRun"].as_bool().unwrap_or(false);
            let manifest = match validate_manifest(manifest_raw) {
                Ok(m) => m,
                Err(e) => return Some(json!({ "ok": false, "error": format!("Validation error: {e}") })),
            };
            let slug = manifest["slug"].as_str().unwrap_or("");
            let declared = manifest_domains(&manifest);
            let approved = approved_domains(app, slug);
            let missing = missing_domains(&manifest, &approved);
            let mut sample = Map::new();
            if dry_run && !declared.is_empty() && missing.is_empty() {
                app.state::<crate::mcp::Mcp>().mark_tainted(session);
                let cfg = read_config(&data_dir, slug, &manifest);
                let secs = module_secrets(app, slug);
                for ds in manifest["dataSources"].as_array().into_iter().flatten() {
                    let Some(id) = ds["id"].as_str() else { continue };
                    match fetch_data_source(ds, &approved, &cfg, &secs) {
                        Ok(d) => {
                            let s: String = d.to_string().chars().take(600).collect();
                            sample.insert(id.to_string(), Value::from(s));
                        }
                        Err(e) => {
                            sample.insert(id.to_string(), Value::from(format!("ERR: {e}")));
                        }
                    }
                }
            }
            let summary = json!({
                "valid": true,
                "slug": slug,
                "id": custom_id(slug),
                "name": manifest["name"],
                "defaultSize": manifest["defaultSize"],
                "exists": read_manifest(&data_dir, slug).is_ok(),
                "httpDomains": declared,
                "needsDomainApproval": missing,
                "dryRunSample": sample,
            });
            let _ = app.emit(
                "custommod:preview",
                json!({
                    "session": session,
                    "manifest": manifest,
                    "missingDomains": missing,
                }),
            );
            Some(json!({ "ok": true, "text": serde_json::to_string_pretty(&summary).unwrap_or_default() }))
        }
        "cm_save" => {
            let Ok(v) = serde_json::from_str::<Value>(args) else {
                return Some(json!({ "ok": false, "error": "invalid save_custom_module arguments" }));
            };
            let manifest_raw = v.get("manifest").unwrap_or(&Value::Null);
            let replace = v["replace"].as_bool().unwrap_or(false);
            let manifest = match validate_manifest(manifest_raw) {
                Ok(m) => m,
                Err(e) => return Some(json!({ "ok": false, "error": format!("Validation error: {e}") })),
            };
            let slug = manifest["slug"].as_str().unwrap_or("").to_string();
            let existed = read_manifest(&data_dir, &slug).is_ok();
            if existed && !replace {
                return Some(json!({
                    "ok": false,
                    "error": format!("Custom module '{slug}' already exists. Ask the user to confirm overwriting it, then pass replace: true.")
                }));
            }
            let declared = manifest_domains(&manifest);
            let existing_approved = approved_domains(app, &slug);
            let newly_needed = missing_domains(&manifest, &existing_approved);
            let tainted = app.state::<crate::mcp::Mcp>().is_tainted(session);

            // Real interactive approval card whenever new outbound HTTPS domains are requested OR the turn is tainted.
            if !newly_needed.is_empty() || tainted {
                let mut detail = format!(
                    "{} custom module “{}” (`custom:{slug}`, {})\n{}",
                    if existed { "Update" } else { "Install" },
                    manifest["name"].as_str().unwrap_or(&slug),
                    manifest["defaultSize"].as_str().unwrap_or("2x1"),
                    manifest["description"].as_str().unwrap_or(""),
                );
                if !newly_needed.is_empty() {
                    detail.push_str(&format!("\n\nAllow HTTPS access to: {}", newly_needed.join(", ")));
                }
                if crate::exec::approve(
                    app,
                    session,
                    json!({
                        "tool": "save_custom_module",
                        "detail": detail,
                        "manifest": manifest,
                        "canAlways": false,
                    }),
                ) == "deny"
                {
                    return Some(json!({ "ok": false, "error": "The user declined installing this custom module." }));
                }
            }

            let saved = match save_manifest(&data_dir, &manifest, replace) {
                Ok(m) => m,
                Err(e) => return Some(json!({ "ok": false, "error": e })),
            };
            // Persist approved domains (intersection with declared manifest domains)
            save_approved_domains(app, &slug, declared.clone());
            clear_cache(app, &slug);
            ensure_in_settings_modules(app, &slug, true);
            emit_changed(app, &slug, if existed { "updated" } else { "created" });

            Some(json!({
                "ok": true,
                "text": format!(
                    "Installed custom module '{}' (id: {}, size: {}, domains: [{}]). It is now live in the Notch carousel and Settings → Modules.",
                    saved["name"].as_str().unwrap_or(&slug),
                    custom_id(&slug),
                    saved["defaultSize"].as_str().unwrap_or("2x1"),
                    declared.join(", "),
                )
            }))
        }
        "cm_delete" => {
            let Ok(v) = serde_json::from_str::<Value>(args) else {
                return Some(json!({ "ok": false, "error": "invalid delete_custom_module arguments" }));
            };
            let slug = v["slug"].as_str().unwrap_or("").trim();
            if let Err(e) = validate_slug(slug) {
                return Some(json!({ "ok": false, "error": e }));
            }
            let name = read_manifest(&data_dir, slug)
                .ok()
                .and_then(|m| m["name"].as_str().map(String::from))
                .unwrap_or_else(|| slug.to_string());
            if crate::exec::approve(
                app,
                session,
                json!({
                    "tool": "delete_custom_module",
                    "detail": format!("Delete custom module “{name}” (`custom:{slug}`)?"),
                    "canAlways": false,
                }),
            ) == "deny"
            {
                return Some(json!({ "ok": false, "error": "The user declined deleting this custom module." }));
            }
            match delete_full(app, slug) {
                Ok(()) => Some(json!({ "ok": true, "text": format!("Deleted custom module '{slug}'") })),
                Err(e) => Some(json!({ "ok": false, "error": e })),
            }
        }
        _ => None,
    }
}
