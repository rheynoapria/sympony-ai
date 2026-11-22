use serde_json::json;
use services::wifi::{to_networks, Scan};

fn n(ssid: &str, rssi: i64, secure: bool, band: &str) -> Scan {
    Scan { ssid: ssid.into(), rssi, secure, enterprise: false, band: band.into() }
}

#[test]
fn wifi_rows() {
    let scan = vec![n("Cafe", -80, false, "2.4 GHz"), n("Home", -45, true, "5 GHz"), n("Home", -60, true, "2.4 GHz"), n("", -40, true, "5 GHz"), n("Office", -70, true, "5 GHz")];
    let v = to_networks(&scan, &["Office".to_string()], Some("Office"));
    assert_eq!((v["ok"].as_bool(), v["connected"].as_str()), (Some(true), Some("Office")));
    let ssids: Vec<&str> = v["networks"].as_array().unwrap().iter().map(|x| x["ssid"].as_str().unwrap()).collect();
    // connected first, then by signal; one row per name; hidden networks left out
    assert_eq!(ssids, vec!["Office", "Home", "Cafe"]);
    assert_eq!(v["networks"][1], json!({"ssid": "Home", "bars": 4, "secure": true, "saved": false, "connected": false, "band": "5 GHz", "enterprise": false}));
    assert_eq!((v["networks"][0]["saved"].as_bool(), v["networks"][0]["bars"].as_i64()), (Some(true), Some(3)));
    assert_eq!(v["networks"][2]["bars"], 1);
    assert_eq!(to_networks(&[], &[], None)["connected"], serde_json::Value::Null);
}
