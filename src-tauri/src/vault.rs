use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::Duration;

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
    GroupRecord, HostRecord, KnownHostRecord, SnippetRecord, SshKeyRecord, TotpSetupPayload,
    TunnelRecord, VaultProfile, VaultSnapshot, VaultStatus,
};

#[cfg(not(test))]
const KEYRING_SERVICE: &str = "com.cyberdyne.skynetssh";
const SCHEMA_VERSION: u32 = 1;
pub const DEFAULT_GLOBAL_HOTKEY: &str = "CommandOrControl+Backquote";
pub const DAY_MS: i64 = 86_400_000;
pub const MAX_REMEMBER_DAYS: u32 = 30;
pub const MAX_TOTP_ATTEMPTS: u8 = 3;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TotpVaultRecord {
    secret_base32: String,
    enabled_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct KeyringLease {
    dek_b64: String,
    #[serde(default)]
    totp_secret_base32: Option<String>,
    issued_at_ms: i64,
    auto_unlock_until_ms: i64,
    max_lease_until_ms: i64,
    #[serde(default)]
    failed_totp_attempts: u8,
}

#[cfg(test)]
fn test_keyring_store() -> &'static std::sync::Mutex<HashMap<String, String>> {
    static STORE: std::sync::OnceLock<std::sync::Mutex<HashMap<String, String>>> =
        std::sync::OnceLock::new();
    STORE.get_or_init(|| std::sync::Mutex::new(HashMap::new()))
}

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

/// Atomic write with unique temp file + retry backoff for OneDrive / SharePoint file-sync locks (OS error 32).
fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let rand_tag = rand::thread_rng().next_u32();
    let tmp_name = format!(
        "{}.{rand_tag:08x}.tmp",
        path.file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("record")
    );
    let tmp = path.with_file_name(tmp_name);
    fs::write(&tmp, bytes)?;

    let mut last_err = None;
    for attempt in 1..=5 {
        match fs::rename(&tmp, path) {
            Ok(()) => return Ok(()),
            Err(e) => {
                last_err = Some(e);
                thread::sleep(Duration::from_millis(40 * attempt));
            }
        }
    }
    let _ = fs::remove_file(&tmp);
    Err(anyhow!(
        "Failed atomic rename onto {path:?}: {}",
        last_err.unwrap()
    ))
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

#[derive(Debug, Clone, Serialize, Deserialize)]
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
    #[serde(default)]
    vault_path: Option<String>,
    #[serde(default)]
    active_profile_id: Option<String>,
    #[serde(default)]
    profiles: Vec<VaultProfile>,
    #[serde(default)]
    global_hotkey: Option<String>,
}

pub struct VaultEngine {
    config_dir: PathBuf,
    profiles: Vec<VaultProfile>,
    active_profile_id: String,
    global_hotkey: String,
    dek: Option<Zeroizing<[u8; 32]>>,
}

impl VaultEngine {
    pub fn new(config_dir: PathBuf) -> Result<Self> {
        fs::create_dir_all(&config_dir)?;
        let default_vault_dir = config_dir.join("vault");
        let settings_path = config_dir.join("settings.json");

        let (profiles, active_profile_id, global_hotkey) = if settings_path.exists() {
            if let Ok(raw) = fs::read_to_string(&settings_path) {
                if let Ok(parsed) = serde_json::from_str::<AppSettingsFile>(&raw) {
                    let mut profs = parsed.profiles;
                    if profs.is_empty() {
                        let legacy_path = parsed
                            .vault_path
                            .unwrap_or_else(|| default_vault_dir.to_string_lossy().to_string());
                        profs.push(VaultProfile {
                            id: "personal".into(),
                            name: "Personal Vault".into(),
                            kind: "personal".into(),
                            path: legacy_path,
                        });
                    }
                    let active_id = parsed
                        .active_profile_id
                        .filter(|id| profs.iter().any(|p| &p.id == id))
                        .unwrap_or_else(|| profs[0].id.clone());
                    let hk = parsed
                        .global_hotkey
                        .unwrap_or_else(|| DEFAULT_GLOBAL_HOTKEY.into());
                    (profs, active_id, hk)
                } else {
                    Self::default_settings(&default_vault_dir)
                }
            } else {
                Self::default_settings(&default_vault_dir)
            }
        } else {
            Self::default_settings(&default_vault_dir)
        };

        let engine = Self {
            config_dir,
            profiles,
            active_profile_id,
            global_hotkey,
            dek: None,
        };
        fs::create_dir_all(engine.vault_dir())?;
        engine.persist_settings()?;
        Ok(engine)
    }

