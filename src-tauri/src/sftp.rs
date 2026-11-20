use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, UNIX_EPOCH};

use anyhow::{anyhow, Context, Result};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::FileAttributes;
use tauri::ipc::Channel as IpcChannel;
use tauri::AppHandle;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

use crate::models::{DirectoryListing, SftpEntry, TransferProgressEvent};
use crate::ssh::SshPool;
use crate::vault::VaultEngine;

pub fn cleanup_temp_edits() {
    let dir = std::env::temp_dir().join("skynetssh_edits");
    if dir.exists() {
        let _ = fs::remove_dir_all(dir);
    }
}

fn format_unix_mode(is_dir: bool, is_symlink: bool, mode_opt: Option<u32>) -> String {
    let prefix = if is_symlink {
        'l'
    } else if is_dir {
        'd'
    } else {
        '-'
    };
    let Some(mode) = mode_opt else {
        return if is_dir {
            "drwxr-xr-x".into()
        } else {
            "-rw-r--r--".into()
        };
    };

    let flags = [
        (0o400, 'r'),
        (0o200, 'w'),
        (0o100, 'x'),
        (0o040, 'r'),
        (0o020, 'w'),
        (0o010, 'x'),
        (0o004, 'r'),
        (0o002, 'w'),
        (0o001, 'x'),
    ];
    let mut s = String::with_capacity(10);
    s.push(prefix);
    for (bit, ch) in flags {
        s.push(if mode & bit != 0 { ch } else { '-' });
    }
    s
}

pub fn local_list_dir(path_opt: Option<String>) -> Result<DirectoryListing> {
    let dir = match path_opt.filter(|p| !p.trim().is_empty()) {
        Some(p) => PathBuf::from(p),
        None => dirs::home_dir().unwrap_or_else(|| PathBuf::from("C:\\")),
    };

    let canonical = fs::canonicalize(&dir).unwrap_or(dir);
    let clean_path = canonical
        .to_string_lossy()
        .trim_start_matches(r"\\?\")
        .to_string();

    let mut entries = Vec::new();
    for item in fs::read_dir(&clean_path)? {
        let Ok(item) = item else { continue };
        let Ok(meta) = item.metadata() else { continue };
        let name = item.file_name().to_string_lossy().to_string();
        let full = item.path().to_string_lossy().to_string();
        let is_dir = meta.is_dir();
        let is_symlink = meta.file_type().is_symlink();
        let modified_at = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64);

        entries.push(SftpEntry {
            name,
            path: full,
            is_dir,
            is_symlink,
            size: if is_dir { 0 } else { meta.len() },
            modified_at,
            permissions: None,
            permissions_display: if is_dir {
                "drwxr-xr-x".into()
            } else {
                "-rw-r--r--".into()
            },
        });
    }

    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(DirectoryListing {
        path: clean_path,
        entries,
    })
}

pub async fn open_sftp_session(
    pool: &SshPool,
    host_id: &str,
    vault: Arc<std::sync::Mutex<VaultEngine>>,
    app_handle: AppHandle,
) -> Result<SftpSession> {
    let handle = pool
        .get_or_connect(host_id, vault, Some(app_handle))
        .await?;
    let channel = handle
        .channel_open_session()
        .await
        .context("Failed to open SSH channel for SFTP")?;
    channel
        .request_subsystem(true, "sftp")
        .await
        .context("Remote host refused SFTP subsystem")?;
    let sftp = SftpSession::new(channel.into_stream())
        .await
        .context("SFTP handshake failed")?;
    Ok(sftp)
}

