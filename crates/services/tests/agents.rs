use serde_json::json;
use services::agents::{answer, args, needs_update, prompt, signed_in, AGENTS};

#[test]
fn args_per_agent() {
    let a = args("claude", "Hi there", "RULES", Some("opus"), false);
    // the prompt right after -p: Claude's --tools takes every word after it (it ate the prompt at the end)
    assert_eq!(a, ["-p", "Hi there", "--output-format", "json", "--system-prompt", "RULES", "--safe-mode", "--strict-mcp-config",
                   "--no-session-persistence", "--disable-slash-commands", "--model", "opus", "--tools", ""]);
    // Default model for Claude Code is explicitly pinned to sonnet
    let a = args("claude", "Hi", "R", None, true);
    assert!(a.windows(2).any(|w| w == ["--model", "sonnet"]));
    assert!(a.windows(2).any(|w| w == ["--allowedTools", "WebSearch,WebFetch"]));
    assert_eq!(&a[a.len() - 2..], ["--tools", "WebSearch,WebFetch"]);
    // no system-prompt option: the rules lead the prompt
    let a = args("codex", "Hi", "RULES", None, false);
    assert_eq!(&a[..5], ["exec", "--json", "--skip-git-repo-check", "-s", "read-only"]);
    assert!(a.last().unwrap().starts_with("RULES") && a.last().unwrap().ends_with("Hi"));
    let codex_web = args("codex", "Hi", "RULES", None, true);
    assert!(codex_web.windows(2).any(|w| w == ["-c", "web_search=\"live\""]));
    assert!(args("antigravity", "x", "", None, false).windows(2).any(|w| w == ["--mode", "plan"]));
    assert!(args("gemini", "x", "", None, false).windows(2).any(|w| w == ["--approval-mode", "plan"]));
    assert!(args("opencode", "x", "", Some("anthropic/claude-sonnet"), false).windows(2).any(|w| w == ["-m", "anthropic/claude-sonnet"]));
    assert_eq!(&args("hermes", "x", "", None, false)[..3], ["chat", "-q", "x"]);
    assert_eq!(AGENTS.len(), 8);
}

#[test]
fn message_never_becomes_an_option() {
    for a in AGENTS {
        let v = args(a.id, "--dangerously-skip-permissions", "", None, false);
        assert!(!v.iter().any(|x| x == "--dangerously-skip-permissions"), "{}: {v:?}", a.id);
    }
}

