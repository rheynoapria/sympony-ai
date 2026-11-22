//! Tokens and API keys in a private file, not the Keychain (the owner's choice: an app without an Apple Team ID is
//! known to the Keychain by its code hash, so it asked again after every update). `secrets.json` holds them encrypted
//! (AES-256-GCM, `sy1:` + base64(nonce ‖ ciphertext)) with the key in `secrets.key`, readable by this account only.
use aes_gcm::aead::{Aead, AeadCore, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::Engine;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub struct FileSecrets {
    file: PathBuf,
    key: [u8; 32],
    map: Mutex<BTreeMap<String, String>>,
}

fn b64() -> base64::engine::general_purpose::GeneralPurpose {
    base64::engine::general_purpose::STANDARD
}

/// The key in `dir/secrets.key`, made (mode 0600) when missing or unreadable.
fn key(dir: &Path) -> [u8; 32] {
    let _ = crate::paths::ensure_private_dir(dir);
    let path = dir.join("secrets.key");
    if let Some(k) = std::fs::read_to_string(&path).ok().and_then(|s| b64().decode(s.trim()).ok()).and_then(|v| <[u8; 32]>::try_from(v).ok()) {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
        }
        return k;
    }
    let k = crate::notif::new_key();
    let _ = std::fs::remove_file(&path);
    {
        use std::io::Write;
        let mut opts = std::fs::OpenOptions::new();
        opts.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        if let Ok(mut f) = opts.open(&path) {
            let _ = f.write_all(b64().encode(k).as_bytes());
        }
    }
    k
}

impl FileSecrets {
    /// Read-only check for whether `name` has a non-empty value stored in `dir/secrets.json` (never creates files).
    /// Returns `true` if `secrets.json` exists and cannot be decrypted (fail-closed for security guards).
    pub fn has_key(dir: &Path, name: &str) -> bool {
        let file = dir.join("secrets.json");
        let Ok(text) = std::fs::read_to_string(&file) else {
            return false;
        };
        let Some(k) = std::fs::read_to_string(dir.join("secrets.key"))
            .ok()
            .and_then(|s| b64().decode(s.trim()).ok())
            .and_then(|v| <[u8; 32]>::try_from(v).ok())
        else {
            return true;
        };
        let Some(bytes) = text.trim().strip_prefix("sy1:").and_then(|s| b64().decode(s).ok()) else {
            return true;
        };
        if bytes.len() < 12 {
            return true;
        }
        let Ok(cipher) = Aes256Gcm::new_from_slice(&k) else { return true };
        let Ok(plain) = cipher.decrypt(Nonce::from_slice(&bytes[..12]), &bytes[12..]) else {
            return true;
        };
        let Ok(map) = serde_json::from_slice::<BTreeMap<String, String>>(&plain) else {
            return true;
        };
        map.get(name).is_some_and(|v| !v.is_empty())
    }

    /// Opens (or starts) the file in `dir`. Without one yet, `old` (the Keychain) is asked once for `keys`.
    pub fn open(dir: &Path, old: Option<&dyn platform::Secrets>, keys: &[&str]) -> FileSecrets {
        let s = FileSecrets { file: dir.join("secrets.json"), key: key(dir), map: Mutex::new(BTreeMap::new()) };
        match std::fs::read_to_string(&s.file) {
            Ok(text) => *s.map.lock().unwrap() = s.unseal(&text).unwrap_or_default(),
            Err(_) => {
                if let Some(old) = old {
                    let mut m = s.map.lock().unwrap();
                    for k in keys {
                        if let Some(v) = old.get(k) {
                            m.insert(k.to_string(), v);
                        }
                    }
                }
                s.save();
            }
        }
        s
    }

    fn unseal(&self, text: &str) -> Option<BTreeMap<String, String>> {
        let bytes = b64().decode(text.trim().strip_prefix("sy1:")?).ok()?;
        if bytes.len() < 12 {
            return None;
        }
        let plain = Aes256Gcm::new_from_slice(&self.key).ok()?.decrypt(Nonce::from_slice(&bytes[..12]), &bytes[12..]).ok()?;
        serde_json::from_slice(&plain).ok()
    }

    fn save(&self) {
        let Ok(cipher) = Aes256Gcm::new_from_slice(&self.key) else { return };
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let plain = serde_json::to_vec(&*self.map.lock().unwrap()).unwrap_or_default();
        let Ok(sealed) = cipher.encrypt(&nonce, plain.as_slice()) else { return };
        let mut out = nonce.to_vec();
        out.extend(sealed);
        let _ = crate::paths::write_private(&self.file, format!("sy1:{}", b64().encode(out)).as_bytes());
    }
}

impl platform::Secrets for FileSecrets {
    fn get(&self, key: &str) -> Option<String> {
        self.map.lock().unwrap().get(key).cloned().filter(|v| !v.is_empty())
    }

    /// An empty value removes the key.
    fn set(&self, key: &str, value: &str) -> anyhow::Result<()> {
        {
            let mut m = self.map.lock().unwrap();
            if value.is_empty() {
                m.remove(key);
            } else {
                m.insert(key.to_string(), value.to_string());
            }
        }
        self.save();
        Ok(())
    }
}
