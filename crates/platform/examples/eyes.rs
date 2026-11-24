//! A window as Pony's Eyes reads it: `cargo run -p platform --example eyes -- <app name, id or pid> [lines]` prints
//! how many elements of each role the app's window has, then the first lines (role, label, value). Reads only.
use std::collections::BTreeMap;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let query = args.first().expect("eyes <app name, id or pid> [lines]");
    let lines: usize = args.get(1).and_then(|n| n.parse().ok()).unwrap_or(25);
    let me = std::process::id() as i32;
    let pid = query.parse::<i32>().ok().or_else(|| platform::ax::find_running_app(query, me).map(|(p, _, _)| p)).expect("no such app with a window");
    let win = platform::ax::window(pid).expect("the app has no window");
    let t0 = std::time::Instant::now();
    let (nodes, els) = platform::ax::read(&win, 6000);
    println!("{} elements ({} kept) in {} ms; window {:?}", nodes.len(), els.len(), t0.elapsed().as_millis(), win.frame());
    let mut roles: BTreeMap<String, usize> = BTreeMap::new();
    for n in &nodes {
        *roles.entry(format!("{} {}", n.role, n.subrole).trim().to_string()).or_default() += 1;
    }
    println!("{roles:?}");
    let short = |s: &str| s.chars().take(50).collect::<String>();
    for n in nodes.iter().take(lines) {
        println!("{}{} {:?} = {:?}{}{}", "  ".repeat(n.depth.min(8) as usize), n.role, short(&n.label), short(&n.value), if n.focused { " (focused)" } else { "" }, if n.url.is_empty() { String::new() } else { format!(" <{}>", n.url) });
    }
}