    fn default_settings(default_vault_dir: &Path) -> (Vec<VaultProfile>, String, String) {
        (
            vec![VaultProfile {
                id: "personal".into(),
                name: "Personal Vault".into(),
                kind: "personal".into(),
                path: default_vault_dir.to_string_lossy().to_string(),
            }],
            "personal".into(),
            DEFAULT_GLOBAL_HOTKEY.into(),
        )
    }

    fn persist_settings(&self) -> Result<()> {
        let data = AppSettingsFile {
            vault_path: Some(self.vault_dir().to_string_lossy().to_string()),
            active_profile_id: Some(self.active_profile_id.clone()),
            profiles: self.profiles.clone(),
            global_hotkey: Some(self.global_hotkey.clone()),
        };
        atomic_write(
            &self.config_dir.join("settings.json"),
            serde_json::to_string_pretty(&data)?.as_bytes(),
        )
    }

    pub fn active_profile(&self) -> &VaultProfile {
        self.profiles
            .iter()
            .find(|p| p.id == self.active_profile_id)
            .unwrap_or(&self.profiles[0])
    }

    pub fn vault_dir(&self) -> PathBuf {
        PathBuf::from(&self.active_profile().path)
    }

    pub fn global_hotkey(&self) -> &str {
        &self.global_hotkey
    }

    pub fn set_global_hotkey(&mut self, hotkey: String) -> Result<()> {
        self.global_hotkey = hotkey;
        self.persist_settings()
    }

    pub fn set_vault_dir(&mut self, new_path: PathBuf) -> Result<()> {
        fs::create_dir_all(&new_path)?;
        let active_id = self.active_profile_id.clone();
        if let Some(p) = self.profiles.iter_mut().find(|p| p.id == active_id) {
            p.path = new_path.to_string_lossy().to_string();
        }
        self.dek = None;
        self.persist_settings()
    }

    pub fn add_or_switch_profile(
        &mut self,
        name: String,
        kind: String,
        path: PathBuf,
    ) -> Result<VaultProfile> {
        fs::create_dir_all(&path)?;
        let path_str = path.to_string_lossy().to_string();
        if let Some(existing) = self.profiles.iter().find(|p| p.path == path_str) {
            let id = existing.id.clone();
            let cloned = existing.clone();
            self.active_profile_id = id;
            self.dek = None;
            self.persist_settings()?;
            return Ok(cloned);
        }

        let profile = VaultProfile {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.trim().to_string(),
            kind: if kind == "team" {
                "team".into()
            } else {
                "personal".into()
            },
            path: path_str,
        };
        self.active_profile_id = profile.id.clone();
        self.profiles.push(profile.clone());
        self.dek = None;
        self.persist_settings()?;
        Ok(profile)
    }

    pub fn switch_profile(&mut self, profile_id: &str) -> Result<()> {
        if !self.profiles.iter().any(|p| p.id == profile_id) {
            return Err(anyhow!("Vault profile not found: {profile_id}"));
        }
        self.active_profile_id = profile_id.to_string();
        self.dek = None;
        fs::create_dir_all(self.vault_dir())?;
        self.persist_settings()
    }

    pub fn remove_profile(&mut self, profile_id: &str) -> Result<()> {
        if self.profiles.len() <= 1 {
            return Err(anyhow!("Cannot remove your only Vault profile."));
        }
        self.clear_keyring(profile_id);
        self.profiles.retain(|p| p.id != profile_id);
        if self.active_profile_id == profile_id {
            self.active_profile_id = self.profiles[0].id.clone();
            self.dek = None;
        }
        self.persist_settings()
    }

    fn meta_path(&self) -> PathBuf {
        self.vault_dir().join("vault.meta.json")
    }

    pub fn is_initialized(&self) -> bool {
        self.meta_path().exists()
    }

    pub fn is_unlocked(&self) -> bool {
        self.dek.is_some()
    }

    fn keyring_account(&self, profile_id: &str) -> String {
        #[cfg(test)]
        {
            format!("{}::{profile_id}", self.config_dir.to_string_lossy())
        }
        #[cfg(not(test))]
        {
            let _ = &self.config_dir;
            if profile_id == "personal" {
                // Backward-compatible with existing personal vault credential
                "vault_master_dek".into()
            } else {
                format!("vault_dek_{profile_id}")
            }
        }
    }

    fn write_keyring_raw(&self, profile_id: &str, value: &str) -> Result<()> {
        let account = self.keyring_account(profile_id);
        #[cfg(test)]
        {
            test_keyring_store()
                .lock()
                .unwrap()
                .insert(account, value.to_string());
            Ok(())
        }
        #[cfg(not(test))]
        {
            let entry = keyring::Entry::new(KEYRING_SERVICE, &account)?;
            entry.set_password(value)?;
            Ok(())
        }
    }

