//! Ask other AIs: Pony
//! types a prompt into Claude, ChatGPT or Gemini in the user's own browser and profile (or the Claude app), follows the
//! answer and brings it back. Pure: the recipes, which browser and profile, and when an answer is done. The window is
//! driven by `platform::macos::ax` (Accessibility + real keys; no Developer settings in the browser).
use platform::ax::Node;
use serde_json::{json, Value};

pub const NAMES: [&str; 1] = ["ask_ai"];

pub struct Site {
    pub id: &'static str,
    pub name: &'static str,
    /// where a new chat starts
    pub url: &'static str,
    pub host: &'static str,
    /// the app instead of a browser (the Claude app)
    pub app: Option<&'static str>,
    /// DOM classes (or id) of the composer, then of an answer
    pub composer: &'static [&'static str],
    pub answer: &'static [&'static str],
}

pub const SITES: [Site; 4] = [
    Site { id: "claude", name: "Claude", url: "https://claude.ai/new", host: "claude.ai", app: None, composer: &["ProseMirror", "tiptap"], answer: &["font-claude-response", "standard-markdown"] },
    Site { id: "chatgpt", name: "ChatGPT", url: "https://chatgpt.com/", host: "chatgpt.com", app: None, composer: &["ProseMirror", "prompt-textarea"], answer: &["markdown"] },
    Site { id: "gemini", name: "Gemini", url: "https://gemini.google.com/app", host: "gemini.google.com", app: None, composer: &["ql-editor"], answer: &["markdown-main-panel", "markdown"] },
    Site { id: "claude_app", name: "Claude (app)", url: "claude://claude.ai/new", host: "claude.ai", app: Some("com.anthropic.claudefordesktop"), composer: &["ProseMirror", "tiptap"], answer: &["font-claude-response", "standard-markdown"] },
];

pub fn site(id: &str) -> Option<&'static Site> {
    SITES.iter().find(|s| s.id == id)
}

pub const RULES: &str = "Other AIs: ask_ai(ai, prompt) types the prompt into Claude, ChatGPT or Gemini in the user's own browser (or the Claude app) and \
brings the answer back later as a message in this chat; use it only when the user asks you to ask one of them. Write the prompt complete and self-contained. \
agent_status(id) reads its answer so far, agent_send(id, message) continues that conversation, agent_stop(id) stops it.";

pub fn tools() -> Vec<Value> {
    vec![json!({"name": "ask_ai", "description": "Asks another AI (Claude, ChatGPT, Gemini, or the Claude app) in the user's own account: Pony types the prompt there and the answer comes back as a message in this chat (Sympony asks the user first).",
        "inputSchema": {"type": "object", "properties": {
            "ai": {"type": "string", "enum": SITES.iter().map(|s| s.id).collect::<Vec<_>>()},
            "prompt": {"type": "string", "description": "the complete prompt to send, in the language the user wants"}}, "required": ["ai", "prompt"]}})]
}

pub fn functions() -> Vec<Value> {
    tools().into_iter().map(|t| json!({"type": "function", "function": {"name": t["name"], "description": t["description"], "parameters": t["inputSchema"]}})).collect()
}

/// A page that wants a sign-in first: nothing is typed there.
pub fn needs_login(url: &str) -> bool {
    let u = url.to_lowercase();
    ["/login", "/signin", "/sign-in", "/auth", "accounts.google.com", "/log-in"].iter().any(|k| u.contains(k))
}

/// The site's page in the window: the range of nodes under its web area (the browser's own address bar and
/// buttons are outside it). The whole window when there's no web area.
pub fn page(nodes: &[Node], host: &str) -> std::ops::Range<usize> {
    let Some(i) = nodes.iter().position(|n| n.role == "AXWebArea" && n.url.contains(host)) else { return 0..nodes.len() };
    let d = nodes[i].depth;
    i..nodes[i + 1..].iter().position(|n| n.depth <= d).map(|p| i + 1 + p).unwrap_or(nodes.len())
}

fn is_editor(n: &Node) -> bool {
    matches!(n.role.as_str(), "AXTextArea" | "AXTextField") && n.subrole != "AXSearchField" && n.subrole != "AXSecureTextField" && n.frame.2 >= 40.0 && n.frame.3 >= 14.0
}

