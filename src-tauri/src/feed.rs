//! Feed & RSS backend: parallel SSRF-safe fetching for Hacker News, GitHub Trending, Google News
//! Indonesia (+ custom keyword topics), Indonesian news portals, global tech/news presets, and
//! custom RSS/Atom URLs; authentic publisher favicon fetching & local disk cache; and cached
//! 3-bullet Pony summarization (`feed.get`, `feed.refresh`, `feed.presets`, `feed.test`, `feed.summarize`).
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use services::feed::{
    extract_article_text, extract_og_image, feed_title, format_hn_comments, github_repo_slug,
    google_news_topic_url, host_of, merge_and_dedupe, parse_github_search_fallback,
    parse_github_trending_html, parse_hn_item, parse_rss_or_atom, parse_summary_bullets,
    preset_by_id, presets_json, stable_id, summary_prompt, FeedItem,
};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::App;

const MAX_FEED_BYTES: u64 = 2 << 20; // 2 MB max per feed / article
const MAX_ICON_BYTES: u64 = 256 << 10; // 256 KB max per favicon
const MAX_ITEMS_TOTAL: usize = 90;
const MAX_SUMMARIES_CACHED: usize = 80;
const MAX_FAVICONS_CACHED: usize = 120;
const MAX_IMAGES_CACHED: usize = 180;
const SUMMARY_CACHE_VER: &str = "v2";

