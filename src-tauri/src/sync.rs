use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{anyhow, Result};
use russh::keys::{decode_secret_key, HashAlg};
use serde_json::Value;

use crate::models::{
    DiscoveredSshHost, DiscoveredSshKey, GitSyncStatus, HostRecord, SshFolderScan,
};
use crate::ssh::SshPool;
use crate::vault::VaultEngine;

#[derive(Default, Debug, PartialEq, Eq, Clone)]
pub struct ParsedSshHost {
    pub alias: String,
    pub hostname: String,
    pub user: String,
    pub port: u16,
    pub identity_file: Option<String>,
    pub proxy_jump: Option<String>,
}

pub fn parse_openssh_config_str(content: &str) -> Vec<ParsedSshHost> {
    #[derive(Default)]
    struct Draft {
        alias: String,
        hostname: Option<String>,
        user: Option<String>,
        port: Option<u16>,
        identity_file: Option<String>,
        proxy_jump: Option<String>,
    }

    let mut drafts: Vec<Draft> = Vec::new();
    let mut current: Option<Draft> = None;

    for raw_line in content.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let mut parts = line.split_whitespace();
        let Some(key) = parts.next() else { continue };
        let val = parts
            .collect::<Vec<_>>()
            .join(" ")
            .trim_matches('"')
            .to_string();
        if val.is_empty() {
            continue;
        }

        match key.to_lowercase().as_str() {
            "host" => {
                if let Some(prev) = current.take() {
                    if !prev.alias.contains('*') && !prev.alias.contains('?') {
                        drafts.push(prev);
                    }
                }
                let first_alias = val.split_whitespace().next().unwrap_or(&val).to_string();
                current = Some(Draft {
                    alias: first_alias,
                    ..Default::default()
                });
            }
            "hostname" => {
                if let Some(c) = current.as_mut() {
                    c.hostname = Some(val);
                }
            }
            "user" => {
                if let Some(c) = current.as_mut() {
                    c.user = Some(val);
                }
            }
            "port" => {
                if let Some(c) = current.as_mut() {
                    c.port = val.parse::<u16>().ok();
                }
            }
            "identityfile" => {
                if let Some(c) = current.as_mut() {
                    c.identity_file = Some(val);
                }
            }
            "proxyjump" => {
                if let Some(c) = current.as_mut() {
                    c.proxy_jump = Some(val);
                }
            }
            _ => {}
        }
    }

    if let Some(prev) = current.take() {
        if !prev.alias.contains('*') && !prev.alias.contains('?') {
            drafts.push(prev);
        }
    }

    drafts
        .into_iter()
        .map(|d| {
            let hostname = d.hostname.unwrap_or_else(|| d.alias.clone());
            ParsedSshHost {
                alias: d.alias,
                hostname,
                user: d.user.unwrap_or_else(|| "root".into()),
                port: d.port.unwrap_or(22),
                identity_file: d.identity_file,
                proxy_jump: d.proxy_jump,
            }
        })
        .collect()
}

