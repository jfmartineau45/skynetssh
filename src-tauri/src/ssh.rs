use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use russh::client::{self, Handle, Msg, Session};
use russh::keys::agent::client::AgentClient;
use russh::keys::key::PrivateKeyWithHashAlg;
use russh::keys::{decode_secret_key, HashAlg, PublicKey};
use russh::{Channel, ChannelMsg, Disconnect};
use ssh_key::rand_core::OsRng;
use tauri::ipc::Channel as IpcChannel;
use tauri::{AppHandle, Emitter};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, oneshot, Mutex};

use crate::models::{HostKeyPromptEvent, HostRecord, KnownHostRecord, SshKeyRecord};
use crate::vault::VaultEngine;

#[derive(Clone)]
pub struct RemoteForwardTarget {
    pub target_host: String,
    pub target_port: u16,
    pub active_connections: Arc<AtomicUsize>,
    pub bytes_in: Arc<AtomicU64>,
    pub bytes_out: Arc<AtomicU64>,
}

pub struct SshClientHandler {
    host_port: String,
    app_handle: Option<AppHandle>,
    vault: Arc<std::sync::Mutex<VaultEngine>>,
    pending_prompts: Arc<Mutex<HashMap<String, oneshot::Sender<bool>>>>,
    remote_forward: Option<RemoteForwardTarget>,
}

#[async_trait::async_trait]
impl client::Handler for SshClientHandler {
    type Error = anyhow::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        let fingerprint = server_public_key.fingerprint(HashAlg::Sha256).to_string();
        let key_type = server_public_key.algorithm().as_str().to_string();
        let pub_openssh = server_public_key
            .to_openssh()
            .unwrap_or_else(|_| fingerprint.clone());

        let existing_match = {
            let guard = self
                .vault
                .lock()
                .map_err(|_| anyhow!("Vault mutex poisoned"))?;
            guard.find_known_host(&self.host_port)?
        };

        if let Some(ref record) = existing_match {
            if record.fingerprint_sha256 == fingerprint {
                return Ok(true);
            }
        }

        let Some(ref app) = self.app_handle else {
            return Err(anyhow!("Interactive host key verification unavailable"));
        };

        let request_id = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = oneshot::channel::<bool>();
        self.pending_prompts
            .lock()
            .await
            .insert(request_id.clone(), tx);

        let prompt_event = HostKeyPromptEvent {
            request_id: request_id.clone(),
            host_port: self.host_port.clone(),
            key_type: key_type.clone(),
            fingerprint_sha256: fingerprint.clone(),
            status: if existing_match.is_some() {
                "changed".into()
            } else {
                "unknown".into()
            },
            previous_fingerprint: existing_match.as_ref().map(|r| r.fingerprint_sha256.clone()),
        };

        app.emit("ssh-host-key-prompt", prompt_event)
            .map_err(|e| anyhow!("Failed to emit host key prompt: {e}"))?;

        let accepted = tokio::time::timeout(Duration::from_secs(120), rx)
            .await
            .map_err(|_| anyhow!("Host key verification timed out"))?
            .unwrap_or(false);

        if accepted {
            let now = chrono::Utc::now().timestamp_millis();
            let kh_record = KnownHostRecord {
                id: existing_match
                    .map(|r| r.id)
                    .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
                host_port: self.host_port.clone(),
                key_type,
                fingerprint_sha256: fingerprint,
                public_key_base64: pub_openssh,
                first_seen_at: now,
                updated_at: now,
            };
            if let Ok(guard) = self.vault.lock() {
                let _ = guard.save_known_host(&kh_record);
            }
        }

        Ok(accepted)
    }

    async fn server_channel_open_forwarded_tcpip(
        &mut self,
        channel: Channel<Msg>,
        _connected_address: &str,
        _connected_port: u32,
        _originator_address: &str,
        _originator_port: u32,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        let Some(fwd) = self.remote_forward.clone() else {
            let _ = channel.close().await;
            return Ok(());
        };

        tokio::spawn(async move {
            fwd.active_connections.fetch_add(1, Ordering::Relaxed);
            if let Ok(mut local_stream) =
                TcpStream::connect((fwd.target_host.as_str(), fwd.target_port)).await
            {
                let mut ssh_stream = channel.into_stream();
                if let Ok((from_remote, to_remote)) =
                    tokio::io::copy_bidirectional(&mut ssh_stream, &mut local_stream).await
                {
                    fwd.bytes_in.fetch_add(from_remote, Ordering::Relaxed);
                    fwd.bytes_out.fetch_add(to_remote, Ordering::Relaxed);
                }
            } else {
                let _ = channel.close().await;
            }
            fwd.active_connections.fetch_sub(1, Ordering::Relaxed);
        });

        Ok(())
    }
}