/// The composer: a visible editor with the site's class, else the biggest visible editor (a 1x0 clipboard helper is
/// not one).
pub fn composer(nodes: &[Node], site: &Site) -> Option<usize> {
    let eds: Vec<usize> = page(nodes, site.host).filter(|&i| is_editor(&nodes[i])).collect();
    eds.iter().copied().find(|&i| nodes[i].classes.iter().any(|c| site.composer.contains(&c.as_str())))
        .or_else(|| eds.into_iter().max_by(|&a, &b| (nodes[a].frame.2 * nodes[a].frame.3).total_cmp(&(nodes[b].frame.2 * nodes[b].frame.3))))
}

/// Whether the AI is still writing: a stop button shows (in English or Indonesian).
pub fn answering(nodes: &[Node], site: &Site) -> bool {
    nodes[page(nodes, site.host)].iter().any(|n| (n.role == "AXStaticText" && thinking(&n.value)) || n.role == "AXButton" && {
        let l = n.label.to_lowercase();
        l.starts_with("stop") || l.contains("stop response") || l.contains("stop generating") || l.starts_with("hentikan") || l.starts_with("berhenti")
    })
}

fn texts(nodes: &[Node]) -> Vec<&str> {
    let mut out: Vec<&str> = vec![];
    for n in nodes {
        if n.role == "AXStaticText" && !n.value.trim().is_empty() && out.last() != Some(&n.value.as_str()) {
            out.push(&n.value);
        }
    }
    out
}

/// The last answer: the text under the last element with the site's answer class; without one, what follows the
/// prompt on the page.
pub fn answer(nodes: &[Node], site: &Site, prompt: &str) -> String {
    // (the conversation comes before the chat box in reading order; the model picker and notes after it don't count)
    let r = page(nodes, site.host);
    let end = composer(nodes, site).filter(|&c| c > r.start).unwrap_or(r.end);
    let nodes = &nodes[r.start..end];
    if let Some(i) = nodes.iter().rposition(|n| n.classes.iter().any(|c| site.answer.contains(&c.as_str()))) {
        let d = nodes[i].depth;
        let end = nodes[i + 1..].iter().position(|n| n.depth <= d).map(|p| i + 1 + p).unwrap_or(nodes.len());
        let t = texts(&nodes[i + 1..end]).join("\n");
        if !t.trim().is_empty() {
            return t;
        }
    }
    let all = texts(nodes).join("\n");
    let p = prompt.trim();
    match all.rfind(p) {
        Some(at) if !p.is_empty() => all[at + p.len()..].lines().filter(|l| !chrome(l)).collect::<Vec<_>>().join("\n").trim().to_string(),
        _ => String::new(),
    }
}

/// A reasoning model's "Thinking" while it hasn't answered yet.
fn thinking(line: &str) -> bool {
    matches!(line.trim().to_lowercase().as_str(), "thinking" | "thinking…" | "thinking..." | "sedang berpikir" | "berpikir…")
}

/// A line of the site around an answer, not the answer ("ChatGPT said:", "… can make mistakes", a survey).
fn chrome(line: &str) -> bool {
    let l = line.trim().to_lowercase();
    (l.ends_with(" said:") && l.len() < 30)
        || l.contains("can make mistakes")
        || l.contains("dapat membuat kesalahan")
        || l.contains("bisa membuat kesalahan")
        || l.starts_with("do you like this personality")
        || l.starts_with("please double-check")
        || l.contains(" responded: ")
        || l.contains("finished the response")
        || thinking(&l)
        || matches!(l.as_str(), "just now" | "baru saja" | "latest response" | "respons terbaru")
}

/// Following an answer, one look every ~1.5 s: done once the stop button is gone and the answer stayed the same for
/// two looks (after one stop button was seen, or after 8 s for answers too quick to show one).
#[derive(Default)]
pub struct Follow {
    last: String,
    same: u8,
    saw_stop: bool,
}

impl Follow {
    pub fn look(&mut self, writing: bool, text: &str, secs: f32) -> bool {
        if writing {
            self.saw_stop = true;
            self.same = 0;
        } else if !text.trim().is_empty() && text == self.last {
            self.same += 1;
        } else {
            self.same = 0;
        }
        self.last = text.to_string();
        self.same >= 2 && (self.saw_stop || secs > 8.0)
    }
}

/// Browsers Pony can use: bundle id, name, and (Chromium) its folder in ~/Library/Application Support.
pub const BROWSERS: [(&str, &str, Option<&str>); 8] = [
    ("com.google.Chrome", "Google Chrome", Some("Google/Chrome")),
    ("com.brave.Browser", "Brave", Some("BraveSoftware/Brave-Browser")),
    ("com.microsoft.edgemac", "Microsoft Edge", Some("Microsoft Edge")),
    ("company.thebrowser.Browser", "Arc", Some("Arc/User Data")),
    ("com.vivaldi.Vivaldi", "Vivaldi", Some("Vivaldi")),
    ("com.operasoftware.Opera", "Opera", Some("com.operasoftware.Opera")),
    ("com.google.Chrome.beta", "Chrome Beta", Some("Google/Chrome Beta")),
    ("com.apple.Safari", "Safari", None),
];

