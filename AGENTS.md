# SkynetSSH — Agent & Ponytail Guidelines

Follow `.agents/rules/ponytail.md` (lazy senior developer mode: solve the whole problem with the smallest complete diff; reuse existing helpers and native OS/Tauri capabilities before writing custom UI plumbing; end replies with `Not checked / Risk:`).

## Domain Invariants (Never Cut)
- **Vault Crypto & Cloud Sync (`src-tauri/src/vault.rs`):** Keep `Argon2id` + `XChaCha20-Poly1305` per-record envelopes, `~$` temporary write prefixes, OneDrive/SharePoint lock-retry loops (`read_string_with_retry`), `-{COMPUTERNAME}.enc.json` LWW conflict reconciliation, and the 30-day / 3-strike TOTP `KeyringLease` ceiling intact.
- **TUI-Safe Terminal Keys (`src/components/terminal/TerminalPane.tsx`, `src/App.tsx`):** Never intercept bare `Ctrl+<letter>`, `Ctrl+-`/`Ctrl+_`, `Alt+<key>`, or `F1..F12` inside `.xterm` (`nano`, `vim`, `bash`, `tmux`, `htop`, `mc`), and keep `##` disabled when `term.buffer.active === term.buffer.alternate`.
- **Windows / WebView2 Multi-Window Safety (`src-tauri/src/lib.rs`, `src-tauri/src/pty.rs`, `src-tauri/src/sync.rs`, `src-tauri/src/ssh.rs`):**
  - Never call `WebviewWindowBuilder::build()` or blocking subprocess/network/KDF work on the synchronous Win32 UI thread (`#[tauri::command]` must be `async fn` / `spawn_blocking`).
  - Always set `.creation_flags(0x0800_0000)` (`CREATE_NO_WINDOW`) on Windows subprocesses (`wsl.exe`, `ping.exe`, `git.exe`).
