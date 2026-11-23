//! What Sympony's "open" and "show in folder" do: `cargo run -p platform --example shell -- open|reveal <path or link>`.
fn main() {
    let a: Vec<String> = std::env::args().skip(1).collect();
    let verb = a.first().map(String::as_str).unwrap_or("open");
    let target = a.get(1).cloned().unwrap_or_default();
    let ok = match verb {
        "reveal" => platform::os::shell::reveal(&target),
        _ => platform::os::shell::open(&target),
    };
    println!("{verb} {target}: {ok}");
}
