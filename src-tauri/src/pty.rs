use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::path::Path;
use std::process::Command;
use std::sync::{Arc, Mutex};

use anyhow::{anyhow, Result};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use tauri::ipc::Channel;

use crate::models::ShellProfile;
use crate::ssh::append_replay_bytes;

const PTY_REPLAY_CAP: usize = 65_536;

type PtySinkState = Arc<Mutex<(Channel<Vec<u8>>, VecDeque<u8>)>>;

struct ActivePtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    sink: PtySinkState,
    owner_window: String,
}

#[derive(Default, Clone)]
pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<String, ActivePtySession>>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn discover_shells() -> Vec<ShellProfile> {
        let mut list = Vec::new();

        // 1. PowerShell 7 (pwsh.exe)
        let pwsh_candidates = [
            r"C:\Program Files\PowerShell\7\pwsh.exe",
            r"C:\Program Files (x86)\PowerShell\7\pwsh.exe",
        ];
        if let Some(p) = pwsh_candidates.iter().find(|p| Path::new(p).exists()) {
            list.push(ShellProfile {
                id: "pwsh7".into(),
                name: "PowerShell 7".into(),
                executable: (*p).to_string(),
                args: vec!["-NoLogo".into()],
                icon: "powershell".into(),
            });
        }

        // 2. Windows PowerShell
        list.push(ShellProfile {
            id: "powershell".into(),
            name: "Windows PowerShell".into(),
            executable: "powershell.exe".into(),
            args: vec!["-NoLogo".into()],
            icon: "powershell".into(),
        });

        // 3. Git Bash
        let git_bash_candidates = [
            r"C:\Program Files\Git\bin\bash.exe",
            r"C:\Program Files (x86)\Git\bin\bash.exe",
        ];
        if let Some(p) = git_bash_candidates.iter().find(|p| Path::new(p).exists()) {
            list.push(ShellProfile {
                id: "git-bash".into(),
                name: "Git Bash".into(),
                executable: (*p).to_string(),
                args: vec!["--login".into(), "-i".into()],
                icon: "git".into(),
            });
        }

        // 4. Command Prompt
        list.push(ShellProfile {
            id: "cmd".into(),
            name: "Command Prompt (cmd)".into(),
            executable: "cmd.exe".into(),
            args: vec![],
            icon: "cmd".into(),
        });

        // 5. WSL2 Distributions
        if let Ok(output) = Command::new("wsl.exe").args(["-l", "-q"]).output() {
            if output.status.success() {
                // WSL outputs UTF-16LE on Windows
                let u16s: Vec<u16> = output
                    .stdout
                    .chunks_exact(2)
                    .map(|c| u16::from_le_bytes([c[0], c[1]]))
                    .collect();
                let decoded = String::from_utf16_lossy(&u16s);
                for line in decoded.lines() {
                    let distro = line.trim().trim_matches('\0');
                    if !distro.is_empty() && !distro.contains("docker-desktop") {
                        list.push(ShellProfile {
                            id: format!("wsl-{distro}"),
                            name: format!("WSL: {distro}"),
                            executable: "wsl.exe".into(),
                            args: vec!["-d".into(), distro.to_string()],
                            icon: "linux".into(),
                        });
                    }
                }
            }
        }

        list
    }

    pub fn spawn(
        &self,
        profile: ShellProfile,
        cols: u16,
        rows: u16,
        on_data: Channel<Vec<u8>>,
        window_label: String,
    ) -> Result<String> {
        let pty_system = native_pty_system();
        let pair = pty_system.openpty(PtySize {
            rows: rows.max(5),
            cols: cols.max(20),
            pixel_width: 0,
            pixel_height: 0,
        })?;

        let mut cmd = CommandBuilder::new(&profile.executable);
        for arg in &profile.args {
            cmd.arg(arg);
        }
        if let Some(home) = dirs::home_dir() {
            cmd.cwd(home);
        }

        let child = pair.slave.spawn_command(cmd)?;
        drop(pair.slave);

        let mut reader = pair.master.try_clone_reader()?;
        let writer = pair.master.take_writer()?;

        let session_id = uuid::Uuid::new_v4().to_string();
        let session_id_clone = session_id.clone();
        let sessions_ref = self.sessions.clone();

        let sink: PtySinkState = Arc::new(Mutex::new((
            on_data,
            VecDeque::with_capacity(PTY_REPLAY_CAP),
        )));
        let sink_for_thread = sink.clone();

        // Coalesce high-speed PTY output over a 4ms / 64 KB window before IPC dispatch
        let (byte_tx, byte_rx) = std::sync::mpsc::channel::<Vec<u8>>();
        std::thread::spawn(move || {
            let mut buf = [0u8; 16384];
            while let Ok(n) = reader.read(&mut buf) {
                if n == 0 || byte_tx.send(buf[..n].to_vec()).is_err() {
                    break;
                }
            }
        });

        std::thread::spawn(move || {
            while let Ok(mut batch) = byte_rx.recv() {
                let deadline = std::time::Instant::now() + std::time::Duration::from_millis(4);
                while batch.len() < PTY_REPLAY_CAP {
                    let rem = deadline.saturating_duration_since(std::time::Instant::now());
                    if rem.is_zero() {
                        break;
                    }
                    match byte_rx.recv_timeout(rem) {
                        Ok(more) => batch.extend_from_slice(&more),
                        Err(_) => break,
                    }
                }
                if let Ok(mut guard) = sink_for_thread.lock() {
                    let (ref ch, ref mut replay) = *guard;
                    append_replay_bytes(replay, &batch, PTY_REPLAY_CAP);
                    // Ignore transient IPC errors during cross-window session handoff!
                    let _ = ch.send(batch);
                }
            }
            if let Ok(guard) = sink_for_thread.lock() {
                let _ = guard
                    .0
                    .send(b"\r\n\x1b[90m[Process exited]\x1b[0m\r\n".to_vec());
            }
            if let Ok(mut guard) = sessions_ref.lock() {
                guard.remove(&session_id_clone);
            }
        });

        self.sessions
            .lock()
            .map_err(|_| anyhow!("Mutex poisoned"))?
            .insert(
                session_id.clone(),
                ActivePtySession {
                    master: pair.master,
                    writer,
                    child,
                    sink,
                    owner_window: window_label,
                },
            );

        Ok(session_id)
    }

    pub fn reattach(
        &self,
        session_id: &str,
        cols: u16,
        rows: u16,
        new_on_data: Channel<Vec<u8>>,
        window_label: String,
    ) -> Result<()> {
        let mut guard = self
            .sessions
            .lock()
            .map_err(|_| anyhow!("Mutex poisoned"))?;
        let sess = guard
            .get_mut(session_id)
            .ok_or_else(|| anyhow!("Local PTY session is no longer active"))?;
        sess.owner_window = window_label;
        if let Ok(mut sink_guard) = sess.sink.lock() {
            if !sink_guard.1.is_empty() {
                let snapshot: Vec<u8> = sink_guard.1.iter().copied().collect();
                let _ = new_on_data.send(snapshot);
            }
            sink_guard.0 = new_on_data;
        }
        let _ = sess.master.resize(PtySize {
            rows: rows.max(5),
            cols: cols.max(20),
            pixel_width: 0,
            pixel_height: 0,
        });
        Ok(())
    }

    pub fn write(&self, session_id: &str, data: &[u8]) -> Result<()> {
        let mut guard = self
            .sessions
            .lock()
            .map_err(|_| anyhow!("Mutex poisoned"))?;
        if let Some(sess) = guard.get_mut(session_id) {
            sess.writer.write_all(data)?;
            sess.writer.flush()?;
        }
        Ok(())
    }

    pub fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<()> {
        let guard = self
            .sessions
            .lock()
            .map_err(|_| anyhow!("Mutex poisoned"))?;
        if let Some(sess) = guard.get(session_id) {
            sess.master.resize(PtySize {
                rows: rows.max(5),
                cols: cols.max(20),
                pixel_width: 0,
                pixel_height: 0,
            })?;
        }
        Ok(())
    }

    pub fn close(&self, session_id: &str) -> Result<()> {
        let mut guard = self
            .sessions
            .lock()
            .map_err(|_| anyhow!("Mutex poisoned"))?;
        if let Some(mut sess) = guard.remove(session_id) {
            let _ = sess.child.kill();
        }
        Ok(())
    }

    pub fn close_for_window(&self, window_label: &str) {
        let Ok(mut guard) = self.sessions.lock() else {
            return;
        };
        let ids: Vec<String> = guard
            .iter()
            .filter(|(_, s)| s.owner_window == window_label)
            .map(|(k, _)| k.clone())
            .collect();
        for id in ids {
            if let Some(mut sess) = guard.remove(&id) {
                let _ = sess.child.kill();
            }
        }
    }
}
