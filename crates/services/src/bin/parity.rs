//! How far Sympony is: per phase and class, built/total; then what's open in the lowest unfinished phase.
use contract::{items, Class, Kind};
use std::collections::{BTreeMap, HashSet};

fn main() {
    struct NoSecrets;
    impl platform::Secrets for NoSecrets {
        fn get(&self, _: &str) -> Option<String> { None }
        fn set(&self, _: &str, _: &str) -> anyhow::Result<()> { Ok(()) }
    }
    let scratch = std::env::temp_dir().join("sympony-parity");
    let _ = std::fs::create_dir_all(&scratch);
    struct Nowhere;
    impl platform::location::Locator for Nowhere {
        fn locate(&self, _: std::time::Duration) -> Result<platform::location::Fix, platform::location::LocError> { Err(platform::location::LocError::Off) }
        fn place(&self, _: &platform::location::Fix) -> Option<serde_json::Value> { None }
    }
    let deps = services::Deps::new(&scratch, std::sync::Arc::new(NoSecrets), std::sync::Arc::new(Nowhere));
    let done: HashSet<String> = services::implemented(&services::build(&deps)).into_iter().collect();
    let mut table: BTreeMap<(u8, &str), (usize, usize)> = BTreeMap::new();
    for i in items() {
        let class = match i.class { Class::Mac => "mac", Class::Fix => "fix", Class::Excluded => "excluded" };
        let e = table.entry((i.phase, class)).or_default();
        e.1 += 1;
        if done.contains(&i.name) { e.0 += 1; }
    }
    let (mut d, mut t) = (0, 0);
    println!("phase  class     built/total");
    for ((p, c), (b, n)) in &table {
        println!("{p:>5}  {c:<8}  {b:>4}/{n}");
        if *c != "excluded" { d += b; t += n; }
    }
    println!("total (mac + fix): {d}/{t} ({}%)", if t == 0 { 0 } else { d * 100 / t });
    let done = &done;
    let open = |p: u8| items().iter().filter(move |i| i.phase == p && i.class != Class::Excluded && !done.contains(&i.name));
    if let Some(p) = (0..=9).find(|p| open(*p).next().is_some()) {
        let kind = |k: Kind| match k { Kind::Command => "command", Kind::Method => "method", Kind::Event => "event" };
        println!("\nopen in phase {p}:");
        for i in open(p) { println!("  {:<8} {}", kind(i.kind), i.name); }
    }
}
