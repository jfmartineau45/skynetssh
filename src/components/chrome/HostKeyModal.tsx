import React from "react";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { useVaultStore } from "../../store/useVaultStore";
import { apiRespondHostKeyPrompt } from "../../lib/ipc";

export const HostKeyModal: React.FC = () => {
  const { pendingHostKeyPrompts, dequeueHostKeyPrompt, reloadSnapshot } =
    useVaultStore();

  const current = pendingHostKeyPrompts[0];
  if (!current) return null;

  const isChanged = current.status === "changed";

  const respond = async (accept: boolean) => {
    dequeueHostKeyPrompt(current.requestId);
    await apiRespondHostKeyPrompt(current.requestId, accept);
    if (accept) {
      await reloadSnapshot();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-accent)] shadow-2xl p-5">
        <div className="flex items-center gap-3 mb-3">
          {isChanged ? (
            <div className="p-2.5 rounded-lg bg-red-500/20 border border-red-500/50 text-red-400">
              <ShieldAlert className="w-6 h-6" />
            </div>
          ) : (
            <div className="p-2.5 rounded-lg bg-amber-500/20 border border-amber-500/50 text-amber-400">
              <ShieldCheck className="w-6 h-6" />
            </div>
          )}
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              {isChanged
                ? "REMOTE HOST IDENTIFICATION HAS CHANGED!"
                : "Verify New SSH Host Fingerprint"}
            </h3>
            <p className="text-xs text-[var(--text-secondary)]">
              {current.hostPort}
            </p>
          </div>
        </div>

        {isChanged && (
          <div className="mb-3 p-3 rounded-lg bg-red-950/60 border border-red-500/40 text-xs text-red-200 leading-relaxed">
            <strong>Warning:</strong> Someone could be eavesdropping on you
            right now (man-in-the-middle attack), or the host OS was reinstalled.
            Previous fingerprint:{" "}
            <code className="font-mono text-[11px] break-all">
              {current.previousFingerprint}
            </code>
          </div>
        )}

        <div className="space-y-2 p-3 rounded-lg bg-black/35 border border-[var(--border-subtle)] text-xs mb-4">
          <div className="flex justify-between">
            <span className="text-[var(--text-muted)]">Algorithm:</span>
            <span className="font-mono text-[var(--text-primary)]">
              {current.keyType}
            </span>
          </div>
          <div>
            <div className="text-[var(--text-muted)] mb-1">
              SHA-256 Fingerprint:
            </div>
            <div className="font-mono text-[11px] text-emerald-400 break-all bg-black/40 p-2 rounded">
              {current.fingerprintSha256}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => respond(false)}
            className="px-3.5 py-2 rounded-lg text-xs font-medium bg-white/5 hover:bg-white/10 text-[var(--text-secondary)] transition"
          >
            Abort Connection
          </button>
          <button
            onClick={() => respond(true)}
            className="px-4 py-2 rounded-lg text-xs font-semibold bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-white transition"
          >
            {isChanged ? "Trust New Key & Update Vault" : "Trust & Save Host"}
          </button>
        </div>
      </div>
    </div>
  );
};
