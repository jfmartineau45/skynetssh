import React, { useState } from "react";
import {
  Shield,
  KeyRound,
  Lock,
  Eye,
  EyeOff,
  Users,
  User,
  Smartphone,
  Clock,
  Trash2,
} from "lucide-react";
import { useVaultStore } from "../../store/useVaultStore";

const REMEMBER_OPTIONS = [
  { days: 0, label: "Session only (ask every launch)" },
  { days: 1, label: "1 day" },
  { days: 7, label: "7 days (Recommended)" },
  { days: 14, label: "14 days" },
  { days: 30, label: "30 days (Maximum)" },
];

export const VaultUnlockModal: React.FC = () => {
  const {
    status,
    initVault,
    unlockVault,
    unlockWithTotp,
    forgetDevice,
    switchVaultProfile,
  } = useVaultStore();

  const [mode, setMode] = useState<"totp" | "password">("totp");
  const [totpCode, setTotpCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [rememberDays, setRememberDays] = useState<number>(7);
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!status || status.unlocked) return null;

  const isSetup = !status.initialized;
  const activeProf = status.activeProfile;
  const isTeam = activeProf?.kind === "team";
  const canUseTotp = !isSetup && status.totpAvailableOnDevice;
  const effectiveMode: "totp" | "password" = canUseTotp ? mode : "password";

  const leaseExpiryText = status.deviceLeaseExpiresAt
    ? new Date(status.deviceLeaseExpiresAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  const submitTotpCode = async (rawCode: string) => {
    const clean = rawCode.replace(/\D/g, "");
    if (clean.length !== 6) {
      setError("Enter the 6-digit code from your Authenticator app.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await unlockWithTotp(clean, rememberDays);
      setTotpCode("");
    } catch (err) {
      setTotpCode("");
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (effectiveMode === "totp") {
      await submitTotpCode(totpCode);
      return;
    }

    setError(null);
    if (password.length < 6) {
      setError("Master password must be at least 6 characters.");
      return;
    }
    if (isSetup && password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      if (isSetup) {
        await initVault(password, rememberDays);
      } else {
        await unlockVault(password, rememberDays);
      }
      setPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 cyberdyne-grid">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border-accent)] shadow-2xl p-6"
      >
        <div className="flex items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-3.5">
            <div
              className={`w-11 h-11 rounded-xl flex items-center justify-center border ${
                isTeam
                  ? "bg-sky-500/20 border-sky-400/50 text-sky-300"
                  : "bg-[var(--accent-glow)] border-[var(--border-accent)] text-[var(--accent-primary)]"
              }`}
            >
              {isSetup ? (
                <Shield className="w-6 h-6" />
              ) : isTeam ? (
                <Users className="w-6 h-6" />
              ) : (
                <Lock className="w-6 h-6" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span
                  className={`text-[10px] font-bold uppercase tracking-[0.18em] ${
                    isTeam ? "text-sky-300" : "text-[var(--accent-primary)]"
                  }`}
                >
                  {isTeam ? "TEAM VAULT" : "PERSONAL VAULT"}
                </span>
              </div>
              <h2 className="text-base font-bold text-[var(--text-primary)]">
                {isSetup
                  ? `Initialize ${activeProf?.name ?? "Vault"}`
                  : `Unlock ${activeProf?.name ?? "Vault"}`}
              </h2>
            </div>
          </div>

          {status.profiles.length > 1 && (
            <select
              value={activeProf.id}
              onChange={(e) => {
                setError(null);
                setTotpCode("");
                setPassword("");
                switchVaultProfile(e.target.value);
              }}
              className="px-2 py-1 rounded-lg bg-black/40 border border-[var(--border-subtle)] text-[11px] text-[var(--text-primary)]"
              title="Switch Vault Profile"
            >
              {status.profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.kind === "team" ? "👥 " : "👤 "}
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Choice Switcher: TOTP vs Master Password */}
        {canUseTotp && (
          <div className="grid grid-cols-2 gap-1.5 p-1 mb-4 rounded-xl bg-black/45 border border-[var(--border-subtle)]">
            <button
              type="button"
              onClick={() => {
                setError(null);
                setMode("totp");
              }}
              className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition ${
                effectiveMode === "totp"
                  ? "bg-[var(--accent-primary)] text-white shadow"
                  : "text-[var(--text-secondary)] hover:text-white"
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span>6-Digit TOTP</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setMode("password");
              }}
              className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition ${
                effectiveMode === "password"
                  ? "bg-[var(--accent-primary)] text-white shadow"
                  : "text-[var(--text-secondary)] hover:text-white"
              }`}
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>Master Password</span>
            </button>
          </div>
        )}

        {!isSetup && status.totpEnabled && !status.totpAvailableOnDevice && (
          <div className="mb-3.5 p-2.5 rounded-lg bg-sky-950/50 border border-sky-500/30 text-[11px] text-sky-200 leading-relaxed">
            Authenticator (TOTP) is enabled on this Vault. Unlock once with your{" "}
            <strong>Master Password</strong> to enroll this device for 6-digit
            TOTP unlock (up to 30 days).
          </div>
        )}

        <p className="text-xs text-[var(--text-secondary)] leading-relaxed mb-4">
          {isSetup
            ? isTeam
              ? "Set the shared Team Master Password for this SharePoint / OneDrive folder. Every teammate with folder access and this password can sync conflict-free."
              : "Your hosts, SSH keys, passphrases, tunnels, and snippets are encrypted locally with Argon2id + XChaCha20-Poly1305."
            : effectiveMode === "totp"
            ? "Enter the 6-digit Authenticator code to unlock this enrolled device, or switch to Master Password above."
            : "Enter the Master Password to decrypt this Vault (renews your max 30-day device trust ceiling)."}
        </p>

        {error && (
          <div className="mb-4 p-2.5 rounded-lg bg-red-950/70 border border-red-500/40 text-xs text-red-200">
            {error}
          </div>
        )}

        <div className="space-y-3 mb-4">
          {effectiveMode === "totp" ? (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-[var(--text-secondary)]">
                  Authenticator 6-Digit Code
                </label>
                <span className="text-[10px] text-[var(--text-muted)]">
                  {status.totpRemainingAttempts}/3 attempts left
                </span>
              </div>
              <input
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={totpCode}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
                  setTotpCode(digits);
                  if (digits.length === 6 && !busy) {
                    void submitTotpCode(digits);
                  }
                }}
                placeholder="000000"
                className="w-full px-3 py-2.5 rounded-lg bg-black/50 border border-[var(--border-subtle)] focus:border-[var(--border-accent)] text-center text-lg font-mono tracking-[0.45em] text-white focus:outline-none"
              />
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                  Master Password
                </label>
                <div className="relative">
                  <input
                    autoFocus
                    type={showPw ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter master password..."
                    className="w-full pl-3 pr-9 py-2 rounded-lg bg-black/40 border border-[var(--border-subtle)] focus:border-[var(--border-accent)] text-xs text-white focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    className="absolute right-2.5 top-2 text-[var(--text-muted)] hover:text-white"
                  >
                    {showPw ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {isSetup && (
                <div>
                  <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                    Confirm Master Password
                  </label>
                  <input
                    type={showPw ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repeat master password..."
                    className="w-full px-3 py-2 rounded-lg bg-black/40 border border-[var(--border-subtle)] focus:border-[var(--border-accent)] text-xs text-white focus:outline-none"
                  />
                </div>
              )}
            </>
          )}

          {status.keyringAvailable && (
            <div className="pt-1">
              <label className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)] mb-1">
                <Clock className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                <span>Remember this device for (max 30 days)</span>
              </label>
              <select
                value={rememberDays}
                onChange={(e) => setRememberDays(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg bg-black/40 border border-[var(--border-subtle)] text-xs text-white focus:outline-none focus:border-[var(--border-accent)]"
              >
                {REMEMBER_OPTIONS.map((opt) => (
                  <option key={opt.days} value={opt.days}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={busy}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] disabled:opacity-50 text-xs font-semibold text-white transition shadow-lg"
        >
          {isTeam ? <Users className="w-4 h-4" /> : <User className="w-4 h-4" />}
          {effectiveMode === "totp" ? (
            <Smartphone className="w-3.5 h-3.5" />
          ) : (
            <KeyRound className="w-3.5 h-3.5" />
          )}
          <span>
            {busy
              ? effectiveMode === "totp"
                ? "Verifying 6-Digit TOTP..."
                : "Deriving Argon2id Key..."
              : isSetup
              ? `Create ${isTeam ? "Team" : "Personal"} Vault`
              : effectiveMode === "totp"
              ? `Unlock with TOTP`
              : `Unlock ${activeProf?.name ?? "Vault"}`}
          </span>
        </button>

        <div className="mt-3 flex items-center justify-between gap-2 text-[10px] text-[var(--text-muted)]">
          <span className="font-mono truncate">
            {leaseExpiryText
              ? `30d ceiling: ${leaseExpiryText}`
              : status.vaultPath}
          </span>
          {status.keyringSaved && (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setTotpCode("");
                void forgetDevice();
              }}
              className="flex items-center gap-1 text-red-300/80 hover:text-red-300 shrink-0"
              title="Wipe Windows Credential Manager cache on this PC immediately"
            >
              <Trash2 className="w-3 h-3" />
              <span>Forget this device</span>
            </button>
          )}
        </div>
      </form>
    </div>
  );
};
