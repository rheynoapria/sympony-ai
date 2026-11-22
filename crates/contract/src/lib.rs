//! What the frontend calls and listens to, as data (contract.json: tools/extract_contract.py, then
//! tools/classify_contract.py). The single list of "what exists" and the base of the parity report.
use serde::Deserialize;
use std::sync::OnceLock;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Command,
    Method,
    Event,
}

/// `Mac`: supported on macOS. `Fix`: expected by the frontend and implemented in services.
/// `Excluded`: Windows-only or retired.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Class {
    Mac,
    Fix,
    Excluded,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Item {
    pub kind: Kind,
    /// "settings_get", "weather.get" (service.method) or "notch:hover"
    pub name: String,
    pub class: Class,
    pub phase: u8,
    /// what an unbuilt item answers: the "nothing here" the frontend copes with
    pub stub: serde_json::Value,
}

pub fn items() -> &'static [Item] {
    static ITEMS: OnceLock<Vec<Item>> = OnceLock::new();
    ITEMS.get_or_init(|| serde_json::from_str(include_str!("../contract.json")).expect("contract.json"))
}

pub fn find(kind: Kind, name: &str) -> Option<&'static Item> {
    items().iter().find(|i| i.kind == kind && i.name == name)
}
