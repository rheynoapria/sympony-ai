//! Pony's Hands: acting on the
//! elements Eyes numbered (`screen_read`). Pure: the tools, which actions are risky, keys as key codes.
use serde_json::{json, Value};

use platform::ax::Node;

pub const NAMES: [&str; 1] = ["screen_do"];
/// Steps in one screen_do at most, and actions in one turn.
pub const MAX_STEPS: usize = 6;
pub const MAX_ACTIONS: usize = 40;

pub const RULES: &str = "How to act here: screen_do(steps) acts on the numbers above, several steps in one call when you know them \
(fill a form, then press its button): click {n, at?} (optional at: 0..100 clicks that horizontal % across a bar/timeline), \
double_click {n} or double_click {spot: \"t3\"} (opens a file/folder in Finder or list item), \
right_click {n} or right_click {spot: \"t3\"} (opens a context menu), \
hover {n} or hover {spot: \"t3\"} (moves the pointer there to reveal hover-only controls/tooltips), \
fill {n, text} (no click needed first; pass \"\" to clear), choose {n, option}, \
slide {n, value} or slide {n, percent} (sets a slider/video timeline/scrubber to an exact value inside its range or 0..100%), \
drag {n, to_n | percent | dx, dy} (drags a slider/handle/control smoothly across the screen), \
key {keys: \"cmd+s\", repeat?} (e.g. space, right, left, enter, cmd+o, cmd+f; optional repeat 1..20), \
scroll {direction: \"up\"|\"down\"|\"left\"|\"right\", n?}, wait {ms: 100..5000} (brief pause for animations or loading), \
click {spot: \"t3\"} for an ocr text spot, \
menu {path: [\"File\", \"Save\"]} (the menu bar: often the quickest and surest way), \
point {n, say} (only shows the user where). It stops at a step that fails and answers with what changed and the new numbers: use \
those. When that answer shows the request is done, it is: don't read the screen again to check. If nothing changed, don't repeat \
the step: try another way or tell the user. Act only on what the user asked; sending, buying, paying or deleting asks the user first.";
/// In the system prompt while Hands are on (the rules come with the first screen read of a run).
pub const BRIEF: &str = "Hands: YOU CAN DO FULL VISUAL MULTI-STEP UI AUTOMATION on desktop apps (Finder, QuickTime Player, System Settings, etc.) and browser websites using screen_read + screen_do with a visible glowing screen aurora and Pony's live cursor. \
IMPORTANT — PREFER INTERACTIVE UI AUTOMATION OVER OSASCRIPT/SHELL: Whenever the user asks to open or operate a desktop app, browse Finder, open/play/seek a video (QuickTime, YouTube, VLC), or interact with on-screen UI, ALWAYS use screen_read(app: \"...\") + screen_do (click, double_click, slide, drag, fill, key, menu) so the user sees your live cursor performing the steps interactively—do NOT bypass Hands with background `osascript` / AppleScript (`tell application ...`) or shell shortcuts unless UI automation genuinely fails. \
Pass `app` directly to `screen_read` (e.g. `screen_read(mode: \"elements\", app: \"Finder\")` or `screen_read(app: \"QuickTime Player\")`) to open/focus that exact app cleanly without needing `run_command`. \
Do NOT claim you cannot read or automate an app, slider, timeline, or website when screen_read and screen_do are in your tools—even if earlier chat messages or memory claimed otherwise, use your active tools now. Detailed step syntax comes with your first screen_read.";

pub fn tools() -> Vec<Value> {
    json!([{"name": "screen_do", "description": "Acts on the window the user is looking at, using the numbers from the last screen_read: one or more steps, in order.",
        "inputSchema": {"type": "object", "properties": {"routine": {"type": "string", "description": "instead of steps: replay a routine that worked (its id, like r3)"}, "texts": {"type": "array", "items": {"type": "string"}, "description": "with routine: new text for its fill steps, in order (else last time's text)"}, "steps": {"type": "array", "maxItems": MAX_STEPS, "items": {"type": "object", "required": ["do"], "properties": {
            "do": {"type": "string", "enum": ["click", "double_click", "right_click", "hover", "fill", "choose", "slide", "drag", "key", "scroll", "wait", "menu", "point"]},
            "n": {"type": "integer", "description": "element number"},
            "at": {"type": "number", "description": "click: optional horizontal position 0..100 (%) across element n (useful for timelines/progress bars)"},
            "spot": {"type": "string", "description": "click/double_click/right_click/hover: a text spot from screen_read mode ocr, like t3 (instead of n)"},
            "text": {"type": "string", "description": "fill: the field's new text (empty string clears it)"},
            "option": {"type": "string", "description": "choose: the option's name"},
            "value": {"type": "number", "description": "slide: exact numeric value inside the slider's (range min..max), e.g. 10 for second 10"},
            "percent": {"type": "number", "description": "slide or drag: target position 0..100 (%) along the slider/element"},
            "to_n": {"type": "integer", "description": "drag: destination element number"},
            "dx": {"type": "number", "description": "drag: horizontal pixel offset from element n"},
            "dy": {"type": "number", "description": "drag: vertical pixel offset from element n"},
            "keys": {"type": "string", "description": "key: like cmd+s, space, enter, tab, esc, left, right, up, down"},
            "repeat": {"type": "integer", "description": "key: optional repeat count (1..20)"},
            "direction": {"type": "string", "enum": ["up", "down", "left", "right"]},
            "ms": {"type": "integer", "description": "wait: milliseconds to pause (100..5000)"},
            "path": {"type": "array", "items": {"type": "string"}, "description": "menu: menu bar path, like [\"File\", \"Export…\"]"},
            "say": {"type": "string", "description": "point: a short instruction for the user"}}}}}}}])
    .as_array().cloned().unwrap_or_default()
}

