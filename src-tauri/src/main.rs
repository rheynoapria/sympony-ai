#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // (started by an AI agent as Sympony's MCP server: a small bridge to the running app, no window)
    // (an AI agent's hook: the card under the notch, and its answer back)
    let args: Vec<String> = std::env::args().collect();
    if let Some(i) = args.iter().position(|a| a == "--hook") {
        sympony_lib::hook_bridge(args.get(i + 1).map(String::as_str).unwrap_or(""), args.get(i + 2).map(String::as_str).unwrap_or(""));
        return;
    }
    if std::env::args().any(|a| a == "--mcp") {
        sympony_lib::mcp_bridge();
        return;
    }
    sympony_lib::run();
}
