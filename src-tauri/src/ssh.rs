use std::collections::{HashMap, HashSet, VecDeque};
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

use crate::models::{
    HostKeyPromptEvent, HostOsDetectedEvent, HostProbeResult, HostRecord, KnownHostRecord,
    SshKeyRecord,
};
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

const SHELL_REPLAY_CAP: usize = 65_536;

pub(crate) fn append_replay_bytes(buf: &mut VecDeque<u8>, chunk: &[u8], cap: usize) {
    if cap == 0 || chunk.is_empty() {
        return;
    }
    if chunk.len() >= cap {
        buf.clear();
        buf.extend(&chunk[chunk.len() - cap..]);
        return;
    }
    let overflow = (buf.len() + chunk.len()).saturating_sub(cap);
    if overflow > 0 {
        buf.drain(..overflow);
    }
    buf.extend(chunk);
}

enum ShellControl {
    Data(Vec<u8>),
    Resize { cols: u32, rows: u32 },
    Reattach {
        on_data: IpcChannel<Vec<u8>>,
        cols: u32,
        rows: u32,
    },
    Close,
}

type CachedSshHandle = (String, Arc<Handle<SshClientHandler>>);

#[derive(Clone)]
pub struct SshPool {
    handles: Arc<Mutex<HashMap<String, CachedSshHandle>>>,
    shells: Arc<Mutex<HashMap<String, mpsc::UnboundedSender<ShellControl>>>>,
    shell_owners: Arc<Mutex<HashMap<String, String>>>,
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
            shell_owners: Arc::new(Mutex::new(HashMap::new())),
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

    fn compute_connection_fingerprint(
        host_id: &str,
        vault: &std::sync::Mutex<VaultEngine>,
    ) -> Result<String> {
        let guard = vault.lock().map_err(|_| anyhow!("Vault mutex poisoned"))?;
        let mut parts = Vec::new();
        let mut cur = Some(host_id.to_string());
        let mut seen = HashSet::new();

        while let Some(id) = cur {
            if !seen.insert(id.clone()) || seen.len() > 8 {
                break;
            }
            let h = guard.get_host(&id)?;
            let key_fp = h
                .key_id
                .as_deref()
                .and_then(|kid| guard.get_key(kid).ok())
                .map(|k| format!("{}:{:?}", k.fingerprint, k.passphrase))
                .unwrap_or_default();
            parts.push(format!(
                "{}|{}|{}|{}|{}|{:?}|{}",
                h.id,
                h.address.trim(),
                h.port,
                h.username.trim(),
                h.auth_method,
                h.password,
                key_fp
            ));
            cur = h.jump_host_id.filter(|s| !s.is_empty());
        }

        Ok(parts.join("->"))
    }

    pub async fn invalidate_host(&self, host_id: &str) {
        self.handles.lock().await.remove(host_id);
    }

