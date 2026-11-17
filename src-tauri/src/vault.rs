use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{anyhow, Context, Result};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    XChaCha20Poly1305, XNonce,
};
use rand::RngCore;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::models::{
    GroupRecord, HostRecord, KnownHostRecord, SnippetRecord, SshKeyRecord, TunnelRecord,
    VaultSnapshot, VaultStatus,
};

const KEYRING_SERVICE: &str = "com.cyberdyne.skynetssh";
const KEYRING_ACCOUNT: &str = "vault_master_dek";
const SCHEMA_VERSION: u32 = 1;

fn validate_record_id(id: &str) -> Result<()> {
    if id.is_empty()
        || id.len() > 128
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(anyhow!("Invalid record ID: {id}"));
    }
    Ok(())
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, path)?;
    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct VaultMetaFile {
    pub version: u32,
    pub kdf_salt_b64: String,
    pub argon2_m_cost_kib: u32,
    pub argon2_t_cost: u32,
    pub argon2_p_cost: u32,
    pub wrapped_dek_nonce_b64: String,
    pub wrapped_dek_ciphertext_b64: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct EncryptedEnvelope {
    pub id: String,
    pub schema_version: u32,
    pub updated_at: i64,
    pub tombstone: bool,
    pub nonce_b64: String,
    pub ciphertext_b64: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct AppSettingsFile {
    vault_path: String,
}

pub struct VaultEngine {
    config_dir: PathBuf,
    vault_dir: PathBuf,
    dek: Option<Zeroizing<[u8; 32]>>,
}

impl VaultEngine {
    pub fn new(config_dir: PathBuf) -> Result<Self> {
        fs::create_dir_all(&config_dir)?;
        let settings_path = config_dir.join("settings.json");
        let vault_dir = if settings_path.exists() {
            fs::read_to_string(&settings_path)
                .ok()
                .and_then(|raw| serde_json::from_str::<AppSettingsFile>(&raw).ok())
                .map(|p| PathBuf::from(p.vault_path))
                .unwrap_or_else(|| config_dir.join("vault"))
        } else {
            config_dir.join("vault")
        };

        fs::create_dir_all(&vault_dir)?;
        Ok(Self {
            config_dir,
            vault_dir,
            dek: None,
        })
    }

    pub fn vault_dir(&self) -> &Path {
        &self.vault_dir
    }

    pub fn set_vault_dir(&mut self, new_path: PathBuf) -> Result<()> {
        fs::create_dir_all(&new_path)?;
        let settings = AppSettingsFile {
            vault_path: new_path.to_string_lossy().to_string(),
        };
        atomic_write(
            &self.config_dir.join("settings.json"),
            serde_json::to_string_pretty(&settings)?.as_bytes(),
        )?;
        self.vault_dir = new_path;
        self.dek = None;
        Ok(())
    }

    fn meta_path(&self) -> PathBuf {
        self.vault_dir.join("vault.meta.json")
    }

    pub fn is_initialized(&self) -> bool {
        self.meta_path().exists()
    }

    pub fn is_unlocked(&self) -> bool {
        self.dek.is_some()
    }

    pub fn status(&self) -> VaultStatus {
        let keyring_saved = Self::load_dek_from_keyring().is_ok();
        let snap = if self.is_unlocked() {
            self.snapshot().unwrap_or_default()
        } else {
            VaultSnapshot::default()
        };

        VaultStatus {
            initialized: self.is_initialized(),
            unlocked: self.is_unlocked(),
            vault_path: self.vault_dir.to_string_lossy().to_string(),
            keyring_available: true,
            keyring_saved,
            host_count: snap.hosts.len(),
            key_count: snap.keys.len(),
            tunnel_count: snap.tunnels.len(),
            snippet_count: snap.snippets.len(),
        }
    }

    fn derive_kek(
        password: &str,
        salt: &[u8],
        m_cost_kib: u32,
        t_cost: u32,
        p_cost: u32,
    ) -> Result<Zeroizing<[u8; 32]>> {
        let params = Params::new(m_cost_kib, t_cost, p_cost, Some(32))
            .map_err(|e| anyhow!("Invalid Argon2 parameters: {e}"))?;
        let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
        let mut kek = Zeroizing::new([0u8; 32]);
        argon2
            .hash_password_into(password.as_bytes(), salt, kek.as_mut())
            .map_err(|e| anyhow!("Argon2id derivation failed: {e}"))?;
        Ok(kek)
    }

    pub fn initialize(&mut self, master_password: &str, save_to_keyring: bool) -> Result<VaultSnapshot> {
        fs::create_dir_all(&self.vault_dir)?;
        for sub in ["groups", "hosts", "keys", "tunnels", "snippets", "known_hosts"] {
            fs::create_dir_all(self.vault_dir.join(sub))?;
        }

        let mut salt = [0u8; 16];
        rand::thread_rng().fill_bytes(&mut salt);

        let m_cost = 65536;
        let t_cost = 3;
        let p_cost = 1;
        let kek = Self::derive_kek(master_password, &salt, m_cost, t_cost, p_cost)?;

        let mut dek = Zeroizing::new([0u8; 32]);
        rand::thread_rng().fill_bytes(dek.as_mut());

        let mut nonce_bytes = [0u8; 24];
        rand::thread_rng().fill_bytes(&mut nonce_bytes);

        let cipher = XChaCha20Poly1305::new(kek.as_ref().into());
        let wrapped = cipher
            .encrypt(
                XNonce::from_slice(&nonce_bytes),
                Payload {
                    msg: dek.as_ref(),
                    aad: b"skynetssh-vault-dek-v1",
                },
            )
            .map_err(|_| anyhow!("Failed to encrypt master DEK"))?;

        let meta = VaultMetaFile {
            version: SCHEMA_VERSION,
            kdf_salt_b64: B64.encode(salt),
            argon2_m_cost_kib: m_cost,
            argon2_t_cost: t_cost,
            argon2_p_cost: p_cost,
            wrapped_dek_nonce_b64: B64.encode(nonce_bytes),
            wrapped_dek_ciphertext_b64: B64.encode(wrapped),
        };

        atomic_write(&self.meta_path(), serde_json::to_string_pretty(&meta)?.as_bytes())?;

        if save_to_keyring {
            let _ = Self::save_dek_to_keyring(&dek);
        } else {
            Self::clear_dek_from_keyring();
        }

        self.dek = Some(dek);
        self.snapshot()
    }

    pub fn unlock(&mut self, master_password: &str, save_to_keyring: bool) -> Result<VaultSnapshot> {
        let raw = fs::read_to_string(self.meta_path())
            .context("Vault metadata file not found")?;
        let meta: VaultMetaFile = serde_json::from_str(&raw)?;

        let salt = B64.decode(&meta.kdf_salt_b64)?;
        let nonce_bytes = B64.decode(&meta.wrapped_dek_nonce_b64)?;
        let ciphertext = B64.decode(&meta.wrapped_dek_ciphertext_b64)?;

        let kek = Self::derive_kek(
            master_password,
            &salt,
            meta.argon2_m_cost_kib,
            meta.argon2_t_cost,
            meta.argon2_p_cost,
        )?;

        let cipher = XChaCha20Poly1305::new(kek.as_ref().into());
        let unwrapped = cipher
            .decrypt(
                XNonce::from_slice(&nonce_bytes),
                Payload {
                    msg: &ciphertext,
                    aad: b"skynetssh-vault-dek-v1",
                },
            )
            .map_err(|_| anyhow!("Invalid Master Password"))?;

        if unwrapped.len() != 32 {
            return Err(anyhow!("Corrupted Vault DEK length"));
        }

        let mut dek = Zeroizing::new([0u8; 32]);
        dek.copy_from_slice(&unwrapped);

        if save_to_keyring {
            let _ = Self::save_dek_to_keyring(&dek);
        } else {
            Self::clear_dek_from_keyring();
        }

        self.dek = Some(dek);
        self.snapshot()
    }

    pub fn unlock_with_keyring(&mut self) -> Result<VaultSnapshot> {
        if !self.is_initialized() {
            return Err(anyhow!("Vault is not initialized yet"));
        }
        let dek = Self::load_dek_from_keyring()?;
        self.dek = Some(dek);
        self.snapshot()
    }

    /// Locks the Vault in RAM and removes any cached DEK from OS Credential Manager.
    pub fn lock(&mut self) {
        self.dek = None;
        Self::clear_dek_from_keyring();
    }

    fn save_dek_to_keyring(dek: &[u8; 32]) -> Result<()> {
        let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)?;
        entry.set_password(&B64.encode(dek))?;
        Ok(())
    }

    fn clear_dek_from_keyring() {
        if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT) {
            let _ = entry.delete_credential();
        }
    }

    fn load_dek_from_keyring() -> Result<Zeroizing<[u8; 32]>> {
        let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)?;
        let encoded = entry.get_password()?;
        let decoded = B64.decode(encoded)?;
        if decoded.len() != 32 {
            return Err(anyhow!("Invalid DEK in OS keyring"));
        }
        let mut dek = Zeroizing::new([0u8; 32]);
        dek.copy_from_slice(&decoded);
        Ok(dek)
    }

    fn require_dek(&self) -> Result<&[u8; 32]> {
        self.dek
            .as_deref()
            .ok_or_else(|| anyhow!("Vault is locked. Please unlock first."))
    }

    fn write_envelope(
        &self,
        collection: &str,
        id: &str,
        updated_at: i64,
        tombstone: bool,
        plaintext: &[u8],
    ) -> Result<()> {
        validate_record_id(id)?;
        let dek = self.require_dek()?;
        let dir = self.vault_dir.join(collection);
        fs::create_dir_all(&dir)?;

        let mut nonce = [0u8; 24];
        rand::thread_rng().fill_bytes(&mut nonce);

        let aad = format!("{collection}:{id}:{SCHEMA_VERSION}:{updated_at}:{tombstone}");
        let cipher = XChaCha20Poly1305::new(dek.into());
        let ciphertext = cipher
            .encrypt(
                XNonce::from_slice(&nonce),
                Payload {
                    msg: plaintext,
                    aad: aad.as_bytes(),
                },
            )
            .map_err(|_| anyhow!("Record encryption failed"))?;

        let env = EncryptedEnvelope {
            id: id.to_string(),
            schema_version: SCHEMA_VERSION,
            updated_at,
            tombstone,
            nonce_b64: B64.encode(nonce),
            ciphertext_b64: B64.encode(ciphertext),
        };

        let path = dir.join(format!("{id}.enc.json"));
        atomic_write(&path, serde_json::to_string_pretty(&env)?.as_bytes())
    }

    fn write_record<T: Serialize>(
        &self,
        collection: &str,
        id: &str,
        updated_at: i64,
        record: &T,
    ) -> Result<()> {
        let plaintext = Zeroizing::new(serde_json::to_vec(record)?);
        self.write_envelope(collection, id, updated_at, false, &plaintext)
    }

    fn tombstone_record(&self, collection: &str, id: &str) -> Result<()> {
        let updated_at = chrono::Utc::now().timestamp_millis();
        self.write_envelope(collection, id, updated_at, true, b"{}")
    }

    fn decrypt_envelope_file<T: DeserializeOwned>(
        cipher: &XChaCha20Poly1305,
        collection: &str,
        path: &Path,
    ) -> Result<Option<T>> {
        let raw = fs::read_to_string(path)?;
        let env: EncryptedEnvelope = serde_json::from_str(&raw)
            .with_context(|| format!("Invalid envelope JSON in {path:?}"))?;

        let nonce = B64.decode(&env.nonce_b64)?;
        if nonce.len() != 24 {
            return Err(anyhow!("Invalid XNonce length in {path:?}"));
        }
        let ciphertext = B64.decode(&env.ciphertext_b64)?;
        let aad = format!(
            "{}:{}:{}:{}:{}",
            collection, env.id, env.schema_version, env.updated_at, env.tombstone
        );

        let decrypted = cipher
            .decrypt(
                XNonce::from_slice(&nonce),
                Payload {
                    msg: &ciphertext,
                    aad: aad.as_bytes(),
                },
            )
            .map_err(|_| anyhow!("Tampered or unreadable encrypted record: {}", env.id))?;

        if env.tombstone {
            return Ok(None);
        }
        Ok(Some(serde_json::from_slice(&decrypted)?))
    }

    fn read_single<T: DeserializeOwned>(&self, collection: &str, id: &str) -> Result<Option<T>> {
        validate_record_id(id)?;
        let dek = self.require_dek()?;
        let path = self.vault_dir.join(collection).join(format!("{id}.enc.json"));
        if !path.exists() {
            return Ok(None);
        }
        let cipher = XChaCha20Poly1305::new(dek.into());
        Self::decrypt_envelope_file(&cipher, collection, &path)
    }

    fn read_collection<T: DeserializeOwned>(&self, collection: &str) -> Result<Vec<T>> {
        let dek = self.require_dek()?;
        let dir = self.vault_dir.join(collection);
        if !dir.exists() {
            return Ok(Vec::new());
        }

        let cipher = XChaCha20Poly1305::new(dek.into());
        let mut items = Vec::new();

        for entry in fs::read_dir(dir)? {
            let Ok(entry) = entry else { continue };
            let path = entry.path();
            if !path
                .file_name()
                .and_then(|s| s.to_str())
                .map(|n| n.ends_with(".enc.json"))
                .unwrap_or(false)
            {
                continue;
            }

            match Self::decrypt_envelope_file(&cipher, collection, &path) {
                Ok(Some(parsed)) => items.push(parsed),
                Ok(None) => {}
                Err(err) => {
                    eprintln!("[SkynetSSH Vault] Skipping unreadable file {path:?}: {err}");
                }
            }
        }

        Ok(items)
    }

    pub fn snapshot(&self) -> Result<VaultSnapshot> {
        let mut groups: Vec<GroupRecord> = self.read_collection("groups")?;
        groups.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

        let mut hosts: Vec<HostRecord> = self.read_collection("hosts")?;
        hosts.sort_by(|a, b| a.label.to_lowercase().cmp(&b.label.to_lowercase()));

        let mut keys: Vec<SshKeyRecord> = self.read_collection("keys")?;
        keys.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

        let mut tunnels: Vec<TunnelRecord> = self.read_collection("tunnels")?;
        tunnels.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

        let mut snippets: Vec<SnippetRecord> = self.read_collection("snippets")?;
        snippets.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

        let mut known_hosts: Vec<KnownHostRecord> = self.read_collection("known_hosts")?;
        known_hosts.sort_by(|a, b| a.host_port.cmp(&b.host_port));

        Ok(VaultSnapshot {
            groups,
            hosts,
            keys,
            tunnels,
            snippets,
            known_hosts,
        })
    }

    /* Typed CRUD Helpers */
    pub fn save_group(&self, g: &GroupRecord) -> Result<()> {
        self.write_record("groups", &g.id, g.updated_at, g)
    }
    pub fn delete_group(&self, id: &str) -> Result<()> {
        self.tombstone_record("groups", id)
    }

    pub fn save_host(&self, h: &HostRecord) -> Result<()> {
        self.write_record("hosts", &h.id, h.updated_at, h)
    }
    pub fn delete_host(&self, id: &str) -> Result<()> {
        self.tombstone_record("hosts", id)
    }
    pub fn get_host(&self, id: &str) -> Result<HostRecord> {
        self.read_single("hosts", id)?
            .ok_or_else(|| anyhow!("Host not found: {id}"))
    }

    pub fn save_key(&self, k: &SshKeyRecord) -> Result<()> {
        self.write_record("keys", &k.id, k.updated_at, k)
    }
    pub fn delete_key(&self, id: &str) -> Result<()> {
        self.tombstone_record("keys", id)
    }
    pub fn get_key(&self, id: &str) -> Result<SshKeyRecord> {
        self.read_single("keys", id)?
            .ok_or_else(|| anyhow!("SSH key not found: {id}"))
    }

    pub fn save_tunnel(&self, t: &TunnelRecord) -> Result<()> {
        self.write_record("tunnels", &t.id, t.updated_at, t)
    }
    pub fn delete_tunnel(&self, id: &str) -> Result<()> {
        self.tombstone_record("tunnels", id)
    }
    pub fn get_tunnel(&self, id: &str) -> Result<TunnelRecord> {
        self.read_single("tunnels", id)?
            .ok_or_else(|| anyhow!("Tunnel not found: {id}"))
    }

    pub fn save_snippet(&self, s: &SnippetRecord) -> Result<()> {
        self.write_record("snippets", &s.id, s.updated_at, s)
    }
    pub fn delete_snippet(&self, id: &str) -> Result<()> {
        self.tombstone_record("snippets", id)
    }

    pub fn save_known_host(&self, kh: &KnownHostRecord) -> Result<()> {
        self.write_record("known_hosts", &kh.id, kh.updated_at, kh)
    }
    pub fn delete_known_host(&self, id: &str) -> Result<()> {
        self.tombstone_record("known_hosts", id)
    }
    pub fn find_known_host(&self, host_port: &str) -> Result<Option<KnownHostRecord>> {
        Ok(self
            .read_collection::<KnownHostRecord>("known_hosts")?
            .into_iter()
            .find(|kh| kh.host_port == host_port))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_vault_roundtrip_tamper_and_tombstone() {
        let temp_dir =
            std::env::temp_dir().join(format!("skynet_vault_test_{}", uuid::Uuid::new_v4()));
        let mut engine = VaultEngine::new(temp_dir.clone()).unwrap();
        assert!(!engine.is_initialized());

        engine.initialize("T800-Cyberdyne!", false).unwrap();
        assert!(engine.is_initialized());
        assert!(engine.is_unlocked());

        let mut host = HostRecord {
            id: "h-1".into(),
            label: "Skynet Core".into(),
            address: "10.0.0.1".into(),
            port: 22,
            username: "miles".into(),
            auth_method: "password".into(),
            password: Some("top-secret".into()),
            key_id: None,
            group_id: None,
            tags: vec!["cyberdyne".into()],
            jump_host_id: None,
            startup_snippet_id: None,
            startup_command: None,
            keepalive_interval_secs: 30,
            notes: None,
            last_connected_at: None,
            updated_at: 1700000000,
        };
        engine.save_host(&host).unwrap();

        // Path traversal ID must be rejected
        host.id = "../escape".into();
        assert!(engine.save_host(&host).is_err());

        engine.lock();
        assert!(!engine.is_unlocked());

        // Wrong password must fail
        assert!(engine.unlock("wrong-password", false).is_err());

        // Correct password unlocks; corrupted sibling file does NOT brick healthy records
        fs::write(
            engine.vault_dir().join("hosts").join("corrupt.enc.json"),
            b"<<<<<<< HEAD broken sync file",
        )
        .unwrap();

        let snap = engine.unlock("T800-Cyberdyne!", false).unwrap();
        assert_eq!(snap.hosts.len(), 1);
        assert_eq!(engine.get_host("h-1").unwrap().password.as_deref(), Some("top-secret"));

        // Tombstone deletion hides record cleanly
        engine.delete_host("h-1").unwrap();
        assert!(engine.get_host("h-1").is_err());
        assert_eq!(engine.snapshot().unwrap().hosts.len(), 0);

        let _ = fs::remove_dir_all(temp_dir);
    }
}