fn summary_cache_key(base_id: &str, lang: &str) -> String {
    format!("{SUMMARY_CACHE_VER}:{base_id}:{lang}")
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FeedCache {
    #[serde(default)]
    items: Vec<FeedItem>,
    #[serde(default)]
    updated_at: i64,
    #[serde(default)]
    errors: HashMap<String, String>,
    /// Authentic site favicons keyed by lowercase domain host (e.g. `cnnindonesia.com` -> `data:image/...`).
    #[serde(default)]
    favicons: HashMap<String, String>,
    /// Enriched article thumbnail URLs (`og:image` / `twitter:image`) keyed by item id.
    #[serde(default)]
    images: HashMap<String, String>,
    /// Cached Pony summaries keyed by item id.
    #[serde(default)]
    summaries: HashMap<String, CachedSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CachedSummary {
    summary: String,
    bullets: Vec<String>,
    source: String,
    at: i64,
}

pub struct Feed {
    cache: Mutex<FeedCache>,
    failed_icons: Mutex<HashSet<String>>,
    failed_images: Mutex<HashSet<String>>,
    refreshing: Mutex<()>,
    auto_summarizing: AtomicBool,
    kick: Mutex<Sender<()>>,
}

pub fn kick(app: &AppHandle) {
    if let Some(f) = app.try_state::<Feed>() {
        let _ = f.kick.lock().unwrap().send(());
    }
}

/// Reacts to Feed settings changes: source/schedule edits refresh feeds, while turning on
/// background auto-summary (or switching summary language/batch size) immediately pre-summarizes
/// already-cached stories without forcing a full RSS re-fetch.
pub fn on_settings_changed(app: &AppHandle, patch: &Value) {
    let has = |keys: &[&str]| keys.iter().any(|k| patch.get(k).is_some());
    if has(&["feedEnabled", "feedSources", "feedGoogleTopics", "feedCustomUrls", "feedRefreshMinutes", "modules"]) {
        kick(app);
    } else if has(&["feedAutoSummary", "feedAutoSummaryBatch", "feedSummaryLang", "feedPonySummary"]) {
        spawn_background_batch(app);
    }
}

fn cache_path(app: &AppHandle) -> PathBuf {
    app.state::<App>().data_dir.join("feed-cache.json")
}

fn rewrite_github_og_to_avatar(img_url: &str, item_url: &str) -> Option<String> {
    if !img_url.contains("opengraph.githubassets.com") {
        return None;
    }
    if let Some((owner, _)) = github_repo_slug(item_url) {
        return Some(format!("https://github.com/{owner}.png?size=128"));
    }
    // `https://opengraph.githubassets.com/<hash>/<owner>/<repo>`
    let after = img_url.split("opengraph.githubassets.com/").nth(1)?;
    let mut segs = after.split('/').filter(|s| !s.is_empty());
    let _hash = segs.next()?;
    let owner = segs.next()?;
    (!owner.is_empty()).then(|| format!("https://github.com/{owner}.png?size=128"))
}

fn load_cache(app: &AppHandle) -> FeedCache {
    let p = cache_path(app);
    let mut cache: FeedCache = std::fs::read(&p)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default();
    // Migrate any previously cached GitHub OpenGraph card thumbnails to clean owner profile avatars
    for it in &mut cache.items {
        if let Some(av) = rewrite_github_og_to_avatar(&it.image, &it.url) {
            it.image = av;
        }
    }
    for img in cache.images.values_mut() {
        if let Some(av) = rewrite_github_og_to_avatar(img, "") {
            *img = av;
        }
    }
    cache
}

fn save_cache(app: &AppHandle, cache: &FeedCache) {
    let p = cache_path(app);
    if let Ok(bytes) = serde_json::to_vec(cache) {
        let tmp = p.with_extension("json.tmp");
        if std::fs::write(&tmp, &bytes).is_ok() {
            let _ = std::fs::rename(&tmp, &p);
        }
    }
}

fn feed_module_enabled(s: &Value) -> bool {
    if s["feedEnabled"] == false {
        return false;
    }
    s["modules"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .find(|m| m["id"].as_str() == Some("feed"))
                .map(|m| m["on"] != false)
                .unwrap_or(true)
        })
        .unwrap_or(true)
}

fn payload_from(cache: &FeedCache) -> Value {
    json!({
        "items": cache.items,
        "updatedAt": cache.updated_at,
        "errors": cache.errors,
        "favicons": cache.favicons,
        "images": cache.images,
        "summaries": cache.summaries,
    })
}

/// Fetches a publisher's authentic favicon directly from its origin (no third-party tracker proxy)
/// using `services::http::get_public_bytes` (SSRF + DNS-rebinding safe).
fn fetch_origin_favicon(site_url: &str) -> Option<String> {
    if !services::http::is_public_url(site_url) {
        return None;
    }
    let mut candidates: Vec<String> = Vec::new();
    if let Ok((200, _, body)) = services::http::get_public_bytes(site_url, 512 << 10) {
        let html = String::from_utf8_lossy(&body);
        let (_, icons) = services::bookmarks::page_meta(&html, site_url);
        candidates.extend(icons.into_iter().take(4));
    }
    let fallback = services::bookmarks::absolute(site_url, "/favicon.ico");
    if !candidates.contains(&fallback) {
        candidates.push(fallback);
    }
    for ico_url in candidates {
        if !services::http::is_public_url(&ico_url) {
            continue;
        }
        let Ok((200, ct, bytes)) = services::http::get_public_bytes(&ico_url, MAX_ICON_BYTES) else {
            continue;
        };
        if bytes.is_empty() {
            continue;
        }
        let low_ct = ct.to_ascii_lowercase();
        let mime = if low_ct.starts_with("image/") {
            low_ct.split(';').next().unwrap_or("image/png").to_string()
        } else if ico_url.to_ascii_lowercase().ends_with(".ico") {
            "image/x-icon".into()
        } else if ico_url.to_ascii_lowercase().ends_with(".svg") {
            "image/svg+xml".into()
        } else if ico_url.to_ascii_lowercase().ends_with(".png") {
            "image/png".into()
        } else {
            continue;
        };
        return Some(format!(
            "data:{mime};base64,{}",
            base64::engine::general_purpose::STANDARD.encode(&bytes)
        ));
    }
    None
}

fn fetch_hn(limit: usize) -> Result<Vec<FeedItem>, String> {
    let (status, _, body) = services::http::get_public_bytes(
        "https://hacker-news.firebaseio.com/v0/topstories.json",
        512 << 10,
    )
    .map_err(|_| "Couldn't reach Hacker News".to_string())?;
    if status != 200 {
        return Err(format!("Hacker News answered HTTP {status}"));
    }
    let ids: Vec<u64> = serde_json::from_slice(&body).map_err(|_| "Invalid Hacker News response".to_string())?;
    let top: Vec<u64> = ids.into_iter().take(limit.clamp(4, 16)).collect();
    let results: Vec<Option<FeedItem>> = std::thread::scope(|s| {
        let handles: Vec<_> = top
            .into_iter()
            .map(|id| {
                s.spawn(move || {
                    let url = format!("https://hacker-news.firebaseio.com/v0/item/{id}.json");
                    let (st, _, b) = services::http::get_public_bytes(&url, 128 << 10).ok()?;
                    if st != 200 {
                        return None;
                    }
                    let v: Value = serde_json::from_slice(&b).ok()?;
                    parse_hn_item(&v)
                })
            })
            .collect();
        handles.into_iter().map(|h| h.join().ok().flatten()).collect()
    });
    Ok(results.into_iter().flatten().collect())
}

fn fetch_github_trending(now_ms: i64, limit: usize) -> Result<Vec<FeedItem>, String> {
    if let Ok((200, _, body)) = services::http::get_public_bytes("https://github.com/trending", MAX_FEED_BYTES) {
        let html = String::from_utf8_lossy(&body);
        let items = parse_github_trending_html(&html, now_ms, limit);
        if !items.is_empty() {
            return Ok(items);
        }
    }
    // Resilient fallback: GitHub public repository search for hot repos created in the last 14 days
    let since = (chrono::Utc::now() - chrono::Duration::days(14))
        .format("%Y-%m-%d")
        .to_string();
    let api_url = format!(
        "https://api.github.com/search/repositories?q=created:>{since}&sort=stars&order=desc&per_page={limit}"
    );
    let (status, _, body) = services::http::get_public_bytes(&api_url, 1 << 20)
        .map_err(|_| "Couldn't reach GitHub Trending".to_string())?;
    if status != 200 {
        return Err(format!("GitHub Trending answered HTTP {status}"));
    }
    let v: Value = serde_json::from_slice(&body).map_err(|_| "Invalid GitHub response".to_string())?;
    Ok(parse_github_search_fallback(&v, now_ms, limit))
}

#[derive(Clone)]
struct FetchJob {
    id: String,
    name: String,
    category: String,
    brand: String,
    color: String,
    kind: String,
    url: String,
    site_url: String,
    limit: usize,
}

fn build_jobs(s: &Value) -> Vec<FetchJob> {
    let mut jobs = Vec::new();
    let enabled_ids: Vec<String> = s["feedSources"]
        .as_array()
        .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_else(|| {
            services::feed::PRESETS
                .iter()
                .filter(|p| p.default_on)
                .map(|p| p.id.to_string())
                .collect()
        });

    for id in enabled_ids {
        if let Some(p) = preset_by_id(&id) {
            jobs.push(FetchJob {
                id: p.id.into(),
                name: p.name.into(),
                category: p.category.into(),
                brand: p.brand.into(),
                color: p.color.into(),
                kind: p.kind.into(),
                url: p.url.into(),
                site_url: p.site_url.into(),
                limit: 12,
            });
        }
    }

    if let Some(topics) = s["feedGoogleTopics"].as_array() {
        for raw in topics.iter().take(12) {
            let topic = raw.as_str().unwrap_or("").trim();
            if topic.is_empty() {
                continue;
            }
            let slug = stable_id("gtopic", topic, topic);
            jobs.push(FetchJob {
                id: slug,
                name: format!("Google News · {topic}"),
                category: "topics".into(),
                brand: "gnews".into(),
                color: "#4285f4".into(),
                kind: "rss".into(),
                url: google_news_topic_url(topic),
                site_url: "https://news.google.com".into(),
                limit: 8,
            });
        }
    }

    if let Some(customs) = s["feedCustomUrls"].as_array() {
        for (idx, raw) in customs.iter().take(20).enumerate() {
            let url = raw["url"].as_str().unwrap_or("").trim();
            if url.is_empty() || !services::http::is_public_url(url) {
                continue;
            }
            let host = host_of(url);
            let name = raw["name"]
                .as_str()
                .map(str::trim)
                .filter(|n| !n.is_empty())
                .map(String::from)
                .unwrap_or_else(|| if host.is_empty() { format!("Custom RSS {}", idx + 1) } else { host.clone() });
            let color = raw["color"]
                .as_str()
                .filter(|c| c.starts_with('#') && c.len() == 7)
                .unwrap_or("#f59e0b")
                .to_string();
            let id = raw["id"]
                .as_str()
                .filter(|x| !x.is_empty())
                .map(String::from)
                .unwrap_or_else(|| stable_id("custom", url, &name));
            let origin = format!("https://{host}");
            jobs.push(FetchJob {
                id,
                name,
                category: "custom".into(),
                brand: "favicon".into(),
                color,
                kind: "rss".into(),
                url: url.to_string(),
                site_url: origin,
                limit: 10,
            });
        }
    }

    jobs
}

fn run_job(job: &FetchJob, now_ms: i64) -> Result<Vec<FeedItem>, String> {
    match job.kind.as_str() {
        "hn" => fetch_hn(job.limit),
        "github_trending" => fetch_github_trending(now_ms, job.limit),
        _ => {
            if !services::http::is_public_url(&job.url) {
                return Err("Refused non-public feed URL".into());
            }
            let (status, _, body) = services::http::get_public_bytes(&job.url, MAX_FEED_BYTES)
                .map_err(|_| format!("Couldn't reach {}", job.name))?;
            if !(200..300).contains(&status) {
                return Err(format!("{} answered HTTP {status}", job.name));
            }
            let xml = String::from_utf8_lossy(&body);
            let items = parse_rss_or_atom(
                &xml,
                &job.id,
                &job.name,
                &job.category,
                &job.brand,
                &job.color,
                &job.site_url,
                job.limit,
            );
            if items.is_empty() {
                return Err(format!("No RSS/Atom entries found in {}", job.name));
            }
            Ok(items)
        }
    }
}

/// Refreshes all enabled sources in parallel, warms missing authentic site favicons, persists cache, and emits `feed`.
fn refresh(app: &AppHandle) -> Value {
    let feed_state = app.state::<Feed>();
    let _guard = feed_state.refreshing.lock().unwrap();
    let s = app.state::<App>().settings.get();
    if !feed_module_enabled(&s) {
        let cache = feed_state.cache.lock().unwrap();
        return payload_from(&cache);
    }
    let jobs = build_jobs(&s);
    if jobs.is_empty() {
        let mut cache = feed_state.cache.lock().unwrap();
        cache.items.clear();
        cache.errors.clear();
        cache.updated_at = chrono::Utc::now().timestamp_millis();
        save_cache(app, &cache);
        let v = payload_from(&cache);
        let _ = app.emit("feed", &v);
        return v;
    }

    let now_ms = chrono::Utc::now().timestamp_millis();
    let results: Vec<(String, Result<Vec<FeedItem>, String>)> = std::thread::scope(|scope| {
        let handles: Vec<_> = jobs
            .iter()
            .map(|job| {
                let id = job.id.clone();
                scope.spawn(move || (id, run_job(job, now_ms)))
            })
            .collect();
        handles
            .into_iter()
            .filter_map(|h| h.join().ok())
            .collect()
    });

    let mut all_items = Vec::new();
    let mut errors = HashMap::new();
    for (id, res) in results {
        match res {
            Ok(items) => all_items.extend(items),
            Err(err) => {
                errors.insert(id, err);
            }
        }
    }

    // Hydrate any previously cached og:image thumbnails onto fresh items before emitting
    let mut merged = merge_and_dedupe(all_items, MAX_ITEMS_TOTAL);
    {
        let cache = feed_state.cache.lock().unwrap();
        for it in &mut merged {
            if it.image.is_empty() {
                if let Some(img) = cache.images.get(&it.id) {
                    it.image = img.clone();
                }
            }
        }
    }

    // Emit & persist feed items immediately so the UI is snappy (~2s), then warm missing publisher
    // favicons and og:image article thumbnails in the background and re-emit when ready.
    let v = {
        let mut cache = feed_state.cache.lock().unwrap();
        if !merged.is_empty() || errors.is_empty() {
            cache.items = merged.clone();
        }
        cache.errors = errors;
        cache.updated_at = now_ms;
        save_cache(app, &cache);
        payload_from(&cache)
    };
    app.state::<App>().log.line(&format!(
        "feed: refreshed {} items ({} errors)",
        v["items"].as_array().map(|a| a.len()).unwrap_or(0),
        v["errors"].as_object().map(|m| m.len()).unwrap_or(0)
    ));
    let _ = app.emit("feed", &v);

    // Collect authentic favicon hosts AND articles missing thumbnails (e.g. HN stories, plain RSS blogs)
    let mut needed_hosts: Vec<String> = Vec::new();
    let mut needed_thumbs: Vec<(String, String)> = Vec::new();
    {
        let cache = feed_state.cache.lock().unwrap();
        let failed = feed_state.failed_icons.lock().unwrap();
        let failed_img = feed_state.failed_images.lock().unwrap();
        let mut seen = HashSet::new();
        for job in &jobs {
            if job.brand == "favicon" {
                let h = host_of(&job.site_url);
                if !h.is_empty() && !cache.favicons.contains_key(&h) && !failed.contains(&h) && seen.insert(h.clone()) {
                    needed_hosts.push(h);
                }
            }
        }
        for it in &merged {
            if !it.icon_host.is_empty()
                && (it.brand == "favicon" || it.brand == "gnews")
                && it.icon_host != "news.google.com"
                && !cache.favicons.contains_key(&it.icon_host)
                && !failed.contains(&it.icon_host)
                && seen.insert(it.icon_host.clone())
                && needed_hosts.len() < 18
            {
                needed_hosts.push(it.icon_host.clone());
            }
            if it.image.is_empty()
                && !cache.images.contains_key(&it.id)
                && !failed_img.contains(&it.id)
                && !it.url.is_empty()
                && host_of(&it.url) != "news.google.com"
                && host_of(&it.url) != "news.ycombinator.com"
                && services::http::is_public_url(&it.url)
                && needed_thumbs.len() < 45
            {
                needed_thumbs.push((it.id.clone(), it.url.clone()));
            }
        }
    }

    if !needed_hosts.is_empty() || !needed_thumbs.is_empty() {
        let bg = app.clone();
        let active_hosts: HashSet<String> = merged.iter().map(|i| i.icon_host.clone()).collect();
        let active_ids: HashSet<String> = merged.iter().map(|i| i.id.clone()).collect();
        std::thread::spawn(move || {
            let (fetched_icons, fetched_thumbs): (Vec<(String, Option<String>)>, Vec<(String, Option<String>)>) =
                std::thread::scope(|scope| {
                    let ico_handles: Vec<_> = needed_hosts
                        .into_iter()
                        .map(|host| {
                            scope.spawn(move || {
                                let url = format!("https://{host}");
                                (host, fetch_origin_favicon(&url))
                            })
                        })
                        .collect();
                    let thumb_handles: Vec<_> = needed_thumbs
                        .into_iter()
                        .map(|(id, url)| {
                            scope.spawn(move || {
                                let img = services::http::get_public_bytes(&url, 320 << 10)
                                    .ok()
                                    .filter(|(st, _, _)| *st == 200)
                                    .and_then(|(_, _, bytes)| {
                                        let html = String::from_utf8_lossy(&bytes);
                                        extract_og_image(&html, &url)
                                    });
                                (id, img)
                            })
                        })
                        .collect();
                    (
                        ico_handles.into_iter().filter_map(|h| h.join().ok()).collect(),
                        thumb_handles.into_iter().filter_map(|h| h.join().ok()).collect(),
                    )
                });
            let mut changed = 0usize;
            let next_v = {
                let st = bg.state::<Feed>();
                let mut cache = st.cache.lock().unwrap();
                let mut failed = st.failed_icons.lock().unwrap();
                let mut failed_img = st.failed_images.lock().unwrap();
                for (host, ico) in fetched_icons {
                    if let Some(data_uri) = ico {
                        cache.favicons.insert(host, data_uri);
                        changed += 1;
                    } else {
                        failed.insert(host);
                    }
                }
                for (id, img) in fetched_thumbs {
                    if let Some(img_url) = img {
                        cache.images.insert(id.clone(), img_url.clone());
                        if let Some(item) = cache.items.iter_mut().find(|i| i.id == id) {
                            item.image = img_url;
                        }
                        changed += 1;
                    } else {
                        failed_img.insert(id);
                    }
                }
                if cache.favicons.len() > MAX_FAVICONS_CACHED {
                    cache.favicons.retain(|k, _| active_hosts.contains(k));
                }
                if cache.images.len() > MAX_IMAGES_CACHED {
                    cache.images.retain(|k, _| active_ids.contains(k));
                }
                if changed > 0 {
                    save_cache(&bg, &cache);
                    Some(payload_from(&cache))
                } else {
                    None
                }
            };
            if let Some(payload) = next_v {
                let _ = bg.emit("feed", &payload);
            }
        });
    }

    // Optional opt-in background batch auto-summarization for newest unsummarized stories
    spawn_background_batch(app);

    v
}

/// Pre-summarizes up to `feedAutoSummaryBatch` newest unsummarized items in the background when
/// `feedAutoSummary` is enabled, emitting incremental `feed` updates so cached badges light up live.
fn spawn_background_batch(app: &AppHandle) {
    let Some(feed_state) = app.try_state::<Feed>() else {
        return;
    };
    let s = app.state::<App>().settings.get();
    if !feed_module_enabled(&s) || s["feedPonySummary"] == false || s["feedAutoSummary"] != true {
        return;
    }
    if feed_state
        .auto_summarizing
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }
    let bg = app.clone();
    std::thread::spawn(move || {
        struct Reset(AppHandle);
        impl Drop for Reset {
            fn drop(&mut self) {
                if let Some(f) = self.0.try_state::<Feed>() {
                    f.auto_summarizing.store(false, Ordering::SeqCst);
                }
            }
        }
        let _reset = Reset(bg.clone());

        let lang = effective_summary_lang(&bg);
        let batch_size = bg.state::<App>().settings.get()["feedAutoSummaryBatch"]
            .as_u64()
            .unwrap_or(5)
            .clamp(1, 15) as usize;

        let targets: Vec<FeedItem> = {
            let st = bg.state::<Feed>();
            let cache = st.cache.lock().unwrap();
            cache
                .items
                .iter()
                .filter(|it| {
                    let key = summary_cache_key(&it.id, &lang);
                    !cache.summaries.contains_key(&key)
                })
                .take(batch_size)
                .cloned()
                .collect()
        };

        if targets.is_empty() {
            return;
        }
        bg.state::<App>().log.line(&format!(
            "feed: background auto-summary starting ({} stories, lang={lang})",
            targets.len()
        ));

        let mut done = 0usize;
        for it in targets {
            let cur_s = bg.state::<App>().settings.get();
            if !feed_module_enabled(&cur_s) || cur_s["feedPonySummary"] == false || cur_s["feedAutoSummary"] != true {
                break;
            }
            let cur_lang = effective_summary_lang(&bg);
            let source = if !it.publisher.is_empty() {
                it.publisher.as_str()
            } else {
                it.source_name.as_str()
            };
            let args = vec![
                json!(it.id),
                json!(it.url),
                json!(it.title),
                json!(source),
                json!(it.snippet),
                json!(false),
                json!(cur_lang),
            ];
            let res = summarize_item(&bg, &args);
            if res["ok"] == true {
                done += 1;
                let payload = {
                    let st = bg.state::<Feed>();
                    let p = payload_from(&st.cache.lock().unwrap());
                    p
                };
                let _ = bg.emit("feed", &payload);
            } else {
                // Stop batch early if AI provider isn't configured, signed out, or rate-limited
                bg.state::<App>().log.line(&format!(
                    "feed: background auto-summary stopped early: {}",
                    res["error"].as_str().unwrap_or("error")
                ));
                break;
            }
            std::thread::sleep(Duration::from_millis(350));
        }

        if done > 0 {
            bg.state::<App>().log.line(&format!("feed: background auto-summary cached {done} stories"));
        }
    });
}