fn expand_tilde(raw: &str, home: &Path) -> PathBuf {
    if let Some(stripped) = raw.strip_prefix("~/").or_else(|| raw.strip_prefix(r"~\")) {
        home.join(stripped)
    } else {
        PathBuf::from(raw)
    }
}

/// Non-destructively sniffs `~/.ssh` for private keys (`id_ed25519`, custom keys like `zamboni`, `.pem`),
/// `~/.ssh/config` hosts, and `known_hosts` entries!
pub fn sniff_ssh_folder(vault: &VaultEngine) -> Result<SshFolderScan> {
    let Some(home) = dirs::home_dir() else {
        return Ok(SshFolderScan::default());
    };
    let ssh_dir = home.join(".ssh");
    if !ssh_dir.exists() {
        return Ok(SshFolderScan {
            ssh_dir: ssh_dir.to_string_lossy().to_string(),
            ..Default::default()
        });
    }

    let snap = if vault.is_unlocked() {
        vault.snapshot().unwrap_or_default()
    } else {
        Default::default()
    };

    let mut discovered_keys = Vec::new();
    if let Ok(entries) = fs::read_dir(&ssh_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let Some(file_name) = path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            let lower = file_name.to_lowercase();
            if lower.ends_with(".pub")
                || lower.ends_with(".old")
                || lower.ends_with(".bak")
                || lower.starts_with("known_hosts")
                || lower.starts_with("authorized_keys")
                || lower.starts_with("config")
            {
                continue;
            }

            let Ok(meta) = entry.metadata() else { continue };
            if meta.len() == 0 || meta.len() > 65536 {
                continue;
            }
            let Ok(raw) = fs::read_to_string(&path) else {
                continue;
            };
            if !raw.contains("PRIVATE KEY-----") {
                continue;
            }

            let pub_companion = PathBuf::from(format!("{}.pub", path.to_string_lossy()));
            let mut public_key = fs::read_to_string(&pub_companion)
                .ok()
                .map(|s| s.trim().to_string());

            let (encrypted, fingerprint) = match decode_secret_key(&raw, None) {
                Ok(priv_k) => {
                    let fp = priv_k.public_key().fingerprint(HashAlg::Sha256).to_string();
                    if public_key.is_none() {
                        public_key = priv_k.public_key().to_openssh().ok();
                    }
                    (false, Some(fp))
                }
                Err(_) => {
                    let fp = public_key
                        .as_deref()
                        .and_then(|pk| ssh_key::PublicKey::from_openssh(pk).ok())
                        .map(|pk| pk.fingerprint(ssh_key::HashAlg::Sha256).to_string());
                    (true, fp)
                }
            };

            let already_in_vault = snap.keys.iter().any(|k| {
                fingerprint
                    .as_deref()
                    .map(|fp| k.fingerprint == fp)
                    .unwrap_or(false)
                    || k.name.eq_ignore_ascii_case(file_name)
            });

            discovered_keys.push(DiscoveredSshKey {
                name: file_name.to_string(),
                path: path.to_string_lossy().to_string(),
                public_key,
                fingerprint,
                encrypted,
                already_in_vault,
            });
        }
    }
    discovered_keys.sort_by(|a, b| a.name.cmp(&b.name));

    let config_path = ssh_dir.join("config");
    let config_hosts = if config_path.exists() {
        let raw = fs::read_to_string(&config_path).unwrap_or_default();
        parse_openssh_config_str(&raw)
            .into_iter()
            .map(|h| {
                let already_in_vault = snap
                    .hosts
                    .iter()
                    .any(|vh| vh.label == h.alias || vh.address == h.hostname);
                DiscoveredSshHost {
                    alias: h.alias,
                    hostname: h.hostname,
                    user: h.user,
                    port: h.port,
                    identity_file: h.identity_file,
                    proxy_jump: h.proxy_jump,
                    already_in_vault,
                }
            })
            .collect()
    } else {
        Vec::new()
    };

    let known_hosts_lines = fs::read_to_string(ssh_dir.join("known_hosts"))
        .map(|s| {
            s.lines()
                .filter(|l| !l.trim().is_empty() && !l.trim().starts_with('#'))
                .count()
        })
        .unwrap_or(0);

    Ok(SshFolderScan {
        ssh_dir: ssh_dir.to_string_lossy().to_string(),
        keys: discovered_keys,
        config_hosts,
        known_hosts_lines,
    })
}

