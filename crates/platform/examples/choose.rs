//! The OS's file dialog, as Sympony opens it: `cargo run -p platform --example choose [files|folder|app|backup|audio]`.
fn main() {
    let what = std::env::args().nth(1).unwrap_or_else(|| "files".into());
    println!("{:?}", platform::os::files::choose(&what, "Sympony: choose test"));
}
