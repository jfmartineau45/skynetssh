import React, { useEffect, useRef, useState, useCallback } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import {
  Columns2,
  Rows2,
  X,
  RotateCw,
  FolderSync,
  Search,
  Radio,
  Terminal as TerminalIcon,
  Server,
} from "lucide-react";
import type { TerminalPaneConfig } from "../../types/models";
import { useWorkspaceStore } from "../../store/useWorkspaceStore";
import { useVaultStore } from "../../store/useVaultStore";
import { APP_THEMES } from "../../lib/themes";
import {
  apiPtyClose,
  apiPtyResize,
  apiPtySpawn,
  apiSshClose,
  apiSshConnectShell,
  apiSshResize,
  isTauriRuntime,
} from "../../lib/ipc";

interface Props {
  tabId: string;
  pane: TerminalPaneConfig;
  isActive: boolean;
}

export const TerminalPane: React.FC<Props> = ({ tabId, pane, isActive }) => {
  const {
    theme,
    shells,
    setActivePane,
    updatePane,
    splitPane,
    closePane,
    toggleSftpDrawer,
    broadcastEnabled,
    broadcastPaneIds,
    togglePaneInBroadcast,
    dispatchInputFromPane,
  } = useWorkspaceStore();

  const { hosts, snippets } = useVaultStore();

  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const paneRef = useRef<TerminalPaneConfig>(pane);
  paneRef.current = pane;

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [connectNonce, setConnectNonce] = useState(0);

  const inBroadcast =
    broadcastEnabled && broadcastPaneIds.includes(pane.id);

  // Sync theme changes dynamically into xterm
  useEffect(() => {
    if (xtermRef.current) {
      xtermRef.current.options.theme = APP_THEMES[theme].xterm;
    }
  }, [theme]);

  const startBackendSession = useCallback(
    async (term: XTerm) => {
      if (!isTauriRuntime()) {
        term.writeln(
          "\x1b[1;31m[SKYNET//SSH]\x1b[0m Preview mode (run inside Tauri desktop shell for live SSH & ConPTY)."
        );
        updatePane(tabId, pane.id, { connecting: false, connected: true });
        return;
      }

      updatePane(tabId, pane.id, {
        connecting: true,
        connected: false,
        error: null,
      });

      const cols = Math.max(20, term.cols || 80);
      const rows = Math.max(5, term.rows || 24);

      try {
        if (pane.kind === "ssh" && pane.hostId) {
          const host = hosts.find((h) => h.id === pane.hostId);
          term.writeln(
            `\x1b[90m[SKYNET//SSH] Establishing encrypted link to ${
              host ? `${host.username}@${host.address}:${host.port}` : pane.title
            }...\x1b[0m`
          );
          const sid = await apiSshConnectShell(pane.hostId, cols, rows, (bytes) => {
            term.write(bytes);
          });
          sessionIdRef.current = sid;
          updatePane(tabId, pane.id, {
            sessionId: sid,
            connecting: false,
            connected: true,
            error: null,
          });

          // Run startup command or startup snippet if configured on host
          if (host) {
            const startupCmd =
              host.startupCommand ||
              snippets.find((s) => s.id === host.startupSnippetId)?.command;
            if (startupCmd) {
              const enc = new TextEncoder();
              setTimeout(() => {
                dispatchInputFromPane(
                  { ...paneRef.current, sessionId: sid, connected: true },
                  enc.encode(`${startupCmd}\r`)
                );
              }, 350);
            }
          }
        } else {
          const profile =
            pane.shellProfile ??
            shells[0] ?? {
              id: "powershell",
              name: "Windows PowerShell",
              executable: "powershell.exe",
              args: ["-NoLogo"],
              icon: "powershell",
            };
          const sid = await apiPtySpawn(profile, cols, rows, (bytes) => {
            term.write(bytes);
          });
          sessionIdRef.current = sid;
          updatePane(tabId, pane.id, {
            sessionId: sid,
            connecting: false,
            connected: true,
            error: null,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        term.writeln(`\r\n\x1b[1;31m[CONNECTION FAILED]\x1b[0m ${msg}\r\n`);
        updatePane(tabId, pane.id, {
          connecting: false,
          connected: false,
          error: msg,
        });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pane.id, pane.kind, pane.hostId, tabId, connectNonce]
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const term = new XTerm({
      cursorBlink: true,
      cursorStyle: "bar",
      fontSize: 13.5,
      lineHeight: 1.22,
      fontFamily:
        '"Cascadia Mono", "JetBrains Mono", "Consolas", ui-monospace, monospace',
      scrollback: 10000,
      allowProposedApi: true,
      theme: APP_THEMES[theme].xterm,
    });

    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(searchAddon);
    term.loadAddon(webLinksAddon);

    term.open(el);

    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch {
      // Fallback cleanly to standard canvas renderer
    }

    fitAddon.fit();
    xtermRef.current = term;
    fitRef.current = fitAddon;
    searchRef.current = searchAddon;

    const encoder = new TextEncoder();
    const dataDisposable = term.onData((data) => {
      dispatchInputFromPane(paneRef.current, encoder.encode(data));
    });

    term.attachCustomKeyEventHandler((ev) => {
      if (ev.type === "keydown" && ev.ctrlKey && ev.shiftKey) {
        if (ev.key.toLowerCase() === "f") {
          setSearchOpen((v) => !v);
          return false;
        }
        if (ev.key.toLowerCase() === "c" && term.hasSelection()) {
          navigator.clipboard.writeText(term.getSelection());
          return false;
        }
      }
      return true;
    });

    startBackendSession(term);

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        try {
          fitAddon.fit();
          const sid = sessionIdRef.current;
          if (sid && isTauriRuntime()) {
            if (paneRef.current.kind === "ssh") {
              apiSshResize(sid, term.cols, term.rows).catch(() => {});
            } else {
              apiPtyResize(sid, term.cols, term.rows).catch(() => {});
            }
          }
        } catch {
          // ignore transient hidden layout
        }
      }, 40);
    });
    ro.observe(el);

    return () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      ro.disconnect();
      dataDisposable.dispose();
      const sid = sessionIdRef.current;
      sessionIdRef.current = null;
      if (sid && isTauriRuntime()) {
        if (paneRef.current.kind === "ssh") {
          apiSshClose(sid).catch(() => {});
        } else {
          apiPtyClose(sid).catch(() => {});
        }
      }
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectNonce]);

  const handleSplit = (direction: "horizontal" | "vertical") => {
    if (pane.kind === "ssh" && pane.hostId) {
      splitPane(tabId, pane.id, direction, {
        kind: "ssh",
        title: pane.title,
        hostId: pane.hostId,
      });
    } else {
      const profile = pane.shellProfile ?? shells[0];
      splitPane(tabId, pane.id, direction, {
        kind: "local",
        title: profile?.name ?? "PowerShell",
        shellProfile: profile,
      });
    }
  };

  return (
    <div
      onMouseDown={() => setActivePane(tabId, pane.id)}
      className={`relative flex flex-col w-full h-full min-w-0 min-h-0 bg-[var(--term-bg)] transition-colors ${
        inBroadcast
          ? "ring-1 ring-inset ring-amber-500/70"
          : isActive
          ? "ring-1 ring-inset ring-[var(--border-accent)]"
          : ""
      }`}
    >
      {/* Sleek Tabby-Style Micro Pane Header */}
      <div className="h-7 px-2.5 flex items-center justify-between bg-[var(--bg-panel)] border-b border-[var(--border-subtle)] text-[11px] shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${
              pane.connecting
                ? "bg-amber-400 animate-pulse"
                : pane.connected
                ? "bg-emerald-400"
                : "bg-red-500"
            }`}
          />
          {pane.kind === "ssh" ? (
            <Server className="w-3 h-3 text-[var(--accent-primary)] shrink-0" />
          ) : (
            <TerminalIcon className="w-3 h-3 text-emerald-400 shrink-0" />
          )}
          <span className="font-medium text-[var(--text-primary)] truncate">
            {pane.title}
          </span>

          {broadcastEnabled && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                togglePaneInBroadcast(pane.id);
              }}
              className={`ml-1 flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition ${
                inBroadcast
                  ? "bg-amber-500/25 text-amber-300 border border-amber-500/50"
                  : "bg-white/5 text-[var(--text-muted)] hover:text-white"
              }`}
            >
              <Radio className="w-2.5 h-2.5" />
              {inBroadcast ? "Broadcasting" : "Join"}
            </button>
          )}
        </div>

        {/* Pane Controls */}
        <div className="flex items-center gap-0.5">
          {pane.kind === "ssh" && pane.hostId && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleSftpDrawer(tabId, pane.hostId);
              }}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-amber-300 hover:bg-amber-500/15 transition"
              title="Toggle Quick SFTP Drawer (reuses SSH session)"
            >
              <FolderSync className="w-3 h-3" />
              <span>SFTP</span>
            </button>
          )}
          <button
            onClick={() => setSearchOpen((v) => !v)}
            className="p-1 rounded text-[var(--text-secondary)] hover:text-white hover:bg-white/10 transition"
            title="Find in terminal (Ctrl+Shift+F)"
          >
            <Search className="w-3 h-3" />
          </button>
          <button
            onClick={() => handleSplit("horizontal")}
            className="p-1 rounded text-[var(--text-secondary)] hover:text-white hover:bg-white/10 transition"
            title="Split Right"
          >
            <Columns2 className="w-3 h-3" />
          </button>
          <button
            onClick={() => handleSplit("vertical")}
            className="p-1 rounded text-[var(--text-secondary)] hover:text-white hover:bg-white/10 transition"
            title="Split Down"
          >
            <Rows2 className="w-3 h-3" />
          </button>
          <button
            onClick={() => setConnectNonce((n) => n + 1)}
            className="p-1 rounded text-[var(--text-secondary)] hover:text-white hover:bg-white/10 transition"
            title="Reconnect session"
          >
            <RotateCw className="w-3 h-3" />
          </button>
          <button
            onClick={() => closePane(tabId, pane.id)}
            className="p-1 rounded text-[var(--text-secondary)] hover:text-red-400 hover:bg-red-500/15 transition"
            title="Close pane"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Floating Search Bar */}
      {searchOpen && (
        <div className="absolute top-9 right-3 z-20 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-accent)] shadow-xl">
          <input
            autoFocus
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              searchRef.current?.findNext(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (e.shiftKey) searchRef.current?.findPrevious(searchQuery);
                else searchRef.current?.findNext(searchQuery);
              } else if (e.key === "Escape") {
                setSearchOpen(false);
              }
            }}
            placeholder="Find in buffer..."
            className="w-44 bg-transparent text-xs text-[var(--text-primary)] focus:outline-none"
          />
          <button
            onClick={() => setSearchOpen(false)}
            className="text-[var(--text-muted)] hover:text-white"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Disconnected / Error Reconnect Banner */}
      {pane.error && (
        <div className="px-3 py-1.5 bg-red-950/80 border-b border-red-500/40 flex items-center justify-between text-xs text-red-200">
          <span className="truncate">{pane.error}</span>
          <button
            onClick={() => setConnectNonce((n) => n + 1)}
            className="ml-2 px-2.5 py-0.5 rounded bg-red-600 hover:bg-red-500 text-white font-medium shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* xterm.js Canvas / WebGL Surface */}
      <div ref={containerRef} className="flex-1 w-full min-h-0 overflow-hidden" />
    </div>
  );
};