/// Parses `~/.ssh/config` and imports Host blocks (plus referenced unencrypted `IdentityFile` keys) into the Vault.
pub fn import_openssh_config(vault: &VaultEngine) -> Result<usize> {
    let home = dirs::home_dir().ok_or_else(|| anyhow!("Could not locate user home directory"))?;
    let ssh_config_path = home.join(".ssh").join("config");
    if !ssh_config_path.exists() {
        return Ok(0);
    }

    let content = fs::read_to_string(&ssh_config_path)?;
    let snap = vault.snapshot()?;
    let existing = snap.hosts;
    let mut keys = snap.keys;
    let parsed = parse_openssh_config_str(&content);

    let mut imported = 0usize;
    let now = chrono::Utc::now().timestamp_millis();

    for d in parsed {
        if existing
            .iter()
            .any(|h| h.label == d.alias || h.address == d.hostname)
        {
            continue;
        }

        let mut linked_key_id = None;
        if let Some(ref id_file) = d.identity_file {
            let key_path = expand_tilde(id_file, &home);
            if key_path.exists() {
                if let Ok(pem) = fs::read_to_string(&key_path) {
                    let key_name = key_path
                        .file_name()
                        .and_then(|s| s.to_str())
                        .unwrap_or("ssh-config-key");
                    if let Ok(imported_key) = SshPool::import_key_from_pem(key_name, &pem, None) {
                        if let Some(existing_k) = keys
                            .iter()
                            .find(|k| k.fingerprint == imported_key.fingerprint)
                        {
                            linked_key_id = Some(existing_k.id.clone());
                        } else if vault.save_key(&imported_key).is_ok() {
                            linked_key_id = Some(imported_key.id.clone());
                            keys.push(imported_key);
                        }
                    }
                }
            }
        }

        let rec = HostRecord {
            id: uuid::Uuid::new_v4().to_string(),
            label: d.alias,
            address: d.hostname,
            port: d.port,
            username: d.user,
            auth_method: if linked_key_id.is_some() {
                "key".into()
            } else {
                "agent".into()
            },
            password: None,
            key_id: linked_key_id,
            group_id: None,
            tags: vec!["ssh-config".into()],
            jump_host_id: None,
            startup_snippet_id: None,
            startup_command: None,
            keepalive_interval_secs: 30,
            notes: Some("Imported from ~/.ssh/config".into()),
            last_connected_at: None,
            updated_at: now,
        };
        vault.save_host(&rec)?;
        imported += 1;
    }

    Ok(imported)
}