pub fn functions() -> Vec<Value> {
    tools().into_iter().map(|t| json!({"type": "function", "function": {"name": t["name"], "description": t["description"], "parameters": t["inputSchema"]}})).collect()
}

fn key(n: &Node) -> (&str, &str) {
    (n.role.as_str(), n.label.as_str())
}

fn short(s: &str, n: usize) -> String {
    let s = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if s.chars().count() > n { format!("{}…", s.chars().take(n).collect::<String>()) } else { s }
}

/// The element numbered `n` before, found again in a new view by its role and label (the one nearest its old place
/// when there are several): its new number.
pub fn refind(old: &[Node], old_map: &[usize], n: usize, new: &[Node], new_map: &[usize]) -> Option<usize> {
    let was = &old[*old_map.get(n.checked_sub(1)?)?];
    new_map.iter().enumerate().filter(|(_, &i)| key(&new[i]) == key(was))
        .min_by_key(|(_, &i)| (i as i64 - old_map[n - 1] as i64).abs()).map(|(k, _)| k + 1)
}

/// What changed between two views of a window (numbered elements, title, url, focus), for the model: far fewer
/// tokens than the whole list. A window that changed a lot gets its whole new list instead.
pub fn changes(old: &[Node], old_map: &[usize], new: &[Node], new_map: &[usize], new_list: &str) -> String {
    let title = |v: &[Node]| v.first().map(|n| n.label.clone()).unwrap_or_default();
    let url = |v: &[Node]| v.iter().find(|n| n.role == "AXWebArea").map(|n| n.url.clone()).unwrap_or_default();
    let mut out = vec![];
    if title(old) != title(new) || url(old) != url(new) {
        out.push(format!("Window now: \"{}\"{}", short(&title(new), 80), if url(new).is_empty() { String::new() } else { format!(" {}", url(new)) }));
    }
    let mut before: Vec<(&str, &str, &str)> = old_map.iter().map(|&i| (old[i].role.as_str(), old[i].label.as_str(), old[i].value.as_str())).collect();
    let (mut added, mut changed) = (vec![], vec![]);
    for (k, &i) in new_map.iter().enumerate() {
        let n = &new[i];
        if let Some(p) = before.iter().position(|b| (b.0, b.1) == key(n)) {
            if before[p].2 != n.value && !n.value.is_empty() {
                changed.push(format!("[{}] \"{}\" = \"{}\"", k + 1, short(&n.label, 40), short(&n.value, 60)));
            }
            before.remove(p);
        } else {
            added.push(format!("[{}] {} \"{}\"", k + 1, n.role.trim_start_matches("AX").to_lowercase(), short(&n.label, 50)));
        }
    }
    if added.len() > 40 {
        return format!("The window changed a lot:\n{new_list}");
    }
    if let Some((k, &i)) = new_map.iter().enumerate().find(|(_, &i)| new[i].focused) {
        let n = &new[i];
        out.push(format!("Focused: [{}] {}{}", k + 1, n.role.trim_start_matches("AX").to_lowercase(), if n.label.is_empty() { String::new() } else { format!(" \"{}\"", short(&n.label, 50)) }));
    }
    if !changed.is_empty() {
        out.push(format!("Changed: {}", changed.iter().take(10).cloned().collect::<Vec<_>>().join(" · ")));
    }
    if !added.is_empty() {
        out.push(format!("New: {}{}", added.iter().take(25).cloned().collect::<Vec<_>>().join(" · "), if added.len() > 25 { format!(" (+{} more)", added.len() - 25) } else { String::new() }));
    }
    if !before.is_empty() {
        out.push(format!("Gone: {}", before.iter().take(8).map(|b| format!("\"{}\"", short(b.1, 30))).collect::<Vec<_>>().join(", ") + if before.len() > 8 { " …" } else { "" }));
    }
    if out.is_empty() {
        return "Nothing changed on screen.".into();
    }
    out.push("(Numbers are from this view; screen_read shows the whole list.)".into());
    out.join("\n")
}

