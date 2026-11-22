use serde_json::{json, Value};

fn ids() -> impl FnMut() -> String {
    let mut n = 0;
    move || {
        n += 1;
        format!("i{n}")
    }
}

#[test]
fn shelf_adds_files_text_and_links_once() {
    use services::shelf::add;
    let mut list: Vec<Value> = vec![];
    let mut id = ids();
    add(&mut list, &[json!({"kind": "file", "path": "/a/b.png"}), json!({"kind": "file", "path": "/a/b.png"}),
        json!({"kind": "text", "text": "  hello\nworld "}), json!({"kind": "text", "text": "https://example.com/x"}),
        json!({"kind": "text", "text": "   "}), json!({"kind": "file", "path": ""}), json!({"kind": "weird"})], &mut id, 5);
    assert_eq!(list, vec![
        json!({"id": "i1", "kind": "file", "path": "/a/b.png", "at": 5}),
        json!({"id": "i2", "kind": "text", "text": "hello\nworld", "at": 5}),
        json!({"id": "i3", "kind": "link", "text": "https://example.com/x", "at": 5}),
    ]);
    // the same again: nothing new
    add(&mut list, &[json!({"kind": "text", "text": "hello\nworld"}), json!({"kind": "file", "path": "/a/b.png"})], &mut id, 6);
    assert_eq!(list.len(), 3);
    // from the phone: says so
    add(&mut list, &[json!({"kind": "file", "path": "/d/p.jpg", "from": "phone"})], &mut id, 7);
    assert_eq!(list[3]["from"], "phone");
}

#[test]
fn shelf_shows_each_item() {
    use services::shelf::view;
    let f = view(&json!({"id": "1", "kind": "file", "path": "/a/Photo.JPG"}), Some((false, 1234)));
    assert_eq!(f, json!({"id": "1", "kind": "file", "path": "/a/Photo.JPG", "name": "Photo.JPG", "photo": true, "isDir": false, "size": 1234, "missing": false}));
    let d = view(&json!({"id": "2", "kind": "file", "path": "/a/dir"}), Some((true, 0)));
    assert_eq!((d["isDir"].as_bool(), d["size"].clone(), d["photo"].as_bool()), (Some(true), Value::Null, Some(false)));
    let gone = view(&json!({"id": "3", "kind": "file", "path": "/a/x.txt"}), None);
    assert_eq!((gone["missing"].as_bool(), gone["size"].clone()), (Some(true), Value::Null));
    // text: its first line, cut
    let t = view(&json!({"id": "4", "kind": "text", "text": format!("\n  {}\nsecond", "w".repeat(100))}), None);
    assert_eq!(t["name"].as_str().unwrap().chars().count(), 61);
    assert!(t["name"].as_str().unwrap().ends_with('…'));
    let l = view(&json!({"id": "5", "kind": "link", "text": "https://www.example.com/a?b"}), None);
    assert_eq!(l["name"], "example.com");
}

#[test]
fn clipboard_keeps_newest_pins_and_the_limit() {
    use services::clipboard::*;
    let mut list: Vec<Value> = vec![];
    let mut id = ids();
    push(&mut list, text_item("one", &mut id, 1), 3);
    push(&mut list, text_item("two", &mut id, 2), 3);
    pin(&mut list, "i1", true);
    push(&mut list, text_item("three", &mut id, 3), 3);
    push(&mut list, text_item("four", &mut id, 4), 3);
    // pinned first, then newest; the limit doesn't count pins
    let texts: Vec<&str> = list.iter().map(|i| i["text"].as_str().unwrap()).collect();
    assert_eq!(texts, ["one", "four", "three", "two"]);
    push(&mut list, text_item("five", &mut id, 5), 3);
    assert_eq!(list.iter().map(|i| i["text"].as_str().unwrap()).collect::<Vec<_>>(), ["one", "five", "four", "three"]);
    // the same text again moves up, keeping its pin and id
    push(&mut list, text_item("three", &mut id, 6), 3);
    assert_eq!((list[1]["text"].as_str(), list[1]["id"].as_str(), list[1]["at"].as_i64()), (Some("three"), Some("i3"), Some(6)));
    push(&mut list, text_item("one", &mut id, 7), 3);
    assert_eq!((list[0]["id"].as_str(), list[0]["pinned"].as_bool()), (Some("i1"), Some(true)));
    clear(&mut list);
    assert_eq!(list.len(), 1);
}

