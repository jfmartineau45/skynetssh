import React, { useEffect, useState } from "react";
import {
  FolderOpen,
  GitBranch,
  RefreshCw,
  Palette,
  Upload,
  Check,
  Users,
  User,
  Plus,
  Trash2,
  Keyboard,
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

const HOTKEY_PRESETS = [
  { value: "CommandOrControl+Backquote", label: "Ctrl + ` (Tabby Quake Default)" },
  { value: "Alt+Backquote", label: "Alt + `" },
  { value: "CommandOrControl+Shift+Space", label: "Ctrl + Shift + Space" },
  { value: "F12", label: "F12 (Guake / Yakuake Style)" },
  { value: "Disabled", label: "Disabled" },
];

export const SyncSettingsPanel: React.FC = () => {
  const {
    status,
    gitStatus,
    refreshStatus,
    refreshGitStatus,
    reloadSnapshot,
    addVaultProfile,
    switchVaultProfile,
    removeVaultProfile,
    setGlobalHotkey,
  } = useVaultStore();

  const {
    theme,
    setTheme,
    copyOnSelect,
    setCopyOnSelect,
    rightClickPaste,
    setRightClickPaste,
    terminalFontSize,
    adjustFontSize,
  } = useWorkspaceStore();

  const [remoteUrl, setRemoteUrl] = useState("");
  const [syncBusy, setSyncBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [newProfileName, setNewProfileName] = useState("");
  const [newProfileKind, setNewProfileKind] = useState<"team" | "personal">("team");

  useEffect(() => {
    refreshGitStatus();
  }, [refreshGitStatus, status?.vaultPath]);

  useEffect(() => {
    if (gitStatus?.remoteUrl) setRemoteUrl(gitStatus.remoteUrl);
    else setRemoteUrl("");
  }, [gitStatus]);

  const handleChooseVaultFolder = async () => {
    const dir = await open({ directory: true, multiple: false });
    if (!dir || Array.isArray(dir)) return;
    try {
      await apiVaultSetPath(dir);
      await refreshStatus();
      setMessage(`Active Vault folder updated to ${dir}`);
    } catch (e) {
      setMessage(`Error: ${String(e)}`);
    }
  };

  const handleAddProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProfileName.trim()) {
      setMessage("Enter a name for the Vault profile first (e.g. Ops Team SharePoint).");
      return;
    }
    const dir = await open({ directory: true, multiple: false });
    if (!dir || Array.isArray(dir)) return;
    try {
      await addVaultProfile(newProfileName.trim(), newProfileKind, dir);
      setNewProfileName("");
      setMessage(`Linked ${newProfileKind.toUpperCase()} Vault at ${dir}`);
    } catch (err) {
      setMessage(`Error: ${String(err)}`);
    }
  };

  const handleInitGit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSyncBusy(true);
    setMessage(null);
    try {
      await apiGitInitRemote(remoteUrl.trim());
      await refreshGitStatus();
      setMessage("Git repository configured on active Vault folder.");
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

      {/* Section 1: Personal & Team Vaults (OneDrive / SharePoint Conflict-Free Sync) */}
      <section className="p-5 rounded-2xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] space-y-4">
        <div className="flex items-center gap-2.5">
          <Users className="w-4 h-4 text-sky-400" />
          <div>
            <h3 className="text-sm font-bold">
              Personal & Team Vaults (OneDrive / SharePoint Conflict-Free)
            </h3>
            <p className="text-xs text-[var(--text-secondary)]">
              Every host/key is an independent AEAD-verified <code>.enc.json</code> envelope with automatic Last-Writer-Wins healing for OneDrive <code>-COMPUTERNAME</code> conflict copies and live folder watching
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {(status?.profiles ?? []).map((prof) => {
            const active = prof.id === status?.activeProfile.id;
            const isTeam = prof.kind === "team";
            return (
              <div
                key={prof.id}
                onClick={() => !active && switchVaultProfile(prof.id)}
                className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 cursor-pointer transition ${
                  active
                    ? isTeam
                      ? "bg-sky-950/30 border-sky-400/60"
                      : "bg-[var(--bg-elevated)] border-[var(--border-accent)]"
                    : "bg-black/25 border-[var(--border-subtle)] hover:border-white/25"
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`p-2 rounded-lg shrink-0 ${
                      isTeam
                        ? "bg-sky-500/20 text-sky-300"
                        : "bg-emerald-500/20 text-emerald-300"
                    }`}
                  >
                    {isTeam ? (
                      <Users className="w-4 h-4" />
                    ) : (
                      <User className="w-4 h-4" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold truncate">
                        {prof.name}
                      </span>
                      <span
                        className={`text-[9px] px-1.5 py-0.2 rounded uppercase font-bold ${
                          isTeam
                            ? "bg-sky-500/20 text-sky-300"
                            : "bg-emerald-500/20 text-emerald-300"
                        }`}
                      >
                        {prof.kind}
                      </span>
                      {active && (
                        <span className="text-[9px] px-1.5 py-0.2 rounded bg-white/10 text-white font-semibold">
                          ACTIVE
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] font-mono text-[var(--text-muted)] truncate mt-0.5">
                      {prof.path}
                    </div>
                  </div>
                </div>

                {(status?.profiles.length ?? 0) > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeVaultProfile(prof.id);
                    }}
                    className="p-1.5 rounded hover:bg-red-500/20 text-[var(--text-muted)] hover:text-red-400 shrink-0"
                    title="Unlink Vault profile (keeps files on disk)"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <form
          onSubmit={handleAddProfile}
          className="flex flex-wrap items-center gap-2 pt-2 border-t border-[var(--border-subtle)]"
        >
          <input
            value={newProfileName}
            onChange={(e) => setNewProfileName(e.target.value)}
            placeholder="New Vault Name (e.g. Infra Team SharePoint)"
            className="flex-1 min-w-[220px] px-3 py-2 rounded-lg bg-black/40 border border-[var(--border-subtle)] text-xs text-white focus:outline-none focus:border-sky-400"
          />
          <select
            value={newProfileKind}
            onChange={(e) =>
              setNewProfileKind(e.target.value as "team" | "personal")
            }
            className="px-3 py-2 rounded-lg bg-black/40 border border-[var(--border-subtle)] text-xs text-white"
          >
            <option value="team">👥 Team Vault (SharePoint / OneDrive)</option>
            <option value="personal">👤 Personal Vault</option>
          </select>
          <button
            type="submit"
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-xs font-semibold text-white transition"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Select Folder & Link Vault</span>
          </button>
        </form>
      </section>

      {/* Section 2: Tabby Shortcuts & Global "Bring to Front" Hotkey */}
      <section className="p-5 rounded-2xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] space-y-4">
        <div className="flex items-center gap-2.5">
          <Keyboard className="w-4 h-4 text-amber-400" />
          <div>
            <h3 className="text-sm font-bold">
              Tabby Global "Bring to Front" Hotkey & Terminal Behavior
            </h3>
            <p className="text-xs text-[var(--text-secondary)]">
              Summon or hide SkynetSSH from anywhere in Windows with a single Quake-style shortcut
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="block text-xs font-medium text-[var(--text-secondary)]">
              Global Bring-to-Front / Quake Toggle Hotkey
            </label>
            <select
              value={status?.globalHotkey ?? "CommandOrControl+Backquote"}
              onChange={async (e) => {
                try {
                  await setGlobalHotkey(e.target.value);
                  setMessage(`Global hotkey set to ${e.target.value}`);
                } catch (err) {
                  setMessage(`Hotkey error: ${String(err)}`);
                }
              }}
              className="w-full px-3 py-2 rounded-lg bg-black/40 border border-[var(--border-subtle)] text-xs text-white"
            >
              {HOTKEY_PRESETS.map((hp) => (
                <option key={hp.value} value={hp.value}>
                  {hp.label}
                </option>
              ))}
            </select>

            <div className="flex items-center justify-between pt-2 text-xs">
              <span className="text-[var(--text-secondary)]">
                Terminal Font Size ({terminalFontSize}px)
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => adjustFontSize(-1)}
                  className="px-2.5 py-1 rounded bg-white/5 hover:bg-white/10"
                >
                  -
                </button>
                <button
                  onClick={() => adjustFontSize("reset")}
                  className="px-2.5 py-1 rounded bg-white/5 hover:bg-white/10"
                >
                  Reset
                </button>
                <button
                  onClick={() => adjustFontSize(1)}
                  className="px-2.5 py-1 rounded bg-white/5 hover:bg-white/10"
                >
                  +
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-2.5 p-3.5 rounded-xl bg-black/25 border border-[var(--border-subtle)] text-xs">
            <label className="flex items-center justify-between cursor-pointer">
              <span>Copy automatically on text selection (Tabby style)</span>
              <input
                type="checkbox"
                checked={copyOnSelect}
                onChange={(e) => setCopyOnSelect(e.target.checked)}
                className="accent-[var(--accent-primary)]"
              />
            </label>
            <label className="flex items-center justify-between cursor-pointer">
              <span>Right-click inside terminal to paste clipboard</span>
              <input
                type="checkbox"
                checked={rightClickPaste}
                onChange={(e) => setRightClickPaste(e.target.checked)}
                className="accent-[var(--accent-primary)]"
              />
            </label>
            <div className="pt-2 border-t border-[var(--border-subtle)] grid grid-cols-2 gap-y-1 text-[11px] text-[var(--text-muted)] font-mono">
              <span>Ctrl+` : Bring to Front</span>
              <span>Ctrl+K : Command Palette</span>
              <span>Ctrl+Shift+T : New Shell</span>
              <span>Ctrl+Shift+N : New Host</span>
              <span>Alt+Shift+D : Split Right</span>
              <span>Alt+Shift+E : Split Down</span>
              <span>Ctrl+Tab : Cycle Tabs</span>
              <span>Ctrl+1..9 : Jump to Tab</span>
            </div>
          </div>
        </div>
      </section>

      {/* Section 3: Theme Selector */}
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

      {/* Section 4: Git Sync on Active Vault */}
      <section className="p-5 rounded-2xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <GitBranch className="w-4 h-4 text-emerald-400" />
            <div>
              <h3 className="text-sm font-bold">
                Git Sync (Optional alternative to SharePoint / OneDrive)
              </h3>
              <p className="text-xs text-[var(--text-secondary)]">
                Active Vault ({status?.activeProfile.name}):{" "}
                <code className="font-mono">{status?.vaultPath}</code>
              </p>
            </div>
          </div>

          <button
            onClick={handleChooseVaultFolder}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-[var(--border-subtle)] text-xs text-white transition"
          >
            <FolderOpen className="w-3.5 h-3.5 text-amber-400" />
            <span>Change Current Folder</span>
          </button>
        </div>

        <form
          onSubmit={handleInitGit}
          className="flex flex-wrap items-center gap-2"
        >
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
            <RefreshCw
              className={`w-3.5 h-3.5 ${syncBusy ? "animate-spin" : ""}`}
            />
            <span>Pull, Commit & Push Now</span>
          </button>
        </form>
      </section>

      {/* Section 5: Termius Migration */}
      <section className="p-5 rounded-2xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold">Migrate from Termius</h3>
          <p className="text-xs text-[var(--text-secondary)]">
            Import a Termius JSON backup file into your currently active Vault
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