/// Whether acting on an element with this label sends, buys, pays or deletes something (English and Indonesian).
pub fn risky(label: &str) -> bool {
    let l = label.to_lowercase();
    const WORDS: [&str; 26] = [
        "send", "kirim", "submit", "post", "publish", "terbitkan", "buy", "beli", "pay", "bayar", "checkout", "order", "pesan sekarang",
        "delete", "hapus", "remove", "buang", "transfer", "confirm", "konfirmasi", "place order", "purchase", "unsubscribe", "sign out", "keluar", "trash",
    ];
    // (whole words: "Sender" isn't "send")
    let padded = format!(" {} ", l.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).collect::<Vec<_>>().join(" "));
    WORDS.iter().any(|w| padded.contains(&format!(" {w} ")))
}

/// Narrower guard used in YOLO mode: only truly irreversible financial or destructive labels ask for confirmation.
pub fn destructive_or_financial(label: &str) -> bool {
    let l = label.to_lowercase();
    const WORDS: [&str; 14] = [
        "buy", "beli", "pay", "bayar", "checkout", "pesan sekarang", "place order", "purchase",
        "transfer", "delete", "hapus", "buang", "trash", "sign out",
    ];
    let padded = format!(" {} ", l.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).collect::<Vec<_>>().join(" "));
    WORDS.iter().any(|w| padded.contains(&format!(" {w} ")))
}

/// Keys like "cmd+shift+t" as (macOS virtual key code, modifier flags). None: a key it doesn't know.
pub fn keys(combo: &str) -> Option<(u16, u64)> {
    let mut flags = 0u64;
    let mut code = None;
    for part in combo.to_lowercase().split('+').map(str::trim).filter(|p| !p.is_empty()) {
        match part {
            "cmd" | "command" | "⌘" => flags |= 0x0010_0000,
            "shift" | "⇧" => flags |= 0x0002_0000,
            "alt" | "option" | "opt" | "⌥" => flags |= 0x0008_0000,
            "ctrl" | "control" | "⌃" => flags |= 0x0004_0000,
            k => code = Some(key_code(k)?),
        }
    }
    code.map(|c| (c, flags))
}