/// Imports hosts from a Termius JSON export file.
pub fn import_termius_json(vault: &VaultEngine, file_path: &Path) -> Result<usize> {
    let raw = fs::read_to_string(file_path)?;
    let parsed: Value = serde_json::from_str(&raw)?;

    let hosts_array = parsed
        .get("hosts")
        .and_then(|v| v.as_array())
        .or_else(|| parsed.as_array())
        .ok_or_else(|| anyhow!("JSON does not contain a 'hosts' array"))?;

    let mut count = 0usize;
    let now = chrono::Utc::now().timestamp_millis();

    for item in hosts_array {
        let address = item
            .get("address")
            .or_else(|| item.get("hostname"))
            .or_else(|| item.get("ip"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        if address.is_empty() {
            continue;
        }
        let label = item
            .get("label")
            .or_else(|| item.get("name"))
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(address);
        let username = item
            .get("username")
            .or_else(|| item.get("user"))
            .and_then(|v| v.as_str())
            .unwrap_or("root");
        let port = item
            .get("port")
            .and_then(|v| v.as_u64())
            .map(|p| p as u16)
            .unwrap_or(22);

        let rec = HostRecord {
            id: uuid::Uuid::new_v4().to_string(),
            label: label.to_string(),
            address: address.to_string(),
            port,
            username: username.to_string(),
            auth_method: "key".into(),
            password: None,
            key_id: None,
            group_id: None,
            tags: vec!["termius-import".into()],
            jump_host_id: None,
            startup_snippet_id: None,
            startup_command: None,
            keepalive_interval_secs: 30,
            notes: Some("Imported from Termius JSON".into()),
            last_connected_at: None,
            updated_at: now,
        };
        vault.save_host(&rec)?;
        count += 1;
    }

    Ok(count)
}

fn run_git(vault_dir: &Path, args: &[&str]) -> Result<String> {
    let out = Command::new("git")
        .current_dir(vault_dir)
        .args(args)
        .output()?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(anyhow!("git {} failed: {}", args.join(" "), stderr.trim()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

pub fn git_status(vault_dir: &Path) -> GitSyncStatus {
    if !vault_dir.join(".git").exists() {
        return GitSyncStatus {
            is_git_repo: false,
            branch: None,
            remote_url: None,
            changed_files: 0,
            ahead: 0,
            behind: 0,
            last_sync_message: None,
        };
    }

    let branch = run_git(vault_dir, &["rev-parse", "--abbrev-ref", "HEAD"]).ok();
    let remote_url = run_git(vault_dir, &["remote", "get-url", "origin"]).ok();
    let porcelain = run_git(vault_dir, &["status", "--porcelain"]).unwrap_or_default();
    let changed_files = porcelain.lines().filter(|l| !l.trim().is_empty()).count();

    GitSyncStatus {
        is_git_repo: true,
        branch,
        remote_url,
        changed_files,
        ahead: 0,
        behind: 0,
        last_sync_message: None,
    }
}

pub fn git_init_remote(vault_dir: &Path, remote_url: &str) -> Result<GitSyncStatus> {
    if !vault_dir.join(".git").exists() {
        run_git(vault_dir, &["init", "-b", "main"])?;
    }
    if !remote_url.is_empty() {
        if run_git(vault_dir, &["remote", "get-url", "origin"]).is_ok() {
            run_git(vault_dir, &["remote", "set-url", "origin", remote_url])?;
        } else {
            run_git(vault_dir, &["remote", "add", "origin", remote_url])?;
        }
    }
    Ok(git_status(vault_dir))
}

pub fn git_sync_now(vault_dir: &Path) -> Result<GitSyncStatus> {
    if !vault_dir.join(".git").exists() {
        return Err(anyhow!(
            "Vault folder is not a Git repo yet. Save a Git remote URL first."
        ));
    }

    run_git(vault_dir, &["add", "-A"])?;
    let porcelain = run_git(vault_dir, &["status", "--porcelain"])?;
    if !porcelain.is_empty() {
        let msg = format!(
            "SkynetSSH encrypted vault sync {}",
            chrono::Utc::now().to_rfc3339()
        );
        run_git(vault_dir, &["commit", "-m", &msg])?;
    }

    let has_origin = run_git(vault_dir, &["remote", "get-url", "origin"]).is_ok();
    let sync_msg = if has_origin {
        let branch =
            run_git(vault_dir, &["rev-parse", "--abbrev-ref", "HEAD"]).unwrap_or("main".into());
        if let Err(pull_err) = run_git(vault_dir, &["pull", "--rebase", "origin", &branch]) {
            let _ = run_git(vault_dir, &["rebase", "--abort"]);
            return Err(anyhow!(
                "Git pull --rebase failed (rebase aborted cleanly to protect Vault): {pull_err}"
            ));
        }
        run_git(vault_dir, &["push", "-u", "origin", &branch])?;
        format!("Synced encrypted envelopes with origin/{branch}")
    } else {
        "Committed encrypted envelopes locally (no remote configured)".into()
    };

    let mut st = git_status(vault_dir);
    st.last_sync_message = Some(sync_msg);
    Ok(st)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_openssh_config() {
        let sample = r#"
            Host *
                ServerAliveInterval 30

            Host prod-api prod-alias
                HostName 10.0.1.42
                User ubuntu
                Port 2222
                IdentityFile ~/.ssh/zamboni
                ProxyJump bastion

            Host homelab
                User miles
        "#;
        let hosts = parse_openssh_config_str(sample);
        assert_eq!(hosts.len(), 2);
        assert_eq!(
            hosts[0],
            ParsedSshHost {
                alias: "prod-api".into(),
                hostname: "10.0.1.42".into(),
                user: "ubuntu".into(),
                port: 2222,
                identity_file: Some("~/.ssh/zamboni".into()),
                proxy_jump: Some("bastion".into()),
            }
        );
        assert_eq!(hosts[1].hostname, "homelab");
        assert_eq!(hosts[1].port, 22);
    }
}
