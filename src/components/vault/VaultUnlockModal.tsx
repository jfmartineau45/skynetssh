import React, { useState } from "react";
import { Shield, KeyRound, Lock, Eye, EyeOff } from "lucide-react";
import { useVaultStore } from "../../store/useVaultStore";

export const VaultUnlockModal: React.FC = () => {
  const { status, initVault, unlockVault } = useVaultStore();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saveToKeyring, setSaveToKeyring] = useState(true);
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!status || status.unlocked) return null;

  const isSetup = !status.initialized;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
        await initVault(password, saveToKeyring);
      } else {
        await unlockVault(password, saveToKeyring);
      }
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
        <div className="flex items-center gap-3.5 mb-5">
          <div className="w-11 h-11 rounded-xl bg-[var(--accent-glow)] border border-[var(--border-accent)] flex items-center justify-center text-[var(--accent-primary)]">
            {isSetup ? (
              <Shield className="w-6 h-6" />
            ) : (
              <Lock className="w-6 h-6" />
            )}
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--accent-primary)]">
              CYBERDYNE VAULT ENCRYPTION
            </div>
            <h2 className="text-base font-bold text-[var(--text-primary)]">
              {isSetup
                ? "Initialize Encrypted Host Vault"
                : "Unlock SkynetSSH Vault"}
            </h2>
          </div>
        </div>

        <p className="text-xs text-[var(--text-secondary)] leading-relaxed mb-4">
          {isSetup
            ? "Your hosts, SSH keys, passphrases, tunnels, and snippets are encrypted locally with Argon2id + XChaCha20-Poly1305 so you can sync safely over Git, Dropbox, or Syncthing for $0/mo."
            : "Enter your Master Password to decrypt your saved hosts and SSH keys."}
        </p>

        {error && (
          <div className="mb-4 p-2.5 rounded-lg bg-red-950/70 border border-red-500/40 text-xs text-red-200">
            {error}
          </div>
        )}

        <div className="space-y-3 mb-4">
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
                placeholder="Enter strong master password..."
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

          {status.keyringAvailable && (
            <label className="flex items-center gap-2.5 pt-1 cursor-pointer text-xs text-[var(--text-secondary)]">
              <input
                type="checkbox"
                checked={saveToKeyring}
                onChange={(e) => setSaveToKeyring(e.target.checked)}
                className="rounded accent-[var(--accent-primary)]"
              />
              <span>
                Remember vault key in Windows Credential Manager (instant unlock
                on launch)
              </span>
            </label>
          )}
        </div>

        <button
          type="submit"
          disabled={busy}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] disabled:opacity-50 text-xs font-semibold text-white transition shadow-lg"
        >
          <KeyRound className="w-4 h-4" />
          <span>
            {busy
              ? "Deriving Argon2id Key..."
              : isSetup
              ? "Create Encrypted Vault"
              : "Unlock Vault"}
          </span>
        </button>

        <div className="mt-3 text-[10px] text-[var(--text-muted)] font-mono truncate">
          Vault Path: {status.vaultPath}
        </div>
      </form>
    </div>
  );
};