    pub async fn get_or_connect(
        &self,
        host_id: &str,
        vault: Arc<std::sync::Mutex<VaultEngine>>,
        app_handle: Option<AppHandle>,
    ) -> Result<Arc<Handle<SshClientHandler>>> {
        let desired_fp = Self::compute_connection_fingerprint(host_id, &vault)?;

        if let Some((cached_fp, existing)) = self.handles.lock().await.get(host_id).cloned() {
            if cached_fp == desired_fp && !existing.is_closed() {
                return Ok(existing);
            }
            // Host IP, username, port, credentials, or jump-host changed -> evict stale session!
            self.handles.lock().await.remove(host_id);
        }

        let mut visited = HashSet::new();
        let handle = self
            .connect_recursive(host_id, &mut visited, vault.clone(), app_handle.clone(), None)
            .await?;

        let arc_handle = Arc::new(handle);
        self.handles
            .lock()
            .await
            .insert(host_id.to_string(), (desired_fp, arc_handle.clone()));

        spawn_os_distro_probe(host_id.to_string(), arc_handle.clone(), vault, app_handle);

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
        window_label: String,
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
        self.shell_owners
            .lock()
            .await
            .insert(session_id.clone(), window_label);

        let shells_map = self.shells.clone();
        let owners_map = self.shell_owners.clone();
        let sid_clone = session_id.clone();

        tokio::spawn(async move {
            let mut on_data = on_data;
            let mut out_buf: Vec<u8> = Vec::with_capacity(16384);
            let mut replay_buf: VecDeque<u8> = VecDeque::with_capacity(SHELL_REPLAY_CAP);
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
                                let _ = channel.window_change(cols.max(20), rows.max(5), 0, 0).await;
                            }
                            ShellControl::Reattach { on_data: new_sink, cols, rows } => {
                                if !out_buf.is_empty() {
                                    append_replay_bytes(&mut replay_buf, &out_buf, SHELL_REPLAY_CAP);
                                    out_buf.clear();
                                }
                                if !replay_buf.is_empty() {
                                    let snapshot: Vec<u8> = replay_buf.iter().copied().collect();
                                    let _ = new_sink.send(snapshot);
                                }
                                on_data = new_sink;
                                let _ = channel.window_change(cols.max(20), rows.max(5), 0, 0).await;
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
                                if out_buf.len() >= SHELL_REPLAY_CAP {
                                    append_replay_bytes(&mut replay_buf, &out_buf, SHELL_REPLAY_CAP);
                                    // Ignore transient IPC send errors so cross-window session handoff never drops the remote shell!
                                    let _ = on_data.send(std::mem::take(&mut out_buf));
                                }
                            }
                            Some(ChannelMsg::Close) | None => {
                                if !out_buf.is_empty() {
                                    append_replay_bytes(&mut replay_buf, &out_buf, SHELL_REPLAY_CAP);
                                    let _ = on_data.send(std::mem::take(&mut out_buf));
                                }
                                let _ = on_data.send(b"\r\n\x1b[90m[SSH session closed]\x1b[0m\r\n".to_vec());
                                break;
                            }
                            _ => {}
                        }
                    }
                    _ = &mut flush_sleep, if !out_buf.is_empty() => {
                        append_replay_bytes(&mut replay_buf, &out_buf, SHELL_REPLAY_CAP);
                        let _ = on_data.send(std::mem::take(&mut out_buf));
                    }
                }
            }
            shells_map.lock().await.remove(&sid_clone);
            owners_map.lock().await.remove(&sid_clone);
        });

        Ok(session_id)
    }

    pub async fn reattach_shell(
        &self,
        session_id: &str,
        cols: u32,
        rows: u32,
        on_data: IpcChannel<Vec<u8>>,
        window_label: String,
    ) -> Result<()> {
        let tx = self
            .shells
            .lock()
            .await
            .get(session_id)
            .cloned()
            .ok_or_else(|| anyhow!("SSH shell session is no longer active"))?;
        tx.send(ShellControl::Reattach {
            on_data,
            cols,
            rows,
        })
        .map_err(|_| anyhow!("SSH shell session closed"))?;
        self.shell_owners
            .lock()
            .await
            .insert(session_id.to_string(), window_label);
        Ok(())
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
        self.shell_owners.lock().await.remove(session_id);
        if let Some(tx) = self.shells.lock().await.remove(session_id) {
            let _ = tx.send(ShellControl::Close);
        }
        Ok(())
    }

    pub async fn close_shells_for_window(&self, window_label: &str) {
        let matching_ids: Vec<String> = {
            let mut owners = self.shell_owners.lock().await;
            let ids: Vec<String> = owners
                .iter()
                .filter(|(_, w)| w.as_str() == window_label)
                .map(|(sid, _)| sid.clone())
                .collect();
            for sid in &ids {
                owners.remove(sid);
            }
            ids
        };
        if matching_ids.is_empty() {
            return;
        }
        let mut shells = self.shells.lock().await;
        for sid in matching_ids {
            if let Some(tx) = shells.remove(&sid) {
                let _ = tx.send(ShellControl::Close);
            }
        }
    }

    pub async fn disconnect_all(&self) {
        self.shell_owners.lock().await.clear();
        let shells: Vec<_> = self.shells.lock().await.drain().collect();
        for (_, tx) in shells {
            let _ = tx.send(ShellControl::Close);
        }
        let handles: Vec<_> = self.handles.lock().await.drain().collect();
        for (_, (_, h)) in handles {
            let _ = h
                .disconnect(Disconnect::ByApplication, "Vault locked", "en")
                .await;
        }
    }
}

pub fn is_safe_probe_host(addr: &str) -> bool {
    let trimmed = addr.trim();
    !trimmed.is_empty()
        && trimmed.len() <= 253
        && !trimmed.starts_with('-')
        && trimmed
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | ':' | '-' | '_'))
}

