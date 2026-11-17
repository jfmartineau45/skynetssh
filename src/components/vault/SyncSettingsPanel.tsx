import React, { useEffect, useState } from "react";
import {
  FolderOpen,
  GitBranch,
  RefreshCw,
  Palette,
  Upload,
  Check,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useVaultStore } from "../../store/useVaultStore";
import { useWorkspaceStore } from "../../store/useWorkspaceStore";
import { APP_THEMES } from "../../lib/themes";
import type { ThemeId } from "../../types/models";
import {
  apiGitInitRemote,
  apiGitSyncNow,
  apiImportTermiusJson,
  apiVaultSetPath,
} from "../../lib/ipc";

export const SyncSettingsPanel: React.FC = () => {
  const { status, gitStatus, refreshStatus, refreshGitStatus, reloadSnapshot } =
    useVaultStore();
  const { theme, setTheme } = useWorkspaceStore();

  const [remoteUrl, setRemoteUrl] = useState("");
  const [syncBusy, setSyncBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    refreshGitStatus();
  }, [refreshGitStatus]);

  useEffect(() => {
    if (gitStatus?.remoteUrl) setRemoteUrl(gitStatus.remoteUrl);
  }, [gitStatus]);

  const handleChooseVaultFolder = async () => {
    const dir = await open({ directory: true, multiple: false });
    if (!dir || Array.isArray(dir)) return;
    try {
      await apiVaultSetPath(dir);
      await refreshStatus();
      setMessage(`Vault directory switched to ${dir}`);
    } catch (e) {
      setMessage(`Error: ${String(e)}`);
    }
  };

  const handleInitGit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSyncBusy(true);
    setMessage(null);
    try {
      await apiGitInitRemote(remoteUrl.trim());
      await refreshGitStatus();
      setMessage("Git repository configured on encrypted Vault folder.");
    } catch (e) {
      setMessage(`Git setup error: ${String(e)}`);
    } finally {
      setSyncBusy(false);
    }
  };

  const handleGitSync = async () => {
    setSyncBusy(true);
    setMessage(null);
    try {
      const res = await apiGitSyncNow();
      await refreshGitStatus();
      await reloadSnapshot();
      setMessage(res.lastSyncMessage || "Encrypted Vault synced with Git remote.");
    } catch (e) {
      setMessage(`Git sync error: ${String(e)}`);
    } finally {
      setSyncBusy(false);
    }
  };

  const handleImportTermius = async () => {
    const file = await open({
      multiple: false,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!file || Array.isArray(file)) return;
    try {
      const count = await apiImportTermiusJson(file);
      await reloadSnapshot();
      setMessage(`Imported ${count} host(s) from Termius JSON export.`);
    } catch (e) {
      setMessage(`Import error: ${String(e)}`);
    }
  };

  return (
    <div className="flex-1 h-full overflow-y-auto p-6 space-y-6">
      {message && (
        <div className="p-3 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-accent)] text-xs text-[var(--text-primary)]">
          {message}
        </div>
      )}

      {/* Section 1: Theme Selector (Cyberdyne / Tabby / Termius / Tokyo Night / T-800 HUD) */}
      <section className="p-5 rounded-2xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] space-y-4">
        <div className="flex items-center gap-2.5">
          <Palette className="w-4 h-4 text-[var(--accent-primary)]" />
          <div>
            <h3 className="text-sm font-bold">Interface & Terminal Theme</h3>
            <p className="text-xs text-[var(--text-secondary)]">
              Applies immediately to both the Acrylic shell and all open xterm.js panes
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Object.values(APP_THEMES).map((t) => {
            const active = theme === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTheme(t.id as ThemeId)}
                className={`p-3.5 rounded-xl text-left border transition ${
                  active
                    ? "bg-[var(--bg-elevated)] border-[var(--border-accent)] shadow-md"
                    : "bg-black/25 border-[var(--border-subtle)] hover:border-white/25"
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span
                      style={{ backgroundColor: t.accentHex }}
                      className="w-3 h-3 rounded-full"
                    />
                    <span className="text-xs font-bold">{t.name}</span>
                  </div>
                  {active ? (
                    <Check className="w-3.5 h-3.5 text-[var(--accent-primary)]" />
                  ) : (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-[var(--text-muted)]">
                      {t.badge}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-[var(--text-secondary)]">
                  {t.description}
                </p>
              </button>
            );
          })}
        </div>
      </section>

      {/* Section 2: Zero-Cost Encrypted Folder & Git Sync */}
      <section className="p-5 rounded-2xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <GitBranch className="w-4 h-4 text-emerald-400" />
            <div>
              <h3 className="text-sm font-bold">
                Encrypted Vault Sync ($0/month)
              </h3>
              <p className="text-xs text-[var(--text-secondary)]">
                Every host, key, snippet, and tunnel is stored in its own encrypted{" "}
                <code>.enc.json</code> file—conflict-free for Dropbox, Syncthing, OneDrive, or Git
              </p>
            </div>
          </div>

          <button
            onClick={handleChooseVaultFolder}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-[var(--border-subtle)] text-xs text-white transition"
          >
            <FolderOpen className="w-3.5 h-3.5 text-amber-400" />
            <span>Change Vault Folder</span>
          </button>
        </div>

        <div className="p-3 rounded-lg bg-black/35 border border-[var(--border-subtle)] text-xs font-mono text-[var(--text-secondary)]">
          Active Vault Directory: {status?.vaultPath ?? "Loading..."}
        </div>

        <form onSubmit={handleInitGit} className="flex flex-wrap items-center gap-2">
          <input
            value={remoteUrl}
            onChange={(e) => setRemoteUrl(e.target.value)}
            placeholder="Private Git Remote URL (e.g. git@github.com:you/skynet-vault.git)"
            className="flex-1 min-w-[260px] px-3 py-2 rounded-lg bg-black/40 border border-[var(--border-subtle)] text-xs font-mono text-white focus:outline-none focus:border-[var(--border-accent)]"
          />
          <button
            type="submit"
            disabled={syncBusy}
            className="px-3.5 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-semibold text-white transition"
          >
            Save Git Remote
          </button>
          <button
            type="button"
            disabled={syncBusy}
            onClick={handleGitSync}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-xs font-semibold text-white transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncBusy ? "animate-spin" : ""}`} />
            <span>Pull, Commit & Push Now</span>
          </button>
        </form>

        {gitStatus && (
          <div className="text-[11px] text-[var(--text-muted)] font-mono">
            Git Repo: {gitStatus.isGitRepo ? `Active (${gitStatus.branch || "main"})` : "Not initialized"} | Uncommitted envelopes: {gitStatus.changedFiles}
          </div>
        )}
      </section>

      {/* Section 3: Termius Migration */}
      <section className="p-5 rounded-2xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold">Migrate from Termius</h3>
          <p className="text-xs text-[var(--text-secondary)]">
            Import a Termius JSON backup file directly into your encrypted SkynetSSH Vault
          </p>
        </div>

        <button
          onClick={handleImportTermius}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-semibold text-white transition"
        >
          <Upload className="w-3.5 h-3.5 text-emerald-400" />
          <span>Import Termius JSON</span>
        </button>
      </section>
    </div>
  );
};
