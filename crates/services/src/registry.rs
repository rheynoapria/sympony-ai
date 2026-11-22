use contract::Kind;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

/// What a handler gets: where data lives, how to send an event to the windows, how to log.
#[derive(Clone)]
pub struct Ctx {
    pub data_dir: PathBuf,
    pub emit: Arc<dyn Fn(&str, Value) + Send + Sync>,
    pub log: Arc<dyn Fn(&str) + Send + Sync>,
    /// a service changed settings (the patch): the app sends `settings` and does what follows (refreshes…)
    pub changed: Arc<dyn Fn(&Value) + Send + Sync>,
}

pub type Handler = Box<dyn Fn(&Ctx, Vec<Value>) -> anyhow::Result<Value> + Send + Sync>;

/// The service methods ("svc.method") that are built; everything else answers its contract stub.
#[derive(Default)]
pub struct Registry {
    handlers: HashMap<String, Handler>,
    warned: Mutex<HashSet<String>>,
}

impl Registry {
    pub fn add(&mut self, name: &'static str, h: Handler) {
        self.handlers.insert(name.to_string(), h);
    }

    pub fn names(&self) -> Vec<String> {
        self.handlers.keys().cloned().collect()
    }

    pub fn call(&self, ctx: &Ctx, name: &str, args: Vec<Value>) -> Value {
        match self.handlers.get(name) {
            Some(h) => h(ctx, args).unwrap_or_else(|e| {
                (ctx.log)(&format!("{name} failed: {e:#}"));
                stub(Kind::Method, name)
            }),
            None => {
                not_implemented(&self.warned, ctx, name);
                stub(Kind::Method, name)
            }
        }
    }
}

/// The contract's "nothing here" answer (null for names the contract doesn't know).
pub fn stub(kind: Kind, name: &str) -> Value {
    contract::find(kind, name).map(|i| i.stub.clone()).unwrap_or(Value::Null)
}

/// Logs `not implemented: <name>` once per process (per `warned` set).
pub fn not_implemented(warned: &Mutex<HashSet<String>>, ctx: &Ctx, name: &str) {
    if warned.lock().unwrap().insert(name.to_string()) {
        (ctx.log)(&format!("not implemented: {name}"));
    }
}
