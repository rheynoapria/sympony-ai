#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Windows has no HOME, and the app finds `~/.sympony`, `~/.claude`, Downloads… from it: without it those paths
    // came out relative to wherever Sympony was started. The profile folder is what HOME means there (and what Git
    // and the agent CLIs use). Set before any thread starts.
    #[cfg(windows)]
    if std::env::var_os("HOME").is_none() {
        if let Some(profile) = std::env::var_os("USERPROFILE") {
            std::env::set_var("HOME", profile);
        }
    }
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
    // (a test build's live check: a script run in one of the running app's windows, its value printed)
    #[cfg(feature = "dev-drive")]
    if let Some(i) = args.iter().position(|a| a == "--dev-eval") {
        let arg = |n: usize| args.get(i + n).map(String::as_str).unwrap_or("");
        std::process::exit(sympony_lib::dev_eval(arg(1), arg(2)));
    }
    sympony_lib::run();
}
