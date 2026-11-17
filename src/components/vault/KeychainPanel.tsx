import React, { useState } from "react";
import {
  KeyRound,
  Sparkles,
  Upload,
  Copy,
  Check,
  Trash2,
  Plus,
  Radar,
  Lock,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useVaultStore } from "../../store/useVaultStore";
import type { DiscoveredSshKey } from "../../types/models";

export const KeychainPanel: React.FC = () => {
  const {
    keys,
    sshScan,
    generateKey,
    importKeyFile,
    importKeyPem,
    deleteKey,
    refreshSshScan,
  } = useVaultStore();

  const [encryptedImportTarget, setEncryptedImportTarget] =
    useState<DiscoveredSshKey | null>(null);
  const [encryptedPassphrase, setEncryptedPassphrase] = useState("");

  const [genOpen, setGenOpen] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [algo, setAlgo] = useState<"ed25519" | "rsa">("ed25519");
  const [passphrase, setPassphrase] = useState("");

  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteName, setPasteName] = useState("");
  const [pastePem, setPastePem] = useState("");
  const [pastePassphrase, setPastePassphrase] = useState("");

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await generateKey(keyName.trim(), algo, passphrase || null);
      setKeyName("");
      setPassphrase("");
      setGenOpen(false);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleImportDisk = async () => {
    const selected = await open({ multiple: false, directory: false });
    if (!selected || Array.isArray(selected)) return;
    const baseName = selected.split(/[/\\]/).pop() || "Imported SSH Key";
    setBusy(true);
    setError(null);
    try {
      await importKeyFile(baseName, selected, null);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const handlePasteSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pasteName.trim() || !pastePem.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await importKeyPem(
        pasteName.trim(),
        pastePem.trim(),
        pastePassphrase || null
      );
      setPasteName("");
      setPastePem("");
      setPastePassphrase("");
      setPasteOpen(false);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const copyPub = (id: string, pub: string) => {
    navigator.clipboard.writeText(pub);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const unimportedLocalKeys = (sshScan?.keys ?? []).filter(
    (k) => !k.alreadyInVault
  );

  const handleImportDiscoveredKey = async (
    dk: DiscoveredSshKey,
    pw?: string | null
  ) => {
    if (dk.encrypted && pw === undefined) {
      setEncryptedPassphrase("");
      setEncryptedImportTarget(dk);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await importKeyFile(dk.name, dk.path, pw || null);
      setEncryptedImportTarget(null);
      await refreshSshScan();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex-1 h-full flex flex-col min-h-0 overflow-hidden">
      <div className="px-6 py-4 border-b border-[var(--border-subtle)] bg-[var(--bg-panel)] flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-[var(--text-primary)]">
            SSH Keychain ({keys.length})
          </h2>
          <p className="text-xs text-[var(--text-secondary)]">
            Private keys & passphrases are encrypted with XChaCha20-Poly1305 inside your Vault
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleImportDisk}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-[var(--border-subtle)] text-xs text-white transition"
          >
            <Upload className="w-3.5 h-3.5 text-sky-400" />
            <span>Import File</span>
          </button>
          <button
            onClick={() => setPasteOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-[var(--border-subtle)] text-xs text-white transition"
          >
            <Plus className="w-3.5 h-3.5 text-emerald-400" />
            <span>Paste PEM</span>
          </button>
          <button
            onClick={() => setGenOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-xs font-semibold text-white shadow transition"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Generate Key</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-6 mt-4 p-3 rounded-lg bg-red-950/70 border border-red-500/40 text-xs text-red-200">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Auto-Sniffed ~/.ssh Keys Banner */}
        {unimportedLocalKeys.length > 0 && (
          <section className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/35 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold text-amber-300">
                <Radar className="w-4 h-4" />
                <span>
                  Detected {unimportedLocalKeys.length} SSH Key(s) in{" "}
                  <code className="font-mono">{sshScan?.sshDir}</code>
                </span>
              </div>
              <button
                onClick={() => refreshSshScan()}
                className="text-[11px] text-amber-200/80 hover:text-white"
              >
                Rescan ~/.ssh
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {unimportedLocalKeys.map((dk) => (
                <div
                  key={dk.path}
                  className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-black/40 border border-[var(--border-subtle)]"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-white">
                      <span className="truncate">{dk.name}</span>
                      {dk.encrypted && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded bg-amber-500/20 text-[9px] text-amber-300">
                          <Lock className="w-2.5 h-2.5" /> Passphrase
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] font-mono text-[var(--text-muted)] truncate">
                      {dk.fingerprint ?? dk.path}
                    </div>
                  </div>
                  <button
                    disabled={busy}
                    onClick={() => handleImportDiscoveredKey(dk)}
                    className="px-2.5 py-1 rounded-md bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-[11px] font-semibold text-white shrink-0 transition"
                  >
                    Import to Vault
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {keys.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-panel)]/50 p-12 text-center">
            <KeyRound className="w-9 h-9 text-amber-400 mx-auto mb-3 opacity-80" />
            <h3 className="text-sm font-semibold mb-1">Keychain is Empty</h3>
            <p className="text-xs text-[var(--text-secondary)] max-w-md mx-auto">
              Generate an Ed25519 key pair in one click or import your existing{" "}
              <code className="text-white">~/.ssh/id_ed25519</code> key.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
            {keys.map((k) => (
              <div
                key={k.id}
                className="p-4 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] hover:border-[var(--border-accent)] flex flex-col justify-between transition"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="p-2 rounded-lg bg-amber-500/15 text-amber-400">
                        <KeyRound className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-[var(--text-primary)] truncate">
                          {k.name}
                        </div>
                        <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                          {k.algorithm}
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => deleteKey(k.id)}
                      className="p-1.5 rounded hover:bg-red-500/20 text-[var(--text-muted)] hover:text-red-400 transition"
                      title="Delete Key"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="text-[11px] font-mono text-[var(--text-secondary)] bg-black/35 p-2 rounded break-all mb-3">
                    {k.fingerprint}
                  </div>
                </div>

                {k.publicKey && (
                  <button
                    onClick={() => copyPub(k.id, k.publicKey)}
                    className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-[var(--text-primary)] transition"
                  >
                    {copiedId === k.id ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Copied Public Key!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy Public Key (authorized_keys)</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Generate Key Modal */}
      {genOpen && (
        <div className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center p-4">
          <form
            onSubmit={handleGenerate}
            className="w-full max-w-md rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-accent)] p-5 space-y-3"
          >
            <h3 className="text-sm font-bold">Generate New SSH Key Pair</h3>
            <div>
              <label className="block text-xs text-[var(--text-secondary)] mb-1">
                Key Label *
              </label>
              <input
                autoFocus
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
                placeholder="e.g. Production Ed25519"
                className="w-full px-3 py-2 rounded-lg bg-black/40 border border-[var(--border-subtle)] text-xs"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-secondary)] mb-1">
                Algorithm
              </label>
              <select
                value={algo}
                onChange={(e) => setAlgo(e.target.value as "ed25519" | "rsa")}
                className="w-full px-3 py-2 rounded-lg bg-black/40 border border-[var(--border-subtle)] text-xs"
              >
                <option value="ed25519">Ed25519 (Recommended — Fast & Modern)</option>
                <option value="rsa">RSA 4096-bit (Legacy Compatibility)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-secondary)] mb-1">
                Optional Key Passphrase
              </label>
              <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Leave blank for unencrypted PEM inside encrypted Vault"
                className="w-full px-3 py-2 rounded-lg bg-black/40 border border-[var(--border-subtle)] text-xs"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setGenOpen(false)}
                className="px-3 py-1.5 rounded-lg text-xs bg-white/5"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-[var(--accent-primary)] text-white"
              >
                {busy ? "Generating..." : "Generate"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Paste PEM Modal */}
      {pasteOpen && (
        <div className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center p-4">
          <form
            onSubmit={handlePasteSave}
            className="w-full max-w-lg rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-accent)] p-5 space-y-3"
          >
            <h3 className="text-sm font-bold">Paste Private Key (OpenSSH / PEM)</h3>
            <input
              autoFocus
              value={pasteName}
              onChange={(e) => setPasteName(e.target.value)}
              placeholder="Key name (e.g. AWS Bastion)"
              className="w-full px-3 py-2 rounded-lg bg-black/40 border border-[var(--border-subtle)] text-xs"
            />
            <textarea
              rows={7}
              value={pastePem}
              onChange={(e) => setPastePem(e.target.value)}
              placeholder="-----BEGIN OPENSSH PRIVATE KEY-----..."
              className="w-full p-3 rounded-lg bg-black/40 border border-[var(--border-subtle)] text-xs font-mono"
            />
            <input
              type="password"
              value={pastePassphrase}
              onChange={(e) => setPastePassphrase(e.target.value)}
              placeholder="Passphrase (if key is encrypted)"
              className="w-full px-3 py-2 rounded-lg bg-black/40 border border-[var(--border-subtle)] text-xs"
            />
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPasteOpen(false)}
                className="px-3 py-1.5 rounded-lg text-xs bg-white/5"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-[var(--accent-primary)] text-white"
              >
                Save to Vault
              </button>
            </div>
          </form>
        </div>
      )}
      {/* Encrypted ~/.ssh Key Passphrase Prompt */}
      {encryptedImportTarget && (
        <div className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleImportDiscoveredKey(
                encryptedImportTarget,
                encryptedPassphrase
              );
            }}
            className="w-full max-w-sm rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-accent)] p-5 space-y-3"
          >
            <h3 className="text-sm font-bold">
              Unlock Key: {encryptedImportTarget.name}
            </h3>
            <p className="text-xs text-[var(--text-secondary)]">
              Enter the key passphrase once so SkynetSSH can verify and store it
              encrypted inside your Vault.
            </p>
            <input
              autoFocus
              type="password"
              value={encryptedPassphrase}
              onChange={(e) => setEncryptedPassphrase(e.target.value)}
              placeholder="Key passphrase..."
              className="w-full px-3 py-2 rounded-lg bg-black/40 border border-[var(--border-subtle)] text-xs"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEncryptedImportTarget(null)}
                className="px-3 py-1.5 rounded-lg text-xs bg-white/5"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-[var(--accent-primary)] text-white"
              >
                Unlock & Import
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