/// Validates and previews a user-supplied custom RSS/Atom URL (plus fetches its real site favicon).
fn test_feed_url(url: &str) -> Value {
    let trimmed = url.trim();
    if !services::http::is_public_url(trimmed) {
        return json!({
            "ok": false,
            "error": "Paste a valid public https:// RSS or Atom feed URL.",
        });
    }
    let (status, _, body) = match services::http::get_public_bytes(trimmed, MAX_FEED_BYTES) {
        Ok(res) => res,
        Err(_) => return json!({ "ok": false, "error": "Couldn't reach that feed URL." }),
    };
    if !(200..300).contains(&status) {
        return json!({ "ok": false, "error": format!("Feed server answered HTTP {status}.") });
    }
    let xml = String::from_utf8_lossy(&body);
    let host = host_of(trimmed);
    let origin = format!("https://{host}");
    let title = feed_title(&xml).unwrap_or_else(|| host.clone());
    let items = parse_rss_or_atom(&xml, "test", &title, "custom", "favicon", "#f59e0b", &origin, 5);
    if items.is_empty() {
        return json!({
            "ok": false,
            "error": "No RSS 2.0 or Atom entries found at that URL.",
        });
    }
    let icon = fetch_origin_favicon(&origin);
    json!({
        "ok": true,
        "title": title,
        "host": host,
        "count": items.len(),
        "sample": items.first().map(|i| i.title.as_str()).unwrap_or(""),
        "icon": icon,
    })
}

