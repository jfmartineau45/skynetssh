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
  FileCode2,
  Folder,
  Search,
  Radio,
  Terminal as TerminalIcon,
  Server,
  ExternalLink,
  PanelTop,
  Zap,
} from "lucide-react";
import type { TerminalPaneConfig } from "../../types/models";
import { useWorkspaceStore, collectPanes } from "../../store/useWorkspaceStore";
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
    terminalFontSize,
    copyOnSelect,
    rightClickPaste,
    showSnippetsSection,
    tabs,
    shells,
    setActiveTab,
    setActivePane,
    updatePane,
    splitPane,
    dockTabIntoSplit,
    detachPaneToTab,
    popoutPaneToWindow,
    closePane,
    toggleSftpDrawer,
    broadcastEnabled,
    broadcastPaneIds,
    togglePaneInBroadcast,
    dispatchInputFromPane,
    runSnippetOnPane,
  } = useWorkspaceStore();

  const { status, hosts, snippets, setActiveSection } = useVaultStore();

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
  const [splitPicker, setSplitPicker] = useState<{
    direction: "horizontal" | "vertical";
    top: number;
    left: number;
  } | null>(null);
  const [splitFilter, setSplitFilter] = useState("");
  const splitMenuRef = useRef<HTMLDivElement>(null);

  const [snippetPicker, setSnippetPicker] = useState<{
    top: number;
    left: number;
    triggeredByHash?: boolean;
  } | null>(null);
  const [snippetFilter, setSnippetFilter] = useState("");
  const [snippetSelectedIdx, setSnippetSelectedIdx] = useState(0);
  const snippetMenuRef = useRef<HTMLDivElement>(null);
  const lastHashKeyAtRef = useRef<number>(0);

  useEffect(() => {
    if (!splitPicker && !snippetPicker) return;
    const onDown = (e: MouseEvent) => {
      if (
        splitPicker &&
        splitMenuRef.current &&
        !splitMenuRef.current.contains(e.target as Node)
      ) {
        setSplitPicker(null);
      }
      if (
        snippetPicker &&
        snippetMenuRef.current &&
        !snippetMenuRef.current.contains(e.target as Node)
      ) {
        setSnippetPicker(null);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [splitPicker, snippetPicker]);

  const inBroadcast =
    broadcastEnabled && broadcastPaneIds.includes(pane.id);

  // Sync theme & font size changes dynamically into xterm
  useEffect(() => {
    if (xtermRef.current) {
      xtermRef.current.options.theme = APP_THEMES[theme].xterm;
    }
  }, [theme]);

  useEffect(() => {
    if (xtermRef.current && fitRef.current) {
      xtermRef.current.options.fontSize = terminalFontSize;
      try {
        fitRef.current.fit();
      } catch {
        // ignore hidden layout
      }
    }
  }, [terminalFontSize]);

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
      fontSize: terminalFontSize,
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

    // Tabby-style Copy-on-Select
    const selDisposable = term.onSelectionChange(() => {
      if (useWorkspaceStore.getState().copyOnSelect && term.hasSelection()) {
        navigator.clipboard.writeText(term.getSelection()).catch(() => {});
      }
    });

    term.attachCustomKeyEventHandler((ev) => {
      if (ev.type !== "keydown") return true;

      // TUI-Safe App Shortcuts: NEVER hijack bare Ctrl+<letter>, Ctrl+-/_, or bare Alt+<key>
      // used by nano, vim, bash/readline, tmux, screen, htop, or mc!
      if (
        (ev.ctrlKey && ev.shiftKey && !ev.altKey && ["p", "t", "w", "n"].includes(ev.key.toLowerCase())) ||
        (ev.ctrlKey && !ev.altKey && ev.key === "Tab") ||
        (ev.ctrlKey && ev.altKey && /^[1-9]$/.test(ev.key)) ||
        (ev.ctrlKey && ev.altKey && ["=", "+", "-", "0"].includes(ev.key))
      ) {
        return false;
      }

      // Tabby Split Shortcuts: Alt+Shift+D (Right) / Alt+Shift+E (Down)
      if (ev.altKey && ev.shiftKey) {
        const k = ev.key.toLowerCase();
        if (k === "d" || k === "e") {
          setSplitFilter("");
          setSplitPicker({
            direction: k === "d" ? "horizontal" : "vertical",
            top: 80,
            left: Math.max(20, window.innerWidth / 2 - 120),
          });
          return false;
        }
      }

      if (ev.ctrlKey && ev.shiftKey) {
        const k = ev.key.toLowerCase();
        if (k === "f") {
          setSearchOpen((v) => !v);
          return false;
        }
        if (k === "c" && term.hasSelection()) {
          navigator.clipboard.writeText(term.getSelection());
          return false;
        }
        if (k === "v") {
          navigator.clipboard
            .readText()
            .then((txt) => {
              if (txt) dispatchInputFromPane(paneRef.current, encoder.encode(txt));
            })
            .catch(() => {});
          return false;
        }
      }

      // Inline `##` Snippet Trigger — ONLY in normal shell buffer (auto-disabled in nano/vim/tmux/htop alternate buffer!)
      if (
        !ev.ctrlKey &&
        !ev.altKey &&
        !ev.metaKey &&
        term.buffer.active !== term.buffer.alternate &&
        useWorkspaceStore.getState().showSnippetsSection &&
        useWorkspaceStore.getState().inlineHashSnippets
      ) {
        if (ev.key === "#") {
          const now = performance.now();
          if (now - lastHashKeyAtRef.current < 650) {
            lastHashKeyAtRef.current = 0;
            ev.preventDefault();
            // Erase the first `#` sent to the shell
            dispatchInputFromPane(paneRef.current, new Uint8Array([0x7f]));

            const rect = el.getBoundingClientRect();
            const approxCellW = Math.max(7, term.options.fontSize ? term.options.fontSize * 0.6 : 8);
            const approxCellH = Math.max(15, term.options.fontSize ? term.options.fontSize * 1.25 : 17);
            const curX = term.buffer.active.cursorX * approxCellW;
            const curY = (term.buffer.active.cursorY + 1) * approxCellH;

            setSnippetFilter("");
            setSnippetSelectedIdx(0);
            setSnippetPicker({
              top: Math.max(36, Math.min(rect.top + curY + 6, window.innerHeight - 330)),
              left: Math.max(12, Math.min(rect.left + curX, window.innerWidth - 324)),
              triggeredByHash: true,
            });
            return false;
          }
          lastHashKeyAtRef.current = now;
          return true;
        }
        if (!["Shift", "Control", "Alt", "Meta", "CapsLock"].includes(ev.key)) {
          lastHashKeyAtRef.current = 0;
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
      selDisposable.dispose();
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

  const currentTab = tabs.find((t) => t.id === tabId);
  const siblingPaneCount =
    currentTab && currentTab.kind === "terminal"
      ? collectPanes(currentTab.rootNode).length
      : 1;
  const otherOpenTerminalTabs = tabs.filter(
    (t) => t.kind === "terminal" && t.id !== tabId
  );

  const handleSplitDuplicate = (direction: "horizontal" | "vertical") => {
    setSplitPicker(null);
    if (pane.kind === "ssh" && pane.hostId) {
      splitPane(tabId, pane.id, direction, {
        kind: "ssh",
        title: pane.title,
        hostId: pane.hostId,
        vaultKind: pane.vaultKind,
        vaultName: pane.vaultName,
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

  const openSplitMenu = (
    e: React.MouseEvent<HTMLButtonElement>,
    direction: "horizontal" | "vertical"
  ) => {
    e.stopPropagation();
    // Shift+Click splits the current session immediately in 1 click!
    if (e.shiftKey) {
      handleSplitDuplicate(direction);
      return;
    }
    const r = e.currentTarget.getBoundingClientRect();
    setSplitFilter("");
    setSplitPicker((prev) =>
      prev?.direction === direction
        ? null
        : {
            direction,
            top: r.bottom + 4,
            left: Math.max(8, Math.min(r.right - 268, window.innerWidth - 276)),
          }
    );
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
          {pane.kind === "ssh" && (
            <span
              className={`px-1.5 py-0.2 rounded text-[9px] font-bold uppercase tracking-wider shrink-0 ${
                pane.vaultKind === "team"
                  ? "bg-sky-500/20 text-sky-300 border border-sky-400/35"
                  : "bg-emerald-500/15 text-emerald-300"
              }`}
              title={`Vault: ${pane.vaultName ?? "Personal"}`}
            >
              {pane.vaultKind === "team" ? `TEAM · ${pane.vaultName ?? ""}` : "PERSONAL"}
            </span>
          )}

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
          {showSnippetsSection && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                const r = e.currentTarget.getBoundingClientRect();
                setSnippetFilter("");
                setSnippetSelectedIdx(0);
                setSnippetPicker((prev) =>
                  prev
                    ? null
                    : {
                        top: r.bottom + 4,
                        left: Math.max(
                          8,
                          Math.min(r.right - 310, window.innerWidth - 318)
                        ),
                        triggeredByHash: false,
                      }
                );
              }}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-purple-300 hover:bg-purple-500/15 transition"
              title="Run Shared Snippet (or type ## inside terminal!)"
            >
              <FileCode2 className="w-3 h-3" />
              <span>Snippets</span>
            </button>
          )}
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
            onClick={(e) => openSplitMenu(e, "horizontal")}
            className="p-1 rounded text-[var(--text-secondary)] hover:text-white hover:bg-white/10 transition"
            title="Split Right — pick open tab, same host, or Vault server (Shift+Click = instant split)"
          >
            <Columns2 className="w-3 h-3" />
          </button>
          <button
            onClick={(e) => openSplitMenu(e, "vertical")}
            className="p-1 rounded text-[var(--text-secondary)] hover:text-white hover:bg-white/10 transition"
            title="Split Down — pick open tab, same host, or Vault server (Shift+Click = instant split)"
          >
            <Rows2 className="w-3 h-3" />
          </button>
          {siblingPaneCount > 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                detachPaneToTab(tabId, pane.id);
              }}
              className="p-1 rounded text-sky-300 hover:bg-sky-500/15 transition"
              title="Un-split this pane out into its own Tab"
            >
              <PanelTop className="w-3 h-3" />
            </button>
          )}
          {isTauriRuntime() && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                void popoutPaneToWindow(tabId, pane.id);
              }}
              className="p-1 rounded text-[var(--text-secondary)] hover:text-sky-300 hover:bg-sky-500/15 transition"
              title="Pop out terminal into its own standalone OS window"
            >
              <ExternalLink className="w-3 h-3" />
            </button>
          )}
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

      {/* Categorized Snippets Quick-Run & Inline `##` Picker */}
      {snippetPicker && (() => {
        const q = snippetFilter.trim().toLowerCase();
        const flatMatches = snippets
          .filter(
            (s) =>
              !q ||
              s.name.toLowerCase().includes(q) ||
              s.command.toLowerCase().includes(q) ||
              (s.category ?? "").toLowerCase().includes(q) ||
              (s.tags ?? []).some((t) => t.toLowerCase().includes(q))
          )
          .sort((a, b) =>
            (a.category ?? "Uncategorized").localeCompare(
              b.category ?? "Uncategorized"
            ) || a.name.localeCompare(b.name)
          );
        const clampedIdx =
          flatMatches.length > 0
            ? Math.min(snippetSelectedIdx, flatMatches.length - 1)
            : 0;

        const closeAndFocusTerm = () => {
          setSnippetPicker(null);
          requestAnimationFrame(() => xtermRef.current?.focus());
        };

        return (
          <div
            ref={snippetMenuRef}
            style={{ top: snippetPicker.top, left: snippetPicker.left }}
            className="fixed w-80 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-accent)] shadow-2xl py-1.5 z-50 text-xs"
          >
            <div className="px-2.5 pb-1.5 border-b border-[var(--border-subtle)]">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-purple-300">
                  {snippetPicker.triggeredByHash ? "## Inline Snippet" : "Run Snippet"} ·{" "}
                  {status?.activeProfile.name}
                </span>
                <button
                  onClick={() => {
                    setSnippetPicker(null);
                    setActiveSection("snippets");
                    setActiveTab("vault");
                  }}
                  className="text-[10px] text-[var(--text-muted)] hover:text-white"
                >
                  Manage →
                </button>
              </div>
              <input
                autoFocus
                value={snippetFilter}
                onChange={(e) => {
                  setSnippetFilter(e.target.value);
                  setSnippetSelectedIdx(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    closeAndFocusTerm();
                  } else if (
                    e.key === "#" &&
                    snippetPicker.triggeredByHash &&
                    snippetFilter === ""
                  ) {
                    // Typing a 3rd `#` inserts literal `##` into the shell cleanly!
                    e.preventDefault();
                    closeAndFocusTerm();
                    dispatchInputFromPane(
                      paneRef.current,
                      new TextEncoder().encode("##")
                    );
                  } else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setSnippetSelectedIdx((i) =>
                      flatMatches.length > 0 ? (i + 1) % flatMatches.length : 0
                    );
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setSnippetSelectedIdx((i) =>
                      flatMatches.length > 0
                        ? (i - 1 + flatMatches.length) % flatMatches.length
                        : 0
                    );
                  } else if (e.key === "Enter" && flatMatches[clampedIdx]) {
                    e.preventDefault();
                    const chosen = flatMatches[clampedIdx];
                    closeAndFocusTerm();
                    void runSnippetOnPane(paneRef.current, chosen);
                  } else if (e.key === "Tab" && flatMatches[clampedIdx]) {
                    // Tab inserts the command onto the shell line without executing Enter!
                    e.preventDefault();
                    const chosen = flatMatches[clampedIdx];
                    closeAndFocusTerm();
                    dispatchInputFromPane(
                      paneRef.current,
                      new TextEncoder().encode(chosen.command)
                    );
                  }
                }}
                placeholder="Filter snippets (Enter=Run, Tab=Insert)..."
                className="w-full px-2 py-1 rounded bg-black/40 border border-[var(--border-subtle)] text-xs text-white focus:outline-none focus:border-purple-400"
              />
            </div>

            <div className="max-h-72 overflow-y-auto py-1">
              {snippets.length === 0 ? (
                <div className="px-3 py-4 text-center space-y-2">
                  <div className="text-[11px] text-[var(--text-muted)]">
                    No snippets saved in this Vault yet.
                  </div>
                  <button
                    onClick={() => {
                      setSnippetPicker(null);
                      setActiveSection("snippets");
                      setActiveTab("vault");
                    }}
                    className="px-2.5 py-1 rounded bg-purple-600 hover:bg-purple-500 text-[11px] font-semibold text-white"
                  >
                    Open Snippets Playbook
                  </button>
                </div>
              ) : flatMatches.length === 0 ? (
                <div className="px-3 py-4 text-center text-[11px] text-[var(--text-muted)]">
                  No matching snippets.
                </div>
              ) : (
                (() => {
                  let lastCat = "";
                  return flatMatches.map((s, idx) => {
                    const cat = s.category?.trim() || "Uncategorized";
                    const showHeader = cat !== lastCat;
                    lastCat = cat;
                    const selected = idx === clampedIdx;
                    return (
                      <React.Fragment key={s.id}>
                        {showHeader && (
                          <div className="px-3 pt-1.5 pb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-amber-300/90">
                            <Folder className="w-3 h-3" />
                            <span className="truncate">{cat}</span>
                          </div>
                        )}
                        <button
                          onMouseEnter={() => setSnippetSelectedIdx(idx)}
                          onClick={() => {
                            closeAndFocusTerm();
                            void runSnippetOnPane(paneRef.current, s);
                          }}
                          className={`w-full px-3 py-1.5 text-left transition ${
                            selected ? "bg-[var(--bg-hover)]" : ""
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-[var(--text-primary)] truncate">
                              {s.name}
                            </span>
                            {selected && (
                              <span className="text-[9px] font-mono text-purple-300 shrink-0">
                                ↵ Run · Tab Insert
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] font-mono text-purple-300/80 truncate">
                            {s.command}
                          </div>
                        </button>
                      </React.Fragment>
                    );
                  });
                })()
              )}
            </div>

            {snippetPicker.triggeredByHash && (
              <div className="px-3 pt-1 border-t border-[var(--border-subtle)] flex items-center justify-between text-[9px] font-mono text-[var(--text-muted)]">
                <span>↑↓ Select · Enter Run · Tab Paste</span>
                <span># Literal ##</span>
              </div>
            )}
          </div>
        );
      })()}

      {/* Split Target Picker (Same Session, Already-Open Tabs, Saved SSH Hosts, or Local Shells!) */}
      {splitPicker && (
        <div
          ref={splitMenuRef}
          style={{ top: splitPicker.top, left: splitPicker.left }}
          className="fixed w-68 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-accent)] shadow-2xl py-1.5 z-50 text-xs"
        >
          <div className="px-2.5 pb-1.5 border-b border-[var(--border-subtle)] space-y-1.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
              Split {splitPicker.direction === "horizontal" ? "Right" : "Down"} With...
            </div>

            {/* #1 Prominent Action: Split Current Open Session! */}
            <button
              onClick={() => handleSplitDuplicate(splitPicker.direction)}
              className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-[var(--accent-glow)] hover:bg-[var(--accent-primary)] border border-[var(--border-accent)] text-white font-semibold transition"
            >
              <span className="flex items-center gap-1.5 truncate">
                <Zap className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">Split Current: {pane.title}</span>
              </span>
              <span className="text-[9px] font-mono opacity-80 shrink-0">↵</span>
            </button>

            <input
              autoFocus
              value={splitFilter}
              onChange={(e) => setSplitFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setSplitPicker(null);
                else if (e.key === "Enter" && !splitFilter.trim()) {
                  handleSplitDuplicate(splitPicker.direction);
                }
              }}
              placeholder="Or search open tabs / hosts..."
              className="w-full px-2 py-1 rounded bg-black/40 border border-[var(--border-subtle)] text-xs text-white focus:outline-none focus:border-[var(--border-accent)]"
            />
          </div>

          <div className="max-h-68 overflow-y-auto py-1">
            {/* Dock Already-Open Tabs Side-by-Side! */}
            {otherOpenTerminalTabs.filter((t) =>
              t.title.toLowerCase().includes(splitFilter.toLowerCase())
            ).length > 0 && (
              <>
                <div className="px-3 pt-1.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-sky-300">
                  Already Open Tabs (Dock Here)
                </div>
                {otherOpenTerminalTabs
                  .filter((t) =>
                    t.title.toLowerCase().includes(splitFilter.toLowerCase())
                  )
                  .map((t) => (
                    <button
                      key={t.id}
                      onClick={() => {
                        dockTabIntoSplit(
                          t.id,
                          tabId,
                          pane.id,
                          splitPicker.direction
                        );
                        setSplitPicker(null);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--bg-hover)] text-[var(--text-primary)]"
                    >
                      <Columns2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                      <div className="min-w-0">
                        <div className="truncate font-medium">{t.title}</div>
                        {t.kind === "terminal" && t.subtitle && (
                          <div className="truncate text-[10px] text-[var(--text-muted)] font-mono">
                            {t.subtitle}
                          </div>
                        )}
                      </div>
                    </button>
                  ))}
                <div className="my-1 border-t border-[var(--border-subtle)]" />
              </>
            )}

            {hosts.filter(
              (h) =>
                h.label.toLowerCase().includes(splitFilter.toLowerCase()) ||
                h.address.toLowerCase().includes(splitFilter.toLowerCase())
            ).length > 0 && (
              <>
                <div className="px-3 pt-1.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Saved SSH Hosts
                </div>
                {hosts
                  .filter(
                    (h) =>
                      h.label.toLowerCase().includes(splitFilter.toLowerCase()) ||
                      h.address.toLowerCase().includes(splitFilter.toLowerCase())
                  )
                  .map((h) => (
                    <button
                      key={h.id}
                      onClick={() => {
                        splitPane(tabId, pane.id, splitPicker.direction, {
                          kind: "ssh",
                          title: h.label || `${h.username}@${h.address}`,
                          hostId: h.id,
                          vaultKind: status?.activeProfile.kind ?? "personal",
                          vaultName: status?.activeProfile.name ?? "Personal",
                        });
                        setSplitPicker(null);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--bg-hover)] text-[var(--text-primary)]"
                    >
                      <Server className="w-3.5 h-3.5 text-[var(--accent-primary)] shrink-0" />
                      <div className="min-w-0">
                        <div className="truncate font-medium">{h.label}</div>
                        <div className="truncate text-[10px] text-[var(--text-muted)] font-mono">
                          {h.username}@{h.address}
                        </div>
                      </div>
                    </button>
                  ))}
              </>
            )}

            {shells.filter((s) =>
              s.name.toLowerCase().includes(splitFilter.toLowerCase())
            ).length > 0 && (
              <>
                <div className="px-3 pt-1.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Local Terminals
                </div>
                {shells
                  .filter((s) =>
                    s.name.toLowerCase().includes(splitFilter.toLowerCase())
                  )
                  .map((sh) => (
                    <button
                      key={sh.id}
                      onClick={() => {
                        splitPane(tabId, pane.id, splitPicker.direction, {
                          kind: "local",
                          title: sh.name,
                          shellProfile: sh,
                        });
                        setSplitPicker(null);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--bg-hover)] text-[var(--text-primary)]"
                    >
                      <TerminalIcon className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span className="truncate">{sh.name}</span>
                    </button>
                  ))}
              </>
            )}
          </div>
        </div>
      )}

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

      {/* xterm.js Canvas / WebGL Surface (Tabby Right-Click Paste support) */}
      <div
        ref={containerRef}
        onContextMenu={(e) => {
          if (rightClickPaste) {
            e.preventDefault();
            navigator.clipboard
              .readText()
              .then((txt) => {
                if (txt) {
                  const enc = new TextEncoder();
                  dispatchInputFromPane(paneRef.current, enc.encode(txt));
                }
              })
              .catch(() => {});
          }
        }}
        className="flex-1 w-full min-h-0 overflow-hidden"
      />
    </div>
  );
};
