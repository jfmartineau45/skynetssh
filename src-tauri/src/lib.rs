pub mod models;
pub mod pty;
pub mod sftp;
pub mod ssh;
pub mod sync;
pub mod totp;
pub mod tunnel;
pub mod vault;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_global_shortcut::{
    Builder as GlobalShortcutBuilder, GlobalShortcutExt, ShortcutState,
};

use crate::models::{
    ActiveTunnelRuntime, DirectoryListing, GitSyncStatus, GroupRecord, HostProbeResult, HostRecord,
    ShellProfile, SnippetRecord, SshFolderScan, SshKeyRecord, TotpSetupPayload,
    TransferProgressEvent, TunnelRecord, VaultSnapshot, VaultStatus,
};
use crate::pty::PtyManager;
use crate::ssh::SshPool;
use crate::tunnel::TunnelManager;
use crate::vault::VaultEngine;

pub struct AppState {
    pub vault: Arc<Mutex<VaultEngine>>,
    pub pty: PtyManager,
    pub ssh: SshPool,
    pub tunnels: TunnelManager,
    pub vault_watcher: Arc<Mutex<Option<RecommendedWatcher>>>,
}

type CmdResult<T> = Result<T, String>;

fn err_str<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Starts (or restarts) a recursive file watcher on the active Vault directory so OneDrive / SharePoint
/// / Syncthing / Dropbox changes made by teammates refresh the UI automatically!
fn restart_vault_watcher(
    app: &AppHandle,
    watcher_slot: &Arc<Mutex<Option<RecommendedWatcher>>>,
    vault_dir: PathBuf,
) {
    let _ = std::fs::create_dir_all(&vault_dir);
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<()>();

    let Ok(mut watcher) = RecommendedWatcher::new(
        move |res: notify::Result<notify::Event>| {
            if let Ok(ev) = res {
                let touches_envelope = ev.paths.iter().any(|p| {
                    p.file_name()
                        .and_then(|s| s.to_str())
                        .map(|n| n.ends_with(".enc.json"))
                        .unwrap_or(false)
                });
                if touches_envelope {
                    let _ = tx.send(());
                }
            }
        },
        notify::Config::default(),
    ) else {
        return;
    };

    if watcher.watch(&vault_dir, RecursiveMode::Recursive).is_ok() {
        if let Ok(mut slot) = watcher_slot.lock() {
            *slot = Some(watcher);
        }
        let app_clone = app.clone();
        tauri::async_runtime::spawn(async move {
            while rx.recv().await.is_some() {
                tokio::time::sleep(Duration::from_millis(450)).await;
                while rx.try_recv().is_ok() {}
                let _ = app_clone.emit("vault-external-sync", ());
            }
        });
    }
}

fn apply_global_hotkey(app: &AppHandle, hotkey: &str) -> Result<(), String> {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    let trimmed = hotkey.trim();
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("disabled") {
        return Ok(());
    }
    gs.register(trimmed)
        .map_err(|e| format!("Could not register global shortcut '{trimmed}': {e}"))
}

/* ─── Vault Lifecycle & Multi-Profile (Personal / Team SharePoint) Commands ─── */
#[tauri::command]
fn vault_status(state: State<'_, AppState>) -> CmdResult<VaultStatus> {
    let guard = state.vault.lock().map_err(err_str)?;
    Ok(guard.status())
}

#[tauri::command]
fn vault_init(
    master_password: String,
    remember_days: u32,
    state: State<'_, AppState>,
) -> CmdResult<VaultSnapshot> {
    let mut guard = state.vault.lock().map_err(err_str)?;
    guard
        .initialize(&master_password, remember_days)
        .map_err(err_str)
}

#[tauri::command]
fn vault_unlock(
    master_password: String,
    remember_days: u32,
    state: State<'_, AppState>,
) -> CmdResult<VaultSnapshot> {
    let mut guard = state.vault.lock().map_err(err_str)?;
    guard
        .unlock(&master_password, remember_days)
        .map_err(err_str)
}

