import React from "react";
import { ShieldCheck, Trash2 } from "lucide-react";
import { useVaultStore } from "../../store/useVaultStore";

export const KnownHostsPanel: React.FC = () => {
  const { knownHosts, deleteKnownHost } = useVaultStore();

  return (
    <div className="flex-1 h-full flex flex-col min-h-0 overflow-hidden">
      <div className="px-6 py-4 border-b border-[var(--border-subtle)] bg-[var(--bg-panel)]">
        <h2 className="text-sm font-bold text-[var(--text-primary)]">
          Verified Known Hosts ({knownHosts.length})
        </h2>
        <p className="text-xs text-[var(--text-secondary)]">
          Cryptographic SHA-256 server fingerprints trusted inside your encrypted Vault
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {knownHosts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-panel)]/50 p-12 text-center">
            <ShieldCheck className="w-9 h-9 text-emerald-400 mx-auto mb-3 opacity-80" />
            <h3 className="text-sm font-semibold mb-1">No Known Hosts Recorded Yet</h3>
            <p className="text-xs text-[var(--text-secondary)] max-w-md mx-auto">
              When you connect to an SSH server for the first time, SkynetSSH prompts you to verify and store its SHA-256 fingerprint here.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {knownHosts.map((kh) => (
              <div
                key={kh.id}
                className="p-3.5 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] flex items-center justify-between gap-4"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-[var(--text-primary)]">
                      {kh.hostPort}
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-white/5 text-[10px] font-mono text-[var(--text-secondary)]">
                      {kh.keyType}
                    </span>
                  </div>
                  <div className="text-[11px] font-mono text-emerald-400 truncate mt-1">
                    {kh.fingerprintSha256}
                  </div>
                </div>

                <button
                  onClick={() => deleteKnownHost(kh.id)}
                  className="p-2 rounded-lg hover:bg-red-500/20 text-[var(--text-muted)] hover:text-red-400 transition shrink-0"
                  title="Revoke trusted fingerprint"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