fn effective_summary_lang(app: &AppHandle) -> String {
    let s = app.state::<App>().settings.get();
    let feed_pref = s["feedSummaryLang"].as_str().unwrap_or("auto").trim();
    if !feed_pref.is_empty() && feed_pref != "auto" {
        return feed_pref.to_string();
    }
    let pref = s["language"].as_str().unwrap_or("auto");
    if pref != "auto" && !pref.trim().is_empty() {
        return pref.to_string();
    }
    // When "auto", inspect system locale env or voiceLanguage preference as hint
    let env_lang = std::env::var("LC_ALL")
        .or_else(|_| std::env::var("LANG"))
        .unwrap_or_default()
        .to_ascii_lowercase();
    if env_lang.starts_with("id") || s["voiceLanguage"].as_str() == Some("id") {
        "id".into()
    } else {
        "en".into()
    }
}

/// Fetches top Hacker News comments + Show/Ask HN author text for `hn-{id}` stories in parallel (~250ms)
/// so visual demos, photo galleries, and technical posts get rich expert discussion context.
fn fetch_hn_discussion_context(hn_id: u64) -> String {
    let story_url = format!("https://hacker-news.firebaseio.com/v0/item/{hn_id}.json");
    let Ok((200, _, story_bytes)) = services::http::get_public_bytes(&story_url, 128 << 10) else {
        return String::new();
    };
    let Ok(story) = serde_json::from_slice::<Value>(&story_bytes) else {
        return String::new();
    };
    let mut parts = Vec::new();
    if let Some(post_text) = story["text"].as_str() {
        let cleaned = services::feed::clean_text(&post_text.replace("<p>", "\n"));
        if cleaned.chars().count() >= 20 {
            parts.push(format!("Author post on HN: {cleaned}"));
        }
    }
    let kid_ids: Vec<u64> = story["kids"]
        .as_array()
        .map(|a| a.iter().filter_map(Value::as_u64).take(6).collect())
        .unwrap_or_default();
    if !kid_ids.is_empty() {
        let comments: Vec<Value> = std::thread::scope(|scope| {
            let handles: Vec<_> = kid_ids
                .into_iter()
                .map(|cid| {
                    scope.spawn(move || {
                        let cu = format!("https://hacker-news.firebaseio.com/v0/item/{cid}.json");
                        let (st, _, b) = services::http::get_public_bytes(&cu, 64 << 10).ok()?;
                        (st == 200).then(|| serde_json::from_slice::<Value>(&b).ok()).flatten()
                    })
                })
                .collect();
            handles.into_iter().filter_map(|h| h.join().ok().flatten()).collect()
        });
        let formatted = format_hn_comments(&comments, 2200);
        if !formatted.is_empty() {
            parts.push(format!("Top Hacker News technical discussion:\n{formatted}"));
        }
    }
    parts.join("\n\n")
}

