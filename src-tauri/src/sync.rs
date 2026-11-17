use std::fs;
use std::path::Path;
use std::process::Command;

use anyhow::{anyhow, Result};
use serde_json::Value;

use crate::models::{GitSyncStatus, HostRecord};
use crate::vault::VaultEngine;

#[derive(Default, Debug, PartialEq, Eq)]
pub struct ParsedSshHost {
    pub alias: String,
    pub hostname: String,
    pub user: String,
    pub port: u16,
}

pub fn parse_openssh_config_str(content: &str) -> Vec<ParsedSshHost> {
    #[derive(Default)]
    struct Draft {
        alias: String,
        hostname: Option<String>,
        user: Option<String>,
        port: Option<u16>,
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
        let val = parts.collect::<Vec<_>>().join(" ");
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
                // Take the first alias token if multiple aliases are on one Host line
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
            }
        })
        .collect()
}

/// Parses `~/.ssh/config` and imports Host blocks into the encrypted Vault.
pub fn import_openssh_config(vault: &VaultEngine) -> Result<usize> {
    let home = dirs::home_dir().ok_or_else(|| anyhow!("Could not locate user home directory"))?;
    let ssh_config_path = home.join(".ssh").join("config");
    if !ssh_config_path.exists() {
        return Ok(0);
    }

    let content = fs::read_to_string(&ssh_config_path)?;
    let existing = vault.snapshot()?.hosts;
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
        let rec = HostRecord {
            id: uuid::Uuid::new_v4().to_string(),
            label: d.alias,
            address: d.hostname,
            port: d.port,
            username: d.user,
            auth_method: "agent".into(),
            password: None,
            key_id: None,
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
            # Wildcard ignored
            Host *
                ServerAliveInterval 30

            Host prod-api prod-alias
                HostName 10.0.1.42
                User ubuntu
                Port 2222

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
            }
        );
        assert_eq!(hosts[1].hostname, "homelab");
        assert_eq!(hosts[1].port, 22);
    }
}
