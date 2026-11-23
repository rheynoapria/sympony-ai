use contract::{Class, Kind};
use std::collections::BTreeSet;
use std::process::Command;

fn contract_names_from_frontend() -> BTreeSet<String> {
    let out = Command::new("python3")
        .args(["-I", "../../tools/extract_contract.py", "../../frontend"])
        .output()
        .expect("python3");
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).expect("extractor json");
    let mut names: BTreeSet<String> = v.as_array().unwrap().iter().map(|i| i["name"].as_str().unwrap().to_string()).collect();
    // the classifier's EXTRA_EVENTS: subscribed in a loop, so the extractor can't see them
    names.extend(["weather", "health", "github"].map(String::from));
    // and its EXTRA_METHODS: called as `on ? 'connect' : 'disconnect'`
    names.extend(["bluetooth.connect", "bluetooth.disconnect"].map(String::from));
    names.extend(["signIn", "cancel", "signOut", "syncNow", "setList", "newList"].map(|m| format!("todosync.{m}")));
    // settings.js's svc('claude', b.dataset.cc)
    names.extend(["claude.install", "claude.remove"].map(String::from));
    // bluetooth.js's svc('speedtest', run ? 'cancel' : 'start')
    names.extend(["speedtest.start", "speedtest.cancel"].map(String::from));
    // Retired 3D buddy entries stay excluded in contract.json for parity
    names.extend(
        ["cat.clear", "cat.data", "cat.pick", "cat:place", "cat:relay", "cat:sympony", "cat_free", "notch:cursor"]
            .map(String::from),
    );
    // Voice V1 and Pony Assistant events/methods live outside contract.json so core parity stays 216/216
    // (and Pony's own engine: `agent:step` / `agent:delta`, the live steps and the streamed text while an answer is on its way, `chat.stop` and `chat.steer`; `brain.*` / `brain:*`;
    // the YouTube video mode's `yt.*`)
    names.retain(|n| !n.starts_with("voice:") && !n.starts_with("voice.") && !n.starts_with("pony:") && !n.starts_with("pony.")
        && n != "agent:step" && n != "agent:delta" && n != "chat.stop" && n != "chat.steer" && !n.starts_with("brain:") && !n.starts_with("brain.") && !n.starts_with("yt.") && n != "perm.request");
    names
}

#[test]
fn counts_match_the_frontend() {
    assert_eq!(
        contract_names_from_frontend(),
        contract::items().iter().map(|i| i.name.clone()).collect::<BTreeSet<_>>()
    );
}

#[test]
fn known_items() {
    assert_eq!(contract::find(Kind::Command, "notch_arrows").unwrap().class, Class::Fix);
    assert_eq!(contract::find(Kind::Command, "update_check").unwrap().class, Class::Excluded);
    assert_eq!(contract::find(Kind::Method, "store.get").unwrap().phase, 1);
    assert_eq!(contract::find(Kind::Command, "helper_state").unwrap().stub, serde_json::json!({}));
    let detect = contract::find(Kind::Method, "location.detect").unwrap();
    assert_eq!((detect.phase, detect.class), (2, Class::Fix));
    assert_eq!(contract::find(Kind::Event, "weather").unwrap().phase, 2);
    assert_eq!(contract::find(Kind::Method, "prayer.search").unwrap().phase, 2);
}
