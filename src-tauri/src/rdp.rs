use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Arc;
use std::time::{Duration, Instant};

#[cfg(not(target_os = "windows"))]
use anyhow::anyhow;
use anyhow::{Context, Result};
use tauri::AppHandle;
use tokio::net::TcpListener;
use tokio::sync::oneshot;

use crate::models::{HostRecord, RdpLaunchResult};
use crate::ssh::SshPool;
use crate::vault::VaultEngine;

pub fn cleanup_temp_rdp_files() {
    let dir = std::env::temp_dir().join("skynetssh_rdp");
    if dir.exists() {
        let _ = fs::remove_dir_all(dir);
    }
}

fn sanitize_rdp_value(raw: &str) -> String {
    raw.chars()
        .filter(|c| *c != '\r' && *c != '\n' && *c != '\0')
        .collect::<String>()
        .trim()
        .to_string()
}

/// Formats `(cred_username, rdp_user_line, rdp_domain_line)` so Win32 `CRED_TYPE_DOMAIN_PASSWORD`
/// (which requires `DOMAIN\user` or `user@domain`) and `mstsc.exe` agree on both domain and local accounts.
pub fn format_rdp_identity(
    domain_opt: Option<&str>,
    username_raw: &str,
    fallback_host: &str,
) -> (String, String, Option<String>) {
    let clean_user = sanitize_rdp_value(username_raw);
    let user = if clean_user.is_empty() {
        "Administrator".to_string()
    } else {
        clean_user
    };
    let clean_domain = domain_opt
        .map(sanitize_rdp_value)
        .filter(|d| !d.is_empty());

    if let Some((dom, usr)) = user.split_once('\\') {
        let dom_clean = if dom.is_empty() || dom == "." {
            sanitize_rdp_value(fallback_host)
        } else {
            dom.to_string()
        };
        let cred_user = format!("{dom_clean}\\{usr}");
        return (cred_user, usr.to_string(), Some(dom.to_string()));
    }

    if user.contains('@') {
        return (user.clone(), user, None);
    }

    if let Some(dom) = clean_domain {
        let dom_for_cred = if dom == "." {
            sanitize_rdp_value(fallback_host)
        } else {
            dom.clone()
        };
        return (format!("{dom_for_cred}\\{user}"), user, Some(dom));
    }

    let host_scope = sanitize_rdp_value(fallback_host);
    let scope = if host_scope.is_empty() {
        "WORKGROUP".to_string()
    } else {
        host_scope
    };
    (format!("{scope}\\{user}"), user, None)
}

pub fn build_rdp_file_contents(
    connect_host: &str,
    connect_port: u16,
    rdp_user: &str,
    rdp_domain: Option<&str>,
    display_mode: &str,
    width: u32,
    height: u32,
    ignore_cert: bool,
) -> String {
    let clean_host = sanitize_rdp_value(connect_host);
    let full_address = if connect_port == 3389 {
        clean_host
    } else {
        format!("{clean_host}:{connect_port}")
    };

    let mut lines = vec![
        format!("full address:s:{full_address}"),
        format!("username:s:{}", sanitize_rdp_value(rdp_user)),
        "prompt for credentials:i:0".to_string(),
        "promptcredentialonce:i:0".to_string(),
        "enablecredsspsupport:i:1".to_string(),
        format!("authentication level:i:{}", if ignore_cert { 0 } else { 1 }),
        "redirectclipboard:i:1".to_string(),
        "redirectprinters:i:0".to_string(),
        "audiomode:i:0".to_string(),
        "autoreconnection enabled:i:1".to_string(),
        "compression:i:1".to_string(),
    ];

    if let Some(dom) = rdp_domain.map(sanitize_rdp_value).filter(|d| !d.is_empty()) {
        lines.push(format!("domain:s:{dom}"));
    }

    match display_mode {
        "fullscreen" => {
            lines.push("screen mode id:i:2".into());
            lines.push("dynamic resolution:i:1".into());
        }
        "multimon" => {
            lines.push("screen mode id:i:2".into());
            lines.push("use multimon:i:1".into());
            lines.push("dynamic resolution:i:1".into());
        }
        _ => {
            let w = width.clamp(800, 7680);
            let h = height.clamp(600, 4320);
            lines.push("screen mode id:i:1".into());
            lines.push(format!("desktopwidth:i:{w}"));
            lines.push(format!("desktopheight:i:{h}"));
            lines.push("smart sizing:i:1".into());
            lines.push("dynamic resolution:i:1".into());
        }
    }

    let mut out = lines.join("\r\n");
    out.push_str("\r\n");
    out
}