pub async fn remote_list_dir(
    pool: &SshPool,
    host_id: &str,
    path_opt: Option<String>,
    vault: Arc<std::sync::Mutex<VaultEngine>>,
    app_handle: AppHandle,
) -> Result<DirectoryListing> {
    let sftp = open_sftp_session(pool, host_id, vault, app_handle).await?;
    let target = match path_opt.filter(|s| !s.trim().is_empty()) {
        Some(p) => p,
        None => sftp
            .canonicalize(".")
            .await
            .unwrap_or_else(|_| "/".to_string()),
    };

    let read_dir = sftp
        .read_dir(&target)
        .await
        .with_context(|| format!("Failed to read remote directory: {target}"))?;

    let mut entries = Vec::new();
    for entry in read_dir {
        let name = entry.file_name();
        if name == "." || name == ".." {
            continue;
        }
        let meta = entry.metadata();
        let is_dir = entry.file_type().is_dir();
        let is_symlink = entry.file_type().is_symlink();
        let full = if target.ends_with('/') {
            format!("{target}{name}")
        } else {
            format!("{target}/{name}")
        };

        entries.push(SftpEntry {
            name,
            path: full,
            is_dir,
            is_symlink,
            size: meta.size.unwrap_or(0),
            modified_at: meta.mtime.map(|m| m as i64),
            permissions: meta.permissions,
            permissions_display: format_unix_mode(is_dir, is_symlink, meta.permissions),
        });
    }

    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    let _ = sftp.close().await;
    Ok(DirectoryListing {
        path: target,
        entries,
    })
}

pub async fn remote_mkdir(
    pool: &SshPool,
    host_id: &str,
    path: &str,
    vault: Arc<std::sync::Mutex<VaultEngine>>,
    app_handle: AppHandle,
) -> Result<()> {
    let sftp = open_sftp_session(pool, host_id, vault, app_handle).await?;
    sftp.create_dir(path).await?;
    let _ = sftp.close().await;
    Ok(())
}

pub async fn remote_delete(
    pool: &SshPool,
    host_id: &str,
    path: &str,
    is_dir: bool,
    vault: Arc<std::sync::Mutex<VaultEngine>>,
    app_handle: AppHandle,
) -> Result<()> {
    let sftp = open_sftp_session(pool, host_id, vault, app_handle).await?;
    if is_dir {
        sftp.remove_dir(path).await?;
    } else {
        sftp.remove_file(path).await?;
    }
    let _ = sftp.close().await;
    Ok(())
}

pub async fn remote_rename(
    pool: &SshPool,
    host_id: &str,
    old_path: &str,
    new_path: &str,
    vault: Arc<std::sync::Mutex<VaultEngine>>,
    app_handle: AppHandle,
) -> Result<()> {
    let sftp = open_sftp_session(pool, host_id, vault, app_handle).await?;
    sftp.rename(old_path, new_path).await?;
    let _ = sftp.close().await;
    Ok(())
}

pub async fn remote_chmod(
    pool: &SshPool,
    host_id: &str,
    path: &str,
    mode: u32,
    vault: Arc<std::sync::Mutex<VaultEngine>>,
    app_handle: AppHandle,
) -> Result<()> {
    let sftp = open_sftp_session(pool, host_id, vault, app_handle).await?;
    let mut attrs = FileAttributes::empty();
    attrs.permissions = Some(mode);
    sftp.set_metadata(path, attrs).await?;
    let _ = sftp.close().await;
    Ok(())
}

async fn stream_with_progress<R, W, F>(
    mut reader: R,
    mut writer: W,
    total: u64,
    emit: &F,
) -> Result<(u64, u64)>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
    F: Fn(u64, u64, &str, Option<String>),
{
    emit(0, total, "running", None);
    let mut buf = vec![0u8; 65536];
    let mut copied = 0u64;
    let mut last_emit = std::time::Instant::now();
    loop {
        let n = reader.read(&mut buf).await?;
        if n == 0 {
            break;
        }
        writer.write_all(&buf[..n]).await?;
        copied += n as u64;
        if last_emit.elapsed() >= Duration::from_millis(60) {
            emit(copied, total, "running", None);
            last_emit = std::time::Instant::now();
        }
    }
    writer.flush().await?;
    Ok((copied, total))
}