enum ShellControl {
    Data(Vec<u8>),
    Resize { cols: u32, rows: u32 },
    Close,
}

#[derive(Clone)]
pub struct SshPool {
    handles: Arc<Mutex<HashMap<String, Arc<Handle<SshClientHandler>>>>>,
    shells: Arc<Mutex<HashMap<String, mpsc::UnboundedSender<ShellControl>>>>,
    pending_prompts: Arc<Mutex<HashMap<String, oneshot::Sender<bool>>>>,
}

impl Default for SshPool {
    fn default() -> Self {
        Self::new()
    }
}

impl SshPool {
    pub fn new() -> Self {
        Self {
            handles: Arc::new(Mutex::new(HashMap::new())),
            shells: Arc::new(Mutex::new(HashMap::new())),
            pending_prompts: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn respond_host_key(&self, request_id: &str, accept: bool) {
        if let Some(tx) = self.pending_prompts.lock().await.remove(request_id) {
            let _ = tx.send(accept);
        }
    }

    pub fn generate_key_pair(
        name: &str,
        algorithm: &str,
        passphrase: Option<&str>,
    ) -> Result<SshKeyRecord> {
        let ssh_algo = match algorithm {
            "rsa" => ssh_key::Algorithm::Rsa {
                hash: Some(ssh_key::HashAlg::Sha512),
            },
            _ => ssh_key::Algorithm::Ed25519,
        };

        let mut priv_key = ssh_key::PrivateKey::random(&mut OsRng, ssh_algo)
            .map_err(|e| anyhow!("Key generation failed: {e}"))?;
        priv_key.set_comment(name);

        let public_openssh = priv_key
            .public_key()
            .to_openssh()
            .map_err(|e| anyhow!("Public key serialization failed: {e}"))?;
        let fingerprint = priv_key
            .public_key()
            .fingerprint(ssh_key::HashAlg::Sha256)
            .to_string();

        let pem_zeroizing = if let Some(pw) = passphrase.filter(|p| !p.is_empty()) {
            let encrypted = priv_key
                .encrypt(&mut OsRng, pw)
                .map_err(|e| anyhow!("Key passphrase encryption failed: {e}"))?;
            encrypted
                .to_openssh(ssh_key::LineEnding::LF)
                .map_err(|e| anyhow!("PEM encode failed: {e}"))?
        } else {
            priv_key
                .to_openssh(ssh_key::LineEnding::LF)
                .map_err(|e| anyhow!("PEM encode failed: {e}"))?
        };

        let now = chrono::Utc::now().timestamp_millis();
        Ok(SshKeyRecord {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.to_string(),
            algorithm: if algorithm == "rsa" {
                "rsa".into()
            } else {
                "ed25519".into()
            },
            public_key: public_openssh,
            private_key_pem: pem_zeroizing.to_string(),
            passphrase: passphrase.map(|s| s.to_string()),
            fingerprint,
            created_at: now,
            updated_at: now,
        })
    }

    pub fn import_key_from_pem(
        name: &str,
        pem_text: &str,
        passphrase: Option<&str>,
    ) -> Result<SshKeyRecord> {
        let decoded = decode_secret_key(pem_text, passphrase)
            .context("Could not parse SSH private key (check format or passphrase)")?;
        let pub_key = decoded.public_key();
        let fingerprint = pub_key.fingerprint(HashAlg::Sha256).to_string();
        let pub_openssh = pub_key.to_openssh().unwrap_or_default();
        let algo = pub_key.algorithm().as_str().to_string();
        let now = chrono::Utc::now().timestamp_millis();

        Ok(SshKeyRecord {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.to_string(),
            algorithm: algo,
            public_key: pub_openssh,
            private_key_pem: pem_text.to_string(),
            passphrase: passphrase.map(|s| s.to_string()),
            fingerprint,
            created_at: now,
            updated_at: now,
        })
    }

    pub async fn get_or_connect(
        &self,
        host_id: &str,
        vault: Arc<std::sync::Mutex<VaultEngine>>,
        app_handle: Option<AppHandle>,
    ) -> Result<Arc<Handle<SshClientHandler>>> {
        if let Some(existing) = self.handles.lock().await.get(host_id).cloned() {
            if !existing.is_closed() {
                return Ok(existing);
            }
        }

        let mut visited = HashSet::new();
        let handle = self
            .connect_recursive(host_id, &mut visited, vault, app_handle, None)
            .await?;

        let arc_handle = Arc::new(handle);
        self.handles
            .lock()
            .await
            .insert(host_id.to_string(), arc_handle.clone());
        Ok(arc_handle)
    }

    pub async fn connect_dedicated_with_forward(
        &self,
        host_id: &str,
        vault: Arc<std::sync::Mutex<VaultEngine>>,
        app_handle: Option<AppHandle>,
        remote_forward: RemoteForwardTarget,
    ) -> Result<Handle<SshClientHandler>> {
        let mut visited = HashSet::new();
        self.connect_recursive(
            host_id,
            &mut visited,
            vault,
            app_handle,
            Some(remote_forward),
        )
        .await
    }

    fn connect_recursive<'a>(
        &'a self,
        host_id: &'a str,
        visited: &'a mut HashSet<String>,
        vault: Arc<std::sync::Mutex<VaultEngine>>,
        app_handle: Option<AppHandle>,
        remote_forward: Option<RemoteForwardTarget>,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<Handle<SshClientHandler>>> + Send + 'a>,
    > {
        Box::pin(async move {
            if !visited.insert(host_id.to_string()) {
                return Err(anyhow!("Circular ProxyJump loop detected for host {host_id}"));
            }

            let (host, maybe_key) = {
                let guard = vault.lock().map_err(|_| anyhow!("Vault mutex poisoned"))?;
                let h = guard.get_host(host_id)?;
                let k = if let Some(ref kid) = h.key_id {
                    guard.get_key(kid).ok()
                } else {
                    None
                };
                (h, k)
            };

            let config = Arc::new(client::Config {
                keepalive_interval: Some(Duration::from_secs(
                    host.keepalive_interval_secs.max(15),
                )),
                keepalive_max: 3,
                inactivity_timeout: None,
                ..Default::default()
            });

            let handler = SshClientHandler {
                host_port: format!("{}:{}", host.address, host.port),
                app_handle: app_handle.clone(),
                vault: vault.clone(),
                pending_prompts: self.pending_prompts.clone(),
                remote_forward,
            };

            let mut session = if let Some(ref jump_id) =
                host.jump_host_id.as_ref().filter(|s| !s.is_empty())
            {
                let bastion = self
                    .connect_recursive(jump_id, visited, vault.clone(), app_handle.clone(), None)
                    .await?;
                let jump_channel = bastion
                    .channel_open_direct_tcpip(&host.address, host.port as u32, "127.0.0.1", 0)
                    .await
                    .with_context(|| {
                        format!(
                            "Bastion host failed to forward TCP connection to {}:{}",
                            host.address, host.port
                        )
                    })?;
                client::connect_stream(config, jump_channel.into_stream(), handler).await?
            } else {
                tokio::time::timeout(
                    Duration::from_secs(15),
                    client::connect(config, (host.address.as_str(), host.port), handler),
                )
                .await
                .map_err(|_| {
                    anyhow!("Connection timed out reaching {}:{}", host.address, host.port)
                })??
            };

            Self::authenticate_session(&mut session, &host, maybe_key.as_ref()).await?;
            Ok(session)
        })
    }

    async fn try_agent_auth<S: russh::keys::agent::client::AgentStream + Unpin + Send + 'static>(
        session: &mut Handle<SshClientHandler>,
        username: &str,
        mut agent: AgentClient<S>,
    ) -> bool {
        let Ok(identities) = agent.request_identities().await else {
            return false;
        };
        for pubkey in identities {
            if let Ok(true) = session
                .authenticate_publickey_with(username, pubkey, &mut agent)
                .await
            {
                return true;
            }
        }
        false
    }

    async fn authenticate_session(
        session: &mut Handle<SshClientHandler>,
        host: &HostRecord,
        key_record: Option<&SshKeyRecord>,
    ) -> Result<()> {
        match host.auth_method.as_str() {
            "password" => {
                let pw = host.password.as_deref().unwrap_or("");
                let ok = session
                    .authenticate_password(&host.username, pw)
                    .await
                    .context("Password authentication error")?;
                if !ok {
                    return Err(anyhow!(
                        "Authentication rejected by server for {}@{}",
                        host.username,
                        host.address
                    ));
                }
            }
            "key" => {
                let kr = key_record.ok_or_else(|| {
                    anyhow!("Host uses SSH Key auth, but no SSH key is selected in Vault")
                })?;
                let decoded = decode_secret_key(&kr.private_key_pem, kr.passphrase.as_deref())
                    .context("Failed to unlock SSH private key")?;
                let hash_alg = if decoded.algorithm().is_rsa() {
                    Some(HashAlg::Sha512)
                } else {
                    None
                };
                let key_with_alg = PrivateKeyWithHashAlg::new(Arc::new(decoded), hash_alg)
                    .context("Invalid SSH key parameters")?;
                let ok = session
                    .authenticate_publickey(&host.username, key_with_alg)
                    .await
                    .context("Public-key authentication failed")?;
                if !ok {
                    return Err(anyhow!(
                        "Server rejected SSH key '{}' for {}@{}",
                        kr.name,
                        host.username,
                        host.address
                    ));
                }
            }
            "agent" => {
                let mut authed = false;

                // 1. Real Windows OpenSSH Agent named pipe + Pageant (1Password / KeePassXC / PuTTY)
                #[cfg(windows)]
                {
                    if let Ok(agent) =
                        AgentClient::connect_named_pipe(r"\\.\pipe\openssh-ssh-agent").await
                    {
                        authed = Self::try_agent_auth(session, &host.username, agent).await;
                    }
                    if !authed {
                        let pageant = AgentClient::connect_pageant().await;
                        authed = Self::try_agent_auth(session, &host.username, pageant).await;
                    }
                }

                #[cfg(unix)]
                {
                    if let Ok(agent) = AgentClient::connect_env().await {
                        authed = Self::try_agent_auth(session, &host.username, agent).await;
                    }
                }

                // 2. Fallback: unencrypted default ~/.ssh/id_ed25519 or ~/.ssh/id_rsa
                if !authed {
                    if let Some(home) = dirs::home_dir() {
                        for path in [
                            home.join(".ssh").join("id_ed25519"),
                            home.join(".ssh").join("id_rsa"),
                        ] {
                            if let Ok(raw) = std::fs::read_to_string(&path) {
                                if let Ok(decoded) = decode_secret_key(&raw, None) {
                                    let hash_alg = if decoded.algorithm().is_rsa() {
                                        Some(HashAlg::Sha512)
                                    } else {
                                        None
                                    };
                                    if let Ok(key_with_alg) =
                                        PrivateKeyWithHashAlg::new(Arc::new(decoded), hash_alg)
                                    {
                                        if let Ok(true) = session
                                            .authenticate_publickey(&host.username, key_with_alg)
                                            .await
                                        {
                                            authed = true;
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                if !authed {
                    return Err(anyhow!(
                        "SSH Agent authentication failed (checked Windows ssh-agent, Pageant, and ~/.ssh default keys)."
                    ));
                }
            }
            other => return Err(anyhow!("Unsupported auth method: {other}")),
        }

        Ok(())
    }

    pub async fn open_shell(
        &self,
        host_id: &str,
        cols: u32,
        rows: u32,
        on_data: IpcChannel<Vec<u8>>,
        vault: Arc<std::sync::Mutex<VaultEngine>>,
        app_handle: AppHandle,
    ) -> Result<String> {
        let handle = self
            .get_or_connect(host_id, vault, Some(app_handle))
            .await?;

        let mut channel = handle
            .channel_open_session()
            .await
            .context("Failed to open SSH session channel")?;

        channel
            .request_pty(
                false,
                "xterm-256color",
                cols.max(20),
                rows.max(5),
                0,
                0,
                &[],
            )
            .await
            .context("SSH PTY allocation failed")?;

        channel
            .request_shell(false)
            .await
            .context("SSH shell request failed")?;

        let session_id = uuid::Uuid::new_v4().to_string();
        let (tx, mut rx) = mpsc::unbounded_channel::<ShellControl>();
        self.shells.lock().await.insert(session_id.clone(), tx);

        let shells_map = self.shells.clone();
        let sid_clone = session_id.clone();

        tokio::spawn(async move {
            let mut out_buf: Vec<u8> = Vec::with_capacity(16384);
            loop {
                let flush_sleep = tokio::time::sleep(Duration::from_millis(4));
                tokio::pin!(flush_sleep);

                tokio::select! {
                    Some(ctrl) = rx.recv() => {
                        match ctrl {
                            ShellControl::Data(bytes) => {
                                if channel.data(&bytes[..]).await.is_err() {
                                    break;
                                }
                            }
                            ShellControl::Resize { cols, rows } => {
                                let _ = channel.window_change(cols, rows, 0, 0).await;
                            }
                            ShellControl::Close => {
                                let _ = channel.eof().await;
                                let _ = channel.close().await;
                                break;
                            }
                        }
                    }
                    maybe_msg = channel.wait() => {
                        match maybe_msg {
                            Some(ChannelMsg::Data { ref data }) | Some(ChannelMsg::ExtendedData { ref data, .. }) => {
                                out_buf.extend_from_slice(data);
                                if out_buf.len() >= 65536 && on_data.send(std::mem::take(&mut out_buf)).is_err() {
                                    break;
                                }
                            }
                            Some(ChannelMsg::Close) | None => {
                                if !out_buf.is_empty() {
                                    let _ = on_data.send(std::mem::take(&mut out_buf));
                                }
                                let _ = on_data.send(b"\r\n\x1b[90m[SSH session closed]\x1b[0m\r\n".to_vec());
                                break;
                            }
                            _ => {}
                        }
                    }
                    _ = &mut flush_sleep, if !out_buf.is_empty() => {
                        if on_data.send(std::mem::take(&mut out_buf)).is_err() {
                            break;
                        }
                    }
                }
            }
            shells_map.lock().await.remove(&sid_clone);
        });

        Ok(session_id)
    }

    pub async fn write_shell(&self, session_id: &str, data: Vec<u8>) -> Result<()> {
        if let Some(tx) = self.shells.lock().await.get(session_id) {
            let _ = tx.send(ShellControl::Data(data));
        }
        Ok(())
    }

    pub async fn resize_shell(&self, session_id: &str, cols: u32, rows: u32) -> Result<()> {
        if let Some(tx) = self.shells.lock().await.get(session_id) {
            let _ = tx.send(ShellControl::Resize { cols, rows });
        }
        Ok(())
    }

    pub async fn close_shell(&self, session_id: &str) -> Result<()> {
        if let Some(tx) = self.shells.lock().await.remove(session_id) {
            let _ = tx.send(ShellControl::Close);
        }
        Ok(())
    }

    pub async fn disconnect_all(&self) {
        let shells: Vec<_> = self.shells.lock().await.drain().collect();
        for (_, tx) in shells {
            let _ = tx.send(ShellControl::Close);
        }
        let handles: Vec<_> = self.handles.lock().await.drain().collect();
        for (_, h) in handles {
            let _ = h
                .disconnect(Disconnect::ByApplication, "Vault locked", "en")
                .await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ed25519_keygen_and_pem_import() {
        let generated =
            SshPool::generate_key_pair("T800-Key", "ed25519", Some("cyberdyne-pass")).unwrap();
        assert_eq!(generated.algorithm, "ed25519");
        assert!(generated.public_key.starts_with("ssh-ed25519 "));
        assert!(generated.fingerprint.starts_with("SHA256:"));

        let reimported = SshPool::import_key_from_pem(
            "Reimported",
            &generated.private_key_pem,
            Some("cyberdyne-pass"),
        )
        .unwrap();
        assert_eq!(reimported.fingerprint, generated.fingerprint);
    }
}
