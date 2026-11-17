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
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useWorkspaceStore } from "../../store/useWorkspaceStore";
import { useVaultStore } from "../../store/useVaultStore";
import { isTauriRuntime } from "../../lib/ipc";

export const TitleBar: React.FC = () => {
  const {
    tabs,
    activeTabId,
    setActiveTab,
    closeTab,
    shells,
    openLocalTerminal,
    openDualSftpTab,
    setCommandPaletteOpen,
    broadcastEnabled,
    broadcastPaneIds,
    toggleBroadcastMode,
  } = useWorkspaceStore();

  const { status, lockVault } = useVaultStore();
  const [shellMenuOpen, setShellMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({
    top: 40,
    left: 160,
  });
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShellMenuOpen(false);
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

  return (
    <header
      data-tauri-drag-region
      className="h-10 flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-panel)] select-none shrink-0 z-30"
    >
      {/* Left: Skynet Cyberdyne Brand + Tab Bar */}
      <div
        data-tauri-drag-region
        className="flex items-center h-full min-w-0 flex-1 overflow-hidden"
      >
        {/* Brand Badge */}
        <div
          data-tauri-drag-region
          className="flex items-center gap-2 px-3.5 h-full border-r border-[var(--border-subtle)] shrink-0"
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

        {/* Workspace Tabs */}
        <div className="flex items-center h-full px-1.5 gap-1 overflow-x-auto no-scrollbar">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                onAuxClick={(e) => {
                  if (e.button === 1 && tab.kind !== "vault") closeTab(tab.id);
                }}
                className={`group relative flex items-center gap-2 h-7 px-3 rounded-md text-xs font-medium cursor-pointer transition-all shrink-0 ${
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

                <span className="max-w-[150px] truncate">{tab.title}</span>

                {tab.kind !== "vault" && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(tab.id);
                    }}
                    className="ml-0.5 p-0.5 rounded opacity-60 hover:opacity-100 hover:bg-white/10 transition"
                    title="Close tab"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })}

          {/* Quick + New Shell / SFTP Button */}
          <div className="shrink-0" ref={menuRef}>
            <button
              ref={btnRef}
              onClick={() => {
                if (!shellMenuOpen && btnRef.current) {
                  const r = btnRef.current.getBoundingClientRect();
                  setMenuPos({
                    top: r.bottom + 4,
                    left: Math.min(r.left, window.innerWidth - 232),
                  });
                }
                setShellMenuOpen((v) => !v);
              }}
              className="flex items-center gap-0.5 h-7 px-2 rounded-md text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition"
              title="Open Local Shell or Dual-Pane SFTP"
            >
              <Plus className="w-3.5 h-3.5" />
              <ChevronDown className="w-3 h-3 opacity-70" />
            </button>

            {shellMenuOpen && (
              <div
                style={{ top: menuPos.top, left: menuPos.left }}
                className="fixed w-56 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-accent)] shadow-2xl py-1.5 z-50"
              >
                <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Local Terminals
                </div>
                {shells.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-[var(--text-muted)]">
                    Discovering shells...
                  </div>
                ) : (
                  shells.map((sh) => (
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
            )}
          </div>
        </div>
      </div>

      {/* Right: Broadcast Toggle, Ctrl+K Launcher, Vault Lock & Window Controls */}
      <div className="flex items-center h-full shrink-0 gap-1.5 pr-1">
        {/* Multi-Host Broadcast Toggle */}
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

        {/* Command Palette Trigger */}
        <button
          onClick={() => setCommandPaletteOpen(true)}
          className="flex items-center gap-2 h-6 px-2.5 rounded bg-[var(--bg-elevated)] border border-[var(--border-subtle)] hover:border-[var(--border-accent)] text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition"
          title="Command Palette (Ctrl+K)"
        >
          <Search className="w-3 h-3" />
          <span className="hidden md:inline">Command</span>
          <kbd className="text-[10px] px-1 rounded bg-white/5 text-[var(--text-muted)]">
            Ctrl+K
          </kbd>
        </button>

        {/* Lock Vault Button */}
        {status?.unlocked && (
          <button
            onClick={() => lockVault()}
            className="flex items-center justify-center w-6 h-6 rounded text-[var(--text-secondary)] hover:text-[var(--accent-primary)] hover:bg-[var(--bg-hover)] transition"
            title="Lock Encrypted Vault"
          >
            <Lock className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Native Window Controls */}
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
    </header>
  );
};
