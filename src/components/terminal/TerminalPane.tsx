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
    terminalFontSize,
    copyOnSelect,
    rightClickPaste,
    showSnippetsSection,
    shells,
    setActiveTab,
    setActivePane,
    updatePane,
    splitPane,
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
  } | null>(null);
  const [snippetFilter, setSnippetFilter] = useState("");
  const snippetMenuRef = useRef<HTMLDivElement>(null);

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

      // Let global app shortcuts bubble up instead of sending escape codes to shell
      if (
        (ev.ctrlKey && ev.key.toLowerCase() === "k") ||
        (ev.ctrlKey && ev.key === "Tab") ||
        (ev.ctrlKey && /^[1-9]$/.test(ev.key)) ||
        (ev.ctrlKey && ["=", "+", "-", "0"].includes(ev.key)) ||
        (ev.ctrlKey && ev.shiftKey && ["t", "w", "n"].includes(ev.key.toLowerCase()))
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

  const handleSplitDuplicate = (direction: "horizontal" | "vertical") => {
    setSplitPicker(null);
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

  const openSplitMenu = (
    e: React.MouseEvent<HTMLButtonElement>,
    direction: "horizontal" | "vertical"
  ) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setSplitFilter("");
    setSplitPicker((prev) =>
      prev?.direction === direction
        ? null
        : {
            direction,
            top: r.bottom + 4,
            left: Math.max(8, Math.min(r.right - 240, window.innerWidth - 248)),
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
                setSnippetPicker((prev) =>
                  prev
                    ? null
                    : {
                        top: r.bottom + 4,
                        left: Math.max(
                          8,
                          Math.min(r.right - 280, window.innerWidth - 288)
                        ),
                      }
                );
              }}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-purple-300 hover:bg-purple-500/15 transition"
              title="Run Shared Snippet in this pane"
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
            title="Split Right (pick server or local shell)"
          >
            <Columns2 className="w-3 h-3" />
          </button>
          <button
            onClick={(e) => openSplitMenu(e, "vertical")}
            className="p-1 rounded text-[var(--text-secondary)] hover:text-white hover:bg-white/10 transition"
            title="Split Down (pick server or local shell)"
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

      {/* Categorized Snippets Quick-Run Picker */}
      {snippetPicker && (
        <div
          ref={snippetMenuRef}
          style={{ top: snippetPicker.top, left: snippetPicker.left }}
          className="fixed w-72 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-accent)] shadow-2xl py-1.5 z-50 text-xs"
        >
          <div className="px-2.5 pb-1.5 border-b border-[var(--border-subtle)]">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-purple-300">
                Run Snippet ({status?.activeProfile.name})
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
              onChange={(e) => setSnippetFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setSnippetPicker(null);
              }}
              placeholder="Search snippets or categories..."
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
            ) : (
              (() => {
                const q = snippetFilter.trim().toLowerCase();
                const matches = snippets.filter(
                  (s) =>
                    !q ||
                    s.name.toLowerCase().includes(q) ||
                    s.command.toLowerCase().includes(q) ||
                    (s.category ?? "").toLowerCase().includes(q)
                );
                if (matches.length === 0) {
                  return (
                    <div className="px-3 py-4 text-center text-[11px] text-[var(--text-muted)]">
                      No matching snippets.
                    </div>
                  );
                }
                const byCat = new Map<string, typeof matches>();
                for (const s of matches) {
                  const c = s.category?.trim() || "Uncategorized";
                  byCat.set(c, [...(byCat.get(c) ?? []), s]);
                }
                return Array.from(byCat.entries())
                  .sort((a, b) => a[0].localeCompare(b[0]))
                  .map(([cat, items]) => (
                    <div key={cat}>
                      <div className="px-3 pt-1.5 pb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-amber-300/90">
                        <Folder className="w-3 h-3" />
                        <span className="truncate">{cat}</span>
                      </div>
                      {items.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => {
                            setSnippetPicker(null);
                            void runSnippetOnPane(paneRef.current, s);
                          }}
                          className="w-full px-3 py-1.5 text-left hover:bg-[var(--bg-hover)] transition"
                        >
                          <div className="font-medium text-[var(--text-primary)] truncate">
                            {s.name}
                          </div>
                          <div className="text-[10px] font-mono text-purple-300/80 truncate">
                            {s.command}
                          </div>
                        </button>
                      ))}
                    </div>
                  ));
              })()
            )}
          </div>
        </div>
      )}

      {/* Split Target Picker (Choose any Saved SSH Host or Local Shell!) */}
      {splitPicker && (
        <div
          ref={splitMenuRef}
          style={{ top: splitPicker.top, left: splitPicker.left }}
          className="fixed w-60 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-accent)] shadow-2xl py-1.5 z-50 text-xs"
        >
          <div className="px-2.5 pb-1.5 border-b border-[var(--border-subtle)]">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1">
              Split {splitPicker.direction === "horizontal" ? "Right" : "Down"} With...
            </div>
            <input
              autoFocus
              value={splitFilter}
              onChange={(e) => setSplitFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setSplitPicker(null);
              }}
              placeholder="Filter hosts or shells..."
              className="w-full px-2 py-1 rounded bg-black/40 border border-[var(--border-subtle)] text-xs text-white focus:outline-none focus:border-[var(--border-accent)]"
            />
          </div>

          <div className="max-h-64 overflow-y-auto py-1">
            {!splitFilter.trim() && (
              <button
                onClick={() => handleSplitDuplicate(splitPicker.direction)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--bg-hover)] text-[var(--text-primary)] font-medium"
              >
                <RotateCw className="w-3.5 h-3.5 text-[var(--accent-primary)] shrink-0" />
                <span className="truncate">Duplicate: {pane.title}</span>
              </button>
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
