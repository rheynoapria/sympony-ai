use serde_json::{json, Value};
use services::github::to_items;

#[test]
fn github_items_shape() {
    let review: Value = serde_json::from_str(&std::fs::read_to_string("tests/fixtures/github-search.json").unwrap()).unwrap();
    let mine = json!({"items": [{"title": "My PR", "html_url": "https://github.com/acme/api/pull/50", "number": 50,
        "repository_url": "https://api.github.com/repos/acme/api", "user": {"login": "me", "avatar_url": "https://a/u/9?v=4"},
        "updated_at": "2026-11-18T11:00:00Z", "comments": 1}]});
    let items = to_items(&review, Some(&mine));
    assert_eq!(items.len(), 3);
    // to review first (newest first), then yours
    assert_eq!(items[0], json!({"kind": "review", "title": "WIP: new page", "url": "https://github.com/acme/web/pull/7", "repo": "acme/web",
        "number": 7, "author": "sari", "avatar": "https://avatars.githubusercontent.com/u/2?v=4", "updated": 1795003200000i64, "comments": 0, "draft": true}));
    assert_eq!(items[1]["number"], 42);
    assert_eq!((items[2]["kind"].as_str(), items[2]["draft"].as_bool()), (Some("mine"), Some(false)));
    assert_eq!(to_items(&review, None).len(), 2);
    assert!(to_items(&json!({"message": "Bad credentials"}), None).is_empty());
}