fn encode_utf16le_with_bom(text: &str) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(2 + text.len() * 2);
    bytes.extend_from_slice(&[0xFF, 0xFE]);
    for unit in text.encode_utf16() {
        bytes.extend_from_slice(&unit.to_le_bytes());
    }
    bytes
}

#[cfg(target_os = "windows")]
mod wincred {
    use anyhow::{anyhow, Result};
    use zeroize::Zeroize;

    const CRED_TYPE_DOMAIN_PASSWORD: u32 = 2;
    const CRED_PERSIST_SESSION: u32 = 1;

    #[repr(C)]
    struct FileTime {
        dw_low_date_time: u32,
        dw_high_date_time: u32,
    }

    #[repr(C)]
    struct CredentialW {
        flags: u32,
        cred_type: u32,
        target_name: *mut u16,
        comment: *mut u16,
        last_written: FileTime,
        credential_blob_size: u32,
        credential_blob: *mut u8,
        persist: u32,
        attribute_count: u32,
        attributes: *mut core::ffi::c_void,
        target_alias: *mut u16,
        user_name: *mut u16,
    }

    #[link(name = "advapi32")]
    extern "system" {
        fn CredWriteW(credential: *const CredentialW, flags: u32) -> i32;
        fn CredDeleteW(target_name: *const u16, cred_type: u32, flags: u32) -> i32;
    }

