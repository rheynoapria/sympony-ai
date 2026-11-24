//! The OS's own secret store. On macOS it's where older versions kept keys (`FileSecrets` moves them out); Windows
//! never had them there, so nothing is read and nothing is kept.

pub struct Keychain;

impl crate::Secrets for Keychain {
    fn get(&self, _key: &str) -> Option<String> {
        None
    }

    fn set(&self, _key: &str, _value: &str) -> anyhow::Result<()> {
        Ok(())
    }
}
