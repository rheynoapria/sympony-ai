//! `svc('store', 'get'|'set', name, value)`: one `<name>.json` per store in the data folder; a change goes out as
//! `store:<name>`. Restricted to known user data stores so internal files (`secrets.json`, `settings.json`, etc.)
//! cannot be read, clobbered, or renamed aside.
use crate::Ctx;
use serde_json::Value;
use std::path::PathBuf;

/// The only store names the `store` service may access.
pub const ALLOWED_STORES: &[&str] = &[
    "todo",
    "notes",
    "stopwatch",
    "bookmarks",
    "chats",
    "teleprompter",
    "radio",
    "health",
    "pomodoro",
    "timer",
    "screentime",
];

fn file(ctx: &Ctx, name: &str) -> anyhow::Result<PathBuf> {
    anyhow::ensure!(ALLOWED_STORES.contains(&name), "unknown store {name:?}");
    Ok(ctx.data_dir.join(format!("{name}.json")))
}

pub fn get(ctx: &Ctx, name: &str) -> anyhow::Result<Value> {
    let path = file(ctx, name)?;
    match std::fs::read(&path) {
        Ok(bytes) => match serde_json::from_slice(&bytes) {
            Ok(v) => Ok(v),
            // doesn't parse: kept aside (the frontend would save over it), and the store starts empty
            Err(e) => {
                let kept = crate::paths::broken_name(&path);
                std::fs::rename(&path, &kept)?;
                (ctx.log)(&format!("store {name}: unreadable ({e}), kept as {}", kept.display()));
                Ok(Value::Null)
            }
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Value::Null),
        Err(e) => Err(e.into()),
    }
}

pub fn set(ctx: &Ctx, name: &str, value: Value) -> anyhow::Result<Value> {
    let path = file(ctx, name)?;
    crate::paths::write_private(&path, &serde_json::to_vec(&value)?)?;
    (ctx.emit)(&format!("store:{name}"), value);
    Ok(Value::Bool(true))
}

/// The registry entries.
pub fn register(reg: &mut crate::Registry) {
    let name = |args: &[Value]| args.first().and_then(Value::as_str).unwrap_or_default().to_string();
    reg.add("store.get", Box::new(move |ctx, args| get(ctx, &name(&args))));
    reg.add("store.set", Box::new(move |ctx, mut args| {
        let n = name(&args);
        let v = if args.len() > 1 { args.swap_remove(1) } else { Value::Null };
        set(ctx, &n, v)
    }));
}