/// Summarizes a feed item into 3 crisp Pony bullet points (cached locally per language so re-opens cost 0 tokens).
fn summarize_item(app: &AppHandle, args: &[Value]) -> Value {
    let id = args.first().and_then(Value::as_str).unwrap_or("").trim();
    let url = args.get(1).and_then(Value::as_str).unwrap_or("").trim();
    let title = args.get(2).and_then(Value::as_str).unwrap_or("").trim();
    let source = args.get(3).and_then(Value::as_str).unwrap_or("Feed").trim();
    let snippet = args.get(4).and_then(Value::as_str).unwrap_or("").trim();
    let force = args.get(5).and_then(Value::as_bool).unwrap_or(false);
    let explicit_lang = args.get(6).and_then(Value::as_str).map(str::trim).filter(|l| !l.is_empty() && *l != "auto");

    if title.is_empty() && url.is_empty() {
        return json!({ "ok": false, "error": "Missing article title or URL." });
    }
    let lang = explicit_lang
        .map(String::from)
        .unwrap_or_else(|| effective_summary_lang(app));
    let base_id = if !id.is_empty() {
        id.to_string()
    } else {
        stable_id("sum", url, title)
    };
    let cache_key = summary_cache_key(&base_id, &lang);

    if !force {
        let hit = {
            let feed_state = app.state::<Feed>();
            let cached = feed_state.cache.lock().unwrap().summaries.get(&cache_key).cloned();
            cached
        };
        if let Some(hit) = hit {
            return json!({
                "ok": true,
                "id": base_id,
                "key": cache_key,
                "lang": lang,
                "summary": hit.summary,
                "bullets": hit.bullets,
                "source": hit.source,
                "cached": true,
            });
        }
    }

    // Gather rich source context: GitHub raw README, article HTML + JSON-LD + meta, Sympony web fallback, & HN discussion
    let mut sections: Vec<String> = Vec::new();
    let mut from_article = false;

    if let Some((owner, repo)) = github_repo_slug(url) {
        for readme_name in ["README.md", "readme.md", "README.rst"] {
            let raw_url = format!("https://raw.githubusercontent.com/{owner}/{repo}/HEAD/{readme_name}");
            if let Ok((200, _, bytes)) = services::http::get_public_bytes(&raw_url, 256 << 10) {
                let md = String::from_utf8_lossy(&bytes);
                let trimmed_md: String = md.chars().take(5200).collect();
                if trimmed_md.chars().count() >= 60 {
                    sections.push(format!("Repository {owner}/{repo} README:\n{trimmed_md}"));
                    from_article = true;
                    break;
                }
            }
        }
    }

    if sections.is_empty() && !url.is_empty() && services::http::is_public_url(url) && host_of(url) != "news.google.com" {
        if let Ok((200, ct, bytes)) = services::http::get_public_bytes(url, MAX_FEED_BYTES) {
            let low_ct = ct.to_ascii_lowercase();
            if low_ct.contains("text/") || low_ct.contains("html") || low_ct.contains("xml") || low_ct.is_empty() {
                let html = String::from_utf8_lossy(&bytes);
                // Opportunistically populate thumbnail if still missing
                if let Some(found_img) = extract_og_image(&html, url) {
                    let feed_state = app.state::<Feed>();
                    let mut cache = feed_state.cache.lock().unwrap();
                    if !cache.images.contains_key(&base_id) {
                        cache.images.insert(base_id.clone(), found_img.clone());
                        if let Some(it) = cache.items.iter_mut().find(|i| i.id == base_id) {
                            if it.image.is_empty() {
                                it.image = found_img;
                            }
                        }
                    }
                }
                let extracted = extract_article_text(&html, 5500);
                if extracted.chars().count() >= 45 {
                    sections.push(extracted);
                    from_article = true;
                }
            }
        }
    }

    // Sympony AI `/v1/fetch` or `/v1/search` enrichment when direct HTTP text is thin (e.g. Google News / JS SPA)
    if sections.iter().map(|s| s.chars().count()).sum::<usize>() < 180 {
        if let Some(web_extra) = crate::brain::fetch_article_fallback(app, url, title) {
            sections.push(web_extra);
            from_article = true;
        }
    }

    if !snippet.is_empty() && !sections.iter().any(|s| s.contains(snippet)) {
        sections.insert(0, format!("Feed excerpt / related coverage: {snippet}"));
    }

    if let Some(hn_num) = base_id.strip_prefix("hn-").and_then(|n| n.parse::<u64>().ok()) {
        let hn_ctx = fetch_hn_discussion_context(hn_num);
        if !hn_ctx.is_empty() {
            sections.push(hn_ctx);
            from_article = true;
        }
    }

    let body_text = sections.join("\n\n");

    let (system, user_prompt) = summary_prompt(title, source, url, &body_text, &lang);
    // Run with session=None so zero tools/exec/hands are ever exposed to untrusted web article text!
    match crate::agents::ask(app, "chatAgent", &user_prompt, &system, false) {
        Ok(raw) => {
            let trimmed = raw.trim().to_string();
            let bullets = parse_summary_bullets(&trimmed);
            let src_label = if from_article { "article" } else { "snippet" }.to_string();
            let entry = CachedSummary {
                summary: trimmed.clone(),
                bullets: bullets.clone(),
                source: src_label.clone(),
                at: chrono::Utc::now().timestamp_millis(),
            };
            {
                let feed_state = app.state::<Feed>();
                let mut cache = feed_state.cache.lock().unwrap();
                cache.summaries.insert(cache_key.clone(), entry);
                // Evict oldest summaries if over cap
                if cache.summaries.len() > MAX_SUMMARIES_CACHED {
                    let mut pairs: Vec<(String, i64)> = cache.summaries.iter().map(|(k, v)| (k.clone(), v.at)).collect();
                    pairs.sort_by_key(|(_, at)| *at);
                    for (old_k, _) in pairs.into_iter().take(cache.summaries.len() - MAX_SUMMARIES_CACHED) {
                        cache.summaries.remove(&old_k);
                    }
                }
                save_cache(app, &cache);
            }
            json!({
                "ok": true,
                "id": base_id,
                "key": cache_key,
                "lang": lang,
                "summary": trimmed,
                "bullets": bullets,
                "source": src_label,
                "cached": false,
            })
        }
        Err(e) => json!({ "ok": false, "error": e }),
    }
}

