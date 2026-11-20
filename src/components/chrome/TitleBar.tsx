import React, { useState, useRef, useEffect } from "react";
import {
  Shield,
  Terminal,
  FolderSync,
  Plus,
  Search,
  Radio,
  Lock,
  Minus,
  Square,
  X,
  ChevronDown,
  Server,
  Zap,
  Users,
  User,
  Check,
  FolderOpen,
  ExternalLink,
  Columns2,
  Rows2,
  Pin,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { useWorkspaceStore, collectPanes } from "../../store/useWorkspaceStore";
import { useVaultStore } from "../../store/useVaultStore";
import { isTauriRuntime } from "../../lib/ipc";
import { parseSshConnectionString } from "../../lib/sshParser";

export const TitleBar: React.FC<{ isPopout?: boolean }> = ({
  isPopout = false,
}) => {
  const {
    tabs,
    activeTabId,
    setActiveTab,
    closeTab,
    dockTabIntoSplit,
    popoutTabToWindow,
    shells,
    openHostTerminal,
    openLocalTerminal,
    openDualSftpTab,
    setCommandPaletteOpen,
    broadcastEnabled,
    broadcastPaneIds,
    toggleBroadcastMode,
  } = useWorkspaceStore();

  const {
    status,
    hosts,
    keys,
    saveHost,
    lockVault,
    setActiveSection,
    setNewHostDrawerRequested,
    switchVaultProfile,
    addVaultProfile,
  } = useVaultStore();

  const [shellMenuOpen, setShellMenuOpen] = useState(false);
  const [menuQuery, setMenuQuery] = useState("");
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({
    top: 40,
    left: 160,
  });
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  /* Vault Switcher (Personal vs Team SharePoint) */
  const [vaultMenuOpen, setVaultMenuOpen] = useState(false);
  const [vaultMenuPos, setVaultMenuPos] = useState<{ top: number; left: number }>({
    top: 40,
    left: 12,
  });
  const [addingTeamVault, setAddingTeamVault] = useState(false);
  const [newVaultName, setNewVaultName] = useState("");
  const [newVaultKind, setNewVaultKind] = useState<"team" | "personal">("team");
  const vaultMenuRef = useRef<HTMLDivElement>(null);
  const vaultBtnRef = useRef<HTMLButtonElement>(null);

  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [tabCtxMenu, setTabCtxMenu] = useState<{
    tabId: string;
    top: number;
    left: number;
  } | null>(null);
  const tabCtxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShellMenuOpen(false);
      }
      if (
        vaultMenuRef.current &&
        !vaultMenuRef.current.contains(e.target as Node)
      ) {
        setVaultMenuOpen(false);
      }
      if (
        tabCtxRef.current &&
        !tabCtxRef.current.contains(e.target as Node)
      ) {
        setTabCtxMenu(null);
      }
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, []);

  const handleMinimize = () => {
    if (isTauriRuntime()) getCurrentWindow().minimize();
  };
  const handleToggleMaximize = () => {
    if (isTauriRuntime()) getCurrentWindow().toggleMaximize();
  };
  const handleClose = () => {
    if (isTauriRuntime()) getCurrentWindow().close();
  };

  const activeProfile = status?.activeProfile;
  const isTeamVault = activeProfile?.kind === "team";

  const handlePickAndAddVaultFolder = async () => {
    if (!newVaultName.trim()) return;
    const dir = await open({ directory: true, multiple: false });
    if (!dir || Array.isArray(dir)) return;
    await addVaultProfile(newVaultName.trim(), newVaultKind, dir);
    setNewVaultName("");
    setAddingTeamVault(false);
    setVaultMenuOpen(false);
    setActiveTab("vault");
  };

  const q = menuQuery.trim().toLowerCase();
  const filteredHosts = hosts.filter(
    (h) =>
      !q ||
      h.label.toLowerCase().includes(q) ||
      h.address.toLowerCase().includes(q) ||
      h.username.toLowerCase().includes(q)
  );
  const filteredShells = shells.filter(
    (s) => !q || s.name.toLowerCase().includes(q)
  );

  const looksLikeSshTarget =
    menuQuery.includes("@") ||
    menuQuery.trim().startsWith("ssh ") ||
    (menuQuery.includes(".") && !menuQuery.includes(" "));
  const parsedQuickSsh = looksLikeSshTarget
    ? parseSshConnectionString(menuQuery)
    : null;

  const handleQuickSshConnectAndSave = async () => {
    if (!parsedQuickSsh?.address) return;
    const saved = await saveHost({
      id: crypto.randomUUID(),
      label: parsedQuickSsh.address,
      address: parsedQuickSsh.address,
      port: parsedQuickSsh.port ?? 22,
      username: parsedQuickSsh.username ?? "root",
      authMethod: keys.length > 0 ? "key" : "password",
      keyId: keys[0]?.id ?? null,
      groupId: null,
      tags: [],
      keepaliveIntervalSecs: 30,
      updatedAt: Date.now(),
    });
    setShellMenuOpen(false);
    setMenuQuery("");
    openHostTerminal(saved);
  };

  const handleOpenNewHostDrawer = () => {
    setShellMenuOpen(false);
    setMenuQuery("");
    setActiveSection("hosts");
    setActiveTab("vault");
    setNewHostDrawerRequested(true);
  };

  return (
    <header
      data-tauri-drag-region
      className="h-10 flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-panel)] select-none shrink-0 z-30"
    >
      {/* Left: Brand + Active Vault (Personal vs Team) Pill + Tab Bar */}
      <div
        data-tauri-drag-region
        className="flex items-center h-full min-w-0 flex-1 overflow-hidden"
      >
        {/* Brand Badge */}
        <div
          data-tauri-drag-region
          className="flex items-center gap-2 px-3 h-full border-r border-[var(--border-subtle)] shrink-0"
        >
          <div className="relative flex items-center justify-center w-5 h-5 rounded bg-[var(--accent-glow)] border border-[var(--border-accent)]">
            <div className="w-2 h-2 rounded-full bg-[var(--accent-primary)] shadow-[0_0_8px_var(--accent-primary)]" />
          </div>
          <span
            data-tauri-drag-region
            className="text-xs font-bold tracking-[0.18em] uppercase text-[var(--text-primary)]"
          >
            SKYNET<span className="text-[var(--accent-primary)]">//</span>SSH
          </span>
        </div>

        {/* High-Visibility Personal vs Team Vault Indicator & Switcher */}
        {!isPopout && (
        <div className="px-1.5 border-r border-[var(--border-subtle)] h-full flex items-center shrink-0" ref={vaultMenuRef}>
          <button
            ref={vaultBtnRef}
            onClick={() => {
              if (!vaultMenuOpen && vaultBtnRef.current) {
                const r = vaultBtnRef.current.getBoundingClientRect();
                setVaultMenuPos({ top: r.bottom + 4, left: r.left });
              }
              setVaultMenuOpen((v) => !v);
            }}
            className={`flex items-center gap-1.5 h-6 px-2.5 rounded-md text-[11px] font-semibold transition ${
              isTeamVault
                ? "bg-sky-500/20 text-sky-300 border border-sky-400/50 shadow-[0_0_10px_rgba(56,189,248,0.20)]"
                : "bg-emerald-500/15 text-emerald-300 border border-emerald-500/35"
            }`}
            title={`Active Vault: ${activeProfile?.name ?? "Personal"} (${activeProfile?.path ?? ""}) — Click to switch Personal / Team Vault`}
          >
            {isTeamVault ? (
              <Users className="w-3.5 h-3.5 text-sky-300 shrink-0" />
            ) : (
              <User className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            )}
            <span className="max-w-[120px] truncate">
              {isTeamVault
                ? `TEAM · ${activeProfile?.name}`
                : activeProfile?.name || "Personal"}
            </span>
            <ChevronDown className="w-3 h-3 opacity-75 shrink-0" />
          </button>

          {vaultMenuOpen && (
            <div
              style={{ top: vaultMenuPos.top, left: vaultMenuPos.left }}
              className="fixed w-80 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-accent)] shadow-2xl p-2 z-50 text-xs"
            >
              <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                Switch Encrypted Vault
              </div>

              <div className="space-y-1 my-1">
                {(status?.profiles ?? []).map((prof) => {
                  const active = prof.id === activeProfile?.id;
                  const team = prof.kind === "team";
                  return (
                    <button
                      key={prof.id}
                      onClick={async () => {
                        setVaultMenuOpen(false);
                        if (!active) await switchVaultProfile(prof.id);
                      }}
                      className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-left transition ${
                        active
                          ? "bg-[var(--bg-hover)] border border-[var(--border-accent)]"
                          : "hover:bg-[var(--bg-hover)] border border-transparent"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {team ? (
                          <Users className="w-4 h-4 text-sky-400 shrink-0" />
                        ) : (
                          <User className="w-4 h-4 text-emerald-400 shrink-0" />
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-[var(--text-primary)] truncate">
                              {prof.name}
                            </span>
                            <span
                              className={`text-[9px] px-1.5 py-0.2 rounded uppercase font-bold ${
                                team
                                  ? "bg-sky-500/20 text-sky-300"
                                  : "bg-emerald-500/20 text-emerald-300"
                              }`}
                            >
                              {prof.kind}
                            </span>
                          </div>
                          <div className="text-[10px] font-mono text-[var(--text-muted)] truncate">
                            {prof.path}
                          </div>
                        </div>
                      </div>
                      {active && (
                        <Check className="w-4 h-4 text-[var(--accent-primary)] shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="border-t border-[var(--border-subtle)] pt-2 mt-1">
                {!addingTeamVault ? (
                  <button
                    onClick={() => setAddingTeamVault(true)}
                    className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 border border-sky-400/35 text-sky-200 font-semibold transition"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add / Link Team SharePoint or OneDrive Vault</span>
                  </button>
                ) : (
                  <div className="space-y-2 p-2 rounded-lg bg-black/30 border border-[var(--border-subtle)]">
                    <input
                      autoFocus
                      value={newVaultName}
                      onChange={(e) => setNewVaultName(e.target.value)}
                      placeholder="Vault Name (e.g. Ops Team SharePoint)"
                      className="w-full px-2.5 py-1.5 rounded bg-black/50 border border-[var(--border-subtle)] text-xs text-white focus:outline-none focus:border-sky-400"
                    />
                    <div className="grid grid-cols-2 gap-1 p-0.5 rounded bg-black/40">
                      <button
                        type="button"
                        onClick={() => setNewVaultKind("team")}
                        className={`py-1 rounded text-[11px] font-semibold ${
                          newVaultKind === "team"
                            ? "bg-sky-600 text-white"
                            : "text-[var(--text-muted)]"
                        }`}
                      >
                        Team Vault
                      </button>
                      <button
                        type="button"
                        onClick={() => setNewVaultKind("personal")}
                        className={`py-1 rounded text-[11px] font-semibold ${
                          newVaultKind === "personal"
                            ? "bg-emerald-600 text-white"
                            : "text-[var(--text-muted)]"
                        }`}
                      >
                        Personal Vault
                      </button>
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => setAddingTeamVault(false)}
                        className="px-2.5 py-1.5 rounded bg-white/5 text-[var(--text-secondary)]"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handlePickAndAddVaultFolder}
                        className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded bg-sky-600 hover:bg-sky-500 text-white font-semibold"
                      >
                        <FolderOpen className="w-3.5 h-3.5" />
                        <span>Pick Shared Folder...</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        )}

        {/* Workspace Tabs */}
        <div className="flex items-center h-full px-1.5 gap-1 overflow-x-auto no-scrollbar">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                onContextMenu={(e) => {
                  if (tab.kind === "terminal") {
                    e.preventDefault();
                    setTabCtxMenu({
                      tabId: tab.id,
                      top: e.clientY + 4,
                      left: Math.min(e.clientX, window.innerWidth - 230),
                    });
                  }
                }}
                onAuxClick={(e) => {
                  if (e.button === 1 && tab.kind !== "vault") closeTab(tab.id);
                }}
                className={`group relative flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium cursor-pointer transition-all shrink-0 ${
                  isActive
                    ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-accent)] shadow-sm"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border border-transparent"
                }`}
              >
                {tab.kind === "vault" && (
                  <Shield className="w-3.5 h-3.5 text-[var(--accent-primary)]" />
                )}
                {tab.kind === "terminal" &&
                  (tab.subtitle ? (
                    <Server className="w-3.5 h-3.5 text-[var(--accent-primary)]" />
                  ) : (
                    <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                  ))}
                {tab.kind === "sftp" && (
                  <FolderSync className="w-3.5 h-3.5 text-amber-400" />
                )}

                {tab.kind === "terminal" && tab.vaultKind === "team" && (
                  <span
                    className="px-1 py-0.2 rounded bg-sky-500/20 text-sky-300 text-[9px] font-bold uppercase tracking-wider"
                    title={`Connected from Team Vault: ${tab.vaultName}`}
                  >
                    TEAM
                  </span>
                )}

                <span className="max-w-[140px] truncate">{tab.title}</span>

                {tab.kind === "terminal" && isTauriRuntime() && !isPopout && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void popoutTabToWindow(tab.id);
                    }}
                    className="p-0.5 rounded opacity-0 group-hover:opacity-80 hover:!opacity-100 hover:bg-sky-500/20 text-sky-300 transition"
                    title="Pop out tab into standalone window (Right-click tab for Split options)"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </button>
                )}

                {tab.kind !== "vault" && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(tab.id);
                    }}
                    className="ml-0.5 p-0.5 rounded opacity-60 hover:opacity-100 hover:bg-white/10 transition"
                    title="Close tab (Ctrl+Shift+W)"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })}

          {/* Quick + New SSH / Vault Host / Local Shell / SFTP Button */}
          <div className="shrink-0" ref={menuRef}>
            <button
              ref={btnRef}
              onClick={() => {
                if (!shellMenuOpen && btnRef.current) {
                  const r = btnRef.current.getBoundingClientRect();
                  setMenuPos({
                    top: r.bottom + 4,
                    left: Math.min(r.left, window.innerWidth - 296),
                  });
                  setMenuQuery("");
                }
                setShellMenuOpen((v) => !v);
              }}
              className="flex items-center gap-0.5 h-7 px-2 rounded-md text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition"
              title="Connect SSH, Add Host to Vault, Local Shell, or SFTP"
            >
              <Plus className="w-3.5 h-3.5" />
              <ChevronDown className="w-3 h-3 opacity-70" />
            </button>

            {shellMenuOpen && (
              <div
                style={{ top: menuPos.top, left: menuPos.left }}
                className="fixed w-72 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-accent)] shadow-2xl py-2 z-50"
              >
                <div className="px-2.5 pb-2 border-b border-[var(--border-subtle)] space-y-1.5">
                  <input
                    autoFocus
                    value={menuQuery}
                    onChange={(e) => setMenuQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setShellMenuOpen(false);
                      } else if (e.key === "Enter") {
                        if (filteredHosts.length === 1 && !looksLikeSshTarget) {
                          openHostTerminal(filteredHosts[0]);
                          setShellMenuOpen(false);
                        } else if (parsedQuickSsh?.address) {
                          handleQuickSshConnectAndSave();
                        }
                      }
                    }}
                    placeholder="Filter or type user@host -p 22..."
                    className="w-full px-2.5 py-1.5 rounded-lg bg-black/40 border border-[var(--border-subtle)] focus:border-[var(--border-accent)] text-xs text-white placeholder-[var(--text-muted)] focus:outline-none"
                  />

                  {parsedQuickSsh?.address && (
                    <button
                      onClick={handleQuickSshConnectAndSave}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-white text-xs font-semibold transition"
                    >
                      <Zap className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">
                        Connect & Save to {isTeamVault ? "Team" : "Personal"}:{" "}
                        {parsedQuickSsh.address}
                      </span>
                    </button>
                  )}

                  <button
                    onClick={handleOpenNewHostDrawer}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-medium text-[var(--text-primary)] transition"
                  >
                    <Plus className="w-3.5 h-3.5 text-[var(--accent-primary)] shrink-0" />
                    <span>
                      New Host in {activeProfile?.name || "Vault"}...
                    </span>
                  </button>
                </div>

                <div className="max-h-72 overflow-y-auto py-1">
                  {filteredHosts.length > 0 && (
                    <>
                      <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                        {isTeamVault ? "Team" : "Personal"} SSH Hosts ({filteredHosts.length})
                      </div>
                      {filteredHosts.map((h) => (
                        <button
                          key={h.id}
                          onClick={() => {
                            openHostTerminal(h);
                            setShellMenuOpen(false);
                          }}
                          className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-xs text-left text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <Server className="w-3.5 h-3.5 text-[var(--accent-primary)] shrink-0" />
                            <span className="truncate font-medium">
                              {h.label}
                            </span>
                          </div>
                          <span className="text-[10px] font-mono text-[var(--text-muted)] shrink-0">
                            {h.username}@{h.address}
                          </span>
                        </button>
                      ))}
                      <div className="my-1 border-t border-[var(--border-subtle)]" />
                    </>
                  )}

                  <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    Local Terminals (Ctrl+Shift+T)
                  </div>
                  {filteredShells.length === 0 ? (
                    <div className="px-3 py-1.5 text-xs text-[var(--text-muted)]">
                      No matching local shells
                    </div>
                  ) : (
                    filteredShells.map((sh) => (
                      <button
                        key={sh.id}
                        onClick={() => {
                          openLocalTerminal(sh);
                          setShellMenuOpen(false);
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-left text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition"
                      >
                        <Terminal className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <span className="truncate">{sh.name}</span>
                      </button>
                    ))
                  )}

                  <div className="my-1 border-t border-[var(--border-subtle)]" />
                  <button
                    onClick={() => {
                      openDualSftpTab();
                      setShellMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-left text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition"
                  >
                    <FolderSync className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span>Open Dual-Pane SFTP</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Right: Broadcast Toggle, Ctrl+K Launcher, Vault Lock & Window Controls */}
      <div className="flex items-center h-full shrink-0 gap-1.5 pr-1">
        <button
          onClick={toggleBroadcastMode}
          className={`flex items-center gap-1.5 h-6 px-2.5 rounded text-[11px] font-medium transition ${
            broadcastEnabled
              ? "bg-amber-500/20 text-amber-300 border border-amber-500/50 shadow-[0_0_10px_rgba(245,158,11,0.25)]"
              : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
          }`}
          title="Broadcast keystrokes simultaneously to multiple panes"
        >
          <Radio className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">
            {broadcastEnabled
              ? `Broadcast (${broadcastPaneIds.length})`
              : "Broadcast"}
          </span>
        </button>

        <button
          onClick={() => setCommandPaletteOpen(true)}
          className="flex items-center gap-2 h-6 px-2.5 rounded bg-[var(--bg-elevated)] border border-[var(--border-subtle)] hover:border-[var(--border-accent)] text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition"
          title="Command Palette (Ctrl+Shift+P)"
        >
          <Search className="w-3 h-3" />
          <span className="hidden md:inline">Command</span>
          <kbd className="text-[10px] px-1 rounded bg-white/5 text-[var(--text-muted)]">
            Ctrl+Shift+P
          </kbd>
        </button>

        {isPopout && isTauriRuntime() && (
          <button
            onClick={async () => {
              const next = !alwaysOnTop;
              setAlwaysOnTop(next);
              await getCurrentWindow().setAlwaysOnTop(next);
            }}
            className={`flex items-center gap-1 h-6 px-2 rounded text-[11px] font-medium transition ${
              alwaysOnTop
                ? "bg-sky-500/25 text-sky-200 border border-sky-400/50"
                : "text-[var(--text-secondary)] hover:text-white hover:bg-[var(--bg-hover)]"
            }`}
            title="Pin popped-out terminal window Always on Top"
          >
            <Pin className="w-3 h-3" />
            <span>{alwaysOnTop ? "Pinned" : "Pin Top"}</span>
          </button>
        )}

        {!isPopout && status?.unlocked && (
          <button
            onClick={() => lockVault()}
            className="flex items-center justify-center w-6 h-6 rounded text-[var(--text-secondary)] hover:text-[var(--accent-primary)] hover:bg-[var(--bg-hover)] transition"
            title="Lock Active Vault"
          >
            <Lock className="w-3.5 h-3.5" />
          </button>
        )}

        <div className="flex items-center h-full ml-1 border-l border-[var(--border-subtle)]">
          <button
            onClick={handleMinimize}
            className="w-10 h-full flex items-center justify-center text-[var(--text-secondary)] hover:bg-white/10 hover:text-white transition"
            title="Minimize"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleToggleMaximize}
            className="w-10 h-full flex items-center justify-center text-[var(--text-secondary)] hover:bg-white/10 hover:text-white transition"
            title="Maximize"
          >
            <Square className="w-3 h-3" />
          </button>
          <button
            onClick={handleClose}
            className="w-10 h-full flex items-center justify-center text-[var(--text-secondary)] hover:bg-red-600 hover:text-white transition"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Right-Click Tab Context Menu (Split Into Current View / Pop Out Window) */}
      {tabCtxMenu && (() => {
        const ctxTab = tabs.find((t) => t.id === tabCtxMenu.tabId);
        const curActiveTab = tabs.find((t) => t.id === activeTabId);
        if (!ctxTab || ctxTab.kind !== "terminal") return null;

        const canDockIntoActive =
          curActiveTab &&
          curActiveTab.kind === "terminal" &&
          curActiveTab.id !== ctxTab.id;
        const otherTermTabs = tabs.filter(
          (t) => t.kind === "terminal" && t.id !== ctxTab.id
        );

        return (
          <div
            ref={tabCtxRef}
            style={{ top: tabCtxMenu.top, left: tabCtxMenu.left }}
            className="fixed w-56 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-accent)] shadow-2xl py-1.5 z-50 text-xs"
          >
            <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] truncate">
              Tab: {ctxTab.title}
            </div>

            {canDockIntoActive && curActiveTab.kind === "terminal" && (
              <>
                <button
                  onClick={() => {
                    dockTabIntoSplit(
                      ctxTab.id,
                      curActiveTab.id,
                      curActiveTab.activePaneId,
                      "horizontal"
                    );
                    setTabCtxMenu(null);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--bg-hover)] text-[var(--text-primary)]"
                >
                  <Columns2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                  <span className="truncate">
                    Split Right with {curActiveTab.title}
                  </span>
                </button>
                <button
                  onClick={() => {
                    dockTabIntoSplit(
                      ctxTab.id,
                      curActiveTab.id,
                      curActiveTab.activePaneId,
                      "vertical"
                    );
                    setTabCtxMenu(null);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--bg-hover)] text-[var(--text-primary)]"
                >
                  <Rows2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                  <span className="truncate">
                    Split Down with {curActiveTab.title}
                  </span>
                </button>
              </>
            )}

            {!canDockIntoActive && otherTermTabs.length > 0 && (
              <>
                {otherTermTabs.slice(0, 4).map((ot) => {
                  if (ot.kind !== "terminal") return null;
                  const anchor =
                    collectPanes(ot.rootNode).find(
                      (p) => p.id === ot.activePaneId
                    ) ?? collectPanes(ot.rootNode)[0];
                  if (!anchor) return null;
                  return (
                    <button
                      key={ot.id}
                      onClick={() => {
                        dockTabIntoSplit(
                          ot.id,
                          ctxTab.id,
                          ctxTab.activePaneId,
                          "horizontal"
                        );
                        setTabCtxMenu(null);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--bg-hover)] text-[var(--text-primary)]"
                    >
                      <Columns2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                      <span className="truncate">
                        Dock {ot.title} Beside This
                      </span>
                    </button>
                  );
                })}
              </>
            )}

            {isTauriRuntime() && (
              <button
                onClick={() => {
                  setTabCtxMenu(null);
                  void popoutTabToWindow(ctxTab.id);
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--bg-hover)] text-sky-300 font-medium"
              >
                <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                <span>Pop Out into New Window</span>
              </button>
            )}

            <div className="my-1 border-t border-[var(--border-subtle)]" />
            <button
              onClick={() => {
                setTabCtxMenu(null);
                closeTab(ctxTab.id);
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-red-500/20 text-red-400"
            >
              <X className="w-3.5 h-3.5 shrink-0" />
              <span>Close Tab</span>
            </button>
          </div>
        );
      })()}
    </header>
  );
};
