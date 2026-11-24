use std::path::PathBuf;
use std::time::Duration;

use anyhow::{anyhow, bail, Context, Result};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tauri::AppHandle;

use crate::models::AppUpdateInfo;

pub const GITHUB_REPO: &str = "jfmartineau45/skynetssh";
const RELEASES_PAGE_URL: &str = "https://github.com/jfmartineau45/skynetssh/releases";
const LATEST_API_URL: &str = "https://api.github.com/repos/jfmartineau45/skynetssh/releases/latest";

#[derive(Debug, Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
    size: u64,
}

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    html_url: String,
    body: Option<String>,
    published_at: Option<String>,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
    #[serde(default)]
    assets: Vec<GithubAsset>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SemVer {
    major: u64,
    minor: u64,
    patch: u64,
    prerelease: Option<String>,
}

fn parse_semver(raw: &str) -> Option<SemVer> {
    let trimmed = raw.trim().trim_start_matches(['v', 'V']);
    if trimmed.is_empty() {
        return None;
    }
    let without_build = trimmed.split('+').next().unwrap_or(trimmed);
    let (core, pre) = match without_build.split_once('-') {
        Some((c, p)) => (c, Some(p.to_string())),
        None => (without_build, None),
    };
    let mut parts = core.split('.');
    let major = parts.next()?.parse::<u64>().ok()?;
    let minor = parts.next().unwrap_or("0").parse::<u64>().ok()?;
    let patch = parts.next().unwrap_or("0").parse::<u64>().ok()?;
    Some(SemVer {
        major,
        minor,
        patch,
        prerelease: pre.filter(|s| !s.is_empty()),
    })
}

pub fn is_newer_version(current: &str, candidate: &str) -> bool {
    let Some(cur) = parse_semver(current) else {
        return false;
    };
    let Some(cand) = parse_semver(candidate) else {
        return false;
    };
    match (cand.major, cand.minor, cand.patch).cmp(&(cur.major, cur.minor, cur.patch)) {
        std::cmp::Ordering::Greater => true,
        std::cmp::Ordering::Less => false,
        std::cmp::Ordering::Equal => {
            // 1.0.0 is newer than 1.0.0-rc.1; never prompt pre-releases over stable
            cur.prerelease.is_some() && cand.prerelease.is_none()
        }
    }
}

pub fn is_trusted_release_url(url: &str) -> bool {
    let u = url.trim();
    u.starts_with("https://github.com/jfmartineau45/skynetssh/releases/download/")
        || u.starts_with("https://objects.githubusercontent.com/")
        || u.starts_with("https://release-assets.githubusercontent.com/")
}

pub fn is_safe_installer_filename(name: &str) -> bool {
    let trimmed = name.trim();
    !trimmed.is_empty()
        && trimmed.len() <= 128
        && trimmed.to_ascii_lowercase().ends_with("-setup.exe")
        && !trimmed.contains('/')
        && !trimmed.contains('\\')
        && !trimmed.contains("..")
        && trimmed
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
}

pub fn parse_expected_sha256(sums_text: &str, asset_name: &str) -> Option<String> {
    let target = asset_name.trim();
    for line in sums_text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let mut parts = trimmed.split_whitespace();
        let hash = parts.next()?;
        let file = parts.next()?.trim_start_matches('*');
        let file_base = file.rsplit(['/', '\\']).next().unwrap_or(file);
        if file_base.eq_ignore_ascii_case(target)
            && hash.len() == 64
            && hash.chars().all(|c| c.is_ascii_hexdigit())
        {
            return Some(hash.to_ascii_lowercase());
        }
    }
    None
}

fn http_client() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent(format!("SkynetSSH/{}", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(12))
        .build()
        .context("Failed to initialize HTTPS update client")
}

pub async fn check_github_release() -> Result<AppUpdateInfo> {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let client = http_client()?;

    let resp = client
        .get(LATEST_API_URL)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .context("Could not reach GitHub Releases API")?;

    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(AppUpdateInfo {
            current_version: current.clone(),
            latest_version: current,
            update_available: false,
            release_url: RELEASES_PAGE_URL.to_string(),
            download_url: None,
            sha256_url: None,
            asset_name: None,
            asset_size: None,
            release_notes: None,
            published_at: None,
        });
    }

    if !resp.status().is_success() {
        bail!("GitHub Releases API returned HTTP {}", resp.status());
    }

    let rel: GithubRelease = resp
        .json()
        .await
        .context("Invalid GitHub release JSON response")?;

    if rel.draft || rel.prerelease {
        return Ok(AppUpdateInfo {
            current_version: current.clone(),
            latest_version: current,
            update_available: false,
            release_url: RELEASES_PAGE_URL.to_string(),
            download_url: None,
            sha256_url: None,
            asset_name: None,
            asset_size: None,
            release_notes: None,
            published_at: None,
        });
    }

    let latest_clean = rel.tag_name.trim().trim_start_matches(['v', 'V']).to_string();
    let update_available = is_newer_version(&current, &latest_clean);

    let setup_asset = rel
        .assets
        .iter()
        .find(|a| is_safe_installer_filename(&a.name) && is_trusted_release_url(&a.browser_download_url));

    let sums_asset = rel.assets.iter().find(|a| {
        a.name.eq_ignore_ascii_case("SHA256SUMS.txt")
            && is_trusted_release_url(&a.browser_download_url)
    });

    Ok(AppUpdateInfo {
        current_version: current,
        latest_version: latest_clean,
        update_available,
        release_url: rel.html_url,
        download_url: setup_asset.map(|a| a.browser_download_url.clone()),
        sha256_url: sums_asset.map(|a| a.browser_download_url.clone()),
        asset_name: setup_asset.map(|a| a.name.clone()),
        asset_size: setup_asset.map(|a| a.size),
        release_notes: rel.body,
        published_at: rel.published_at,
    })
}