pub fn requires_multi_ping_warmup(address: &str, label: &str, group_name: Option<&str>) -> bool {
    address.trim().starts_with("198.")
        || label.to_ascii_lowercase().contains("secorall")
        || group_name
            .unwrap_or("")
            .to_ascii_lowercase()
            .contains("secorall")
}

async fn tcp_port_probe(address: &str, port: u16, timeout_ms: u64) -> Option<u64> {
    let start = std::time::Instant::now();
    let target = if address.contains(':') && !address.starts_with('[') {
        format!("[{address}]:{port}")
    } else {
        format!("{address}:{port}")
    };
    match tokio::time::timeout(Duration::from_millis(timeout_ms), TcpStream::connect(target)).await
    {
        Ok(Ok(_stream)) => Some(start.elapsed().as_millis() as u64),
        _ => None,
    }
}

async fn icmp_ping_once(address: &str, timeout_ms: u64) -> Option<u64> {
    if !is_safe_probe_host(address) {
        return None;
    }
    let start = std::time::Instant::now();
    let mut cmd = tokio::process::Command::new("ping");
    #[cfg(target_os = "windows")]
    {
        // CREATE_NO_WINDOW prevents any console flash
        cmd.creation_flags(0x0800_0000);
        cmd.args(["-n", "1", "-w", &timeout_ms.to_string(), address]);
    }
    #[cfg(not(target_os = "windows"))]
    {
        cmd.args(["-c", "1", "-W", "1", address]);
    }

    let out = tokio::time::timeout(Duration::from_millis(timeout_ms + 300), cmd.output())
        .await
        .ok()?
        .ok()?;

    if !out.status.success() {
        return None;
    }
    let stdout_lower = String::from_utf8_lossy(&out.stdout).to_ascii_lowercase();
    // Locale-safe check (English & French Windows): real IPv4 replies always include `TTL=`,
    // whereas gateway "Destination host unreachable" / "Impossible de joindre" does not!
    let valid_reply =
        stdout_lower.contains("ttl=") || (address.contains(':') && stdout_lower.contains("ms"));
    if valid_reply {
        Some(start.elapsed().as_millis() as u64)
    } else {
        None
    }
}

async fn single_reachability_probe(address: &str, port: u16, timeout_ms: u64) -> Option<u64> {
    let addr_tcp = address.to_string();
    let addr_icmp = address.to_string();

    let mut tcp_task =
        tokio::spawn(async move { tcp_port_probe(&addr_tcp, port, timeout_ms).await });
    let mut icmp_task =
        tokio::spawn(async move { icmp_ping_once(&addr_icmp, timeout_ms).await });

    tokio::select! {
        tcp_res = &mut tcp_task => {
            if let Ok(Some(ms)) = tcp_res {
                icmp_task.abort();
                return Some(ms);
            }
            icmp_task.await.ok().flatten()
        }
        icmp_res = &mut icmp_task => {
            if let Ok(Some(ms)) = icmp_res {
                tcp_task.abort();
                return Some(ms);
            }
            tcp_task.await.ok().flatten()
        }
    }
}

