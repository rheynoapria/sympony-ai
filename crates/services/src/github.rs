//! The GitHub tab: open pull requests waiting on your review, and your own (the search API with your token).
use serde_json::{json, Value};

pub const REVIEW_Q: &str = "is:open is:pr review-requested:@me archived:false";
pub const MINE_Q: &str = "is:open is:pr author:@me archived:false";

fn items(search: &Value, kind: &str) -> Vec<Value> {
    let mut v: Vec<Value> = search["items"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|i| {
            let repo = i["repository_url"].as_str().unwrap_or("").rsplitn(3, '/').take(2).collect::<Vec<_>>();
            let updated = i["updated_at"].as_str().and_then(|t| chrono::DateTime::parse_from_rfc3339(t).ok()).map(|t| t.timestamp_millis()).unwrap_or(0);
            json!({"kind": kind, "title": i["title"], "url": i["html_url"], "repo": repo.iter().rev().cloned().collect::<Vec<_>>().join("/"),
                   "number": i["number"], "author": i["user"]["login"], "avatar": i["user"]["avatar_url"], "updated": updated,
                   "comments": i["comments"].as_i64().unwrap_or(0), "draft": i["draft"] == true})
        })
        .collect();
    v.sort_by_key(|i| std::cmp::Reverse(i["updated"].as_i64()));
    v
}

/// The tab's list: to review (newest first), then yours (`mine` when "Include my own" is on), each PR once.
pub fn to_items(review: &Value, mine: Option<&Value>) -> Vec<Value> {
    let mut out = items(review, "review");
    if let Some(m) = mine {
        for i in items(m, "mine") {
            if !out.iter().any(|o| o["url"] == i["url"]) {
                out.push(i);
            }
        }
    }
    out
}
