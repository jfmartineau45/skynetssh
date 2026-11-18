use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupRecord {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub color: String,
    pub parent_id: Option<String>,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostRecord {
    pub id: String,
    pub label: String,
    pub address: String,
    pub port: u16,
    pub username: String,
    pub auth_method: String, // "password" | "key" | "agent"
    pub password: Option<String>,
    pub key_id: Option<String>,
    pub group_id: Option<String>,
    pub tags: Vec<String>,
    pub jump_host_id: Option<String>,
    pub startup_snippet_id: Option<String>,
    pub startup_command: Option<String>,
    #[serde(default = "default_keepalive")]
    pub keepalive_interval_secs: u64,
    pub notes: Option<String>,
    pub last_connected_at: Option<i64>,
    pub updated_at: i64,
}

fn default_keepalive() -> u64 {
    30
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostProbeResult {
    pub host_id: String,
    pub online: bool,
    pub latency_ms: Option<u64>,
    pub passed_probes: u8,
    pub total_probes: u8,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshKeyRecord {
    pub id: String,
    pub name: String,
    pub algorithm: String,
    pub public_key: String,
    pub private_key_pem: String,
    pub passphrase: Option<String>,
    pub fingerprint: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelRecord {
    pub id: String,
    pub name: String,
    pub host_id: String,
    pub tunnel_type: String, // "local" | "remote" | "dynamic"
    pub bind_address: String,
    pub bind_port: u16,
    pub target_host: Option<String>,
    pub target_port: Option<u16>,
    pub auto_start: bool,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveTunnelRuntime {
    pub tunnel_id: String,
    pub status: String,
    pub active_connections: usize,
    pub bytes_in: u64,
    pub bytes_out: u64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnippetRecord {
    pub id: String,
    pub name: String,
    pub command: String,
    pub description: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnownHostRecord {
    pub id: String,
    pub host_port: String,
    pub key_type: String,
    pub fingerprint_sha256: String,
    pub public_key_base64: String,
    pub first_seen_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostKeyPromptEvent {
    pub request_id: String,
    pub host_port: String,
    pub key_type: String,
    pub fingerprint_sha256: String,
    pub status: String, // "unknown" | "changed"
    pub previous_fingerprint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultProfile {
    pub id: String,
    pub name: String,
    pub kind: String, // "personal" | "team"
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TotpSetupPayload {
    pub secret_base32: String,
    pub otpauth_uri: String,
    pub qr_svg: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatus {
    pub initialized: bool,
    pub unlocked: bool,
    pub read_only: bool,
    pub vault_path: String,
    pub active_profile: VaultProfile,
    pub profiles: Vec<VaultProfile>,
    pub global_hotkey: String,
    pub keyring_available: bool,
    pub keyring_saved: bool,
    pub device_auto_unlock_valid: bool,
    pub device_lease_expires_at: Option<i64>,
    pub totp_enabled: bool,
    pub totp_available_on_device: bool,
    pub totp_remaining_attempts: u8,
    pub host_count: usize,
    pub key_count: usize,
    pub tunnel_count: usize,
    pub snippet_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredSshKey {
    pub name: String,
    pub path: String,
    pub public_key: Option<String>,
    pub fingerprint: Option<String>,
    pub encrypted: bool,
    pub already_in_vault: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredSshHost {
    pub alias: String,
    pub hostname: String,
    pub user: String,
    pub port: u16,
    pub identity_file: Option<String>,
    pub proxy_jump: Option<String>,
    pub already_in_vault: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshFolderScan {
    pub ssh_dir: String,
    pub keys: Vec<DiscoveredSshKey>,
    pub config_hosts: Vec<DiscoveredSshHost>,
    pub known_hosts_lines: usize,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultSnapshot {
    pub groups: Vec<GroupRecord>,
    pub hosts: Vec<HostRecord>,
    pub keys: Vec<SshKeyRecord>,
    pub tunnels: Vec<TunnelRecord>,
    pub snippets: Vec<SnippetRecord>,
    pub known_hosts: Vec<KnownHostRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellProfile {
    pub id: String,
    pub name: String,
    pub executable: String,
    pub args: Vec<String>,
    pub icon: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: u64,
    pub modified_at: Option<i64>,
    pub permissions: Option<u32>,
    pub permissions_display: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryListing {
    pub path: String,
    pub entries: Vec<SftpEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferProgressEvent {
    pub transfer_id: String,
    pub file_name: String,
    pub direction: String,
    pub bytes_transferred: u64,
    pub total_bytes: u64,
    pub status: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitSyncStatus {
    pub is_git_repo: bool,
    pub branch: Option<String>,
    pub remote_url: Option<String>,
    pub changed_files: usize,
    pub ahead: usize,
    pub behind: usize,
    pub last_sync_message: Option<String>,
}
