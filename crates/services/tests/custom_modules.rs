use serde_json::{json, Value};
use services::backup::settings_for_import_checked;
use services::custom_modules::{
    apply_action, delete_module, extract_json_path, interpolate_header, interpolate_url,
    is_builtin_id, list_manifests, read_config, read_manifest, read_state, save_manifest,
    validate_manifest, validate_public_domain, validate_slug, write_config, write_state,
};

fn sample_manifest(slug: &str, domains: &[&str]) -> Value {
    let mut ds = vec![];
    if let Some(d) = domains.first() {
        ds.push(json!({
            "id": "mkt",
            "kind": "http",
            "method": "GET",
            "url": format!("https://{d}/api/price?sym={{{{config.symbol}}}}"),
            "headers": { "X-Api-Key": "Bearer {{secret.apiKey}}" },
            "pollSeconds": 60,
            "extract": { "btc": "bitcoin.usd", "series": "history.*.price" }
        }));
    }
    json!({
        "schemaVersion": 1,
        "slug": slug,
        "name": "Crypto Pulse",
        "description": "Live BTC tracker",
        "icon": "TrendingUp",
        "accent": "emerald",
        "defaultSize": "2x1",
        "permissions": { "httpDomains": domains },
        "configSchema": [
            { "key": "symbol", "label": "Symbol", "type": "text", "default": "BTC" },
            { "key": "apiKey", "label": "API Key", "type": "secret" }
        ],
        "initialState": { "count": 2, "done": false, "logs": [] },
        "dataSources": ds,
        "actions": {
            "refresh": { "kind": "refresh" },
            "bump": { "kind": "increment", "stateKey": "count", "delta": 1, "min": 0, "max": 5 },
            "flip": { "kind": "toggleState", "stateKey": "done" },
            "addLog": { "kind": "appendItem", "stateKey": "logs", "maxItems": 3 },
            "delLog": { "kind": "removeItem", "stateKey": "logs" },
            "reset": { "kind": "resetState" }
        },
        "view": {
            "compact": {
                "type": "stack",
                "dir": "col",
                "gap": "sm",
                "children": [
                    { "type": "header", "title": "Crypto Pulse", "rightAction": "refresh" },
                    { "type": "metric", "label": "BTC", "value": "{{mkt.btc | currency:USD}}" },
                    { "type": "button", "label": "+1", "action": "bump" }
                ]
            }
        }
    })
}

