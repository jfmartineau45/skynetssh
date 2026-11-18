import React from "react";
import {
  Server,
  KeyRound,
  ArrowLeftRight,
  FileCode2,
  ShieldCheck,
  RefreshCw,
} from "lucide-react";
import { useVaultStore, type VaultSection } from "../../store/useVaultStore";
import { useWorkspaceStore } from "../../store/useWorkspaceStore";
import { HostsPanel } from "./HostsPanel";
import { KeychainPanel } from "./KeychainPanel";
import { TunnelsPanel } from "./TunnelsPanel";
import { SnippetsPanel } from "./SnippetsPanel";
import { KnownHostsPanel } from "./KnownHostsPanel";
import { SyncSettingsPanel } from "./SyncSettingsPanel";

export const VaultDashboard: React.FC = () => {
  const {
    status,
    activeSection,
    setActiveSection,
    hosts,
    keys,
    tunnels,
    snippets,
    knownHosts,
    activeTunnels,
  } = useVaultStore();

  const { showSnippetsSection } = useWorkspaceStore();
  const isTeam = status?.activeProfile?.kind === "team";

  const runningTunnelCount = Object.values(activeTunnels).filter(
    (t) => t.status === "running"
  ).length;

  const navItems: {
    id: VaultSection;
    label: string;
    icon: React.ReactNode;
    badge?: string | number;
  }[] = [
    {
      id: "hosts",
      label: "Hosts",
      icon: <Server className="w-4 h-4" />,
      badge: hosts.length,
    },
    {
      id: "keychain",
      label: "Keychain",
      icon: <KeyRound className="w-4 h-4" />,
      badge: keys.length,
    },
    {
      id: "tunnels",
      label: "Port Forwarding",
      icon: <ArrowLeftRight className="w-4 h-4" />,
      badge:
        runningTunnelCount > 0
          ? `${runningTunnelCount}/${tunnels.length}`
          : tunnels.length,
    },
    ...(showSnippetsSection
      ? [
          {
            id: "snippets" as VaultSection,
            label: "Snippets",
            icon: <FileCode2 className="w-4 h-4" />,
            badge: snippets.length,
          },
        ]
      : []),
    {
      id: "known_hosts",
      label: "Known Hosts",
      icon: <ShieldCheck className="w-4 h-4" />,
      badge: knownHosts.length,
    },
    {
      id: "sync",
      label: "Sync & Themes",
      icon: <RefreshCw className="w-4 h-4" />,
    },
  ];

  return (
    <div className="flex w-full h-full min-h-0 overflow-hidden bg-[var(--bg-app)]">
      {/* Termius-Style Left Sidebar Navigation */}
      <aside className="w-56 border-r border-[var(--border-subtle)] bg-[var(--bg-panel)] flex flex-col justify-between p-3 shrink-0">
        <div className="space-y-1">
          <div className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--text-muted)]">
            Vault Directory
          </div>

          {navItems.map((item) => {
            const active = activeSection === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveSection(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition ${
                  active
                    ? "bg-[var(--accent-glow)] text-[var(--text-primary)] border border-[var(--border-accent)]"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border border-transparent"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className={
                      active ? "text-[var(--accent-primary)]" : "opacity-80"
                    }
                  >
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </div>
                {item.badge !== undefined && (
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-[var(--text-muted)]">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Active Vault Telemetry Badge (Personal vs Team SharePoint) */}
        <div
          className={`p-3 rounded-xl border space-y-1 ${
            isTeam
              ? "bg-sky-950/35 border-sky-400/40"
              : "bg-black/30 border-[var(--border-subtle)]"
          }`}
        >
          <div
            className={`flex items-center gap-2 text-[11px] font-bold ${
              isTeam ? "text-sky-300" : "text-emerald-400"
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                isTeam ? "bg-sky-400 animate-pulse" : "bg-emerald-400"
              }`}
            />
            <span className="truncate">
              {isTeam
                ? `TEAM: ${status?.activeProfile.name}`
                : status?.activeProfile.name || "Personal Vault"}
            </span>
          </div>
          <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)] font-mono">
            <span>
              {status?.readOnly ? "MEMBER · READ-ONLY" : "ADMIN · R/W"}
            </span>
            <span>XChaCha20</span>
          </div>
        </div>
      </aside>

      {/* Active Section Content */}
      <main className="flex-1 min-w-0 min-h-0 flex overflow-hidden">
        {activeSection === "hosts" && <HostsPanel />}
        {activeSection === "keychain" && <KeychainPanel />}
        {activeSection === "tunnels" && <TunnelsPanel />}
        {activeSection === "snippets" && <SnippetsPanel />}
        {activeSection === "known_hosts" && <KnownHostsPanel />}
        {activeSection === "sync" && <SyncSettingsPanel />}
      </main>
    </div>
  );
};