pub async fn probe_host_reachability(
    host_id: String,
    address: String,
    port: u16,
    label: String,
    group_name: Option<String>,
) -> HostProbeResult {
    let clean_addr = address.trim().trim_matches(|c| c == '[' || c == ']').to_string();
    if !is_safe_probe_host(&clean_addr) {
        return HostProbeResult {
            host_id,
            online: false,
            latency_ms: None,
            passed_probes: 0,
            total_probes: 0,
            detail: "Invalid host address".into(),
        };
    }

    let multi_ping = requires_multi_ping_warmup(&clean_addr, &label, group_name.as_deref());

    if multi_ping {
        // Secorall / 198.xx VPN & tunnel targets: run 3 sequential probes so cold routes/ARP wake up
        // on ping 1-2 and confirm reachability across 3 probes.
        let mut passed = 0u8;
        let mut last_ms: Option<u64> = None;
        for attempt in 1..=3u8 {
            if let Some(ms) = single_reachability_probe(&clean_addr, port, 1100).await {
                passed += 1;
                last_ms = Some(ms);
            }
            if attempt < 3 {
                tokio::time::sleep(Duration::from_millis(180)).await;
            }
        }
        let online = passed > 0;
        let detail = match (online, last_ms) {
            (true, Some(ms)) => format!("Online ({passed}/3) · {ms}ms"),
            (true, None) => format!("Online ({passed}/3)"),
            (false, _) => "Offline (0/3)".into(),
        };
        HostProbeResult {
            host_id,
            online,
            latency_ms: last_ms,
            passed_probes: passed,
            total_probes: 3,
            detail,
        }
    } else {
        // Standard hosts: return immediately on first success, retrying up to 3 times before marking Offline
        for attempt in 1..=3u8 {
            if let Some(ms) = single_reachability_probe(&clean_addr, port, 950).await {
                return HostProbeResult {
                    host_id,
                    online: true,
                    latency_ms: Some(ms),
                    passed_probes: 1,
                    total_probes: attempt,
                    detail: format!("Online · {ms}ms"),
                };
            }
            if attempt < 3 {
                tokio::time::sleep(Duration::from_millis(150)).await;
            }
        }
        HostProbeResult {
            host_id,
            online: false,
            latency_ms: None,
            passed_probes: 0,
            total_probes: 3,
            detail: "Offline".into(),
        }
    }
}

/// Parses `/etc/os-release` + `uname -s` + Proxmox/Synology markers into a canonical distro icon slug.
pub fn detect_os_slug_from_probe(raw: &str) -> Option<&'static str> {
    let lower = raw.to_ascii_lowercase();
    if lower.contains("skynet_pve=1") {
        return Some("proxmox");
    }
    if lower.contains("skynet_synology=1") || lower.contains("synology") {
        return Some("synology");
    }

    let mut id_val = String::new();
    let mut id_like = String::new();
    let mut pretty = String::new();

    for line in lower.lines() {
        let trimmed = line.trim();
        if let Some(v) = trimmed.strip_prefix("id=") {
            id_val = v.trim_matches(|c| c == '"' || c == '\'').to_string();
        } else if let Some(v) = trimmed.strip_prefix("id_like=") {
            id_like = v.trim_matches(|c| c == '"' || c == '\'').to_string();
        } else if let Some(v) = trimmed.strip_prefix("pretty_name=") {
            pretty = v.trim_matches(|c| c == '"' || c == '\'').to_string();
        }
    }

    let match_token = |tok: &str| -> Option<&'static str> {
        match tok {
            "ubuntu" | "pop" | "linuxmint" | "elementary" | "zorin" => Some("ubuntu"),
            "raspbian" => Some("raspberrypi"),
            "kali" => Some("kali"),
            "proxmox" => Some("proxmox"),
            "debian" => Some("debian"),
            "rocky" => Some("rocky"),
            "almalinux" => Some("almalinux"),
            "rhel" | "ol" => Some("rhel"),
            "fedora" => Some("fedora"),
            "centos" => Some("centos"),
            "amzn" => Some("aws"),
            "arch" | "manjaro" | "endeavouros" | "cachyos" => Some("arch"),
            "alpine" => Some("alpine"),
            "opensuse" | "opensuse-leap" | "opensuse-tumbleweed" | "sles" => Some("opensuse"),
            "nixos" => Some("nixos"),
            "freebsd" => Some("freebsd"),
            _ => None,
        }
    };

    if pretty.contains("raspberry pi") || pretty.contains("raspbian") {
        return Some("raspberrypi");
    }
    if let Some(slug) = match_token(&id_val) {
        return Some(slug);
    }
    for like_tok in id_like.split_whitespace() {
        if let Some(slug) = match_token(like_tok) {
            return Some(slug);
        }
    }

    for line in lower.lines() {
        let t = line.trim();
        if t == "darwin" {
            return Some("macos");
        }
        if t == "freebsd" || t == "openbsd" || t == "netbsd" {
            return Some("freebsd");
        }
        if t.contains("windows_nt") || t.starts_with("msys") || t.starts_with("mingw") {
            return Some("windows");
        }
        if t == "linux" {
            return Some("linux");
        }
    }

    None
}