fn key_code(k: &str) -> Option<u16> {
    const LETTERS: [(char, u16); 36] = [
        ('a', 0), ('s', 1), ('d', 2), ('f', 3), ('h', 4), ('g', 5), ('z', 6), ('x', 7), ('c', 8), ('v', 9), ('b', 11), ('q', 12), ('w', 13), ('e', 14), ('r', 15),
        ('y', 16), ('t', 17), ('1', 18), ('2', 19), ('3', 20), ('4', 21), ('6', 22), ('5', 23), ('9', 25), ('7', 26), ('8', 28), ('0', 29), ('o', 31), ('u', 32),
        ('i', 34), ('p', 35), ('l', 37), ('j', 38), ('k', 40), ('n', 45), ('m', 46),
    ];
    let mut chars = k.chars();
    if let (Some(c), None) = (chars.next(), chars.next()) {
        return LETTERS.iter().find(|l| l.0 == c).map(|l| l.1).or(match c {
            ',' => Some(43), '.' => Some(47), '/' => Some(44), ';' => Some(41), '\'' => Some(39), '[' => Some(33), ']' => Some(30), '-' => Some(27), '=' => Some(24), '`' => Some(50),
            _ => None,
        });
    }
    Some(match k {
        "enter" | "return" | "ret" | "cr" => 36,
        "tab" => 48,
        "space" | "spacebar" | " " => 49,
        "delete" | "backspace" | "bksp" | "bs" => 51,
        "esc" | "escape" => 53,
        "left" | "arrowleft" | "leftarrow" | "left_arrow" | "left arrow" => 123,
        "right" | "arrowright" | "rightarrow" | "right_arrow" | "right arrow" => 124,
        "down" | "arrowdown" | "downarrow" | "down_arrow" | "down arrow" => 125,
        "up" | "arrowup" | "uparrow" | "up_arrow" | "up arrow" => 126,
        "pageup" | "pgup" | "page_up" | "page up" => 116,
        "pagedown" | "pgdn" | "pgdown" | "page_down" | "page down" => 121,
        "home" => 115,
        "end" => 119,
        "forwarddelete" | "del" => 117,
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn el(role: &str, label: &str, value: &str) -> Node {
        Node { role: role.into(), label: label.into(), value: value.into(), enabled: true, ..Default::default() }
    }

    #[test]
    fn changes_say_what_moved_in_few_words() {
        let old = vec![el("AXWindow", "Mail", ""), el("AXTextField", "To", ""), el("AXButton", "Send", ""), el("AXButton", "Draft", "")];
        let old_map = vec![1, 2, 3];
        let mut to = el("AXTextField", "To", "ani@x.id");
        to.focused = true;
        let new = vec![el("AXWindow", "Mail", ""), el("AXButton", "Attach", ""), to, el("AXButton", "Send", "")];
        let new_map = vec![1, 2, 3];
        let c = changes(&old, &old_map, &new, &new_map, "");
        assert_eq!(c, "Focused: [2] textfield \"To\"\nChanged: [2] \"To\" = \"ani@x.id\"\nNew: [1] button \"Attach\"\nGone: \"Draft\"\n(Numbers are from this view; screen_read shows the whole list.)");
        assert_eq!(changes(&old, &old_map, &old, &old_map, ""), "Nothing changed on screen.");
        // ("Send" was [2], now [3])
        assert_eq!(refind(&old, &old_map, 2, &new, &new_map), Some(3));
        assert_eq!(refind(&old, &old_map, 3, &new, &new_map), None);
    }

    #[test]
    fn keys_and_risk() {
        assert_eq!(keys("cmd+s"), Some((1, 0x0010_0000)));
        assert_eq!(keys("cmd+shift+t"), Some((17, 0x0012_0000)));
        assert_eq!(keys("Enter"), Some((36, 0)));
        assert_eq!(keys("down"), Some((125, 0)));
        assert_eq!(keys("ArrowRight"), Some((124, 0)));
        assert_eq!(keys("left_arrow"), Some((123, 0)));
        assert_eq!(keys("spacebar"), Some((49, 0)));
        assert_eq!(keys("cmd+?"), None);
        assert!(risky("Send message") && risky("Kirim") && risky("Hapus pesan") && risky("Place order") && risky("Bayar sekarang"));
        assert!(!risky("New chat") && !risky("Search") && !risky("Sender name"));
        assert!(destructive_or_financial("Bayar sekarang") && destructive_or_financial("Hapus pesan") && destructive_or_financial("Checkout"));
        assert!(!destructive_or_financial("Send") && !destructive_or_financial("Confirm") && !destructive_or_financial("Search"));
        let fns = functions();
        assert_eq!(fns.len(), 1);
        let actions = fns[0]["function"]["parameters"]["properties"]["steps"]["items"]["properties"]["do"]["enum"]
            .as_array()
            .unwrap();
        assert!(actions.iter().any(|v| v == "slide"));
        assert!(actions.iter().any(|v| v == "drag"));
        assert!(actions.iter().any(|v| v == "right_click"));
        assert!(actions.iter().any(|v| v == "hover"));
        assert!(actions.iter().any(|v| v == "wait"));
    }
}

/// Hands' primitives on a real app (TextEdit; opens a new document and closes it empty):
/// `cargo test -p services hands::live -- --ignored --nocapture`.
#[cfg(all(test, target_os = "macos"))]
mod live {
    use platform::ax;
    use std::time::{Duration, Instant};

    #[test]
    #[ignore]
    fn live() {
        let back = ax::front_pid();
        std::process::Command::new("/usr/bin/open").args(["-a", "TextEdit"]).status().unwrap();
        std::thread::sleep(Duration::from_millis(1200));
        let pid = ax::pid_of("com.apple.TextEdit").expect("TextEdit runs");
        assert!(ax::menu_path(pid, &["File".into(), "New".into()]), "File › New");
        std::thread::sleep(Duration::from_millis(600));
        let win = ax::window(pid).expect("a window");
        let t = Instant::now();
        let (nodes, els) = ax::read(&win, 6000);
        let (list, map) = crate::eyes::list(&nodes);
        println!("read {} nodes in {:.0} ms:\n{}", nodes.len(), t.elapsed().as_millis(), list.lines().take(8).collect::<Vec<_>>().join("\n"));
        let i = *map.iter().find(|&&i| nodes[i].role == "AXTextArea").expect("the text area");
        let t = Instant::now();
        assert!(els[i].set_text("AXValue", "Halo dari Pony"), "set value");
        ax::settle(pid, &win, 1500);
        println!("filled and settled in {:.0} ms; value now {:?}", t.elapsed().as_millis(), els[i].value("AXValue"));
        assert_eq!(els[i].value("AXValue"), "Halo dari Pony");
        let (nodes2, _) = ax::read(&win, 6000);
        let (list2, map2) = crate::eyes::list(&nodes2);
        println!("changes:\n{}", super::changes(&nodes, &map, &nodes2, &map2, &list2));
        els[i].set_text("AXValue", "");
        std::thread::sleep(Duration::from_millis(200));
        assert!(ax::menu_path(pid, &["File".into(), "Close".into()]), "File › Close");
        if let Some(b) = back {
            ax::activate(b);
        }
    }
}