#[tauri::command]
fn vault_unlock_keyring(state: State<'_, AppState>) -> CmdResult<VaultSnapshot> {
    let mut guard = state.vault.lock().map_err(err_str)?;
    guard.unlock_with_keyring().map_err(err_str)
}

#[tauri::command]
fn vault_unlock_totp(
    code: String,
    remember_days: u32,
    state: State<'_, AppState>,
) -> CmdResult<VaultSnapshot> {
    let mut guard = state.vault.lock().map_err(err_str)?;
    guard
        .unlock_with_totp(&code, remember_days)
        .map_err(err_str)
}

#[tauri::command]
async fn vault_lock(state: State<'_, AppState>) -> CmdResult<()> {
    {
        let mut guard = state.vault.lock().map_err(err_str)?;
        guard.lock();
    }
    state.tunnels.stop_all().await;
    state.ssh.disconnect_all().await;
    sftp::cleanup_temp_edits();
    Ok(())
}

#[tauri::command]
async fn vault_forget_device(state: State<'_, AppState>) -> CmdResult<VaultStatus> {
    let status = {
        let mut guard = state.vault.lock().map_err(err_str)?;
        guard.forget_device_and_lock();
        guard.status()
    };
    state.tunnels.stop_all().await;
    state.ssh.disconnect_all().await;
    sftp::cleanup_temp_edits();
    Ok(status)
}

#[tauri::command]
fn vault_totp_begin_setup(state: State<'_, AppState>) -> CmdResult<TotpSetupPayload> {
    let guard = state.vault.lock().map_err(err_str)?;
    guard.totp_begin_setup().map_err(err_str)
}

#[tauri::command]
fn vault_totp_confirm_setup(
    secret_base32: String,
    code: String,
    remember_days: u32,
    state: State<'_, AppState>,
) -> CmdResult<VaultStatus> {
    let guard = state.vault.lock().map_err(err_str)?;
    guard
        .totp_confirm_setup(&secret_base32, &code, remember_days)
        .map_err(err_str)
}

#[tauri::command]
fn vault_totp_disable(state: State<'_, AppState>) -> CmdResult<VaultStatus> {
    let guard = state.vault.lock().map_err(err_str)?;
    guard.totp_disable().map_err(err_str)
}

#[tauri::command]
fn vault_snapshot(state: State<'_, AppState>) -> CmdResult<VaultSnapshot> {
    let guard = state.vault.lock().map_err(err_str)?;
    guard.snapshot().map_err(err_str)
}

