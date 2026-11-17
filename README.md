# SkynetSSH (`SKYNET//SSH`)

> **Tabby's** sleek Acrylic split-pane terminal feel + **Termius's** effortless Host Vault, SFTP, Tunnels, and Snippets — built natively on **Tauri v2 + Rust** with **$0/month** end-to-end encrypted Git & folder sync.

![Tauri v2](https://img.shields.io/badge/Tauri-v2-24C8DB?logo=tauri&logoColor=white)
![Rust](https://img.shields.io/badge/Backend-Rust_Async_(Tokio_%2B_russh)-DEA584?logo=rust&logoColor=white)
![React 19](https://img.shields.io/badge/UI-React_19_%2B_TypeScript_%2B_Tailwind_v4-38BDF8?logo=react&logoColor=white)
![Encryption](https://img.shields.io/badge/Vault-Argon2id_%2B_XChaCha20--Poly1305-EF4444)

---

## Why SkynetSSH?

- **Tabby** nails the translucent dark terminal aesthetic and recursive split panes, **but** runs on heavy Electron (~500+ MB RAM) and buries SSH profile creation inside a clunky settings maze.
- **Termius** nails the visual Host Vault, slide-over host inspector, SFTP browser, snippets, and port forwarding, **but** locks core sync/SFTP workflows behind a recurring subscription.
- **SkynetSSH** combines the best of both into a **~6 MB native installer** powered by pure async Rust (`russh`, `russh-sftp`, `portable-pty`) and GPU-accelerated `xterm.js` WebGL panes.

---

## Features

### 1. Termius-Style Host Vault & Slide-Over Inspector
- **Pinned Vault Home Tab:** Organize servers into **Groups** and filterable `#tag` pills, with one-click or double-click launch into SSH or SFTP.
- **Slide-Over Right Host Inspector:** Clean grouped cards for **Address & Group**, **SSH Credentials**, and **ProxyJump / Startup Automation**—create new Groups or generate/import SSH keys **inline** without ever leaving the host form.
- **Smart Quick-Connect & Save Bar:** Paste `ssh -p 2222 ubuntu@10.0.1.5` or IPv6 `root@[2001:db8::1]:2200` into the top bar (or straight into the Address field) to auto-parse credentials, save to the Vault, and connect in one step.
- **1-Click Migration:** Import existing hosts directly from `~/.ssh/config` or a **Termius JSON** export, plus 1-click host card duplication.

### 2. Personal & Team Multi-Vaults (100% Conflict-Free SharePoint / OneDrive / Git Sync)
- **Personal + Team SharePoint Vault Switcher:** Switch in one click between your **Personal Vault** and one or more shared **Team Vaults** (e.g. a shared OneDrive / SharePoint folder), with high-visibility **`PERSONAL`** vs **`TEAM · <Vault Name>`** badges in the titlebar, sidebar, tabs, and split panes so you never mix up Personal and Team Production servers.
- **Two-Tier Envelope Cryptography + Optional TOTP (RFC 6238) & 30-Day Device Trust:**
  1. Each Vault's Master Password derives a 256-bit Key Encryption Key via **`Argon2id`** (64 MiB memory, 3 iterations) so synced SharePoint/OneDrive files remain 100% zero-knowledge encrypted.
  2. That key wraps a random 256-bit Master Data Encryption Key (`DEK`) in `vault.meta.json`, with structured Windows Credential Manager (DPAPI) device leases capped strictly at **30 days maximum** (`Session only`, `1d`, `7d`, `14d`, or `30d`).
  3. **Master Password OR 6-Digit Authenticator (TOTP):** Enroll Google/Microsoft Authenticator, 1Password, or Bitwarden via QR code (`auth/totp.enc.json`) to unlock enrolled PCs with either a **6-digit TOTP code** or your **Master Password**—protected by a **3-strike local wipe** (3 wrong TOTP attempts immediately purge the local Credential Manager cache and force Master Password entry).
  4. Every host, SSH key, group, tunnel, snippet, and known-host fingerprint is encrypted individually with **`XChaCha20-Poly1305`** and AAD header binding (`collection:id:schema:updated_at:tombstone`) into its own `<uuid>.enc.json` file.
- **Mathematically Conflict-Free SharePoint / OneDrive Sync:**
  - Unique `.tmp` atomic writes with automatic backoff retry for `OneDrive.exe` sharing locks (`ERROR_SHARING_VIOLATION`).
  - Deterministic **Last-Writer-Wins (`(updated_at, ciphertext)`) CRDT reconciliation** that automatically resolves and cleans up OneDrive `-{COMPUTERNAME}.enc.json`, Dropbox `conflicted copy`, and Syncthing `sync-conflict` sibling forks without duplicating hosts.
  - **Live Folder Watcher:** When a teammate saves a host into your shared OneDrive / SharePoint folder, every teammate's open SkynetSSH window updates automatically in real time.
- **~/.ssh Auto-Sniffing:** Non-destructively scans `~/.ssh` on launch to detect existing private keys (`id_ed25519`, custom keys, `.pem`, passphrase-protected keys) and `~/.ssh/config` hosts (`Host`, `IdentityFile`, `ProxyJump`) for 1-click Vault import.

### 3. Tabby-Style Multi-Pane Terminal & Local Shells
- **Recursive Binary Split Panes:** Split any tab horizontally or vertically with smooth drag-resizable dividers—freely mixing remote SSH servers and local shells in the same tab.
- **GPU-Accelerated `xterm.js` WebGL:** 10,000-line scrollback, inline buffer search (`Ctrl+Shift+F`), clickable URLs, copy-on-shortcut (`Ctrl+Shift+C`), and 4ms / 64 KB output batching in Rust so `btop`, `vim`, and fast log dumps stay responsive.
- **Auto-Discovered Local Shells:** Automatically detects **PowerShell 7 (`pwsh`)**, **Windows PowerShell**, **Git Bash**, **Command Prompt (`cmd`)**, and installed **WSL2** distributions via Windows ConPTY (`portable-pty`).

### 4. Multiplexed SSH2, Multi-Hop `ProxyJump` & Agent Auth
- **Multiplexed Connections:** A single authenticated `russh` session per host powers multiple terminal panes, SFTP browsers, and tunnels simultaneously without repeated handshakes.
- **In-Memory `ProxyJump` Chaining:** Hop through 1..N bastion servers (`Host C` via `Host B` via `Host A`) purely over virtual `direct-tcpip` streams with loop detection.
- **Flexible Authentication:**
  - **Vault Keychain:** Generate **Ed25519** or **RSA-4096** keys in one click, import `.pem` / OpenSSH files, paste PEM keys (validated with SHA-256 fingerprint & `authorized_keys` public-key extraction), and store key passphrases encrypted in the Vault.
  - **Native SSH Agent:** Connects to Windows OpenSSH `\\.\pipe\openssh-ssh-agent` and **Pageant** (1Password, KeePassXC, PuTTY) before falling back to `~/.ssh` keys.
  - **Password Auth:** Stored encrypted inside your host envelope.
- **Interactive `known_hosts` Verification:** Trust-On-First-Use (TOFU) SHA-256 fingerprint modal and high-visibility Man-In-The-Middle warning if a remote host key ever changes.

### 5. Dual-Pane SFTP + Quick In-Session SFTP Drawer
- **Quick SFTP Drawer:** Toggle a slide-out SFTP browser inside any active SSH tab, reusing the live SSH connection with zero re-authentication.
- **Dedicated Dual-Pane SFTP Tab:** Side-by-side panes where either side can be **Local PC** or **Any Saved Remote Host**—supporting `Local <-> Remote` transfers and direct streamed **`Remote A <-> Remote B`** transfers.
- **Remote File Tools:** Live chunked progress dock, `mkdir`, rename, delete, octal `chmod` permissions modal, and **"Edit Locally"** (downloads to a sanitized temp directory, opens in your default Windows editor via `ShellExecuteW`, watches for saves, and auto-uploads back over SFTP).

### 6. Port Forwarding & Built-In Dynamic SOCKS5 Proxy
- **Local (`-L`):** Bind a local port and forward traffic through SSH `direct-tcpip` to any remote target.
- **Remote (`-R`):** Bind a remote port via `tcpip-forward` and route incoming `forwarded-tcpip` connections back to a local service.
- **Dynamic SOCKS5 (`-D`):** Built-in async RFC 1928 SOCKS5 proxy server (IPv4, IPv6, and domain resolution) over SSH—run tunnels independently in the background with live active-connection counts.

### 7. Snippets, Multi-Host Broadcast, Command Palette & Themes
- **Parameterized Snippets:** Store reusable commands with `{{variable}}` placeholders that prompt for values before running, or attach snippets as automatic host startup commands.
- **Multi-Host Broadcast Mode:** Toggle **Broadcast** in the title bar to mirror keystrokes simultaneously across all selected panes (highlighted with amber tactical borders).
- **Command Palette (`Ctrl+K`):** Fuzzy-search launcher to connect to hosts, open Dual-Pane SFTP, spawn local shells, toggle tunnels, run snippets, or switch themes.
- **5 Built-In Themes (Live-Switching):**
  - **Cyberdyne Obsidian** *(Default — matte carbon glass + crimson T-800 accents)*
  - **T-800 Tactical HUD** *(High-contrast crimson optical HUD)*
  - **Tabby Acrylic Dark** *(Classic Tabby slate + electric sky-blue)*
  - **Termius Midnight** *(Deep navy + emerald vault accents)*
  - **Tokyo Night** *(Low-glare indigo night palette)*

---

## Architecture

```mermaid
flowchart TB
    subgraph UI["Frontend — React 19 + TypeScript + Tailwind CSS v4 + Zustand"]
        VaultUI["Pinned Vault Dashboard & Slide-Over Host Inspector"]
        Tabs["Top Tab Bar + Recursive Split-Pane Engine"]
        Xterm["xterm.js + WebGL + Fit / Search / WebLinks"]
        SftpUI["Dual-Pane SFTP Tab & In-Session Quick SFTP Drawer"]
    end

    subgraph IPC["Tauri v2 Typed IPC & Channels"]
        Invoke["Typed Commands (Vault CRUD, SSH/Tunnel Control, Git Sync)"]
        Stream["Batched Byte & Progress Channels (4ms / 64 KB Coalescer)"]
    end

    subgraph Core["Rust Backend — Tokio Async Runtime"]
        Vault["Vault Engine (Argon2id + XChaCha20-Poly1305 + OS Keyring)"]
        Pool["Multiplexed SSH Pool (russh + ProxyJump + Agent/Pageant)"]
        Pty["Local Shell Manager (portable-pty / Windows ConPTY)"]
        Sftp["Streaming SFTP Engine (russh-sftp + Local Editor Watcher)"]
        Tunnel["Tunnel Engine (-L Local, -R Remote, -D SOCKS5)"]
        Sync["Importers (~/.ssh/config, Termius) & Git Sync"]
    end

    UI <--> Invoke
    Xterm <--> Stream
    SftpUI <--> Stream
    Invoke --> Vault
    Invoke --> Pool
    Invoke --> Pty
    Invoke --> Sftp
    Invoke --> Tunnel
    Invoke --> Sync
    Pool --> Sftp
    Pool --> Tunnel
```

### Encrypted Vault Directory Structure
```text
<vault-directory>/
├── vault.meta.json            # Argon2id salt/params + XChaCha20 wrapped 256-bit Master DEK
├── groups/<uuid>.enc.json     # Encrypted group envelopes
├── hosts/<uuid>.enc.json      # Encrypted host credentials & ProxyJump links
├── keys/<uuid>.enc.json       # Encrypted OpenSSH private keys & passphrases
├── tunnels/<uuid>.enc.json    # Encrypted -L / -R / -D port-forwarding rules
├── snippets/<uuid>.enc.json   # Encrypted command templates
└── known_hosts/<uuid>.enc.json# Verified SHA-256 server host-key fingerprints
```

---

## Keyboard Shortcuts (Tabby-Style)

| Shortcut | Action |
| :--- | :--- |
| `` Ctrl + ` `` *(Global OS-Wide)* | **Bring to Front / Quake Hide Toggle** from anywhere in Windows (customizable in Settings) |
| `Ctrl + K` | Open global **Command Palette** (hosts, split-with, shells, SFTP, tunnels, snippets, themes) |
| `Ctrl + Shift + T` | Open new Local Terminal tab |
| `Ctrl + Shift + N` | Open **New Host** slide-over Vault inspector |
| `Ctrl + Shift + W` | Close active tab |
| `Ctrl + Tab` / `Ctrl + Shift + Tab` | Cycle next / previous tab |
| `Ctrl + 1 .. 9` | Jump directly to Tab 1..9 (`Ctrl + 1` = Vault) |
| `Alt + Shift + D` | Split active pane **Right** (opens Host / Shell picker) |
| `Alt + Shift + E` | Split active pane **Down** (opens Host / Shell picker) |
| `Ctrl + Shift + F` | Toggle inline search inside the active terminal pane |
| `Ctrl + Shift + C` / `V` | Copy / Paste in terminal (plus automatic **Copy-on-Select** & **Right-Click Paste**) |
| `Ctrl + =` / `-` / `0` | Zoom terminal font size in / out / reset |
| `Middle-Click` on Tab | Close terminal or SFTP tab |
| `Double-Click` Host Card | Open new SSH terminal tab for that host |

---

## Getting Started (Development & Build)

### Prerequisites
- **Node.js 22+** and **pnpm**
- **Rust (stable)** via `rustup`
- **Windows:** Edge WebView2 (pre-installed on Windows 11) + MSVC Build Tools or MinGW-w64 + LLVM `lld`

### Install & Run in Dev Mode
```bash
pnpm install
pnpm tauri dev
```

### Run Unit Tests (TypeScript + Rust)
```bash
# Frontend SSH/IPv6 connection-string parser tests
pnpm test

# Backend Argon2id/XChaCha20 Vault, Ed25519 keygen, OpenSSH config & SOCKS5 tests
cd src-tauri && cargo test --lib
```

### Build Production Installer (`~5.9 MiB` NSIS `.exe`)
```bash
pnpm tauri build --bundles nsis
```
The standalone per-user Windows installer is output to:
`src-tauri/target/release/bundle/nsis/SkynetSSH_0.1.0_x64-setup.exe`

---

## License

MIT
