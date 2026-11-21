import React, { useEffect, useState } from "react";
import {
  ArrowLeftRight,
  Plus,
  Play,
  Square,
  Trash2,
} from "lucide-react";
import type { TunnelType } from "../../types/models";
import { useVaultStore } from "../../store/useVaultStore";
import { apiTunnelStart, apiTunnelStop } from "../../lib/ipc";

export const TunnelsPanel: React.FC = () => {
  const {
    tunnels,
    hosts,
    activeTunnels,
    saveTunnel,
    deleteTunnel,
    refreshTunnels,
  } = useVaultStore();

  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [hostId, setHostId] = useState("");
  const [tunnelType, setTunnelType] = useState<TunnelType>("local");
  const [bindAddress, setBindAddress] = useState("127.0.0.1");
  const [bindPort, setBindPort] = useState(8080);
  const [targetHost, setTargetHost] = useState("127.0.0.1");
  const [targetPort, setTargetPort] = useState(5432);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    refreshTunnels();
    const timer = setInterval(refreshTunnels, 2500);
    return () => clearInterval(timer);
  }, [refreshTunnels]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !hostId) return;
    await saveTunnel({
      id: crypto.randomUUID(),
      name: name.trim(),
      hostId,
      tunnelType,
      bindAddress: bindAddress.trim() || "127.0.0.1",
      bindPort: Number(bindPort),
      targetHost: tunnelType === "dynamic" ? null : targetHost.trim(),
      targetPort: tunnelType === "dynamic" ? null : Number(targetPort),
      autoStart: false,
      updatedAt: Date.now(),
    });
    setModalOpen(false);
    setName("");
  };

  const toggleTunnel = async (id: string, isRunning: boolean) => {
    setError(null);
    try {
      if (isRunning) await apiTunnelStop(id);
      else await apiTunnelStart(id);
      await refreshTunnels();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="flex-1 h-full flex flex-col min-h-0 overflow-hidden">
      <div className="px-6 py-4 border-b border-[var(--border-subtle)] bg-[var(--bg-panel)] flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-[var(--text-primary)]">
            Port Forwarding & SOCKS5 Tunnels ({tunnels.length})
          </h2>
          <p className="text-xs text-[var(--text-secondary)]">
            Run Local (-L), Remote (-R), and Dynamic SOCKS5 (-D) tunnels independently in the background
          </p>
        </div>

        <button
          onClick={() => {
            setHostId(hosts[0]?.id ?? "");
            setModalOpen(true);
          }}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-xs font-semibold text-white transition"
        >
          <Plus className="w-4 h-4" />
          <span>New Tunnel Rule</span>
        </button>
      </div>

      {error && (
        <div className="mx-6 mt-4 p-3 rounded-lg bg-red-950/70 border border-red-500/40 text-xs text-red-200">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-6">
        {tunnels.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-panel)]/50 p-12 text-center">
            <ArrowLeftRight className="w-9 h-9 text-cyan-400 mx-auto mb-3 opacity-80" />
            <h3 className="text-sm font-semibold mb-1">No Port Forwarding Rules</h3>
            <p className="text-xs text-[var(--text-secondary)] max-w-md mx-auto">
              Forward remote databases (Postgres, Redis, Grafana) to localhost or spin up a Dynamic SOCKS5 proxy over any SSH host.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
            {tunnels.map((t) => {
              const host = hosts.find((h) => h.id === t.hostId);
              const rt = activeTunnels[t.id];
              const running = rt?.status === "running";

              return (
                <div
                  key={t.id}
                  className={`p-4 rounded-xl bg-[var(--bg-panel)] border transition ${
                    running
                      ? "border-emerald-500/60 shadow-[0_0_15px_rgba(16,185,129,0.12)]"
                      : "border-[var(--border-subtle)]"
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            running ? "bg-emerald-400 animate-pulse" : "bg-zinc-600"
                          }`}
                        />
                        <span className="text-xs font-bold">{t.name}</span>
                        <span className="px-1.5 py-0.5 rounded bg-cyan-500/15 text-[10px] font-mono uppercase text-cyan-300">
                          {t.tunnelType}
                        </span>
                      </div>
                      <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                        via {host?.label ?? "Unknown Host"}
                      </div>
                    </div>

                    <button
                      onClick={() => deleteTunnel(t.id)}
                      className="p-1.5 rounded hover:bg-red-500/20 text-[var(--text-muted)] hover:text-red-400"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="p-2.5 rounded-lg bg-black/35 font-mono text-[11px] text-[var(--text-primary)] mb-3">
                    {t.tunnelType === "dynamic" ? (
                      <span>
                        SOCKS5 {t.bindAddress}:{t.bindPort} &rarr; Dynamic
                      </span>
                    ) : (
                      <span>
                        {t.bindAddress}:{t.bindPort} &rarr; {t.targetHost}:
                        {t.targetPort}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-mono text-[var(--text-muted)]">
                      {running
                        ? `Active Conns: ${rt.activeConnections}`
                        : "Stopped"}
                    </span>

                    <button
                      onClick={() => toggleTunnel(t.id, running)}
                      className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition ${
                        running
                          ? "bg-red-500/20 text-red-300 hover:bg-red-500/30"
                          : "bg-emerald-600 hover:bg-emerald-500 text-white"
                      }`}
                    >
                      {running ? (
                        <>
                          <Square className="w-3 h-3" />
                          <span>Stop</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3 h-3" />
                          <span>Start</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center p-4">
          <form
            onSubmit={handleSave}
            className="w-full max-w-md rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-accent)] p-5 space-y-3"
          >
            <h3 className="text-sm font-bold">New Port Forwarding Rule</h3>
            <div>
              <label className="block text-xs text-[var(--text-secondary)] mb-1">
                Rule Name *
              </label>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Prod Postgres 5432"
                className="w-full px-3 py-2 rounded-lg bg-black/40 border border-[var(--border-subtle)] text-xs"
              />
            </div>

            <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-black/40 border border-[var(--border-subtle)]">
              {(
                [
                  { id: "local", label: "Local (-L)" },
                  { id: "dynamic", label: "SOCKS5 (-D)" },
                  { id: "remote", label: "Remote (-R)" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setTunnelType(opt.id)}
                  className={`py-1.5 rounded text-xs font-medium ${
                    tunnelType === opt.id
                      ? "bg-[var(--accent-primary)] text-white"
                      : "text-[var(--text-secondary)]"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div>
              <label className="block text-xs text-[var(--text-secondary)] mb-1">
                SSH Host *
              </label>
              <select
                value={hostId}
                onChange={(e) => setHostId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-black/40 border border-[var(--border-subtle)] text-xs"
              >
                <option value="">-- Select Host --</option>
                {hosts
                  .filter((h) => h.protocol !== "rdp")
                  .map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.label} ({h.username}@{h.address})
                    </option>
                  ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-[var(--text-secondary)] mb-1">
                  Bind Address
                </label>
                <input
                  value={bindAddress}
                  onChange={(e) => setBindAddress(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-black/40 border border-[var(--border-subtle)] text-xs font-mono"
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-secondary)] mb-1">
                  Bind Port
                </label>
                <input
                  type="number"
                  value={bindPort}
                  onChange={(e) => setBindPort(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-black/40 border border-[var(--border-subtle)] text-xs font-mono"
                />
              </div>
            </div>

            {tunnelType !== "dynamic" && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-[var(--text-secondary)] mb-1">
                    Target Host
                  </label>
                  <input
                    value={targetHost}
                    onChange={(e) => setTargetHost(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-black/40 border border-[var(--border-subtle)] text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[var(--text-secondary)] mb-1">
                    Target Port
                  </label>
                  <input
                    type="number"
                    value={targetPort}
                    onChange={(e) => setTargetPort(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg bg-black/40 border border-[var(--border-subtle)] text-xs font-mono"
                  />
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="px-3 py-1.5 rounded-lg text-xs bg-white/5"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-[var(--accent-primary)] text-white"
              >
                Save Rule
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