#[tauri::command]
fn vault_set_path(
    new_path: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> CmdResult<VaultStatus> {
    let (status, dir) = {
        let mut guard = state.vault.lock().map_err(err_str)?;
        guard.set_vault_dir(PathBuf::from(new_path)).map_err(err_str)?;
        (guard.status(), guard.vault_dir())
    };
    restart_vault_watcher(&app, &state.vault_watcher, dir);
    Ok(status)
}

#[tauri::command]
fn vault_add_profile(
    name: String,
    kind: String,
    path: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> CmdResult<VaultStatus> {
    let (status, dir) = {
        let mut guard = state.vault.lock().map_err(err_str)?;
        guard
            .add_or_switch_profile(name, kind, PathBuf::from(path))
            .map_err(err_str)?;
        (guard.status(), guard.vault_dir())
    };
    restart_vault_watcher(&app, &state.vault_watcher, dir);
    Ok(status)
}

#[tauri::command]
fn vault_switch_profile(
    profile_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> CmdResult<VaultStatus> {
    let (status, dir) = {
        let mut guard = state.vault.lock().map_err(err_str)?;
        guard.switch_profile(&profile_id).map_err(err_str)?;
        (guard.status(), guard.vault_dir())
    };
    restart_vault_watcher(&app, &state.vault_watcher, dir);
    Ok(status)
}

#[tauri::command]
fn vault_remove_profile(
    profile_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> CmdResult<VaultStatus> {
    let (status, dir) = {
        let mut guard = state.vault.lock().map_err(err_str)?;
        guard.remove_profile(&profile_id).map_err(err_str)?;
        (guard.status(), guard.vault_dir())
    };
    restart_vault_watcher(&app, &state.vault_watcher, dir);
    Ok(status)
}

#[tauri::command]
fn app_set_global_hotkey(
    hotkey: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> CmdResult<VaultStatus> {
    apply_global_hotkey(&app, &hotkey)?;
    let mut guard = state.vault.lock().map_err(err_str)?;
    guard.set_global_hotkey(hotkey).map_err(err_str)?;
    Ok(guard.status())
}

/* ─── Vault CRUD Commands ─── */
#[tauri::command]
fn vault_save_group(group: GroupRecord, state: State<'_, AppState>) -> CmdResult<GroupRecord> {
    let guard = state.vault.lock().map_err(err_str)?;
    guard.save_group(&group).map_err(err_str)?;
    Ok(group)
}

#[tauri::command]
fn vault_delete_group(id: String, state: State<'_, AppState>) -> CmdResult<()> {
    let guard = state.vault.lock().map_err(err_str)?;
    guard.delete_group(&id).map_err(err_str)
}

#[tauri::command]
fn vault_save_host(host: HostRecord, state: State<'_, AppState>) -> CmdResult<HostRecord> {
    let guard = state.vault.lock().map_err(err_str)?;
    guard.save_host(&host).map_err(err_str)?;
    Ok(host)
}

#[tauri::command]
fn vault_delete_host(id: String, state: State<'_, AppState>) -> CmdResult<()> {
    let guard = state.vault.lock().map_err(err_str)?;
    guard.delete_host(&id).map_err(err_str)
}

#[tauri::command]
fn vault_generate_key(
    name: String,
    algorithm: String,
    passphrase: Option<String>,
    state: State<'_, AppState>,
) -> CmdResult<SshKeyRecord> {
    let record = SshPool::generate_key_pair(&name, &algorithm, passphrase.as_deref())
        .map_err(err_str)?;
    let guard = state.vault.lock().map_err(err_str)?;
    guard.save_key(&record).map_err(err_str)?;
    Ok(record)
}

#[tauri::command]
fn vault_import_key_pem(
    name: String,
    pem_text: String,
    passphrase: Option<String>,
    state: State<'_, AppState>,
) -> CmdResult<SshKeyRecord> {
    let record =
        SshPool::import_key_from_pem(&name, &pem_text, passphrase.as_deref()).map_err(err_str)?;
    let guard = state.vault.lock().map_err(err_str)?;
    guard.save_key(&record).map_err(err_str)?;
    Ok(record)
}

#[tauri::command]
fn vault_import_key_file(
    name: String,
    file_path: String,
    passphrase: Option<String>,
    state: State<'_, AppState>,
) -> CmdResult<SshKeyRecord> {
    let pem = std::fs::read_to_string(&file_path).map_err(err_str)?;
    vault_import_key_pem(name, pem, passphrase, state)
}

#[tauri::command]
fn vault_delete_key(id: String, state: State<'_, AppState>) -> CmdResult<()> {
    let guard = state.vault.lock().map_err(err_str)?;
    guard.delete_key(&id).map_err(err_str)
}

#[tauri::command]
fn vault_save_tunnel(tunnel: TunnelRecord, state: State<'_, AppState>) -> CmdResult<TunnelRecord> {
    let guard = state.vault.lock().map_err(err_str)?;
    guard.save_tunnel(&tunnel).map_err(err_str)?;
    Ok(tunnel)
}

#[tauri::command]
fn vault_delete_tunnel(id: String, state: State<'_, AppState>) -> CmdResult<()> {
    let guard = state.vault.lock().map_err(err_str)?;
    guard.delete_tunnel(&id).map_err(err_str)
}

#[tauri::command]
fn vault_save_snippet(
    snippet: SnippetRecord,
    state: State<'_, AppState>,
) -> CmdResult<SnippetRecord> {
    let guard = state.vault.lock().map_err(err_str)?;
    guard.save_snippet(&snippet).map_err(err_str)?;
    Ok(snippet)
}

#[tauri::command]
fn vault_delete_snippet(id: String, state: State<'_, AppState>) -> CmdResult<()> {
    let guard = state.vault.lock().map_err(err_str)?;
    guard.delete_snippet(&id).map_err(err_str)
}

#[tauri::command]
fn vault_delete_known_host(id: String, state: State<'_, AppState>) -> CmdResult<()> {
    let guard = state.vault.lock().map_err(err_str)?;
    guard.delete_known_host(&id).map_err(err_str)
}

/* ─── ~/.ssh Sniffer, Importers & Git Sync ─── */
#[tauri::command]
fn ssh_sniff_folder(state: State<'_, AppState>) -> CmdResult<SshFolderScan> {
    let guard = state.vault.lock().map_err(err_str)?;
    sync::sniff_ssh_folder(&guard).map_err(err_str)
}

#[tauri::command]
fn import_ssh_config(state: State<'_, AppState>) -> CmdResult<usize> {
    let guard = state.vault.lock().map_err(err_str)?;
    sync::import_openssh_config(&guard).map_err(err_str)
}

#[tauri::command]
fn import_termius_json(file_path: String, state: State<'_, AppState>) -> CmdResult<usize> {
    let guard = state.vault.lock().map_err(err_str)?;
    sync::import_termius_json(&guard, std::path::Path::new(&file_path)).map_err(err_str)
}

#[tauri::command]
fn snippets_export_json(
    file_path: String,
    category: Option<String>,
    state: State<'_, AppState>,
) -> CmdResult<usize> {
    let guard = state.vault.lock().map_err(err_str)?;
    sync::export_snippets_json(&guard, std::path::Path::new(&file_path), category.as_deref())
        .map_err(err_str)
}

#[tauri::command]
fn snippets_import_json(file_path: String, state: State<'_, AppState>) -> CmdResult<usize> {
    let guard = state.vault.lock().map_err(err_str)?;
    sync::import_snippets_json(&guard, std::path::Path::new(&file_path)).map_err(err_str)
}

#[tauri::command]
fn sync_git_status(state: State<'_, AppState>) -> CmdResult<GitSyncStatus> {
    let dir = {
        let guard = state.vault.lock().map_err(err_str)?;
        guard.vault_dir()
    };
    Ok(sync::git_status(&dir))
}

#[tauri::command]
fn sync_git_init_remote(
    remote_url: String,
    state: State<'_, AppState>,
) -> CmdResult<GitSyncStatus> {
    let dir = {
        let guard = state.vault.lock().map_err(err_str)?;
        guard.vault_dir()
    };
    sync::git_init_remote(&dir, &remote_url).map_err(err_str)
}

#[tauri::command]
fn sync_git_now(state: State<'_, AppState>) -> CmdResult<GitSyncStatus> {
    let dir = {
        let guard = state.vault.lock().map_err(err_str)?;
        guard.vault_dir()
    };
    sync::git_sync_now(&dir).map_err(err_str)
}

/* ─── Local ConPTY Commands ─── */
#[tauri::command]
fn pty_discover_shells() -> Vec<ShellProfile> {
    PtyManager::discover_shells()
}

#[tauri::command]
fn pty_spawn(
    profile: ShellProfile,
    cols: u16,
    rows: u16,
    on_data: Channel<Vec<u8>>,
    state: State<'_, AppState>,
) -> CmdResult<String> {
    state.pty.spawn(profile, cols, rows, on_data).map_err(err_str)
}

#[tauri::command]
fn pty_write(session_id: String, data: Vec<u8>, state: State<'_, AppState>) -> CmdResult<()> {
    state.pty.write(&session_id, &data).map_err(err_str)
}

#[tauri::command]
fn pty_resize(
    session_id: String,
    cols: u16,
    rows: u16,
    state: State<'_, AppState>,
) -> CmdResult<()> {
    state.pty.resize(&session_id, cols, rows).map_err(err_str)
}

#[tauri::command]
fn pty_close(session_id: String, state: State<'_, AppState>) -> CmdResult<()> {
    state.pty.close(&session_id).map_err(err_str)
}

/* ─── SSH Session Commands ─── */
#[tauri::command]
async fn ssh_open_shell(
    host_id: String,
    cols: u32,
    rows: u32,
    on_data: Channel<Vec<u8>>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> CmdResult<String> {
    state
        .ssh
        .open_shell(&host_id, cols, rows, on_data, state.vault.clone(), app)
        .await
        .map_err(err_str)
}

#[tauri::command]
async fn ssh_write(
    session_id: String,
    data: Vec<u8>,
    state: State<'_, AppState>,
) -> CmdResult<()> {
    state.ssh.write_shell(&session_id, data).await.map_err(err_str)
}

#[tauri::command]
async fn ssh_resize(
    session_id: String,
    cols: u32,
    rows: u32,
    state: State<'_, AppState>,
) -> CmdResult<()> {
    state
        .ssh
        .resize_shell(&session_id, cols, rows)
        .await
        .map_err(err_str)
}

#[tauri::command]
async fn ssh_close_shell(session_id: String, state: State<'_, AppState>) -> CmdResult<()> {
    state.ssh.close_shell(&session_id).await.map_err(err_str)
}

#[tauri::command]
async fn ssh_respond_host_key(
    request_id: String,
    accept: bool,
    state: State<'_, AppState>,
) -> CmdResult<()> {
    state.ssh.respond_host_key(&request_id, accept).await;
    Ok(())
}

#[tauri::command]
async fn ssh_probe_host(host_id: String, state: State<'_, AppState>) -> CmdResult<HostProbeResult> {
    let (host, group_name) = {
        let guard = state.vault.lock().map_err(err_str)?;
        let h = guard.get_host(&host_id).map_err(err_str)?;
        let g_name = if let Some(gid) = &h.group_id {
            guard
                .snapshot()
                .ok()
                .and_then(|s| s.groups.into_iter().find(|g| &g.id == gid).map(|g| g.name))
        } else {
            None
        };
        (h, g_name)
    };

    Ok(ssh::probe_host_reachability(
        host.id,
        host.address,
        host.port,
        host.label,
        group_name,
    )
    .await)
}

/* ─── SFTP Commands ─── */
#[tauri::command]
fn sftp_local_list(path: Option<String>) -> CmdResult<DirectoryListing> {
    sftp::local_list_dir(path).map_err(err_str)
}

#[tauri::command]
fn sftp_local_mkdir(path: String) -> CmdResult<()> {
    std::fs::create_dir_all(path).map_err(err_str)
}

#[tauri::command]
fn sftp_local_delete(path: String, is_dir: bool) -> CmdResult<()> {
    if is_dir {
        std::fs::remove_dir_all(path).map_err(err_str)
    } else {
        std::fs::remove_file(path).map_err(err_str)
    }
}

#[tauri::command]
fn sftp_local_rename(old_path: String, new_path: String) -> CmdResult<()> {
    std::fs::rename(old_path, new_path).map_err(err_str)
}

#[tauri::command]
async fn sftp_remote_list(
    host_id: String,
    path: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> CmdResult<DirectoryListing> {
    sftp::remote_list_dir(&state.ssh, &host_id, path, state.vault.clone(), app)
        .await
        .map_err(err_str)
}

#[tauri::command]
async fn sftp_remote_mkdir(
    host_id: String,
    path: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> CmdResult<()> {
    sftp::remote_mkdir(&state.ssh, &host_id, &path, state.vault.clone(), app)
        .await
        .map_err(err_str)
}

#[tauri::command]
async fn sftp_remote_delete(
    host_id: String,
    path: String,
    is_dir: bool,
    app: AppHandle,
    state: State<'_, AppState>,
) -> CmdResult<()> {
    sftp::remote_delete(&state.ssh, &host_id, &path, is_dir, state.vault.clone(), app)
        .await
        .map_err(err_str)
}

#[tauri::command]
async fn sftp_remote_rename(
    host_id: String,
    old_path: String,
    new_path: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> CmdResult<()> {
    sftp::remote_rename(
        &state.ssh,
        &host_id,
        &old_path,
        &new_path,
        state.vault.clone(),
        app,
    )
    .await
    .map_err(err_str)
}

#[tauri::command]
async fn sftp_remote_chmod(
    host_id: String,
    path: String,
    mode: u32,
    app: AppHandle,
    state: State<'_, AppState>,
) -> CmdResult<()> {
    sftp::remote_chmod(&state.ssh, &host_id, &path, mode, state.vault.clone(), app)
        .await
        .map_err(err_str)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn sftp_transfer(
    transfer_id: String,
    direction: String,
    source_host_id: Option<String>,
    source_path: String,
    target_host_id: Option<String>,
    target_path: String,
    on_progress: Channel<TransferProgressEvent>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> CmdResult<()> {
    sftp::transfer_file(
        &state.ssh,
        transfer_id,
        direction,
        source_host_id,
        source_path,
        target_host_id,
        target_path,
        on_progress,
        state.vault.clone(),
        app,
    )
    .await
    .map_err(err_str)
}

#[tauri::command]
async fn sftp_edit_locally(
    host_id: String,
    remote_path: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> CmdResult<String> {
    sftp::edit_remote_file_locally(
        state.ssh.clone(),
        host_id,
        remote_path,
        state.vault.clone(),
        app,
    )
    .await
    .map_err(err_str)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct FilePreviewPayload {
    content: String,
    truncated: bool,
}

#[tauri::command]
async fn sftp_preview_file(
    host_id: Option<String>,
    path: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> CmdResult<FilePreviewPayload> {
    let (content, truncated) = match host_id {
        Some(hid) => {
            sftp::remote_preview_file(&state.ssh, &hid, &path, state.vault.clone(), app)
                .await
                .map_err(err_str)?
        }
        None => sftp::local_preview_file(&path).map_err(err_str)?,
    };
    Ok(FilePreviewPayload { content, truncated })
}

/* ─── Port Forwarding / Tunnel Commands ─── */
#[tauri::command]
async fn tunnel_list_active(state: State<'_, AppState>) -> CmdResult<Vec<ActiveTunnelRuntime>> {
    Ok(state.tunnels.list_active().await)
}

#[tauri::command]
async fn tunnel_start(
    tunnel_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> CmdResult<ActiveTunnelRuntime> {
    let rule = {
        let guard = state.vault.lock().map_err(err_str)?;
        guard.get_tunnel(&tunnel_id).map_err(err_str)?
    };

    state
        .tunnels
        .start(rule, state.ssh.clone(), state.vault.clone(), app)
        .await
        .map_err(err_str)
}

#[tauri::command]
async fn tunnel_stop(tunnel_id: String, state: State<'_, AppState>) -> CmdResult<()> {
    state.tunnels.stop(&tunnel_id).await.map_err(err_str)
}

fn percent_encode_param(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

#[tauri::command]
fn window_popout_terminal(
    kind: String,
    host_id: Option<String>,
    shell_id: Option<String>,
    title: String,
    vault_kind: Option<String>,
    vault_name: Option<String>,
    app: AppHandle,
) -> CmdResult<String> {
    let label = format!("popout-{}", uuid::Uuid::new_v4().simple());
    let url = format!(
        "index.html?popout=1&kind={}&hostId={}&shellId={}&title={}&vaultKind={}&vaultName={}",
        percent_encode_param(&kind),
        percent_encode_param(host_id.as_deref().unwrap_or("")),
        percent_encode_param(shell_id.as_deref().unwrap_or("")),
        percent_encode_param(&title),
        percent_encode_param(vault_kind.as_deref().unwrap_or("personal")),
        percent_encode_param(vault_name.as_deref().unwrap_or("Personal Vault")),
    );

    let win = tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::App(url.into()))
        .title(format!("SkynetSSH — {title}"))
        .inner_size(1040.0, 680.0)
        .min_inner_size(520.0, 340.0)
        .decorations(false)
        .transparent(true)
        .center()
        .build()
        .map_err(err_str)?;

    #[cfg(target_os = "windows")]
    {
        if window_vibrancy::apply_mica(&win, Some(true)).is_err() {
            let _ = window_vibrancy::apply_acrylic(&win, Some((10, 12, 18, 220)));
        }
    }

    Ok(label)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    sftp::cleanup_temp_edits();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            GlobalShortcutBuilder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        if let Some(win) = app.get_webview_window("main") {
                            let focused = win.is_focused().unwrap_or(false);
                            let minimized = win.is_minimized().unwrap_or(false);
                            if focused && !minimized {
                                let _ = win.minimize();
                            } else {
                                let _ = win.unminimize();
                                let _ = win.show();
                                // Pulse always_on_top so Windows 11 foreground-lock yields focus reliably
                                let _ = win.set_always_on_top(true);
                                let _ = win.set_always_on_top(false);
                                let _ = win.set_focus();
                                let _ = app.emit("app-quake-focus", ());
                            }
                        }
                    }
                })
                .build(),
        )
        .setup(|app| {
            let app_data = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from(".skynet-ssh"));
            let vault_engine =
                VaultEngine::new(app_data).expect("Failed to initialize SkynetSSH Vault directory");

            let initial_vault_dir = vault_engine.vault_dir();
            let initial_hotkey = vault_engine.global_hotkey().to_string();
            let watcher_slot = Arc::new(Mutex::new(None));

            restart_vault_watcher(app.handle(), &watcher_slot, initial_vault_dir);
            let _ = apply_global_hotkey(app.handle(), &initial_hotkey);

            app.manage(AppState {
                vault: Arc::new(Mutex::new(vault_engine)),
                pty: PtyManager::new(),
                ssh: SshPool::new(),
                tunnels: TunnelManager::new(),
                vault_watcher: watcher_slot,
            });

            if let Some(window) = app.get_webview_window("main") {
                #[cfg(target_os = "windows")]
                {
                    if window_vibrancy::apply_mica(&window, Some(true)).is_err() {
                        let _ = window_vibrancy::apply_acrylic(&window, Some((10, 12, 18, 220)));
                    }
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            vault_status,
            vault_init,
            vault_unlock,
            vault_unlock_keyring,
            vault_unlock_totp,
            vault_lock,
            vault_forget_device,
            vault_totp_begin_setup,
            vault_totp_confirm_setup,
            vault_totp_disable,
            vault_snapshot,
            vault_set_path,
            vault_add_profile,
            vault_switch_profile,
            vault_remove_profile,
            app_set_global_hotkey,
            vault_save_group,
            vault_delete_group,
            vault_save_host,
            vault_delete_host,
            vault_generate_key,
            vault_import_key_pem,
            vault_import_key_file,
            vault_delete_key,
            vault_save_tunnel,
            vault_delete_tunnel,
            vault_save_snippet,
            vault_delete_snippet,
            vault_delete_known_host,
            ssh_sniff_folder,
            import_ssh_config,
            import_termius_json,
            snippets_export_json,
            snippets_import_json,
            sync_git_status,
            sync_git_init_remote,
            sync_git_now,
            pty_discover_shells,
            pty_spawn,
            pty_write,
            pty_resize,
            pty_close,
            ssh_open_shell,
            ssh_write,
            ssh_resize,
            ssh_close_shell,
            ssh_respond_host_key,
            ssh_probe_host,
            sftp_local_list,
            sftp_local_mkdir,
            sftp_local_delete,
            sftp_local_rename,
            sftp_remote_list,
            sftp_remote_mkdir,
            sftp_remote_delete,
            sftp_remote_rename,
            sftp_remote_chmod,
            sftp_transfer,
            sftp_edit_locally,
            sftp_preview_file,
            tunnel_list_active,
            tunnel_start,
            tunnel_stop,
            window_popout_terminal,
        ])
        .run(tauri::generate_context!())
        .expect("error while running SkynetSSH");
}