#[test]
fn answers_from_each_shape() {
    let ok = |id: &str, out: &str| answer(id, out, "", true);
    assert_eq!(ok("claude", r#"{"type":"result","is_error":false,"result":"Halo!","session_id":"s"}"#), Ok("Halo!".into()));
    let codex = [json!({"type": "thread.started", "thread_id": "t"}), json!({"type": "item.completed", "item": {"type": "agent_message", "text": "first"}}),
        json!({"type": "item.completed", "item": {"type": "agent_message", "text": "Final"}}), json!({"type": "turn.completed"})]
        .iter().map(|v| v.to_string()).collect::<Vec<_>>().join("\n");
    assert_eq!(ok("codex", &codex), Ok("Final".into()));
    let agy = format!("{}\n{}", json!({"event": "init", "conversation_id": "c"}), json!({"event": "result", "result": {"status": "SUCCESS", "response": "Done"}}));
    assert_eq!(ok("antigravity", &agy), Ok("Done".into()));
    assert_eq!(ok("gemini", "{\n  \"response\": \"Pretty\",\n  \"stats\": {}\n}"), Ok("Pretty".into()));
    let oc = [json!({"type": "step_start"}), json!({"type": "text", "part": {"text": "Hello "}}), json!({"type": "text", "part": {"text": "world"}}), json!({"type": "step_finish"})]
        .iter().map(|v| v.to_string()).collect::<Vec<_>>().join("\n");
    assert_eq!(ok("opencode", &oc), Ok("Hello world".into()));
    assert_eq!(ok("hermes", &json!({"type": "result", "exit_code": 0, "text": "Hermes says hi"}).to_string()), Ok("Hermes says hi".into()));
    // plain text out
    assert_eq!(ok("cursor", "Just text\n"), Ok("Just text".into()));
}

#[test]
fn errors_from_each_shape() {
    assert!(answer("claude", r#"{"type":"result","is_error":true,"result":"Credit balance too low"}"#, "", true).unwrap_err().contains("Credit"));
    assert!(answer("codex", &json!({"type": "turn.failed", "error": {"message": "usage limit"}}).to_string(), "", true).unwrap_err().contains("usage limit"));
    assert!(answer("antigravity", &json!({"event": "result", "result": {"status": "ERROR", "response": "authentication required"}}).to_string(), "", true).unwrap_err().contains("authentication"));
    assert_eq!(answer("gemini", "", "Error: please log in\n", false), Err("Error: please log in".into()));
    assert!(answer("cursor", "", "", true).is_err());
}

#[test]
fn prompt_has_rules_context_and_turns() {
    let msgs = vec![json!({"role": "user", "content": "Hai"}), json!({"role": "assistant", "content": "Halo"}), json!({"role": "user", "content": "Jam berapa?"})];
    let p = prompt("CTX LINES", &msgs);
    assert!(p.contains("CTX LINES"));
    let (u1, a1, u2) = (p.find("User: Hai").unwrap(), p.find("Assistant: Halo").unwrap(), p.find("User: Jam berapa?").unwrap());
    assert!(u1 < a1 && a1 < u2);
    assert!(p.trim_end().ends_with("Assistant:"));
}

#[test]
fn signed_in_from_files() {
    let d = tempfile::tempdir().unwrap();
    let h = d.path();
    assert_eq!(signed_in("claude", h), false);
    std::fs::write(h.join(".claude.json"), r#"{"oauthAccount":{"emailAddress":"x"}}"#).unwrap();
    assert!(signed_in("claude", h));
    std::fs::create_dir_all(h.join(".codex")).unwrap();
    std::fs::write(h.join(".codex/auth.json"), "{}").unwrap();
    assert!(signed_in("codex", h));
    // Cursor's config exists before any sign-in (its --help writes it): only its auth info counts
    std::fs::create_dir_all(h.join(".cursor")).unwrap();
    std::fs::write(h.join(".cursor/cli-config.json"), r#"{"version":1,"editor":{},"permissions":{}}"#).unwrap();
    assert!(!signed_in("cursor", h));
    std::fs::write(h.join(".cursor/cli-config.json"), r#"{"version":1,"authInfo":{"email":"x"}}"#).unwrap();
    assert!(signed_in("cursor", h));
    assert!(!signed_in("hermes", h));
    std::fs::create_dir_all(h.join(".hermes")).unwrap();
    std::fs::write(h.join(".hermes/auth.json"), "{}").unwrap();
    assert!(signed_in("hermes", h));
}

#[test]
fn old_codex_needs_update() {
    assert!(needs_update("codex", "0.1.2504161551"));
    assert!(!needs_update("codex", "codex-cli 0.46.0"));
    assert!(!needs_update("claude", "2.1.327 (Claude Code)"));
}

#[test]
fn lyric_lines_round_trip() {
    use services::agents::{lines_answer, lines_prompt};
    let lines = vec!["さくら".to_string(), "".to_string()];
    assert!(lines_prompt(&lines, "Romanize each line.").contains(r#"["さくら",""]"#));
    assert_eq!(lines_answer("```json\n[\"sakura\", \"\"]\n```", 2), Some(vec!["sakura".into(), "".into()]));
    assert_eq!(lines_answer("[\"one\"]", 2), None);
    assert_eq!(lines_answer("no array", 1), None);
}

#[test]
fn rules_carry_the_time() {
    assert!(services::agents::chat_rules("Thursday 19 November 2026, 08:00").contains("It is now Thursday 19 November 2026, 08:00."));
}

#[test]
fn agents_run_without_their_own_tools() {
    use services::agents::{env, supported};
    let has = |id: &str, w: &[&str]| args(id, "x", "R", None, false).windows(w.len()).any(|x| x == w);
    // Claude: no MCP servers, plugins, hooks, skills; nothing saved
    for w in [&["--safe-mode"][..], &["--strict-mcp-config"], &["--no-session-persistence"], &["--disable-slash-commands"]] {
        assert!(has("claude", w), "{w:?}");
    }
    assert!(has("codex", &["-c", "mcp_servers={}"]));
    for id in ["gemini", "qwen"] {
        assert!(has(id, &["--allowed-mcp-server-names", "__none__"]) && has(id, &["-e", "none"]), "{id}");
    }
    // Qwen 0.0.x has no --system-prompt and no -o (output format): plain text, the rules lead the prompt
    assert!(!has("qwen", &["-o"]));
    assert!(!has("qwen", &["--system-prompt"]));
    assert!(args("qwen", "x", "RULES", None, false).last().unwrap().starts_with("RULES"));
    // OpenCode: every tool off through its config
    assert!(env("opencode").iter().any(|(k, v)| *k == "OPENCODE_CONFIG_CONTENT" && v.contains("\"*\":false")));
    // Hermes and Cursor Agent have no read-only mode: listed, not used
    assert!(!supported("hermes") && !supported("cursor") && supported("claude"));
}

#[test]
fn sympony_tools_wired_per_agent() {
    use services::agents::{tools_for, with_tools};
    let env = [("SYMPONY_SOCK", "/d/agent.sock"), ("SYMPONY_TOKEN", "tok"), ("SYMPONY_SESSION", "s1")];
    let exe = "/Applications/Sympony.app/Contents/MacOS/sympony";
    // Claude: only Sympony's server, its tools allowed; the prompt still right after -p
    let w = with_tools("claude", args("claude", "Hi", "R", None, false), exe, &env);
    let i = w.args.iter().position(|a| a == "--mcp-config").unwrap();
    let cfg: serde_json::Value = serde_json::from_str(&w.args[i + 1]).unwrap();
    assert_eq!(cfg["mcpServers"]["sympony"]["command"], exe);
    assert_eq!(cfg["mcpServers"]["sympony"]["args"], json!(["--mcp"]));
    assert_eq!(cfg["mcpServers"]["sympony"]["env"]["SYMPONY_SESSION"], "s1");
    assert!(w.args.windows(2).any(|x| x == ["--allowedTools", "mcp__sympony"]));
    assert_eq!(&w.args[w.args.len() - 2..], ["--tools", ""]);
    assert!(w.args.iter().any(|a| a == "--strict-mcp-config"));
    // Claude with web search ON + tools: merges mcp__sympony with WebSearch,WebFetch and keeps variadic --tools last!
    let w_web = with_tools("claude", args("claude", "Harga emas", "R", None, true), exe, &env);
    assert!(w_web.args.windows(2).any(|x| x == ["--allowedTools", "mcp__sympony,WebSearch,WebFetch"]));
    assert_eq!(&w_web.args[w_web.args.len() - 2..], ["--tools", "WebSearch,WebFetch"]);
    assert!(w_web.args.iter().any(|a| a == "--mcp-config"));
    // --safe-mode turns MCP off altogether: with tools, no user settings at all instead (no hooks or plugins either)
    assert!(!w.args.iter().any(|a| a == "--safe-mode"));
    assert!(w.args.windows(2).any(|x| x == ["--setting-sources", ""]));
    // (and hooks off whatever settings load)
    assert!(w.args.windows(2).any(|x| x == ["--settings", r#"{"disableAllHooks":true}"#]));
    assert_eq!(&w.args[..2], ["-p", "Hi"]);
    // Gemini: its settings in the run folder, only that server allowed, the prompt last
    let w = with_tools("gemini", args("gemini", "Hi", "R", None, false), exe, &env);
    assert!(w.args.windows(2).any(|x| x == ["--allowed-mcp-server-names", "sympony"]));
    assert!(!w.args.iter().any(|a| a == "__none__"));
    assert_eq!(&w.args[w.args.len() - 2..], ["-p", "R\n\nHi"]);
    let (path, body) = &w.files[0];
    assert_eq!(path, ".gemini/settings.json");
    assert_eq!(serde_json::from_str::<serde_json::Value>(body).unwrap()["mcpServers"]["sympony"]["trust"], true);
    // OpenCode: in its inline config, only Sympony's tools on
    let w = with_tools("opencode", args("opencode", "Hi", "", None, false), exe, &env);
    let oc = w.env.iter().find(|(k, _)| *k == "OPENCODE_CONFIG_CONTENT").unwrap();
    let v: serde_json::Value = serde_json::from_str(&oc.1).unwrap();
    assert_eq!((v["tools"]["*"].clone(), v["tools"]["sympony_*"].clone()), (json!(false), json!(true)));
    assert_eq!(v["mcp"]["sympony"]["command"], json!([exe, "--mcp"]));
    // Codex: the server through -c, before the prompt
    let w = with_tools("codex", args("codex", "Hi", "", None, false), exe, &env);
    assert!(w.args.iter().any(|a| a.starts_with("mcp_servers.sympony.command=")));
    assert_eq!(w.args.last().unwrap(), "Hi");
    // who can: the others keep Sympony's [[…]] lines
    // tools only where a live run proved them (Claude Code); the rest keep the [[…]] lines until theirs pass
    // (the wiring above is ready for them)
    assert!(tools_for("claude"));
    for id in ["gemini", "qwen", "opencode", "codex", "antigravity", "cursor", "hermes"] {
        assert!(!tools_for(id), "{id}");
    }
}

#[test]
fn rules_with_tools_have_no_action_lines() {
    let with = services::agents::chat_rules_for("now", true);
    assert!(with.contains("get_context") && !with.contains("[[remind:"));
    let without = services::agents::chat_rules_for("now", false);
    assert!(without.contains("[[remind:") && !without.contains("get_context"));
}

#[test]
fn engine_rules_drop_the_cli_limits() {
    let e = services::agents::engine_rules("now");
    assert!(e.contains("get_context") && e.contains("Do only what your tools allow"));
    assert!(!e.contains("don't run shell commands") && !e.contains("no reading the screen"));
    let cli = services::agents::chat_rules_for("now", true);
    assert!(cli.contains("don't run shell commands") && cli.contains("no reading the screen"));
    let cli_web = services::agents::chat_rules_with_web("now", true, true);
    assert!(cli_web.contains("WebSearch, WebFetch") && cli_web.contains("direct summary"));
    assert!(!cli_web.contains("no opening websites yourself"));
    // Maximized Claude Code with Exec + Eyes + Web: drops NO_CODE and old CANT limits, keeps live web summary rules
    let cli_full = services::agents::chat_rules_with_caps("now", true, true, true, true);
    assert!(!cli_full.contains("don't run shell commands"));
    assert!(!cli_full.contains("no reading the screen"));
    assert!(cli_full.contains("Do only what your tools allow"));
    assert!(cli_full.contains("WebSearch and WebFetch"));
}

#[test]
fn claude_stream_args_images_and_events() {
    use services::agents::{claude_user_message, extract_web_links, with_stream, with_tools, ClaudeEvent, ClaudeStream};
    // Streaming without images keeps -p <prompt> and switches --output-format to stream-json + partial messages
    let base = with_tools("claude", args("claude", "Harga emas", "R", None, true), "/bin/sympony", &[]);
    let st = with_stream("claude", base.args.clone(), false);
    assert!(st.windows(4).any(|w| w == ["--output-format", "stream-json", "--verbose", "--include-partial-messages"]));
    assert_eq!(&st[..2], ["-p", "Harga emas"]);
    assert_eq!(&st[st.len() - 2..], ["--tools", "WebSearch,WebFetch"]);

    // Streaming with images switches -p <prompt> to -p --input-format stream-json
    let st_img = with_stream("claude", base.args, true);
    assert_eq!(&st_img[..3], ["-p", "--input-format", "stream-json"]);
    let msg: serde_json::Value = serde_json::from_str(&claude_user_message("Ada apa di foto ini?", &["data:image/jpeg;base64,QUJD".into()])).unwrap();
    assert_eq!(msg["type"], "user");
    assert_eq!(msg["message"]["content"][0]["type"], "image");
    assert_eq!(msg["message"]["content"][0]["source"]["media_type"], "image/jpeg");
    assert_eq!(msg["message"]["content"][0]["source"]["data"], "QUJD");
    assert_eq!(msg["message"]["content"][1]["text"], "Ada apa di foto ini?");

    // Link extraction from WebSearch tool_result
    let links = extract_web_links("Web search results for query: \"emas\"\n\nLinks: [{\"title\":\"Logam Mulia\",\"url\":\"https://logammulia.com\"},{\"title\":\"Kompas [Live]\",\"url\":\"https://money.kompas.com/emas\"}]");
    assert_eq!(links.len(), 2);
    assert_eq!(links[0], ("Logam Mulia".into(), "https://logammulia.com".into()));
    assert_eq!(links[1], ("Kompas [Live]".into(), "https://money.kompas.com/emas".into()));

    // Incremental stream parsing: WebSearch -> tool_result sources -> WebFetch -> text deltas -> result
    let mut parser = ClaudeStream::default();
    let e1 = parser.feed(r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tu1","name":"WebSearch","input":{"query":"harga emas Antam"}}]}}"#);
    assert_eq!(e1, vec![ClaudeEvent::Step { kind: "web", detail: "harga emas Antam".into(), taints: true }]);
    let e2 = parser.feed(r#"{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tu1","content":"Web search results\n\nLinks: [{\"title\":\"Logam Mulia\",\"url\":\"https://logammulia.com\"}]"}]}}"#);
    assert!(matches!(e2.first(), Some(ClaudeEvent::Sources { query, sources }) if query == "harga emas Antam" && sources.len() == 1));
    let e3 = parser.feed(r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tu2","name":"WebFetch","input":{"url":"https://www.logammulia.com/id/harga-emas-hari-ini"}}]}}"#);
    assert_eq!(e3, vec![ClaudeEvent::Step { kind: "page", detail: "logammulia.com".into(), taints: true }]);
    assert!(parser.feed(r#"{"type":"stream_event","event":{"type":"message_start"}}"#).is_empty());
    let d1 = parser.feed(r#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Rp2.505"}}}"#);
    let d2 = parser.feed(r#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":".000"}}}"#);
    assert_eq!(d1, vec![ClaudeEvent::Delta { round: 1, text: "Rp2.505".into() }]);
    assert_eq!(d2, vec![ClaudeEvent::Delta { round: 1, text: "Rp2.505.000".into() }]);
    parser.feed(r#"{"type":"result","is_error":false,"result":"Harga emas Antam Rp2.505.000/gram."}"#);
    assert_eq!(parser.searched, vec!["harga emas Antam"]);
    assert_eq!(parser.sources.len(), 1);
    assert_eq!(parser.finish("", true), Ok("Harga emas Antam Rp2.505.000/gram.".into()));
}

#[test]
fn exec_mcp_tools_shape() {
    let list = services::exec::mcp_tools();
    assert_eq!(list.len(), services::exec::NAMES.len());
    for (t, name) in list.iter().zip(services::exec::NAMES.iter()) {
        assert_eq!(t["name"], *name);
        assert!(t["description"].as_str().is_some_and(|s| !s.is_empty()));
        assert_eq!(t["inputSchema"]["type"], "object");
    }
}