#[allow(clippy::too_many_arguments)]
pub async fn transfer_file(
    pool: &SshPool,
    transfer_id: String,
    direction: String,
    source_host_id: Option<String>,
    source_path: String,
    target_host_id: Option<String>,
    target_path: String,
    on_progress: IpcChannel<TransferProgressEvent>,
    vault: Arc<std::sync::Mutex<VaultEngine>>,
    app_handle: AppHandle,
) -> Result<()> {
    let file_name = Path::new(&source_path)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| source_path.clone());

    let emit = |bytes_transferred: u64, total_bytes: u64, status: &str, error: Option<String>| {
        let _ = on_progress.send(TransferProgressEvent {
            transfer_id: transfer_id.clone(),
            file_name: file_name.clone(),
            direction: direction.clone(),
            bytes_transferred,
            total_bytes,
            status: status.to_string(),
            error,
        });
    };

    let result: Result<(u64, u64)> = async {
        match direction.as_str() {
            "upload" => {
                let host_id = target_host_id
                    .as_deref()
                    .ok_or_else(|| anyhow!("Missing target host ID for upload"))?;
                let local_file = tokio::fs::File::open(&source_path).await?;
                let total = local_file.metadata().await?.len();
                let sftp = open_sftp_session(pool, host_id, vault, app_handle).await?;
                let remote_file = sftp.create(&target_path).await?;
                let res = stream_with_progress(local_file, remote_file, total, &emit).await;
                let _ = sftp.close().await;
                res
            }
            "download" => {
                let host_id = source_host_id
                    .as_deref()
                    .ok_or_else(|| anyhow!("Missing source host ID for download"))?;
                let sftp = open_sftp_session(pool, host_id, vault, app_handle).await?;
                let total = sftp.metadata(&source_path).await?.size.unwrap_or(0);
                let remote_file = sftp.open(&source_path).await?;
                let local_file = tokio::fs::File::create(&target_path).await?;
                let res = stream_with_progress(remote_file, local_file, total, &emit).await;
                let _ = sftp.close().await;
                res
            }
            "remote-to-remote" => {
                let src_host = source_host_id
                    .as_deref()
                    .ok_or_else(|| anyhow!("Missing source host"))?;
                let dst_host = target_host_id
                    .as_deref()
                    .ok_or_else(|| anyhow!("Missing destination host"))?;

                let sftp_src =
                    open_sftp_session(pool, src_host, vault.clone(), app_handle.clone()).await?;
                let sftp_dst = open_sftp_session(pool, dst_host, vault, app_handle).await?;

                let total = sftp_src.metadata(&source_path).await?.size.unwrap_or(0);
                let r_in = sftp_src.open(&source_path).await?;
                let r_out = sftp_dst.create(&target_path).await?;
                let res = stream_with_progress(r_in, r_out, total, &emit).await;
                let _ = sftp_src.close().await;
                let _ = sftp_dst.close().await;
                res
            }
            other => Err(anyhow!("Unsupported transfer direction: {other}")),
        }
    }
    .await;

    match result {
        Ok((done, total)) => {
            emit(done, total, "completed", None);
            Ok(())
        }
        Err(e) => {
            emit(0, 0, "failed", Some(e.to_string()));
            Err(e)
        }
    }
}