fn temp_dir(tag: &str) -> std::path::PathBuf {
    let p = std::env::temp_dir().join(format!(
        "sympony-cm-test-{tag}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let _ = std::fs::remove_dir_all(&p);
    std::fs::create_dir_all(&p).unwrap();
    p
}

#[test]
fn builtin_ids_are_immutable_and_slugs_validated() {
    for b in ["home", "calendar", "feed", "chat", "pomodoro", "notifs", "hitl", "dashboard"] {
        assert!(is_builtin_id(b));
        let err = validate_slug(b).unwrap_err();
        assert!(err.contains("immutable"), "expected immutable error for {b}, got {err}");
    }
    assert!(!is_builtin_id("custom:crypto-pulse"));
    assert!(validate_slug("crypto-pulse").is_ok());
    assert!(validate_slug("a").is_err());
    assert!(validate_slug("-bad").is_err());
    assert!(validate_slug("bad--slug").is_err());
    assert!(validate_slug("BadCase").is_err());
    assert!(validate_slug("custom:foo").is_err());
}

#[test]
fn domain_and_manifest_security_checks() {
    assert_eq!(validate_public_domain("API.CoinGecko.com").unwrap(), "api.coingecko.com");
    for bad in [
        "localhost",
        "foo.localhost",
        "printer.local",
        "127.0.0.1",
        "169.254.169.254",
        "*.example.com",
        "https://api.example.com",
        "api.example.com/path",
        "{{config.host}}",
    ] {
        assert!(validate_public_domain(bad).is_err(), "domain should fail: {bad}");
    }

    // Valid manifest passes and canonicalizes
    let m = validate_manifest(&sample_manifest("crypto-pulse", &["API.CoinGecko.com"])).unwrap();
    assert_eq!(m["id"], "custom:crypto-pulse");
    assert_eq!(m["permissions"]["httpDomains"], json!(["api.coingecko.com"]));

    // Undeclared URL host fails
    let mut bad_host = sample_manifest("bad-host", &["api.coingecko.com"]);
    bad_host["dataSources"][0]["url"] = json!("https://evil.example.com/steal");
    assert!(validate_manifest(&bad_host).is_err());

    // Secret in URL fails
    let mut secret_url = sample_manifest("secret-url", &["api.coingecko.com"]);
    secret_url["dataSources"][0]["url"] = json!("https://api.coingecko.com/v1?k={{secret.apiKey}}");
    assert!(validate_manifest(&secret_url).is_err());

    // Unknown action in button fails
    let mut bad_btn = sample_manifest("bad-btn", &[]);
    bad_btn["view"]["compact"]["children"][2]["action"] = json!("nonexistent");
    assert!(validate_manifest(&bad_btn).is_err());
}

#[test]
fn storage_crud_config_secret_isolation_and_state_actions() {
    let dir = temp_dir("crud");
    let m = save_manifest(&dir, &sample_manifest("my-tracker", &["api.coingecko.com"]), false).unwrap();
    assert_eq!(m["id"], "custom:my-tracker");

    // Overwrite without replace=true must fail
    assert!(save_manifest(&dir, &sample_manifest("my-tracker", &[]), false).is_err());
    // Overwrite with replace=true succeeds
    let updated = save_manifest(&dir, &sample_manifest("my-tracker", &["api.coingecko.com"]), true).unwrap();
    assert_eq!(list_manifests(&dir).len(), 1);
    assert_eq!(read_manifest(&dir, "my-tracker").unwrap()["slug"], "my-tracker");

    // Secrets must NEVER persist to config.json or be returned by read_config
    let cfg = write_config(&dir, "my-tracker", &updated, &json!({"symbol": "ETH", "apiKey": "SUPER_SECRET"})).unwrap();
    assert_eq!(cfg["symbol"], "ETH");
    assert!(cfg.get("apiKey").is_none());
    let cfg_disk = std::fs::read_to_string(dir.join("custom-modules/my-tracker/config.json")).unwrap();
    assert!(!cfg_disk.contains("SUPER_SECRET"));
    assert_eq!(read_config(&dir, "my-tracker", &updated)["symbol"], "ETH");

    // State actions: increment (clamped), toggleState, appendItem (capped), removeItem, resetState
    let mut st = read_state(&dir, "my-tracker", &updated);
    assert_eq!(st["count"], 2);
    st = apply_action(&updated, &st, "bump", &json!({}), 1000).unwrap();
    assert_eq!(st["count"], 3);
    st = apply_action(&updated, &st, "__step:count", &json!({"delta": 10, "max": 5}), 1001).unwrap();
    assert_eq!(st["count"], 5);
    st = apply_action(&updated, &st, "flip", &json!({}), 1002).unwrap();
    assert_eq!(st["done"], true);
    st = apply_action(&updated, &st, "addLog", &json!({"input": "Drink water"}), 1003).unwrap();
    assert_eq!(st["logs"][0]["title"], "Drink water");
    let item_id = st["logs"][0]["id"].as_str().unwrap().to_string();
    st = apply_action(&updated, &st, "delLog", &json!({"id": item_id}), 1004).unwrap();
    assert_eq!(st["logs"].as_array().unwrap().len(), 0);
    write_state(&dir, "my-tracker", &st).unwrap();
    assert_eq!(read_state(&dir, "my-tracker", &updated)["count"], 5);
    let reset = apply_action(&updated, &st, "reset", &json!({}), 1005).unwrap();
    assert_eq!(reset["count"], 2);
    assert_eq!(reset["done"], false);

    delete_module(&dir, "my-tracker").unwrap();
    assert!(list_manifests(&dir).is_empty());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn path_extraction_and_interpolation_work_safely() {
    let payload = json!({
        "bitcoin": { "usd": 92450.5 },
        "history": [
            { "price": 90000 },
            { "price": 91200 },
            { "price": 92450.5 }
        ]
    });
    assert_eq!(extract_json_path(&payload, "bitcoin.usd"), json!(92450.5));
    assert_eq!(extract_json_path(&payload, "history.1.price"), json!(91200));
    assert_eq!(extract_json_path(&payload, "history.*.price"), json!([90000, 91200, 92450.5]));
    assert_eq!(extract_json_path(&payload, "missing.key"), Value::Null);

    let url = interpolate_url(
        "https://api.coingecko.com/v1?q={{config.symbol}}",
        &json!({"symbol": "BTC/USD & ETH"}),
    )
    .unwrap();
    assert_eq!(url, "https://api.coingecko.com/v1?q=BTC%2FUSD%20%26%20ETH");
    assert!(interpolate_url("https://api.coingecko.com/?k={{secret.apiKey}}", &json!({})).is_err());

    let hdr = interpolate_header(
        "Bearer {{secret.apiKey}}",
        &json!({}),
        &json!({"apiKey": "tok123\r\nInjected: bad"}),
    );
    assert_eq!(hdr, "Bearer tok123Injected: bad");
}

#[test]
fn backup_import_disarms_custom_module_approved_domains() {
    let from = json!({
        "customModApprovedDomains": {
            "crypto-pulse": ["api.coingecko.com"]
        }
    });
    let (sanitized, disarmed) = settings_for_import_checked(&from, &json!({}), false);
    assert_eq!(sanitized["customModApprovedDomains"], json!({}));
    assert!(disarmed.contains(&"customModules"));

    assert!(services::backup::allowed_entry("custom-modules/"));
    assert!(services::backup::allowed_entry("custom-modules/crypto-pulse/"));
    assert!(services::backup::allowed_entry("custom-modules/crypto-pulse/module.json"));
    assert!(services::backup::allowed_entry("custom-modules/crypto-pulse/state.json"));
    assert!(services::backup::allowed_entry("custom-modules/crypto-pulse/config.json"));
    assert!(!services::backup::allowed_entry("custom-modules/crypto-pulse/evil.js"));
    assert!(!services::backup::allowed_entry("custom-modules/home/module.json"));
    assert!(!services::backup::allowed_entry("custom-modules/../secrets.json"));
}