fn spawn_os_distro_probe(
    host_id: String,
    handle: Arc<Handle<SshClientHandler>>,
    vault: Arc<std::sync::Mutex<VaultEngine>>,
    app_handle: Option<AppHandle>,
) {
    tokio::spawn(async move {
        let probe_fut = async {
            let mut ch = handle.channel_open_session().await.ok()?;
            let cmd = "cat /etc/os-release 2>/dev/null; [ -f /usr/bin/pveversion ] && echo SKYNET_PVE=1; [ -f /etc.defaults/VERSION ] && echo SKYNET_SYNOLOGY=1; uname -s 2>/dev/null";
            ch.exec(true, cmd).await.ok()?;
            let mut buf = Vec::with_capacity(2048);
            while let Some(msg) = ch.wait().await {
                match msg {
                    ChannelMsg::Data { ref data } => {
                        if buf.len() < 8192 {
                            buf.extend_from_slice(data);
                        }
                    }
                    ChannelMsg::Eof | ChannelMsg::Close => break,
                    _ => {}
                }
            }
            let _ = ch.close().await;
            String::from_utf8(buf).ok()
        };

        let Ok(Some(output)) = tokio::time::timeout(Duration::from_secs(4), probe_fut).await else {
            return;
        };
        let Some(slug) = detect_os_slug_from_probe(&output) else {
            return;
        };

        if let Ok(guard) = vault.lock() {
            if guard.is_unlocked() && !guard.status().read_only {
                if let Ok(mut host) = guard.get_host(&host_id) {
                    if host.os_icon.as_deref() != Some(slug) {
                        host.os_icon = Some(slug.to_string());
                        let _ = guard.save_host(&host);
                    }
                }
            }
        }

        if let Some(app) = app_handle {
            let _ = app.emit(
                "host-os-detected",
                HostOsDetectedEvent {
                    host_id,
                    os_icon: slug.to_string(),
                },
            );
        }
    });
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

    #[test]
    fn test_probe_validation_and_secorall_198_detection() {
        assert!(is_safe_probe_host("198.51.100.42"));
        assert!(is_safe_probe_host("2001:db8::1"));
        assert!(!is_safe_probe_host("-t 198.51.100.1"));
        assert!(!is_safe_probe_host("bad host;rm"));

        assert!(requires_multi_ping_warmup("198.18.0.15", "App VM", None));
        assert!(requires_multi_ping_warmup("10.20.1.5", "Prod DB", Some("Client - Secorall")));
        assert!(!requires_multi_ping_warmup("192.168.45.205", "Paperless", Some("Homelab")));
    }

    #[test]
    fn test_append_replay_ring_buffer_bounds() {
        let mut ring = VecDeque::new();
        append_replay_bytes(&mut ring, b"hello ", 10);
        append_replay_bytes(&mut ring, b"world!", 10);
        let s: Vec<u8> = ring.iter().copied().collect();
        assert_eq!(s, b"llo world!");

        append_replay_bytes(&mut ring, b"0123456789ABCDEF", 10);
        let s2: Vec<u8> = ring.iter().copied().collect();
        assert_eq!(s2, b"6789ABCDEF");
    }

    #[test]
    fn test_detect_os_slug_from_probe_distros() {
        assert_eq!(
            detect_os_slug_from_probe("NAME=\"Ubuntu\"\nID=ubuntu\nID_LIKE=debian\nLinux\n"),
            Some("ubuntu")
        );
        assert_eq!(
            detect_os_slug_from_probe("ID=debian\nPRETTY_NAME=\"Debian GNU/Linux 12\"\nSKYNET_PVE=1\nLinux\n"),
            Some("proxmox")
        );
        assert_eq!(
            detect_os_slug_from_probe("ID=debian\nPRETTY_NAME=\"Debian GNU/Linux 12\"\nLinux\n"),
            Some("debian")
        );
        assert_eq!(
            detect_os_slug_from_probe("ID=\"rocky\"\nID_LIKE=\"rhel centos fedora\"\nLinux\n"),
            Some("rocky")
        );
        assert_eq!(
            detect_os_slug_from_probe("ID=alpine\nLinux\n"),
            Some("alpine")
        );
        assert_eq!(
            detect_os_slug_from_probe("ID=debian\nPRETTY_NAME=\"Raspberry Pi OS GNU/Linux 12\"\nLinux\n"),
            Some("raspberrypi")
        );
        assert_eq!(detect_os_slug_from_probe("Darwin\n"), Some("macos"));
        assert_eq!(detect_os_slug_from_probe("FreeBSD\n"), Some("freebsd"));
    }
}