pub async fn download_and_install_update(
    app: &AppHandle,
    download_url: &str,
    asset_name: &str,
    sha256_url: Option<&str>,
) -> Result<()> {
    if !is_trusted_release_url(download_url) {
        bail!("Refusing untrusted update URL");
    }
    if !is_safe_installer_filename(asset_name) {
        bail!("Refusing unsafe installer filename");
    }

    let download_client = reqwest::Client::builder()
        .user_agent(format!("SkynetSSH/{}", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(180))
        .build()
        .context("Failed to initialize installer download client")?;

    let expected_sha256 = if let Some(sums_url) = sha256_url.filter(|u| !u.is_empty()) {
        if !is_trusted_release_url(sums_url) {
            bail!("Refusing untrusted checksum URL");
        }
        let sums_resp = download_client
            .get(sums_url)
            .send()
            .await
            .context("Failed to fetch SHA256SUMS.txt")?;
        if sums_resp.status().is_success() {
            let txt = sums_resp.text().await.unwrap_or_default();
            parse_expected_sha256(&txt, asset_name)
        } else {
            None
        }
    } else {
        None
    };

    let resp = download_client
        .get(download_url)
        .send()
        .await
        .context("Failed to download SkynetSSH update installer")?;
    if !resp.status().is_success() {
        bail!("Update download failed with HTTP {}", resp.status());
    }

    let bytes = resp
        .bytes()
        .await
        .context("Interrupted while downloading update installer")?;

    if bytes.len() < 1024 * 256 || &bytes[0..2] != b"MZ" {
        bail!("Downloaded file is not a valid Windows PE installer");
    }

    if let Some(expected) = expected_sha256 {
        let actual = format!("{:x}", Sha256::digest(&bytes));
        if actual != expected {
            bail!(
                "Installer SHA-256 mismatch (expected {}, got {})",
                expected,
                actual
            );
        }
    }

    let updates_dir: PathBuf = std::env::temp_dir().join("skynet-ssh-updates");
    std::fs::create_dir_all(&updates_dir)
        .context("Failed to create temporary updates directory")?;
    let installer_path = updates_dir.join(asset_name);
    std::fs::write(&installer_path, &bytes)
        .context("Failed to write downloaded installer to disk")?;

    let current_exe = std::env::current_exe()
        .ok()
        .unwrap_or_else(|| {
            dirs::data_local_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join("SkynetSSH")
                .join("skynet-ssh.exe")
        });
    let current_pid = std::process::id();

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const DETACHED_PROCESS: u32 = 0x0000_0008;

        let ps_script = concat!(
            "$pidToWait = [int]$env:SKYNET_UPDATER_PID; ",
            "for ($i = 0; $i -lt 40; $i++) { ",
            "  if (-not (Get-Process -Id $pidToWait -ErrorAction SilentlyContinue)) { break } ",
            "  Start-Sleep -Milliseconds 350 ",
            "} ",
            "Start-Process -FilePath $env:SKYNET_UPDATER_SETUP -ArgumentList '/S' -Wait; ",
            "if (Test-Path -LiteralPath $env:SKYNET_UPDATER_APP) { ",
            "  Start-Process -FilePath $env:SKYNET_UPDATER_APP ",
            "}"
        );

        std::process::Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-WindowStyle",
                "Hidden",
                "-Command",
                ps_script,
            ])
            .env("SKYNET_UPDATER_PID", current_pid.to_string())
            .env("SKYNET_UPDATER_SETUP", &installer_path)
            .env("SKYNET_UPDATER_APP", &current_exe)
            .creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS)
            .spawn()
            .map_err(|e| anyhow!("Failed to launch update installer helper: {e}"))?;
    }

    app.exit(0);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_semver_comparison_and_prerelease() {
        assert!(is_newer_version("1.0.0", "1.0.1"));
        assert!(is_newer_version("v0.3.1", "v1.0.0"));
        assert!(is_newer_version("1.0.0-rc.1", "1.0.0"));
        assert!(!is_newer_version("1.0.0", "1.0.0"));
        assert!(!is_newer_version("1.0.0", "0.9.9"));
        assert!(!is_newer_version("1.0.0", "1.0.0-beta.1"));
    }

    #[test]
    fn test_allowed_github_release_asset_urls_and_filename_guard() {
        assert!(is_trusted_release_url(
            "https://github.com/jfmartineau45/skynetssh/releases/download/v1.0.0/SkynetSSH_1.0.0_x64-setup.exe"
        ));
        assert!(!is_trusted_release_url(
            "https://evil.example.com/SkynetSSH_1.0.0_x64-setup.exe"
        ));
        assert!(!is_trusted_release_url(
            "http://github.com/jfmartineau45/skynetssh/releases/download/v1.0.0/SkynetSSH_1.0.0_x64-setup.exe"
        ));

        assert!(is_safe_installer_filename("SkynetSSH_1.0.0_x64-setup.exe"));
        assert!(!is_safe_installer_filename("../SkynetSSH_1.0.0_x64-setup.exe"));
        assert!(!is_safe_installer_filename("SkynetSSH_1.0.0.bat"));
    }

    #[test]
    fn test_sha256sums_parser() {
        let sums = "\
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  SkynetSSH_1.0.0_x64_en-US.msi
0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef *SkynetSSH_1.0.0_x64-setup.exe
";
        assert_eq!(
            parse_expected_sha256(sums, "SkynetSSH_1.0.0_x64-setup.exe").as_deref(),
            Some("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
        );
        assert_eq!(parse_expected_sha256(sums, "Other_1.0.0-setup.exe"), None);
    }
}