pub fn browser(bundle: &str) -> Option<(&'static str, &'static str, Option<&'static str>)> {
    BROWSERS.iter().copied().find(|b| b.0 == bundle)
}

/// A Chromium browser's profiles from its `Local State`: `[{dir, name, account}]`, and the last used one's folder.
pub fn profiles(local_state: &Value) -> (Vec<Value>, String) {
    let cache = local_state["profile"]["info_cache"].as_object();
    let mut list: Vec<Value> = cache.into_iter().flatten().map(|(dir, p)| json!({"dir": dir, "name": p["name"].as_str().unwrap_or(dir), "account": p["user_name"].as_str().unwrap_or("")})).collect();
    list.sort_by_key(|p| (p["dir"] != "Default", p["name"].as_str().unwrap_or("").to_lowercase()));
    let last = local_state["profile"]["last_used"].as_str().unwrap_or("Default").to_string();
    (list, last)
}

/// A Chromium browser's arguments for a new window on `url` in that profile (the same flags on every OS).
pub fn browser_args(profile: &str, url: &str) -> Vec<String> {
    let mut a = vec![];
    if !profile.is_empty() {
        a.push(format!("--profile-directory={profile}"));
    }
    a.extend(["--new-window".into(), url.into()]);
    a
}

/// The site's Send button (in the page, by its name in English or Indonesian).
pub fn send_button(nodes: &[Node], site: &Site) -> Option<usize> {
    page(nodes, site.host).find(|&i| {
        let n = &nodes[i];
        let l = n.label.to_lowercase();
        n.role == "AXButton" && n.enabled && (l.starts_with("send") || l.starts_with("kirim") || l == "submit")
    })
}