pub async fn edit_remote_file_locally(
    pool: SshPool,
    host_id: String,
    remote_path: String,
    vault: Arc<std::sync::Mutex<VaultEngine>>,
    app_handle: AppHandle,
) -> Result<String> {
    let sftp = open_sftp_session(&pool, &host_id, vault.clone(), app_handle.clone()).await?;
    // Sanitize local temp filename so path separators or control chars cannot escape temp folder
    let raw_name = Path::new(&remote_path)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "remote_edit.txt".into());
    let safe_name: String = raw_name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') {
                c
            } else {
                '_'
            }
        })
        .collect();

    let edit_dir = std::env::temp_dir()
        .join("skynetssh_edits")
        .join(uuid::Uuid::new_v4().to_string());
    tokio::fs::create_dir_all(&edit_dir).await?;
    let local_file_path = edit_dir.join(if safe_name.is_empty() {
        "remote_edit.txt"
    } else {
        &safe_name
    });

    let mut r_file = sftp.open(&remote_path).await?;
    let mut l_file = tokio::fs::File::create(&local_file_path).await?;
    tokio::io::copy(&mut r_file, &mut l_file).await?;
    l_file.flush().await?;
    let _ = sftp.close().await;

    // Safe ShellExecuteW via tauri-plugin-opener (no cmd.exe shell parsing!)
    tauri_plugin_opener::open_path(&local_file_path, None::<&str>)
        .context("Failed to open file in default OS editor")?;

    let watch_path = local_file_path.clone();
    tokio::spawn(async move {
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let Ok(mut watcher) = RecommendedWatcher::new(
            move |res: notify::Result<notify::Event>| {
                if let Ok(ev) = res {
                    if matches!(ev.kind, EventKind::Modify(_)) {
                        let _ = tx.send(());
                    }
                }
            },
            notify::Config::default(),
        ) else {
            return;
        };

        if watcher
            .watch(&watch_path, RecursiveMode::NonRecursive)
            .is_err()
        {
            return;
        }

        // Stop automatically after 2 hours of inactivity or if temp dir is wiped
        while let Ok(Some(())) = tokio::time::timeout(Duration::from_secs(7200), rx.recv()).await {
            tokio::time::sleep(Duration::from_millis(250)).await;
            while rx.try_recv().is_ok() {}
            if !watch_path.exists() {
                break;
            }
            if let Ok(bytes) = tokio::fs::read(&watch_path).await {
                if let Ok(sftp_up) =
                    open_sftp_session(&pool, &host_id, vault.clone(), app_handle.clone()).await
                {
                    if let Ok(mut rf) = sftp_up.create(&remote_path).await {
                        let _ = rf.write_all(&bytes).await;
                        let _ = rf.flush().await;
                    }
                    let _ = sftp_up.close().await;
                }
            }
        }
        let _ = tokio::fs::remove_dir_all(&edit_dir).await;
    });

    Ok(local_file_path.to_string_lossy().to_string())
}

const MAX_PREVIEW_BYTES: u64 = 65_536;

pub fn local_preview_file(path: &str) -> Result<(String, bool)> {
    let mut f = fs::File::open(path)?;
    let total_len = f.metadata().map(|m| m.len()).unwrap_or(0);
    let mut buf = Vec::with_capacity(MAX_PREVIEW_BYTES as usize);
    use std::io::Read;
    (&mut f).take(MAX_PREVIEW_BYTES).read_to_end(&mut buf)?;
    let text = String::from_utf8_lossy(&buf).into_owned();
    Ok((text, total_len > MAX_PREVIEW_BYTES))
}

pub async fn remote_preview_file(
    pool: &SshPool,
    host_id: &str,
    remote_path: &str,
    vault: Arc<std::sync::Mutex<VaultEngine>>,
    app_handle: AppHandle,
) -> Result<(String, bool)> {
    let sftp = open_sftp_session(pool, host_id, vault, app_handle).await?;
    let total_len = sftp
        .metadata(remote_path)
        .await
        .ok()
        .and_then(|m| m.size)
        .unwrap_or(0);
    let r_file = sftp.open(remote_path).await?;
    let mut buf = Vec::with_capacity(MAX_PREVIEW_BYTES as usize);
    r_file.take(MAX_PREVIEW_BYTES).read_to_end(&mut buf).await?;
    let _ = sftp.close().await;
    let text = String::from_utf8_lossy(&buf).into_owned();
    Ok((text, total_len > MAX_PREVIEW_BYTES))
}