    fn read_keyring_raw(&self, profile_id: &str) -> Result<String> {
        let account = self.keyring_account(profile_id);
        #[cfg(test)]
        {
            test_keyring_store()
                .lock()
                .unwrap()
                .get(&account)
                .cloned()
                .ok_or_else(|| anyhow!("No keyring credential found"))
        }
        #[cfg(not(test))]
        {
            let entry = keyring::Entry::new(KEYRING_SERVICE, &account)?;
            Ok(entry.get_password()?)
        }
    }

    fn clear_keyring(&self, profile_id: &str) {
        let account = self.keyring_account(profile_id);
        #[cfg(test)]
        {
            test_keyring_store().lock().unwrap().remove(&account);
        }
        #[cfg(not(test))]
        {
            if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, &account) {
                let _ = entry.delete_credential();
            }
        }
    }

    fn save_keyring_lease(&self, profile_id: &str, lease: &KeyringLease) -> Result<()> {
        let json = serde_json::to_string(lease)?;
        self.write_keyring_raw(profile_id, &json)
    }

    /// Loads the structured `KeyringLease` (migrating legacy raw 32-byte Base64 DEKs cleanly)
    /// and automatically purges the entry if the 30-day `max_lease_until_ms` has expired.
    fn load_valid_lease_at(&self, profile_id: &str, now_ms: i64) -> Option<KeyringLease> {
        let raw = self.read_keyring_raw(profile_id).ok()?;
        let trimmed = raw.trim();

        let lease = if let Ok(parsed) = serde_json::from_str::<KeyringLease>(trimmed) {
            parsed
        } else if let Ok(decoded) = B64.decode(trimmed) {
            if decoded.len() == 32 {
                let migrated = KeyringLease {
                    dek_b64: trimmed.to_string(),
                    totp_secret_base32: None,
                    issued_at_ms: now_ms,
                    auto_unlock_until_ms: now_ms + 7 * DAY_MS,
                    max_lease_until_ms: now_ms + (MAX_REMEMBER_DAYS as i64) * DAY_MS,
                    failed_totp_attempts: 0,
                };
                let _ = self.save_keyring_lease(profile_id, &migrated);
                migrated
            } else {
                self.clear_keyring(profile_id);
                return None;
            }
        } else {
            self.clear_keyring(profile_id);
            return None;
        };

        if now_ms >= lease.max_lease_until_ms {
            self.clear_keyring(profile_id);
            return None;
        }
        Some(lease)
    }

    fn decode_dek_b64(dek_b64: &str) -> Result<Zeroizing<[u8; 32]>> {
        let decoded = B64.decode(dek_b64.trim())?;
        if decoded.len() != 32 {
            return Err(anyhow!("Invalid DEK length in OS keyring"));
        }
        let mut dek = Zeroizing::new([0u8; 32]);
        dek.copy_from_slice(&decoded);
        Ok(dek)
    }

    fn read_totp_record(&self) -> Result<Option<TotpVaultRecord>> {
        Ok(self.read_collection::<TotpVaultRecord>("auth")?.into_iter().next())
    }

    fn has_totp_envelope_on_disk(&self) -> bool {
        let path = self.vault_dir().join("auth").join("totp.enc.json");
        let Ok(raw) = fs::read_to_string(path) else {
            return false;
        };
        let Ok(env) = serde_json::from_str::<EncryptedEnvelope>(&raw) else {
            return false;
        };
        !env.tombstone
    }

    pub fn status(&self) -> VaultStatus {
        self.status_at(chrono::Utc::now().timestamp_millis())
    }

    pub fn status_at(&self, now_ms: i64) -> VaultStatus {
        let active = self.active_profile().clone();
        let lease_opt = self.load_valid_lease_at(&active.id, now_ms);

        let (
            keyring_saved,
            device_auto_unlock_valid,
            device_lease_expires_at,
            totp_available_on_device,
            totp_remaining_attempts,
        ) = if let Some(lease) = &lease_opt {
            (
                true,
                now_ms < lease.auto_unlock_until_ms,
                Some(lease.max_lease_until_ms),
                lease.totp_secret_base32.is_some(),
                MAX_TOTP_ATTEMPTS.saturating_sub(lease.failed_totp_attempts),
            )
        } else {
            (false, false, None, false, MAX_TOTP_ATTEMPTS)
        };

        let totp_enabled = if self.is_unlocked() {
            self.read_totp_record().ok().flatten().is_some()
        } else {
            totp_available_on_device || self.has_totp_envelope_on_disk()
        };

        let snap = if self.is_unlocked() {
            self.snapshot().unwrap_or_default()
        } else {
            VaultSnapshot::default()
        };

        let read_only = fs::metadata(&self.meta_path())
            .map(|m| m.permissions().readonly())
            .unwrap_or_else(|_| {
                fs::metadata(self.vault_dir())
                    .map(|m| m.permissions().readonly())
                    .unwrap_or(false)
            });

        VaultStatus {
            initialized: self.is_initialized(),
            unlocked: self.is_unlocked(),
            read_only,
            vault_path: active.path.clone(),
            active_profile: active,
            profiles: self.profiles.clone(),
            global_hotkey: self.global_hotkey.clone(),
            keyring_available: true,
            keyring_saved,
            device_auto_unlock_valid,
            device_lease_expires_at,
            totp_enabled,
            totp_available_on_device,
            totp_remaining_attempts,
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

    fn apply_master_password_lease(
        &self,
        dek: &[u8; 32],
        remember_days: u32,
        totp_secret_base32: Option<String>,
        now_ms: i64,
    ) {
        let pid = &self.active_profile_id;
        let clamped_days = remember_days.min(MAX_REMEMBER_DAYS);
        if clamped_days > 0 || totp_secret_base32.is_some() {
            let max_lease_until_ms = now_ms + (MAX_REMEMBER_DAYS as i64) * DAY_MS;
            let auto_unlock_until_ms = if clamped_days > 0 {
                now_ms + (clamped_days as i64) * DAY_MS
            } else {
                0
            };
            let lease = KeyringLease {
                dek_b64: B64.encode(dek),
                totp_secret_base32,
                issued_at_ms: now_ms,
                auto_unlock_until_ms,
                max_lease_until_ms,
                failed_totp_attempts: 0,
            };
            let _ = self.save_keyring_lease(pid, &lease);
        } else {
            self.clear_keyring(pid);
        }
    }

    pub fn initialize(&mut self, master_password: &str, remember_days: u32) -> Result<VaultSnapshot> {
        let now_ms = chrono::Utc::now().timestamp_millis();
        let vdir = self.vault_dir();
        fs::create_dir_all(&vdir)?;
        for sub in [
            "groups",
            "hosts",
            "keys",
            "tunnels",
            "snippets",
            "known_hosts",
            "auth",
        ] {
            fs::create_dir_all(vdir.join(sub))?;
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

        self.apply_master_password_lease(&dek, remember_days, None, now_ms);
        self.dek = Some(dek);
        self.snapshot()
    }

    pub fn unlock(&mut self, master_password: &str, remember_days: u32) -> Result<VaultSnapshot> {
        self.unlock_at(
            master_password,
            remember_days,
            chrono::Utc::now().timestamp_millis(),
        )
    }

    pub fn unlock_at(
        &mut self,
        master_password: &str,
        remember_days: u32,
        now_ms: i64,
    ) -> Result<VaultSnapshot> {
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
        self.dek = Some(dek.clone());

        let totp_secret = self
            .read_totp_record()
            .ok()
            .flatten()
            .map(|r| r.secret_base32);
        self.apply_master_password_lease(&dek, remember_days, totp_secret, now_ms);

        self.snapshot()
    }

    pub fn unlock_with_keyring(&mut self) -> Result<VaultSnapshot> {
        self.unlock_with_keyring_at(chrono::Utc::now().timestamp_millis())
    }

    pub fn unlock_with_keyring_at(&mut self, now_ms: i64) -> Result<VaultSnapshot> {
        if !self.is_initialized() {
            return Err(anyhow!("Vault is not initialized yet"));
        }
        let pid = self.active_profile_id.clone();
        let lease = self
            .load_valid_lease_at(&pid, now_ms)
            .ok_or_else(|| anyhow!("Device trust expired or not saved"))?;

        if now_ms >= lease.auto_unlock_until_ms {
            return Err(anyhow!("Interactive unlock required (TOTP or Master Password)"));
        }

        let dek = Self::decode_dek_b64(&lease.dek_b64)?;
        self.dek = Some(dek);
        self.snapshot()
    }

    pub fn unlock_with_totp(&mut self, code: &str, remember_days: u32) -> Result<VaultSnapshot> {
        self.unlock_with_totp_at(code, remember_days, chrono::Utc::now().timestamp_millis())
    }

    pub fn unlock_with_totp_at(
        &mut self,
        code: &str,
        remember_days: u32,
        now_ms: i64,
    ) -> Result<VaultSnapshot> {
        if !self.is_initialized() {
            return Err(anyhow!("Vault is not initialized yet"));
        }
        let pid = self.active_profile_id.clone();
        let mut lease = self.load_valid_lease_at(&pid, now_ms).ok_or_else(|| {
            anyhow!("30-day device trust expired or missing. Please unlock with your Master Password.")
        })?;

        let secret = lease
            .totp_secret_base32
            .clone()
            .ok_or_else(|| anyhow!("TOTP is not enrolled on this device yet."))?;

        let unix_secs = (now_ms.max(0) / 1000) as u64;
        let valid = crate::totp::verify_totp_code(&secret, code, unix_secs)?;

        if !valid {
            lease.failed_totp_attempts = lease.failed_totp_attempts.saturating_add(1);
            if lease.failed_totp_attempts >= MAX_TOTP_ATTEMPTS {
                self.clear_keyring(&pid);
                return Err(anyhow!(
                    "3 incorrect TOTP codes — device cache wiped for security. Master Password required."
                ));
            }
            let _ = self.save_keyring_lease(&pid, &lease);
            let rem = MAX_TOTP_ATTEMPTS - lease.failed_totp_attempts;
            return Err(anyhow!(
                "Invalid 6-digit TOTP code ({rem} attempt{} left before device wipe).",
                if rem == 1 { "" } else { "s" }
            ));
        }

        let dek = Self::decode_dek_b64(&lease.dek_b64)?;
        self.dek = Some(dek);

        // Sync TOTP record from Vault in case a teammate disabled/rotated it on SharePoint
        let vault_totp = self
            .read_totp_record()
            .ok()
            .flatten()
            .map(|r| r.secret_base32);

        lease.failed_totp_attempts = 0;
        lease.totp_secret_base32 = vault_totp;
        let clamped_days = remember_days.min(MAX_REMEMBER_DAYS);
        lease.auto_unlock_until_ms = if clamped_days > 0 {
            (now_ms + (clamped_days as i64) * DAY_MS).min(lease.max_lease_until_ms)
        } else {
            0
        };

        if lease.auto_unlock_until_ms > 0 || lease.totp_secret_base32.is_some() {
            let _ = self.save_keyring_lease(&pid, &lease);
        } else {
            self.clear_keyring(&pid);
        }

        self.snapshot()
    }

    pub fn totp_begin_setup(&self) -> Result<TotpSetupPayload> {
        self.require_dek()?;
        crate::totp::generate_totp_setup(&self.active_profile().name)
    }

    pub fn totp_confirm_setup(
        &self,
        secret_base32: &str,
        code: &str,
        remember_days: u32,
    ) -> Result<VaultStatus> {
        self.totp_confirm_setup_at(
            secret_base32,
            code,
            remember_days,
            chrono::Utc::now().timestamp_millis(),
        )
    }

    pub fn totp_confirm_setup_at(
        &self,
        secret_base32: &str,
        code: &str,
        remember_days: u32,
        now_ms: i64,
    ) -> Result<VaultStatus> {
        let dek = self.require_dek()?;
        let normalized: String = secret_base32
            .chars()
            .filter(|c| !c.is_whitespace() && *c != '=')
            .map(|c| c.to_ascii_uppercase())
            .collect();
        crate::totp::decode_base32_secret(&normalized)?;

        let unix_secs = (now_ms.max(0) / 1000) as u64;
        if !crate::totp::verify_totp_code(&normalized, code, unix_secs)? {
            return Err(anyhow!(
                "6-digit TOTP code did not match. Check your Authenticator app and PC clock."
            ));
        }

        let rec = TotpVaultRecord {
            secret_base32: normalized.clone(),
            enabled_at: now_ms,
        };
        self.write_record("auth", "totp", now_ms, &rec)?;

        let pid = &self.active_profile_id;
        let clamped_days = remember_days.min(MAX_REMEMBER_DAYS);
        let existing = self.load_valid_lease_at(pid, now_ms);
        let (issued_at_ms, max_lease_until_ms) = match &existing {
            Some(l) => (l.issued_at_ms, l.max_lease_until_ms),
            None => (now_ms, now_ms + (MAX_REMEMBER_DAYS as i64) * DAY_MS),
        };
        let auto_unlock_until_ms = if clamped_days > 0 {
            (now_ms + (clamped_days as i64) * DAY_MS).min(max_lease_until_ms)
        } else {
            0
        };

        let lease = KeyringLease {
            dek_b64: B64.encode(dek),
            totp_secret_base32: Some(normalized),
            issued_at_ms,
            auto_unlock_until_ms,
            max_lease_until_ms,
            failed_totp_attempts: 0,
        };
        let _ = self.save_keyring_lease(pid, &lease);

        Ok(self.status_at(now_ms))
    }

    pub fn totp_disable(&self) -> Result<VaultStatus> {
        self.require_dek()?;
        let now_ms = chrono::Utc::now().timestamp_millis();
        self.tombstone_record("auth", "totp")?;

        let pid = &self.active_profile_id;
        if let Some(mut lease) = self.load_valid_lease_at(pid, now_ms) {
            lease.totp_secret_base32 = None;
            if now_ms < lease.auto_unlock_until_ms {
                let _ = self.save_keyring_lease(pid, &lease);
            } else {
                self.clear_keyring(pid);
            }
        }
        Ok(self.status_at(now_ms))
    }

    pub fn lock(&mut self) {
        self.lock_at(chrono::Utc::now().timestamp_millis());
    }

    pub fn lock_at(&mut self, now_ms: i64) {
        self.dek = None;
        let pid = self.active_profile_id.clone();
        if let Some(mut lease) = self.load_valid_lease_at(&pid, now_ms) {
            if lease.totp_secret_base32.is_some() {
                lease.auto_unlock_until_ms = 0;
                let _ = self.save_keyring_lease(&pid, &lease);
                return;
            }
        }
        self.clear_keyring(&pid);
    }

    pub fn forget_device_and_lock(&mut self) {
        self.dek = None;
        let pid = self.active_profile_id.clone();
        self.clear_keyring(&pid);
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
        let dir = self.vault_dir().join(collection);
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

    fn decrypt_raw_envelope(
        cipher: &XChaCha20Poly1305,
        collection: &str,
        path: &Path,
    ) -> Result<(EncryptedEnvelope, Vec<u8>)> {
        let raw = fs::read_to_string(path)?;
        let env: EncryptedEnvelope = serde_json::from_str(&raw)
            .with_context(|| format!("Invalid envelope JSON in {path:?}"))?;
        validate_record_id(&env.id)?;

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

        Ok((env, decrypted))
    }

    fn read_single<T: DeserializeOwned>(&self, collection: &str, id: &str) -> Result<Option<T>> {
        validate_record_id(id)?;
        let dek = self.require_dek()?;
        let dir = self.vault_dir().join(collection);
        let canonical = dir.join(format!("{id}.enc.json"));

        // Fast path if canonical file exists and has no OneDrive/SharePoint conflict siblings
        if canonical.exists() {
            let cipher = XChaCha20Poly1305::new(dek.into());
            let (env, decrypted) = Self::decrypt_raw_envelope(&cipher, collection, &canonical)?;
            if env.tombstone {
                return Ok(None);
            }
            return Ok(Some(serde_json::from_slice(&decrypted)?));
        }
        Ok(None)
    }

    /// Conflict-free LWW-Element-Set reader:
    /// Reconciles OneDrive/SharePoint (`<id>-<PCNAME>.enc.json`), Dropbox (`conflicted copy`),
    /// and Syncthing (`sync-conflict`) sibling forks deterministically by `(updated_at, ciphertext_b64)`.
    fn read_collection<T: DeserializeOwned>(&self, collection: &str) -> Result<Vec<T>> {
        let dek = self.require_dek()?;
        let dir = self.vault_dir().join(collection);
        if !dir.exists() {
            return Ok(Vec::new());
        }

        let cipher = XChaCha20Poly1305::new(dek.into());

        struct Candidate {
            env: EncryptedEnvelope,
            decrypted: Vec<u8>,
            paths: Vec<PathBuf>,
            winning_path: PathBuf,
        }

        let mut by_id: HashMap<String, Candidate> = HashMap::new();

        for entry in fs::read_dir(&dir)? {
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

            let (env, decrypted) = match Self::decrypt_raw_envelope(&cipher, collection, &path) {
                Ok(pair) => pair,
                Err(err) => {
                    eprintln!("[SkynetSSH Vault] Skipping unreadable file {path:?}: {err}");
                    continue;
                }
            };

            match by_id.get_mut(&env.id) {
                None => {
                    by_id.insert(
                        env.id.clone(),
                        Candidate {
                            env,
                            decrypted,
                            paths: vec![path.clone()],
                            winning_path: path,
                        },
                    );
                }
                Some(existing) => {
                    existing.paths.push(path.clone());
                    let new_key = (env.updated_at, env.ciphertext_b64.as_str());
                    let cur_key = (
                        existing.env.updated_at,
                        existing.env.ciphertext_b64.as_str(),
                    );
                    if new_key > cur_key {
                        existing.env = env;
                        existing.decrypted = decrypted;
                        existing.winning_path = path;
                    }
                }
            }
        }

        let mut items = Vec::new();
        for (id, cand) in by_id {
            let canonical_path = dir.join(format!("{id}.enc.json"));
            // Heal OneDrive / SharePoint conflict forks back into canonical `{id}.enc.json`
            if cand.paths.len() > 1 || cand.winning_path != canonical_path {
                if let Ok(serialized) = serde_json::to_string_pretty(&cand.env) {
                    if atomic_write(&canonical_path, serialized.as_bytes()).is_ok() {
                        for p in &cand.paths {
                            if p != &canonical_path {
                                let _ = fs::remove_file(p);
                            }
                        }
                    }
                }
            }

            if cand.env.tombstone {
                continue;
            }
            if let Ok(parsed) = serde_json::from_slice::<T>(&cand.decrypted) {
                items.push(parsed);
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

    fn sample_host(id: &str, label: &str, address: &str, updated_at: i64) -> HostRecord {
        HostRecord {
            id: id.into(),
            label: label.into(),
            address: address.into(),
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
            updated_at,
        }
    }

    #[test]
    fn test_vault_roundtrip_tamper_and_tombstone() {
        let temp_dir =
            std::env::temp_dir().join(format!("skynet_vault_test_{}", uuid::Uuid::new_v4()));
        let mut engine = VaultEngine::new(temp_dir.clone()).unwrap();
        assert!(!engine.is_initialized());

        engine.initialize("T800-Cyberdyne!", 0).unwrap();
        assert!(engine.is_initialized());
        assert!(engine.is_unlocked());

        let mut host = sample_host("h-1", "Skynet Core", "10.0.0.1", 1700000000);
        engine.save_host(&host).unwrap();

        host.id = "../escape".into();
        assert!(engine.save_host(&host).is_err());

        engine.lock();
        assert!(!engine.is_unlocked());
        assert!(engine.unlock("wrong-password", 0).is_err());

        fs::write(
            engine.vault_dir().join("hosts").join("corrupt.enc.json"),
            b"<<<<<<< HEAD broken sync file",
        )
        .unwrap();

        let snap = engine.unlock("T800-Cyberdyne!", 0).unwrap();
        assert_eq!(snap.hosts.len(), 1);
        assert_eq!(
            engine.get_host("h-1").unwrap().password.as_deref(),
            Some("top-secret")
        );

        engine.delete_host("h-1").unwrap();
        assert!(engine.get_host("h-1").is_err());
        assert_eq!(engine.snapshot().unwrap().hosts.len(), 0);

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn test_onedrive_sharepoint_conflict_reconciliation() {
        let temp_dir =
            std::env::temp_dir().join(format!("skynet_sharepoint_test_{}", uuid::Uuid::new_v4()));
        let mut engine = VaultEngine::new(temp_dir.clone()).unwrap();
        engine.initialize("TeamSharePointPass!", 0).unwrap();

        let hosts_dir = engine.vault_dir().join("hosts");

        // Teammate A wrote h-shared at t=1000
        let v1 = sample_host("h-shared", "Prod DB (Old)", "10.0.1.10", 1000);
        engine.save_host(&v1).unwrap();
        let v1_bytes = fs::read(hosts_dir.join("h-shared.enc.json")).unwrap();

        // Teammate B concurrently edited h-shared at t=2500; OneDrive saved it as `h-shared-LAPTOP-BOB.enc.json`!
        let v2 = sample_host("h-shared", "Prod DB (New)", "10.0.1.99", 2500);
        engine.save_host(&v2).unwrap();
        fs::rename(
            hosts_dir.join("h-shared.enc.json"),
            hosts_dir.join("h-shared-LAPTOP-BOB.enc.json"),
        )
        .unwrap();
        fs::write(hosts_dir.join("h-shared.enc.json"), v1_bytes).unwrap();

        // Snapshot must deterministically pick t=2500, yield NO duplicates, and clean up `-LAPTOP-BOB` fork!
        let snap = engine.snapshot().unwrap();
        assert_eq!(snap.hosts.len(), 1);
        assert_eq!(snap.hosts[0].label, "Prod DB (New)");
        assert_eq!(snap.hosts[0].address, "10.0.1.99");
        assert!(!hosts_dir.join("h-shared-LAPTOP-BOB.enc.json").exists());
        assert!(hosts_dir.join("h-shared.enc.json").exists());

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn test_totp_30_day_lease_and_3_strike_wipe() {
        let temp_dir =
            std::env::temp_dir().join(format!("skynet_totp_lease_test_{}", uuid::Uuid::new_v4()));
        let mut engine = VaultEngine::new(temp_dir.clone()).unwrap();
        let t0 = 1_700_000_100_000i64;

        // 1. Initialize and unlock requesting 999 days -> clamped strictly to 30 days max!
        engine.initialize("Master-Cyberdyne-99!", 0).unwrap();
        engine
            .save_host(&sample_host("h-totp", "Bastion", "10.0.0.5", t0))
            .unwrap();
        engine.lock_at(t0);
        engine.unlock_at("Master-Cyberdyne-99!", 999, t0).unwrap();

        let st_initial = engine.status_at(t0);
        assert!(st_initial.device_auto_unlock_valid);
        assert_eq!(
            st_initial.device_lease_expires_at,
            Some(t0 + 30 * DAY_MS)
        );

        // 2. Enroll TOTP with 7-day auto-unlock window
        let setup = engine.totp_begin_setup().unwrap();
        let secret_bytes = crate::totp::decode_base32_secret(&setup.secret_base32).unwrap();
        let valid_code_t0 = format!(
            "{:06}",
            crate::totp::compute_totp_at_step(&secret_bytes, (t0 as u64 / 1000) / 30).unwrap()
        );
        let st_enrolled = engine
            .totp_confirm_setup_at(&setup.secret_base32, &valid_code_t0, 7, t0)
            .unwrap();
        assert!(st_enrolled.totp_enabled);
        assert!(st_enrolled.totp_available_on_device);

        // 3. Manual lock disables silent auto-unlock, but keeps TOTP quick-unlock available!
        engine.lock_at(t0 + 1000);
        assert!(engine.unlock_with_keyring_at(t0 + 2000).is_err());
        assert!(engine.status_at(t0 + 2000).totp_available_on_device);

        // 4. Unlock with valid 6-digit TOTP at Day 8 (with 7-day remember) succeeds
        let t_day8 = t0 + 8 * DAY_MS;
        let code_day8 = format!(
            "{:06}",
            crate::totp::compute_totp_at_step(&secret_bytes, (t_day8 as u64 / 1000) / 30).unwrap()
        );
        let snap = engine.unlock_with_totp_at(&code_day8, 7, t_day8).unwrap();
        assert_eq!(snap.hosts.len(), 1);
        assert!(engine.unlock_with_keyring_at(t_day8 + DAY_MS).is_ok());

        // 5. At Day 31 (> 30 days since Master Password), both auto-unlock AND TOTP expire & wipe!
        engine.dek = None;
        let t_day31 = t0 + 31 * DAY_MS;
        assert!(engine.unlock_with_keyring_at(t_day31).is_err());
        let code_day31 = format!(
            "{:06}",
            crate::totp::compute_totp_at_step(&secret_bytes, (t_day31 as u64 / 1000) / 30).unwrap()
        );
        assert!(engine.unlock_with_totp_at(&code_day31, 7, t_day31).is_err());
        assert!(!engine.status_at(t_day31).keyring_saved);
        assert!(!engine.status_at(t_day31).totp_available_on_device);
        // Vault itself still reports totp_enabled from envelope header so UI can prompt Master Password
        assert!(engine.status_at(t_day31).totp_enabled);

        // 6. Re-unlock with Master Password at Day 31 restores TOTP lease, then test 3-strike wipe!
        engine
            .unlock_at("Master-Cyberdyne-99!", 0, t_day31)
            .unwrap();
        engine.lock_at(t_day31 + 1000);
        assert_eq!(engine.status_at(t_day31 + 1000).totp_remaining_attempts, 3);

        // Strike 1
        assert!(engine.unlock_with_totp_at("000000", 0, t_day31 + 2000).is_err());
        assert_eq!(engine.status_at(t_day31 + 2000).totp_remaining_attempts, 2);
        // Strike 2
        assert!(engine.unlock_with_totp_at("000000", 0, t_day31 + 3000).is_err());
        assert_eq!(engine.status_at(t_day31 + 3000).totp_remaining_attempts, 1);
        // Strike 3 -> immediate keyring wipe! Even the real TOTP code must now be rejected!
        assert!(engine.unlock_with_totp_at("000000", 0, t_day31 + 4000).is_err());
        assert!(!engine.status_at(t_day31 + 4000).totp_available_on_device);
        assert!(engine
            .unlock_with_totp_at(&code_day31, 0, t_day31 + 4000)
            .is_err());

        let _ = fs::remove_dir_all(temp_dir);
    }
}