    fn to_wide_null(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// Writes an in-memory LSASS session-scoped (`CRED_PERSIST_SESSION`) `TERMSRV` credential
    /// directly via Win32 `CredWriteW` so passwords never appear on `cmdkey.exe` command lines
    /// and never persist to disk across reboots.
    pub fn write_termsrv_session_cred(target: &str, username: &str, password: &str) -> Result<()> {
        let mut target_w = to_wide_null(target);
        let mut user_w = to_wide_null(username);
        let mut pass_utf16: Vec<u16> = password.encode_utf16().collect();
        let mut pass_bytes: Vec<u8> = Vec::with_capacity(pass_utf16.len() * 2);
        for u in &pass_utf16 {
            pass_bytes.extend_from_slice(&u.to_le_bytes());
        }
        pass_utf16.zeroize();

        let cred = CredentialW {
            flags: 0,
            cred_type: CRED_TYPE_DOMAIN_PASSWORD,
            target_name: target_w.as_mut_ptr(),
            comment: std::ptr::null_mut(),
            last_written: FileTime {
                dw_low_date_time: 0,
                dw_high_date_time: 0,
            },
            credential_blob_size: pass_bytes.len() as u32,
            credential_blob: if pass_bytes.is_empty() {
                std::ptr::null_mut()
            } else {
                pass_bytes.as_mut_ptr()
            },
            persist: CRED_PERSIST_SESSION,
            attribute_count: 0,
            attributes: std::ptr::null_mut(),
            target_alias: std::ptr::null_mut(),
            user_name: user_w.as_mut_ptr(),
        };

        let ok = unsafe { CredWriteW(&cred, 0) };
        pass_bytes.zeroize();
        user_w.zeroize();

        if ok == 0 {
            let err = std::io::Error::last_os_error();
            return Err(anyhow!("CredWriteW failed for {target}: {err}"));
        }
        Ok(())
    }

    pub fn delete_termsrv_session_cred(target: &str) {
        let target_w = to_wide_null(target);
        let _ = unsafe { CredDeleteW(target_w.as_ptr(), CRED_TYPE_DOMAIN_PASSWORD, 0) };
    }
}

pub async fn launch_rdp_session(
    host: HostRecord,
    ssh_pool: SshPool,
    vault: Arc<std::sync::Mutex<VaultEngine>>,
    app_handle: AppHandle,
) -> Result<RdpLaunchResult> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (host, ssh_pool, vault, app_handle);
        return Err(anyhow!("Native mstsc RDP launcher requires Windows"));
    }

    #[cfg(target_os = "windows")]
    {
        let target_port = if host.port == 0 { 3389 } else { host.port };
        let mut stop_tunnel_tx: Option<oneshot::Sender<()>> = None;
        let mut bastion_label: Option<String> = None;
        let mut local_tunnel_port: Option<u16> = None;

        // 1. Optional 1-Click SSH Bastion Tunnel (`127.0.0.1:<ephemeral> -> <host.address>:<target_port>`)
        let (connect_host, connect_port) = if let Some(ref jump_id) =
            host.jump_host_id.as_ref().filter(|s| !s.trim().is_empty())
        {
            if let Ok(guard) = vault.lock() {
                if let Ok(bh) = guard.get_host(jump_id) {
                    bastion_label = Some(bh.label);
                }
            }

            let ssh_handle = ssh_pool
                .get_or_connect(jump_id, vault.clone(), Some(app_handle))
                .await
                .context("Failed to connect to SSH Jump/Tunnel Host for RDP")?;

            let listener = TcpListener::bind("127.0.0.1:0")
                .await
                .context("Failed to bind ephemeral localhost port for RDP SSH tunnel")?;
            let bound_port = listener.local_addr()?.port();
            local_tunnel_port = Some(bound_port);

            let remote_addr = host.address.trim().to_string();
            let (tx, mut rx) = oneshot::channel::<()>();
            stop_tunnel_tx = Some(tx);

            tokio::spawn(async move {
                loop {
                    tokio::select! {
                        _ = &mut rx => break,
                        accepted = listener.accept() => {
                            let Ok((mut tcp_stream, peer)) = accepted else { continue };
                            let h = ssh_handle.clone();
                            let dst = remote_addr.clone();
                            tokio::spawn(async move {
                                if let Ok(ch) = h
                                    .channel_open_direct_tcpip(
                                        &dst,
                                        target_port as u32,
                                        &peer.ip().to_string(),
                                        peer.port() as u32,
                                    )
                                    .await
                                {
                                    let mut ssh_stream = ch.into_stream();
                                    let _ = tokio::io::copy_bidirectional(&mut tcp_stream, &mut ssh_stream).await;
                                }
                            });
                        }
                    }
                }
            });

            ("127.0.0.1".to_string(), bound_port)
        } else {
            (host.address.trim().to_string(), target_port)
        };

        // 2. Stage session-only TERMSRV credential(s) in LSASS if password is stored in Vault
        let (cred_user, rdp_user, rdp_domain) = format_rdp_identity(
            host.rdp_domain.as_deref(),
            &host.username,
            &host.address,
        );

        let mut staged_targets: Vec<String> = Vec::new();
        if let Some(ref pwd) = host.password.as_ref().filter(|p| !p.is_empty()) {
            let t_base = format!("TERMSRV/{connect_host}");
            wincred::write_termsrv_session_cred(&t_base, &cred_user, pwd)?;
            staged_targets.push(t_base);

            if connect_port != 3389 {
                let t_port = format!("TERMSRV/{connect_host}:{connect_port}");
                if wincred::write_termsrv_session_cred(&t_port, &cred_user, pwd).is_ok() {
                    staged_targets.push(t_port);
                }
            }
        }

        // 3. Write temporary UTF-16LE `.rdp` session profile
        let rdp_dir: PathBuf = std::env::temp_dir().join("skynetssh_rdp");
        fs::create_dir_all(&rdp_dir)?;
        let rdp_file = rdp_dir.join(format!("skynet_{}.rdp", uuid::Uuid::new_v4().simple()));

        let rdp_body = build_rdp_file_contents(
            &connect_host,
            connect_port,
            &rdp_user,
            rdp_domain.as_deref(),
            host.rdp_display_mode.as_deref().unwrap_or("smart"),
            host.rdp_width.unwrap_or(1600),
            host.rdp_height.unwrap_or(960),
            host.rdp_ignore_cert.unwrap_or(true),
        );
        fs::write(&rdp_file, encode_utf16le_with_bom(&rdp_body))?;

        // 4. Launch native Windows `mstsc.exe` and clean up temp credentials + SSH tunnel on exit
        let mut child = Command::new("mstsc.exe")
            .arg(&rdp_file)
            .spawn()
            .context("Failed to launch Windows Remote Desktop (mstsc.exe)")?;

        let started = Instant::now();
        tokio::task::spawn_blocking(move || {
            let _ = child.wait();
            // Ensure minimum 12s grace in case mstsc spawned a secondary UI instance
            let elapsed = started.elapsed();
            if elapsed < Duration::from_secs(12) {
                std::thread::sleep(Duration::from_secs(12) - elapsed);
            }
            let _ = fs::remove_file(&rdp_file);
            for t in &staged_targets {
                wincred::delete_termsrv_session_cred(t);
            }
            if let Some(tx) = stop_tunnel_tx {
                let _ = tx.send(());
            }
        });

        Ok(RdpLaunchResult {
            host_id: host.id,
            tunneled: local_tunnel_port.is_some(),
            bastion_label,
            local_port: local_tunnel_port,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_rdp_identity_variants() {
        let (cred, usr, dom) =
            format_rdp_identity(Some("CONTOSO"), "Administrator", "10.20.1.50");
        assert_eq!(cred, "CONTOSO\\Administrator");
        assert_eq!(usr, "Administrator");
        assert_eq!(dom.as_deref(), Some("CONTOSO"));

        let (cred2, usr2, dom2) = format_rdp_identity(None, "CORP\\jdoe", "10.20.1.50");
        assert_eq!(cred2, "CORP\\jdoe");
        assert_eq!(usr2, "jdoe");
        assert_eq!(dom2.as_deref(), Some("CORP"));

        let (cred3, usr3, dom3) = format_rdp_identity(None, "admin@corp.local", "10.20.1.50");
        assert_eq!(cred3, "admin@corp.local");
        assert_eq!(usr3, "admin@corp.local");
        assert!(dom3.is_none());

        let (cred4, usr4, _) = format_rdp_identity(None, "Administrator", "10.20.1.50");
        assert_eq!(cred4, "10.20.1.50\\Administrator");
        assert_eq!(usr4, "Administrator");
    }

    #[test]
    fn test_build_rdp_file_contents_and_sanitization() {
        let rdp = build_rdp_file_contents(
            "127.0.0.1",
            54321,
            "Administrator\r\nevil:i:1",
            Some("CONTOSO"),
            "smart",
            1600,
            960,
            true,
        );
        assert!(rdp.contains("full address:s:127.0.0.1:54321\r\n"));
        assert!(rdp.contains("username:s:Administratorevil:i:1\r\n"));
        assert!(rdp.contains("domain:s:CONTOSO\r\n"));
        assert!(rdp.contains("smart sizing:i:1\r\n"));
        assert!(rdp.contains("dynamic resolution:i:1\r\n"));
        assert!(rdp.contains("authentication level:i:0\r\n"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn test_win32_termsrv_session_cred_write_and_delete() {
        let target = "TERMSRV/skynet-unit-test-host.invalid";
        wincred::write_termsrv_session_cred(
            target,
            "CONTOSO\\UnitTestAdmin",
            "Cyberdyne-Test-Pass-99!",
        )
        .expect("Win32 CredWriteW should accept CRED_TYPE_DOMAIN_PASSWORD");
        wincred::delete_termsrv_session_cred(target);
    }
}
