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
  Smartphone,
  ShieldCheck,
  Copy,
  ArrowUpCircle,
  ExternalLink,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useVaultStore } from "../../store/useVaultStore";
import { useWorkspaceStore } from "../../store/useWorkspaceStore";
import { APP_THEMES } from "../../lib/themes";
import type { ThemeId, TotpSetupPayload } from "../../types/models";
import {
  apiGitInitRemote,
  apiGitSyncNow,
  apiImportTermiusJson,
  apiOpenExternalUrl,
  apiVaultSetPath,
} from "../../lib/ipc";

const HOTKEY_PRESETS = [
  { value: "CommandOrControl+Backquote", label: "Ctrl + ` (Quake Bring-to-Front Default)" },
  { value: "Alt+Backquote", label: "Alt + `" },
  { value: "CommandOrControl+Shift+Backquote", label: "Ctrl + Shift + `" },
  { value: "CommandOrControl+Shift+Space", label: "Ctrl + Shift + Space" },
  { value: "CommandOrControl+Alt+S", label: "Ctrl + Alt + S" },
  { value: "F12", label: "F12 (Guake / Yakuake Style)" },
  { value: "Disabled", label: "Disabled" },
];

function formatRecordedAccelerator(e: KeyboardEvent): string | null {
  if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return null;
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("CommandOrControl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (parts.length === 0 && !/^F([1-9]|1[0-2])$/.test(e.key)) return null;

  let keyToken = "";
  if (e.code === "Backquote") keyToken = "Backquote";
  else if (e.code === "Space") keyToken = "Space";
  else if (e.code.startsWith("Key")) keyToken = e.code.slice(3);
  else if (e.code.startsWith("Digit")) keyToken = e.code.slice(5);
  else if (/^F([1-9]|1[0-2])$/.test(e.code)) keyToken = e.code;
  else return null;

  parts.push(keyToken);
  return parts.join("+");
}

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
    beginTotpSetup,
    confirmTotpSetup,
    disableTotp,
    forgetDevice,
  } = useVaultStore();

  const {
    theme,
    setTheme,
    copyOnSelect,
    setCopyOnSelect,
    rightClickPaste,
    setRightClickPaste,
    showSnippetsSection,
    setShowSnippetsSection,
    inlineHashSnippets,
    setInlineHashSnippets,
    bloodRain,
    setBloodRain,
    idleEasterEggEnabled,
    setIdleEasterEggEnabled,
    terminalFontSize,
    adjustFontSize,
    autoCheckUpdates,
    setAutoCheckUpdates,
    updateInfo,
    checkingUpdate,
    installingUpdate,
    updateError,
    checkForUpdates,
    installAvailableUpdate,
  } = useWorkspaceStore();

  const [remoteUrl, setRemoteUrl] = useState("");
  const [syncBusy, setSyncBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [recordingHotkey, setRecordingHotkey] = useState(false);

  useEffect(() => {
    if (!recordingHotkey) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setRecordingHotkey(false);
        return;
      }
      const accel = formatRecordedAccelerator(e);
      if (!accel) return;
      setRecordingHotkey(false);
      setGlobalHotkey(accel)
        .then(() => setMessage(`Global Bring-to-Front shortcut set to ${accel}`))
        .catch((err) => setMessage(`Hotkey error: ${String(err)}`));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recordingHotkey, setGlobalHotkey]);

  const [newProfileName, setNewProfileName] = useState("");
  const [newProfileKind, setNewProfileKind] = useState<"team" | "personal">("team");

  const [totpSetup, setTotpSetup] = useState<TotpSetupPayload | null>(null);
  const [totpVerifyCode, setTotpVerifyCode] = useState("");
  const [totpRememberDays, setTotpRememberDays] = useState<number>(7);
  const [totpBusy, setTotpBusy] = useState(false);

  const handleStartTotpSetup = async () => {
    setTotpBusy(true);
    setMessage(null);
    try {
      const payload = await beginTotpSetup();
      setTotpSetup(payload);
      setTotpVerifyCode("");
    } catch (err) {
      setMessage(`TOTP setup error: ${String(err)}`);
    } finally {
      setTotpBusy(false);
    }
  };

  const handleConfirmTotpSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!totpSetup) return;
    const clean = totpVerifyCode.replace(/\D/g, "");
    if (clean.length !== 6) {
      setMessage("Enter the 6-digit code from your Authenticator app to confirm.");
      return;
    }
    setTotpBusy(true);
    setMessage(null);
    try {
      await confirmTotpSetup(totpSetup.secretBase32, clean, totpRememberDays);
      setTotpSetup(null);
      setTotpVerifyCode("");
      setMessage(
        "Authenticator (TOTP) enabled! You can now unlock this Vault with a 6-digit code OR Master Password (max 30-day device trust)."
      );
    } catch (err) {
      setMessage(`TOTP verification failed: ${String(err)}`);
    } finally {
      setTotpBusy(false);
    }
  };

  const handleDisableTotp = async () => {
    setTotpBusy(true);
    setMessage(null);
    try {
      await disableTotp();
      setTotpSetup(null);
      setMessage("Authenticator (TOTP) disabled for this Vault.");
    } catch (err) {
      setMessage(`Error disabling TOTP: ${String(err)}`);
    } finally {
      setTotpBusy(false);
    }
  };

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

      {/* Section 0: Software Updates & GitHub Releases */}
      <section className="p-5 rounded-2xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <ArrowUpCircle className="w-4 h-4 text-emerald-400" />
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold">
                  Software Updates & GitHub Releases
                </h3>
                <span className="px-2 py-0.5 rounded-full bg-white/5 border border-[var(--border-subtle)] text-[10px] font-mono text-[var(--text-secondary)]">
                  v{updateInfo?.currentVersion ?? "1.0.0"}
                </span>
                {updateInfo && (
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                      updateInfo.updateAvailable
                        ? "bg-emerald-500/20 text-emerald-300 border border-emerald-400/40"
                        : "bg-white/5 text-[var(--text-muted)]"
                    }`}
                  >
                    {updateInfo.updateAvailable
                      ? `Update v${updateInfo.latestVersion} Available`
                      : "Up to date"}
                  </span>
                )}
              </div>
              <p className="text-xs text-[var(--text-secondary)]">
                Checks <code>github.com/jfmartineau45/skynetssh/releases</code>{" "}
                and verifies SHA-256 checksums before applying updates
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={checkingUpdate || installingUpdate}
              onClick={async () => {
                const info = await checkForUpdates(false);
                if (info && !info.updateAvailable) {
                  setMessage(
                    `SkynetSSH v${info.currentVersion} is already the latest release.`
                  );
                }
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-[var(--border-subtle)] text-xs font-medium text-[var(--text-primary)] transition disabled:opacity-50"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${checkingUpdate ? "animate-spin" : ""}`}
              />
              <span>{checkingUpdate ? "Checking..." : "Check for Updates"}</span>
            </button>

            <button
              type="button"
              onClick={() =>
                void apiOpenExternalUrl(
                  updateInfo?.releaseUrl ||
                    "https://github.com/jfmartineau45/skynetssh/releases"
                )
              }
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-[var(--border-subtle)] text-xs text-[var(--text-secondary)] hover:text-white transition"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>GitHub Releases</span>
            </button>
          </div>
        </div>

        {updateError && (
          <div className="p-2.5 rounded-lg bg-red-950/60 border border-red-500/40 text-xs text-red-200">
            Update check error: {updateError}
          </div>
        )}

        {updateInfo?.updateAvailable && (
          <div className="p-3.5 rounded-xl bg-emerald-950/35 border border-emerald-400/40 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-bold text-emerald-200">
                SkynetSSH v{updateInfo.latestVersion} is ready to install
                {updateInfo.assetSize
                  ? ` (${(updateInfo.assetSize / (1024 * 1024)).toFixed(1)} MB)`
                  : ""}
              </div>
              {updateInfo.downloadUrl ? (
                <button
                  type="button"
                  disabled={installingUpdate}
                  onClick={() => void installAvailableUpdate()}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white shadow transition disabled:opacity-60"
                >
                  <ArrowUpCircle className="w-3.5 h-3.5" />
                  <span>
                    {installingUpdate
                      ? "Downloading & Verifying..."
                      : `Install v${updateInfo.latestVersion} & Restart`}
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void apiOpenExternalUrl(updateInfo.releaseUrl)}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white"
                >
                  Download from GitHub
                </button>
              )}
            </div>
            {updateInfo.releaseNotes && (
              <pre className="max-h-36 overflow-y-auto p-2.5 rounded-lg bg-black/40 text-[11px] text-[var(--text-secondary)] whitespace-pre-wrap font-sans">
                {updateInfo.releaseNotes}
              </pre>
            )}
          </div>
        )}

        <label className="flex items-center justify-between gap-3 pt-1 text-xs text-[var(--text-secondary)] cursor-pointer">
          <span>Automatically check GitHub Releases for updates on startup</span>
          <input
            type="checkbox"
            checked={autoCheckUpdates}
            onChange={(e) => setAutoCheckUpdates(e.target.checked)}
            className="accent-emerald-500"
          />
        </label>
      </section>

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

      {/* Section 1B: Authenticator (TOTP) Quick-Unlock & 30-Day Device Trust */}
      <section className="p-5 rounded-2xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Smartphone className="w-4 h-4 text-emerald-400" />
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold">
                  Authenticator (TOTP) & 30-Day Device Trust
                </h3>
                {status?.totpEnabled ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-[10px] font-bold text-emerald-300">
                    <ShieldCheck className="w-3 h-3" />
                    TOTP ENABLED
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full bg-white/5 text-[10px] font-semibold text-[var(--text-muted)]">
                    PASSWORD ONLY
                  </span>
                )}
              </div>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                Unlock on enrolled PCs with either a <strong>6-digit Authenticator code</strong> or your <strong>Master Password</strong>. Device trust is hard-capped at <strong>30 days max</strong> and wipes after 3 wrong TOTP attempts.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {status?.totpEnabled ? (
              <button
                type="button"
                disabled={totpBusy}
                onClick={handleDisableTotp}
                className="px-3 py-1.5 rounded-lg bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-xs font-semibold text-red-300 transition"
              >
                Disable TOTP
              </button>
            ) : (
              !totpSetup && (
                <button
                  type="button"
                  disabled={totpBusy}
                  onClick={handleStartTotpSetup}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white transition"
                >
                  <Smartphone className="w-3.5 h-3.5" />
                  <span>Enable Authenticator (TOTP)</span>
                </button>
              )
            )}

            {status?.keyringSaved && (
              <button
                type="button"
                onClick={() => void forgetDevice()}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 hover:bg-red-500/20 border border-[var(--border-subtle)] hover:border-red-500/40 text-xs text-[var(--text-secondary)] hover:text-red-300 transition"
                title="Immediately wipe cached Vault key from Windows Credential Manager and lock"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Forget This Device & Lock</span>
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-black/25 border border-[var(--border-subtle)] text-xs text-[var(--text-secondary)]">
          <span>
            Current PC Credential Manager Trust:{" "}
            <strong className="text-white">
              {status?.keyringSaved
                ? status.deviceAutoUnlockValid
                  ? "Auto-Unlock Active"
                  : "Locked (Prompts for TOTP or Master Password)"
                : "Not Cached (Session Only)"}
            </strong>
          </span>
          {status?.deviceLeaseExpiresAt && (
            <span className="font-mono text-[11px] text-[var(--text-muted)]">
              30-day hard expiry:{" "}
              {new Date(status.deviceLeaseExpiresAt).toLocaleString()}
            </span>
          )}
        </div>

        {totpSetup && (
          <form
            onSubmit={handleConfirmTotpSetup}
            className="p-4 rounded-xl bg-black/35 border border-emerald-500/40 flex flex-col md:flex-row items-center gap-5"
          >
            <div className="p-2.5 rounded-xl bg-white shrink-0 shadow-lg">
              <img
                src={`data:image/svg+xml;utf8,${encodeURIComponent(
                  totpSetup.qrSvg
                )}`}
                alt="Scan with Authenticator App"
                className="w-44 h-44 block"
              />
            </div>

            <div className="flex-1 space-y-3 w-full">
              <div>
                <div className="text-xs font-bold text-white">
                  1. Scan QR in Google / Microsoft Authenticator, 1Password, or Bitwarden
                </div>
                <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                  For Team SharePoint Vaults, the TOTP secret is stored AEAD-encrypted inside{" "}
                  <code>auth/totp.enc.json</code> so teammates who unlock once with the Master Password can also use TOTP.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-1.5 rounded-lg bg-black/50 border border-[var(--border-subtle)] text-[11px] font-mono text-emerald-300 select-all break-all">
                  {totpSetup.secretBase32}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(totpSetup.secretBase32);
                    setMessage("Copied Base32 TOTP secret to clipboard.");
                  }}
                  className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-white"
                  title="Copy Base32 Secret"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] text-[var(--text-secondary)] mb-1">
                    2. Enter 6-Digit Code to Confirm
                  </label>
                  <input
                    inputMode="numeric"
                    maxLength={6}
                    value={totpVerifyCode}
                    onChange={(e) =>
                      setTotpVerifyCode(
                        e.target.value.replace(/\D/g, "").slice(0, 6)
                      )
                    }
                    placeholder="000000"
                    className="w-full px-3 py-2 rounded-lg bg-black/50 border border-[var(--border-subtle)] focus:border-emerald-400 text-sm font-mono tracking-[0.35em] text-center text-white focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[var(--text-secondary)] mb-1">
                    Remember This Device For
                  </label>
                  <select
                    value={totpRememberDays}
                    onChange={(e) =>
                      setTotpRememberDays(Number(e.target.value))
                    }
                    className="w-full px-3 py-2 rounded-lg bg-black/50 border border-[var(--border-subtle)] text-xs text-white"
                  >
                    <option value={0}>Session only (ask TOTP every launch)</option>
                    <option value={1}>1 day</option>
                    <option value={7}>7 days</option>
                    <option value={14}>14 days</option>
                    <option value={30}>30 days (Max)</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="submit"
                  disabled={totpBusy}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-xs font-semibold text-white transition"
                >
                  {totpBusy ? "Verifying..." : "Verify & Activate TOTP"}
                </button>
                <button
                  type="button"
                  onClick={() => setTotpSetup(null)}
                  className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-[var(--text-secondary)]"
                >
                  Cancel
                </button>
              </div>
            </div>
          </form>
        )}
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
              Global Bring-to-Front / Quake Toggle Hotkey (Main + Pop-Out Windows)
            </label>
            <div className="flex items-center gap-2">
              <select
                value={
                  HOTKEY_PRESETS.some(
                    (hp) =>
                      hp.value ===
                      (status?.globalHotkey ?? "CommandOrControl+Backquote")
                  )
                    ? status?.globalHotkey ?? "CommandOrControl+Backquote"
                    : "__custom__"
                }
                onChange={async (e) => {
                  if (e.target.value === "__custom__") return;
                  try {
                    await setGlobalHotkey(e.target.value);
                    setMessage(`Global hotkey set to ${e.target.value}`);
                  } catch (err) {
                    setMessage(`Hotkey error: ${String(err)}`);
                  }
                }}
                className="flex-1 px-3 py-2 rounded-lg bg-black/40 border border-[var(--border-subtle)] text-xs text-white"
              >
                {!HOTKEY_PRESETS.some(
                  (hp) =>
                    hp.value ===
                    (status?.globalHotkey ?? "CommandOrControl+Backquote")
                ) &&
                  status?.globalHotkey && (
                    <option value="__custom__">
                      Custom: {status.globalHotkey}
                    </option>
                  )}
                {HOTKEY_PRESETS.map((hp) => (
                  <option key={hp.value} value={hp.value}>
                    {hp.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setRecordingHotkey((v) => !v)}
                className={`px-3 py-2 rounded-lg border text-xs font-semibold shrink-0 transition ${
                  recordingHotkey
                    ? "bg-amber-500/25 border-amber-400 text-amber-200 animate-pulse"
                    : "bg-white/5 hover:bg-white/10 border-[var(--border-subtle)] text-white"
                }`}
                title="Click then press any modifier + key combination (Esc to cancel)"
              >
                {recordingHotkey ? "Press keys..." : "Record Key"}
              </button>
            </div>

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
            <label className="flex items-center justify-between cursor-pointer">
              <span>Show Snippets playbook in Vault & terminal bar</span>
              <input
                type="checkbox"
                checked={showSnippetsSection}
                onChange={(e) => setShowSnippetsSection(e.target.checked)}
                className="accent-[var(--accent-primary)]"
              />
            </label>
            <label className="flex items-center justify-between cursor-pointer">
              <span>
                Inline <code>##</code> snippet trigger (auto-off in nano/vim/tmux)
              </span>
              <input
                type="checkbox"
                checked={inlineHashSnippets}
                onChange={(e) => setInlineHashSnippets(e.target.checked)}
                className="accent-[var(--accent-primary)]"
              />
            </label>
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-red-300 font-medium">
                Cyberdyne Blood Rain Mode
              </span>
              <input
                type="checkbox"
                checked={bloodRain}
                onChange={(e) => setBloodRain(e.target.checked)}
                className="accent-[var(--accent-primary)]"
              />
            </label>
            <label className="flex items-center justify-between cursor-pointer">
              <span>
                15-Minute Idle T-800 / Skynet Patrol Easter Egg
              </span>
              <input
                type="checkbox"
                checked={idleEasterEggEnabled}
                onChange={(e) => setIdleEasterEggEnabled(e.target.checked)}
                className="accent-[var(--accent-primary)]"
              />
            </label>
            <div className="pt-2 border-t border-[var(--border-subtle)] grid grid-cols-2 gap-y-1 text-[11px] text-[var(--text-muted)] font-mono">
              <span>Ctrl+` : Bring to Front</span>
              <span>Ctrl+Shift+O : Pop Out / Dock</span>
              <span>Alt+Shift+P : Pin on Top</span>
              <span>Ctrl+Shift+P : Command</span>
              <span>Ctrl+Shift+T : New Shell</span>
              <span>Ctrl+Shift+N : New Host</span>
              <span>Alt+Shift+D : Split Right</span>
              <span>Alt+Shift+E : Split Down</span>
              <span>Ctrl+Tab : Cycle Tabs</span>
              <span>Ctrl+Alt+1..9 : Jump Tab</span>
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