/// Whether the prompt went: the chat box no longer holds it and it shows in the conversation (an editor that
/// ignored a value set from outside still shows the text in its box, and nothing went).
pub fn sent(nodes: &[Node], site: &Site, prompt: &str) -> bool {
    let head: String = prompt.trim().chars().take(30).collect();
    let Some(c) = composer(nodes, site) else { return false };
    let d = nodes[c].depth;
    let box_end = nodes[c + 1..].iter().position(|n| n.depth <= d).map(|p| c + 1 + p).unwrap_or(nodes.len());
    let in_box = nodes[c].value.contains(&head) || nodes[c + 1..box_end].iter().any(|n| n.value.contains(&head));
    !in_box && page(nodes, site.host).any(|i| (i < c || i >= box_end) && nodes[i].role == "AXStaticText" && nodes[i].value.contains(&head))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn n(depth: u16, role: &str, label: &str, value: &str, classes: &[&str], frame: (f64, f64, f64, f64)) -> Node {
        Node { depth, role: role.into(), label: label.into(), value: value.into(), enabled: true, frame, classes: classes.iter().map(|c| c.to_string()).collect(), ..Default::default() }
    }

    #[test]
    fn composer_is_the_visible_editor_not_a_hidden_helper() {
        let g = site("gemini").unwrap();
        let nodes = vec![
            n(0, "AXWebArea", "", "", &[], (0.0, 0.0, 900.0, 800.0)),
            n(3, "AXTextArea", "Search", "", &[], (10.0, 10.0, 200.0, 20.0)),
            n(5, "AXTextArea", "Masukkan perintah", "", &["ql-editor", "textarea"], (300.0, 600.0, 440.0, 24.0)),
            n(5, "AXTextArea", "", "", &["ql-clipboard"], (300.0, 620.0, 1.0, 0.0)),
        ];
        assert_eq!(composer(&nodes, g), Some(2));
        let plain = vec![nodes[0].clone(), nodes[3].clone(), n(2, "AXTextArea", "", "", &[], (0.0, 0.0, 500.0, 40.0)), nodes[1].clone()];
        assert_eq!(composer(&plain, g), Some(2));
        // (the browser's address bar is outside the page: never the composer)
        let mut area = n(1, "AXWebArea", "", "", &[], (0.0, 80.0, 900.0, 700.0));
        area.url = "https://gemini.google.com/app".into();
        let browser = vec![
            n(0, "AXWindow", "", "", &[], (0.0, 0.0, 900.0, 800.0)),
            n(2, "AXTextField", "Address", "", &["OmniboxViewViews"], (0.0, 40.0, 800.0, 30.0)),
            area,
            n(3, "AXTextArea", "", "", &["ql-editor"], (300.0, 600.0, 440.0, 24.0)),
        ];
        assert_eq!(composer(&browser, g), Some(3));
        let mut empty = browser.clone();
        empty.pop();
        assert_eq!(composer(&empty, g), None);
    }

    #[test]
    fn the_answer_is_under_the_last_answer_block() {
        let g = site("gemini").unwrap();
        let f = (0.0, 0.0, 10.0, 10.0);
        let nodes = vec![
            n(0, "AXWebArea", "", "", &[], f),
            n(4, "AXStaticText", "", "Balas: pong", &[], f),
            n(4, "AXGroup", "", "", &["markdown", "markdown-main-panel"], f),
            n(5, "AXStaticText", "", "old", &[], f),
            n(4, "AXStaticText", "", "Balas: pong", &[], f),
            n(4, "AXGroup", "", "", &["markdown", "markdown-main-panel"], f),
            n(5, "AXGroup", "", "", &["first-token"], f),
            n(6, "AXStaticText", "", "pong", &[], f),
            n(3, "AXStaticText", "", "Gemini can make mistakes.", &[], f),
        ];
        assert_eq!(answer(&nodes, g, "Balas: pong"), "pong");
        let c = site("chatgpt").unwrap();
        let bare: Vec<Node> = nodes.iter().filter(|x| x.classes.is_empty()).cloned().collect();
        assert_eq!(answer(&bare, c, "Balas: pong"), "pong");
        let said = vec![n(1, "AXStaticText", "", "Balas: pong", &[], f), n(2, "AXStaticText", "", "ChatGPT said:", &[], f), n(3, "AXStaticText", "", "pong", &[], f),
            n(2, "AXStaticText", "", "Do you like this personality?", &[], f), n(2, "AXStaticText", "", "ChatGPT can make mistakes. Check important info.", &[], f)];
        assert_eq!(answer(&said, c, "Balas: pong"), "pong");
        let cl = site("claude").unwrap();
        let claude = vec![n(1, "AXStaticText", "", "Balas: pong", &[], f), n(2, "AXStaticText", "", "just now", &[], f), n(2, "AXStaticText", "", "Claude responded: Pong", &[], f),
            n(3, "AXStaticText", "", "Pong", &[], f), n(2, "AXStaticText", "", "Please double-check responses.", &[], f)];
        assert_eq!(answer(&claude, cl, "Balas: pong"), "Pong");
        // (what follows the chat box, like the model picker, isn't the answer)
        let mut app = claude.clone();
        app.push(n(2, "AXTextArea", "", "", &["ProseMirror"], (0.0, 0.0, 400.0, 30.0)));
        app.push(n(2, "AXStaticText", "", "Opus 5.5", &[], f));
        assert_eq!(answer(&app, site("claude_app").unwrap(), "Balas: pong"), "Pong");
    }

    #[test]
    fn done_when_the_stop_button_left_and_the_text_settled() {
        let mut f = Follow::default();
        assert!(!f.look(true, "po", 1.5));
        assert!(!f.look(false, "pong", 3.0));
        assert!(!f.look(false, "pong", 4.5));
        assert!(f.look(false, "pong", 6.0));
        // (too quick for a stop button: after 8 s)
        let mut q = Follow::default();
        assert!(!q.look(false, "pong", 1.5) && !q.look(false, "pong", 3.0) && !q.look(false, "pong", 4.5));
        assert!(q.look(false, "pong", 9.0));
        assert!(answering(&[n(1, "AXButton", "Hentikan respons", "", &[], (0.0, 0.0, 9.0, 9.0))], site("gemini").unwrap()));
    }

    #[test]
    fn sent_only_when_the_box_let_go_of_it() {
        let c = site("claude").unwrap();
        let f = (0.0, 0.0, 400.0, 30.0);
        let mut area = n(0, "AXWebArea", "", "", &[], f);
        area.url = "https://claude.ai/new".into();
        let box_with = |text: &str| vec![area.clone(), n(1, "AXButton", "Send message", "", &[], f), n(1, "AXTextArea", "", text, &["ProseMirror"], f), n(2, "AXStaticText", "", text, &[], f)];
        // (the editor ignored the value: still in its box, nowhere else)
        assert!(!sent(&box_with("Balas: ping"), c, "Balas: ping"));
        let mut went = box_with("");
        went.insert(1, n(1, "AXStaticText", "", "Balas: ping", &[], f));
        assert!(sent(&went, c, "Balas: ping"));
        assert_eq!(send_button(&went, c), Some(2));
    }

    #[test]
    fn logins_profiles_and_open() {
        assert!(needs_login("https://claude.ai/login?returnTo=%2Fnew") && needs_login("https://accounts.google.com/x"));
        assert!(!needs_login("https://gemini.google.com/app"));
        let ls = json!({"profile": {"last_used": "Profile 2", "info_cache": {"Profile 2": {"name": "Work", "user_name": "a@b.c"}, "Default": {"name": "Me"}}}});
        let (list, last) = profiles(&ls);
        assert_eq!((list[0]["dir"].as_str(), list[1]["name"].as_str(), last.as_str()), (Some("Default"), Some("Work"), "Profile 2"));
        assert_eq!(browser_args("Profile 2", "https://x").join(" "), "--profile-directory=Profile 2 --new-window https://x");
        assert_eq!(browser_args("", "https://x").join(" "), "--new-window https://x");
    }
}

