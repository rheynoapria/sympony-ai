use security_framework::passwords::{delete_generic_password, get_generic_password, set_generic_password};

/// Generic passwords in the login Keychain, service `app.sympony`, account = the setting's key.
pub struct Keychain;

const SERVICE: &str = "app.sympony";

impl crate::Secrets for Keychain {
    fn get(&self, key: &str) -> Option<String> {
        get_generic_password(SERVICE, key).ok().and_then(|b| String::from_utf8(b).ok()).filter(|s| !s.is_empty())
    }

    /// An empty value removes the key.
    fn set(&self, key: &str, value: &str) -> anyhow::Result<()> {
        if value.is_empty() {
            let _ = delete_generic_password(SERVICE, key);
            return Ok(());
        }
        Ok(set_generic_password(SERVICE, key, value.as_bytes())?)
    }
}

