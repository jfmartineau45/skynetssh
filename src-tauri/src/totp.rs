use anyhow::{anyhow, Result};
use data_encoding::BASE32_NOPAD;
use hmac::{Hmac, Mac};
use qrcode::render::svg;
use qrcode::QrCode;
use rand::RngCore;
use sha1::Sha1;

use crate::models::TotpSetupPayload;

type HmacSha1 = Hmac<Sha1>;

/// Generates a fresh 160-bit (20-byte) RFC 6238 TOTP secret, `otpauth://` URI, and scannable SVG QR code.
pub fn generate_totp_setup(vault_name: &str) -> Result<TotpSetupPayload> {
    let mut secret_bytes = [0u8; 20];
    rand::thread_rng().fill_bytes(&mut secret_bytes);
    let secret_base32 = BASE32_NOPAD.encode(&secret_bytes);

    let safe_label: String = vault_name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(*c, ' ' | '-' | '_'))
        .collect();
    let encoded_label = safe_label.trim().replace(' ', "%20");
    let label = if encoded_label.is_empty() {
        "Vault"
    } else {
        &encoded_label
    };

    let otpauth_uri = format!(
        "otpauth://totp/SkynetSSH:{label}?secret={secret_base32}&issuer=SkynetSSH&algorithm=SHA1&digits=6&period=30"
    );

    let code = QrCode::new(otpauth_uri.as_bytes())
        .map_err(|e| anyhow!("QR code generation failed: {e}"))?;
    let qr_svg = code
        .render()
        .min_dimensions(188, 188)
        .dark_color(svg::Color("#090a0e"))
        .light_color(svg::Color("#ffffff"))
        .build();

    Ok(TotpSetupPayload {
        secret_base32,
        otpauth_uri,
        qr_svg,
    })
}

pub fn decode_base32_secret(secret_base32: &str) -> Result<Vec<u8>> {
    let normalized: String = secret_base32
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '=')
        .map(|c| c.to_ascii_uppercase())
        .collect();
    BASE32_NOPAD
        .decode(normalized.as_bytes())
        .map_err(|_| anyhow!("Invalid Base32 TOTP secret"))
}

pub fn compute_totp_at_step(secret: &[u8], step: u64) -> Result<u32> {
    let mut mac =
        HmacSha1::new_from_slice(secret).map_err(|_| anyhow!("Invalid HMAC key length"))?;
    mac.update(&step.to_be_bytes());
    let hash = mac.finalize().into_bytes();
    let offset = (hash[19] & 0x0f) as usize;
    let binary = ((u32::from(hash[offset]) & 0x7f) << 24)
        | (u32::from(hash[offset + 1]) << 16)
        | (u32::from(hash[offset + 2]) << 8)
        | u32::from(hash[offset + 3]);
    Ok(binary % 1_000_000)
}

/// Verifies a 6-digit TOTP code against `secret_base32` at `unix_secs` with `±1` 30-second window skew tolerance.
pub fn verify_totp_code(secret_base32: &str, user_code: &str, unix_secs: u64) -> Result<bool> {
    let digits_only: String = user_code.chars().filter(|c| c.is_ascii_digit()).collect();
    if digits_only.len() != 6 {
        return Ok(false);
    }
    let parsed_code: u32 = digits_only.parse().unwrap_or(u32::MAX);
    let secret = decode_base32_secret(secret_base32)?;
    let current_step = unix_secs / 30;

    for offset in [-1i64, 0, 1] {
        let step = (current_step as i64 + offset) as u64;
        if compute_totp_at_step(&secret, step)? == parsed_code {
            return Ok(true);
        }
    }
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rfc6238_totp_and_skew_verification() {
        let setup = generate_totp_setup("Ops Team Vault").unwrap();
        assert!(setup.qr_svg.contains("<svg"));
        assert!(setup.otpauth_uri.starts_with("otpauth://totp/SkynetSSH:"));

        let secret_bytes = decode_base32_secret(&setup.secret_base32).unwrap();
        let now_secs = 1_700_000_100u64;
        let code = compute_totp_at_step(&secret_bytes, now_secs / 30).unwrap();
        let formatted = format!("{code:06}");

        // Valid at exact time and +25s skew
        assert!(verify_totp_code(&setup.secret_base32, &formatted, now_secs).unwrap());
        assert!(verify_totp_code(&setup.secret_base32, &formatted, now_secs + 25).unwrap());

        // Invalid code must fail
        let wrong = format!("{:06}", (code + 1) % 1_000_000);
        assert!(!verify_totp_code(&setup.secret_base32, &wrong, now_secs).unwrap());
    }
}