#[test]
fn clipboard_knows_links_and_colours() {
    use services::clipboard::*;
    let mut id = ids();
    let l = text_item(" https://example.com/a ", &mut id, 1);
    assert_eq!((l["kind"].as_str(), l["len"].as_u64(), l["pinned"].as_bool()), (Some("link"), Some(23), Some(false)));
    assert_eq!(text_item("see https://x.y", &mut id, 1)["kind"], "text");
    assert_eq!(color("#FFAA00"), Some("#ffaa00".into()));
    assert_eq!(color(" #fa0 "), Some("#ffaa00".into()));
    assert_eq!(color("#ffaa0080"), Some("rgba(255, 170, 0, .502)".into()));
    assert_eq!(color("rgb(1,2,3)"), Some("#010203".into()));
    assert_eq!(color("rgba(10, 20, 30, 0.5)"), Some("rgba(10, 20, 30, .5)".into()));
    assert_eq!(color("rgba(10, 20, 30, 1)"), Some("rgba(10, 20, 30, 1)".into()));
    assert_eq!(color("rgb(300, 0, 0)"), None);
    assert_eq!(color("#ggg"), None);
    assert_eq!(color("my #fff"), None);
    assert_eq!(text_item("#ffffff", &mut id, 1)["color"], "#ffffff");
}

#[test]
fn launcher_turns_windows_defaults_into_the_macs() {
    use services::launcher::for_mac;
    let win_defaults = json!([{"name": "File Explorer", "path": "C:\\Windows\\explorer.exe"}, {"name": "Downloads", "path": ""},
        {"name": "Calculator", "path": "C:\\Windows\\System32\\calc.exe"}, {"name": "Notepad", "path": "C:\\Windows\\System32\\notepad.exe"},
        {"name": "Task Manager", "path": "C:\\Windows\\System32\\Taskmgr.exe"}, {"icon": "fa-solid fa-gear", "name": "Settings", "path": "ms-settings:"},
        {"name": "Game", "path": "D:\\Games\\x.exe"}, {"name": "Mine", "path": "/Applications/Safari.app"}]);
    let (items, changed) = for_mac(win_defaults.as_array().unwrap(), "/Users/me");
    assert!(changed);
    assert_eq!(Value::Array(items), json!([
        {"name": "Finder", "path": "/System/Library/CoreServices/Finder.app"},
        {"name": "Downloads", "path": "/Users/me/Downloads"},
        {"name": "Calculator", "path": "/System/Applications/Calculator.app"},
        {"name": "TextEdit", "path": "/System/Applications/TextEdit.app"},
        {"name": "Activity Monitor", "path": "/System/Applications/Utilities/Activity Monitor.app"},
        {"name": "System Settings", "path": "/System/Applications/System Settings.app"},
        {"name": "Mine", "path": "/Applications/Safari.app"},
    ]));
    let mac = json!([{"name": "Mine", "path": "/Applications/Safari.app"}]);
    assert!(!for_mac(mac.as_array().unwrap(), "/Users/me").1);
}

#[test]
fn a_pages_title_and_icon() {
    use services::bookmarks::page_meta;
    let html = r#"<html><head><title>Old &amp; Gold</title><meta property="og:title" content="Better &quot;one&quot;">
        <link rel="stylesheet" href="/a.css"><link rel="shortcut icon" href="/fav.png"><link href="https://cdn.x/t.png" rel="apple-touch-icon"></head></html>"#;
    let (title, icons) = page_meta(html, "https://www.site.com/a/b?c");
    assert_eq!(title.as_deref(), Some("Better \"one\""));
    assert_eq!(icons, ["https://cdn.x/t.png", "https://www.site.com/fav.png", "https://www.site.com/favicon.ico"]);
    let (t, i) = page_meta("<TITLE>\n  Plain  </TITLE><link rel=icon href=\"img/i.ico\">", "http://h.com/dir/page");
    assert_eq!((t.as_deref(), i[0].as_str()), (Some("Plain"), "http://h.com/dir/img/i.ico"));
    assert_eq!(page_meta("", "https://h.com").0, None);
}

#[test]
fn a_new_name_beside_the_old_ones() {
    use services::shelf::unique_name;
    let taken = ["a.zip", "a 2.zip", "Archive"];
    let t = |n: &str| taken.contains(&n);
    assert_eq!(unique_name("b.zip", &t), "b.zip");
    assert_eq!(unique_name("a.zip", &t), "a 3.zip");
    assert_eq!(unique_name("Archive", &t), "Archive 2");
    assert_eq!(unique_name(".hidden", &|n| n == ".hidden"), ".hidden 2");
}

#[test]
fn a_huge_copy_keeps_its_start_and_full_length() {
    use services::clipboard::{text_item, KEEP};
    let mut id = ids();
    let big = "é".repeat(KEEP + 500);
    let it = text_item(&big, &mut id, 1);
    assert_eq!((it["text"].as_str().unwrap().chars().count(), it["len"].as_u64()), (KEEP, Some((KEEP + 500) as u64)));
}

#[test]
fn alpha_edges_stay_valid() {
    use services::clipboard::color;
    assert_eq!(color("rgba(1, 2, 3, 0.9996)"), Some("rgba(1, 2, 3, 1)".into()));
    assert_eq!(color("rgba(1, 2, 3, 0.0001)"), Some("rgba(1, 2, 3, 0)".into()));
    assert_eq!(color("#ffffff00"), Some("rgba(255, 255, 255, 0)".into()));
}