pub fn register(reg: &mut services::Registry, app: &AppHandle) {
    let (tx, rx) = channel::<()>();
    app.manage(Feed {
        cache: Mutex::new(FeedCache::default()),
        failed_icons: Mutex::new(HashSet::new()),
        failed_images: Mutex::new(HashSet::new()),
        refreshing: Mutex::new(()),
        auto_summarizing: AtomicBool::new(false),
        kick: Mutex::new(tx),
    });

    reg.add("feed.presets", Box::new(|_, _| Ok(presets_json())));

    let h = app.clone();
    reg.add("feed.get", Box::new(move |_, _| {
        let payload = {
            let feed = h.state::<Feed>();
            let cache = feed.cache.lock().unwrap();
            payload_from(&cache)
        };
        let empty = payload["items"].as_array().map(|a| a.is_empty()).unwrap_or(true);
        if empty {
            kick(&h);
        }
        Ok(payload)
    }));

    let h = app.clone();
    reg.add("feed.refresh", Box::new(move |_, _| Ok(refresh(&h))));

    reg.add("feed.test", Box::new(|_, a| {
        let url = a.first().and_then(Value::as_str).unwrap_or("");
        Ok(test_feed_url(url))
    }));

    let h = app.clone();
    reg.add("feed.summarize", Box::new(move |_, a| Ok(summarize_item(&h, &a))));

    let h = app.clone();
    std::thread::spawn(move || {
        while h.try_state::<App>().is_none() {
            std::thread::sleep(Duration::from_millis(200));
        }
        // Load persisted disk cache immediately so the Feed tab is never blank on startup
        let initial = load_cache(&h);
        let stale = {
            let feed = h.state::<Feed>();
            let mut cache = feed.cache.lock().unwrap();
            *cache = initial;
            let now = chrono::Utc::now().timestamp_millis();
            let mins = h.state::<App>().settings.get()["feedRefreshMinutes"].as_i64().unwrap_or(30);
            let missing_all_thumbs = !cache.items.is_empty()
                && cache.images.is_empty()
                && cache.items.iter().all(|i| i.image.is_empty());
            cache.items.is_empty()
                || missing_all_thumbs
                || (mins > 0 && now - cache.updated_at >= mins * 60_000)
        };
        {
            let feed = h.state::<Feed>();
            let v = payload_from(&feed.cache.lock().unwrap());
            let _ = h.emit("feed", &v);
        }
        if stale {
            refresh(&h);
        } else {
            spawn_background_batch(&h);
        }
        loop {
            let mins = h.state::<App>().settings.get()["feedRefreshMinutes"].as_u64().unwrap_or(30);
            if mins == 0 {
                // Manual mode: sleep until kicked by settings change or manual refresh
                if rx.recv().is_err() {
                    break;
                }
            } else {
                let wait = Duration::from_secs(mins.clamp(5, 240) * 60);
                let _ = rx.recv_timeout(wait);
            }
            // Drain coalesced kicks from rapid settings toggles
            while rx.try_recv().is_ok() {}
            refresh(&h);
        }
    });
}
