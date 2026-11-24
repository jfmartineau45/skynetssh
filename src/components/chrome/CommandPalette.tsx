import React, { useEffect, useMemo, useState } from "react";
import {
  Search,
  Terminal,
  FolderSync,
  ArrowLeftRight,
  FileCode2,
  Palette,
  CornerDownLeft,
  Columns2,
  ExternalLink,
  Pin,
  Droplets,
  Cpu,
} from "lucide-react";
import {
  useWorkspaceStore,
  collectPanes,
  isPopoutWindowContext,
} from "../../store/useWorkspaceStore";
import { useVaultStore } from "../../store/useVaultStore";
import { APP_THEMES } from "../../lib/themes";
import { apiTunnelStart, apiTunnelStop } from "../../lib/ipc";
import type { ThemeId } from "../../types/models";
import { DistroIcon } from "../common/DistroIcon";

interface PaletteAction {
  id: string;
  category: string;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  run: () => void | Promise<void>;
}

export const CommandPalette: React.FC = () => {
  const {
    commandPaletteOpen,
    setCommandPaletteOpen,
    shells,
    openHostTerminal,
    openLocalTerminal,
    openDualSftpTab,
    splitPane,
    popoutTabToWindow,
    dockPopoutToMain,
    tabs,
    activeTabId,
    runSnippetOnPane,
    showSnippetsSection,
    bloodRain,
    toggleBloodRain,
    setSkynetTakeoverActive,
    setTheme,
  } = useWorkspaceStore();

  const { hosts, tunnels, activeTunnels, snippets, refreshTunnels } =
    useVaultStore();

  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const insideTerminal = Boolean(target?.closest?.(".xterm"));

      // Ctrl+Shift+P works everywhere (Tabby / Windows Terminal standard, zero nano/vim/bash conflict).
      // Ctrl+K ONLY triggers outside terminals so nano (^K cut line) and bash (kill-line) work 100% natively!
      const isCtrlShiftP =
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        !e.altKey &&
        e.key.toLowerCase() === "p";
      const isNonTerminalCtrlK =
        !insideTerminal &&
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        !e.altKey &&
        e.key.toLowerCase() === "k";

      if (isCtrlShiftP || isNonTerminalCtrlK) {
        e.preventDefault();
        setCommandPaletteOpen(!commandPaletteOpen);
        setQuery("");
        setSelectedIdx(0);
      } else if (e.key === "Escape" && commandPaletteOpen) {
        setCommandPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [commandPaletteOpen, setCommandPaletteOpen]);

  const actions = useMemo<PaletteAction[]>(() => {
    const list: PaletteAction[] = [];

    const activeTab = tabs.find((t) => t.id === activeTabId);
    const activePane =
      activeTab && activeTab.kind === "terminal"
        ? collectPanes(activeTab.rootNode).find(
            (p) => p.id === activeTab.activePaneId
          )
        : undefined;

    for (const h of hosts) {
      const isRdp = h.protocol === "rdp";
      list.push({
        id: `host-${h.id}`,
        category: isRdp ? "Windows RDP" : "SSH Connect",
        title: isRdp ? `Launch RDP: ${h.label}` : `Connect: ${h.label}`,
        subtitle: `${isRdp && h.rdpDomain ? `${h.rdpDomain}\\` : ""}${h.username}@${h.address}:${h.port} ${h.tags.map((t) => `#${t}`).join(" ")}`,
        icon: <DistroIcon host={h} className="w-4 h-4" />,
        run: () => openHostTerminal(h),
      });
      if (!isRdp && activeTab && activeTab.kind === "terminal" && activePane) {
        list.push({
          id: `split-${h.id}`,
          category: "Split Pane",
          title: `Split Right with: ${h.label}`,
          subtitle: `${h.username}@${h.address}:${h.port}`,
          icon: <Columns2 className="w-4 h-4 text-sky-400" />,
          run: () =>
            splitPane(activeTab.id, activePane.id, "horizontal", {
              kind: "ssh",
              title: h.label || `${h.username}@${h.address}`,
              hostId: h.id,
            }),
        });
      }
      if (!isRdp) {
        list.push({
          id: `sftp-${h.id}`,
          category: "SFTP",
          title: `Open Dual-Pane SFTP: ${h.label}`,
          subtitle: `${h.username}@${h.address}`,
          icon: <FolderSync className="w-4 h-4 text-amber-400" />,
          run: () => openDualSftpTab(h.id),
        });
      }
    }

    for (const sh of shells) {
      list.push({
        id: `shell-${sh.id}`,
        category: "Local Shell",
        title: `New Terminal: ${sh.name}`,
        subtitle: sh.executable,
        icon: <Terminal className="w-4 h-4 text-emerald-400" />,
        run: () => openLocalTerminal(sh),
      });
    }

    for (const t of tunnels) {
      const runtime = activeTunnels[t.id];
      const isRunning = runtime?.status === "running";
      list.push({
        id: `tunnel-${t.id}`,
        category: "Port Forwarding",
        title: `${isRunning ? "Stop" : "Start"} Tunnel: ${t.name}`,
        subtitle: `${t.tunnelType.toUpperCase()} ${t.bindAddress}:${t.bindPort}`,
        icon: <ArrowLeftRight className="w-4 h-4 text-cyan-400" />,
        run: async () => {
          if (isRunning) {
            await apiTunnelStop(t.id);
          } else {
            await apiTunnelStart(t.id);
          }
          await refreshTunnels();
        },
      });
    }

    if (activePane && showSnippetsSection) {
      for (const snip of snippets) {
        list.push({
          id: `snip-${snip.id}`,
          category: snip.category ? `Snippet · ${snip.category}` : "Run Snippet",
          title: `Run Snippet: ${snip.name}`,
          subtitle: snip.command,
          icon: <FileCode2 className="w-4 h-4 text-purple-400" />,
          run: () => runSnippetOnPane(activePane, snip),
        });
      }
    }

    if (activeTab && activeTab.kind === "terminal") {
      const inPopout = isPopoutWindowContext();
      list.push({
        id: "win-popout-toggle",
        category: "Window",
        title: inPopout
          ? `Dock "${activeTab.title}" Back to Main Window`
          : `Pop Out "${activeTab.title}" into Standalone Window`,
        subtitle: "Zero-pause live session handoff (Ctrl+Shift+O or drag tab out)",
        icon: <ExternalLink className="w-4 h-4 text-sky-400" />,
        run: () =>
          inPopout
            ? dockPopoutToMain(activeTab.id)
            : popoutTabToWindow(activeTab.id),
      });
      if (inPopout && tabs.length > 1) {
        list.push({
          id: "win-dock-all",
          category: "Window",
          title: `Dock All (${tabs.length}) Pop-Out Tabs Back to Main Window`,
          subtitle: "Transfer every open console & split pane in this window back to Main",
          icon: <ExternalLink className="w-4 h-4 text-emerald-400" />,
          run: () => dockPopoutToMain(),
        });
      }
    }

    list.push({
      id: "win-pin-top",
      category: "Window",
      title: "Toggle Pin Window Always on Top",
      subtitle: "Keep current window floating above other apps (Alt+Shift+P)",
      icon: <Pin className="w-4 h-4 text-sky-300" />,
      run: () => {
        window.dispatchEvent(new CustomEvent("skynet-toggle-pin"));
      },
    });

    list.push({
      id: "fx-blood-rain",
      category: "Cyberdyne FX",
      title: `${bloodRain ? "Disable" : "Enable"} Blood Rain Mode`,
      subtitle: "Crimson Cyberdyne plasma rain & telemetry glyphs",
      icon: <Droplets className="w-4 h-4 text-red-400" />,
      run: () => toggleBloodRain(),
    });

    list.push({
      id: "fx-skynet-takeover",
      category: "Easter Egg",
      title: "Summon Skynet T-800 Patrol (15m Idle Easter Egg)",
      subtitle: "Preview the autonomous Terminator HUD & peeking Endoskeletons",
      icon: <Cpu className="w-4 h-4 text-red-500" />,
      run: () => setSkynetTakeoverActive(true),
    });

    for (const theme of Object.values(APP_THEMES)) {
      list.push({
        id: `theme-${theme.id}`,
        category: "Theme",
        title: `Theme: ${theme.name}`,
        subtitle: theme.description,
        icon: <Palette className="w-4 h-4 text-pink-400" />,
        run: () => setTheme(theme.id as ThemeId),
      });
    }

    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.subtitle.toLowerCase().includes(q) ||
        a.category.toLowerCase().includes(q)
    );
  }, [
    hosts,
    shells,
    tunnels,
    activeTunnels,
    snippets,
    tabs,
    activeTabId,
    query,
    openHostTerminal,
    openDualSftpTab,
    openLocalTerminal,
    splitPane,
    popoutTabToWindow,
    dockPopoutToMain,
    refreshTunnels,
    runSnippetOnPane,
    showSnippetsSection,
    bloodRain,
    toggleBloodRain,
    setSkynetTakeoverActive,
    setTheme,
  ]);

  if (!commandPaletteOpen) return null;

  const execute = async (item?: PaletteAction) => {
    if (!item) return;
    setCommandPaletteOpen(false);
    await item.run();
  };

  return (
    <div
      onClick={() => setCommandPaletteOpen(false)}
      className="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex items-start justify-center pt-20 px-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-accent)] shadow-2xl overflow-hidden"
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border-subtle)]">
          <Search className="w-4 h-4 text-[var(--accent-primary)]" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIdx(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelectedIdx((i) => Math.min(actions.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelectedIdx((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                execute(actions[selectedIdx]);
              }
            }}
            placeholder="Connect host, open shell, toggle tunnel, run snippet, switch theme..."
            className="w-full bg-transparent text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none"
          />
          <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-[var(--text-muted)]">
            ESC
          </kbd>
        </div>

        <div className="max-h-96 overflow-y-auto py-1.5">
          {actions.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-[var(--text-muted)]">
              No matching hosts, shells, tunnels, or commands.
            </div>
          ) : (
            actions.map((item, idx) => (
              <button
                key={item.id}
                onMouseEnter={() => setSelectedIdx(idx)}
                onClick={() => execute(item)}
                className={`w-full flex items-center justify-between px-4 py-2.5 text-left transition ${
                  idx === selectedIdx
                    ? "bg-[var(--bg-hover)] text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)]"
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="p-1.5 rounded-md bg-white/5 shrink-0">
                    {item.icon}
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-[var(--text-primary)] truncate">
                      {item.title}
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)] truncate">
                      {item.subtitle}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-3">
                  <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/5 text-[var(--text-muted)]">
                    {item.category}
                  </span>
                  {idx === selectedIdx && (
                    <CornerDownLeft className="w-3.5 h-3.5 text-[var(--accent-primary)]" />
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