/// The real thing on this Mac (types into the browser!): `ASK=gemini cargo test -p services askai::live -- --ignored --nocapture`
/// (`BROWSER=<bundle id>` for another browser than the default).
#[cfg(all(test, target_os = "macos"))]
mod live {
    use super::*;
    use platform::ax;
    use std::time::{Duration, Instant};

    #[test]
    #[ignore]
    fn live() {
        let site = site(&std::env::var("ASK").unwrap_or("gemini".into())).unwrap();
        let bundle = site.app.map(String::from).or_else(|| std::env::var("BROWSER").ok()).or_else(ax::default_browser).unwrap();
        let prompt = "Balas hanya dengan satu kata: pong";
        println!("{} in {bundle}", site.name);
        let open = || if site.app.is_some() { ax::open_background("", site.url) } else { ax::open_background(&bundle, site.url) };
        open();
        let t0 = Instant::now();
        let (pid, win) = loop {
            assert!(t0.elapsed() < Duration::from_secs(30), "no page");
            std::thread::sleep(Duration::from_millis(700));
            let Some(pid) = ax::pid_of(&bundle) else { continue };
            let Some(win) = ax::window(pid) else { continue };
            let (nodes, els) = ax::read(&win, 8000);
            let Some(area) = nodes.iter().find(|n| n.role == "AXWebArea" && n.url.contains(site.host)) else { continue };
            assert!(!needs_login(&area.url), "needs sign-in: {}", area.url);
            if site.app.is_some() && nodes.iter().any(|n| n.role == "AXRadioButton" && n.label == "Code" && n.value == "1") {
                println!("in Code mode: switching to Chat");
                if let Some(j) = nodes.iter().position(|n| n.role == "AXRadioButton" && n.label.starts_with("Chat")) {
                    els[j].act("AXPress");
                    std::thread::sleep(Duration::from_millis(1200));
                    open();
                }
                continue;
            }
            if composer(&nodes, site).is_some() {
                break (pid, win);
            }
        };
        println!("page ready in {:.1} s", t0.elapsed().as_secs_f32());
        let (nodes, els) = ax::read(&win, 8000);
        let c = composer(&nodes, site).unwrap();
        println!("composer: {} {:?}", nodes[c].role, nodes[c].classes);
        ax::bring(pid, &win);
        std::thread::sleep(Duration::from_millis(400));
        els[c].set_flag("AXFocused", true);
        std::thread::sleep(Duration::from_millis(300));
        for piece in prompt.chars().collect::<Vec<_>>().chunks(2) {
            assert!(ax::is_front(pid), "another app came to the front");
            ax::type_all(&piece.iter().collect::<String>());
            std::thread::sleep(Duration::from_millis(35));
        }
        std::thread::sleep(Duration::from_millis(400));
        ax::press_key(36, false);
        let (sent, mut f) = (Instant::now(), Follow::default());
        loop {
            std::thread::sleep(Duration::from_millis(1500));
            let (nodes, _) = ax::read(&win, 8000);
            let (writing, text) = (answering(&nodes, site), answer(&nodes, site, prompt));
            println!("  {:.1} s: writing {writing}, answer {:?}", sent.elapsed().as_secs_f32(), text.chars().take(60).collect::<String>());
            if f.look(writing, &text, sent.elapsed().as_secs_f32()) {
                assert!(text.to_lowercase().contains("pong"), "{text}");
                break;
            }
            assert!(sent.elapsed() < Duration::from_secs(90), "no answer");
        }
    }
}
