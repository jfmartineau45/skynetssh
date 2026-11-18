import React, { useMemo, useState } from "react";
import {
  FileCode2,
  Play,
  FolderSync,
  ExternalLink,
  X,
  Search,
  GripHorizontal,
  Pin,
  Copy,
  Folder,
  CornerDownRight,
} from "lucide-react";
import type { SnippetRecord, WorkspaceTab } from "../../types/models";
import { useWorkspaceStore, collectPanes } from "../../store/useWorkspaceStore";
import { useVaultStore } from "../../store/useVaultStore";
import { SplitPaneNode } from "./SplitPaneNode";
import { SftpFilePane } from "../sftp/SftpFilePane";

interface Props {
  tab: Extract<WorkspaceTab, { kind: "terminal" }>;
}

export const SessionTabView: React.FC<Props> = ({ tab }) => {
  const {
    injectSnippetToPane,
    dispatchInputFromPane,
    runSnippetOnPane,
    showSnippetsSection,
    toggleSftpDrawer,
    openDualSftpTab,
    setActiveTab,
    transfers,
    clearCompletedTransfers,
  } = useWorkspaceStore();
  const { snippets, setActiveSection } = useVaultStore();

  const [snippetsOpen, setSnippetsOpen] = useState(false);
  const [snippetsPinned, setSnippetsPinned] = useState(false);
  const [snippetQuery, setSnippetQuery] = useState("");
  const [snippetCategory, setSnippetCategory] = useState<string>("ALL");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [floatPos, setFloatPos] = useState<{ x: number; y: number } | null>(
    null
  );

  const [drawerWidth, setDrawerWidth] = useState<number>(
    () => Number(localStorage.getItem("skynet_sftp_drawer_w")) || 480
  );

  const panes = collectPanes(tab.rootNode);
  const activePane =
    panes.find((p) => p.id === tab.activePaneId) ?? panes[0];

  const categories = useMemo(() => {
    const s = new Set<string>();
    for (const item of snippets) {
      s.add(item.category?.trim() || "Uncategorized");
    }
    return Array.from(s).sort();
  }, [snippets]);

  const filteredSnippets = useMemo(() => {
    const q = snippetQuery.trim().toLowerCase();
    return snippets
      .filter((s) => {
        const cat = s.category?.trim() || "Uncategorized";
        if (snippetCategory !== "ALL" && cat !== snippetCategory) return false;
        if (!q) return true;
        return (
          s.name.toLowerCase().includes(q) ||
          s.command.toLowerCase().includes(q) ||
          (s.description ?? "").toLowerCase().includes(q) ||
          cat.toLowerCase().includes(q) ||
          (s.tags ?? []).some((t) => t.toLowerCase().includes(q))
        );
      })
      .sort(
        (a, b) =>
          (a.category ?? "Uncategorized").localeCompare(
            b.category ?? "Uncategorized"
          ) || a.name.localeCompare(b.name)
      );
  }, [snippets, snippetQuery, snippetCategory]);

  const clampedIdx =
    filteredSnippets.length > 0
      ? Math.min(selectedIdx, filteredSnippets.length - 1)
      : 0;

  const startDragFloating = (e: React.MouseEvent) => {
    e.preventDefault();
    const box = (e.currentTarget.parentElement as HTMLElement)?.getBoundingClientRect();
    const originX = floatPos?.x ?? (box ? box.left : 16);
    const originY = floatPos?.y ?? (box ? box.top : Math.max(48, window.innerHeight - 430));
    const startMouseX = e.clientX;
    const startMouseY = e.clientY;

    const onMove = (ev: MouseEvent) => {
      const nx = Math.max(
        8,
        Math.min(window.innerWidth - 360, originX + (ev.clientX - startMouseX))
      );
      const ny = Math.max(
        36,
        Math.min(window.innerHeight - 120, originY + (ev.clientY - startMouseY))
      );
      setFloatPos({ x: nx, y: ny });
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const executeSnippet = (s: SnippetRecord, mode: "run" | "insert") => {
    if (!activePane) return;
    if (!snippetsPinned) setSnippetsOpen(false);
    if (mode === "run") {
      void runSnippetOnPane(activePane, s);
    } else {
      void dispatchInputFromPane(
        activePane,
        new TextEncoder().encode(s.command)
      );
    }
  };

  const startResizeDrawer = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = drawerWidth;

    const onMove = (ev: MouseEvent) => {
      const next = Math.min(
        Math.floor(window.innerWidth * 0.68),
        Math.max(360, startWidth + (startX - ev.clientX))
      );
      setDrawerWidth(next);
      localStorage.setItem("skynet_sftp_drawer_w", String(next));
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div className="relative flex flex-col w-full h-full min-h-0 overflow-hidden">
      {/* Main Split-Pane Canvas + Drag-Resizable Quick SFTP Drawer */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="flex-1 min-w-0 min-h-0 overflow-hidden">
          <SplitPaneNode
            tabId={tab.id}
            node={tab.rootNode}
            activePaneId={tab.activePaneId}
          />
        </div>

        {/* Quick In-Session SFTP Drawer (Reuses SSH Session!) */}
        {tab.sftpDrawerOpen && tab.sftpDrawerHostId && (
          <div
            style={{ width: `${drawerWidth}px` }}
            className="relative max-w-[68%] h-full border-l border-[var(--border-accent)] bg-[var(--bg-panel)] flex flex-col shrink-0 shadow-2xl"
          >
            {/* Drag Resize Handle */}
            <div
              onMouseDown={startResizeDrawer}
              className="absolute -left-1 top-0 bottom-0 w-2 cursor-col-resize hover:bg-[var(--accent-primary)]/50 z-20 transition"
              title="Drag to resize Quick SFTP Drawer"
            />

            <div className="h-8 px-3 flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] shrink-0">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-300">
                <FolderSync className="w-3.5 h-3.5" />
                <span>Quick SFTP</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => openDualSftpTab(tab.sftpDrawerHostId)}
                  className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-[var(--text-secondary)] hover:text-white hover:bg-white/10 transition"
                  title="Expand into Full Dual-Pane SFTP Tab"
                >
                  <ExternalLink className="w-3 h-3" />
                  <span>Dual-Pane</span>
                </button>
                <button
                  onClick={() => toggleSftpDrawer(tab.id)}
                  className="p-1 rounded text-[var(--text-secondary)] hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="flex-1 min-h-0">
              <SftpFilePane
                target={{ type: "remote", hostId: tab.sftpDrawerHostId }}
                onRunTerminalCommand={(cmd) => {
                  if (activePane) {
                    void injectSnippetToPane(activePane, cmd);
                  }
                }}
                compact
              />
            </div>

            {/* Embedded Compact Transfer Progress Bar inside Quick SFTP Drawer */}
            {transfers.length > 0 && (
              <div className="max-h-28 border-t border-[var(--border-accent)] bg-[var(--bg-elevated)] flex flex-col shrink-0">
                <div className="px-3 py-1 flex items-center justify-between text-[10px] border-b border-[var(--border-subtle)]">
                  <span className="font-semibold text-amber-300">
                    Transfers ({transfers.length})
                  </span>
                  <button
                    onClick={clearCompletedTransfers}
                    className="text-[var(--text-muted)] hover:text-white"
                  >
                    Clear Done
                  </button>
                </div>
                <div className="overflow-y-auto px-3 py-1 space-y-1.5">
                  {transfers.slice(0, 4).map((tr) => {
                    const pct =
                      tr.totalBytes > 0
                        ? Math.min(
                            100,
                            Math.round(
                              (tr.bytesTransferred / tr.totalBytes) * 100
                            )
                          )
                        : tr.status === "completed"
                        ? 100
                        : 0;
                    return (
                      <div key={tr.transferId} className="text-[10px]">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="truncate font-mono">
                            {tr.fileName}
                          </span>
                          <span
                            className={
                              tr.status === "completed"
                                ? "text-emerald-400"
                                : tr.status === "failed"
                                ? "text-red-400"
                                : "text-amber-300"
                            }
                          >
                            {pct}%
                          </span>
                        </div>
                        <div className="h-1 rounded-full bg-white/10 overflow-hidden">
                          <div
                            style={{ width: `${pct}%` }}
                            className="h-full bg-[var(--accent-primary)] transition-all"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Draggable, Searchable, Categorized Floating Snippets Palette */}
      {showSnippetsSection && snippetsOpen && (
        <div
          style={
            floatPos
              ? { left: floatPos.x, top: floatPos.y }
              : { left: 12, bottom: 34 }
          }
          className="fixed w-[420px] max-w-[94vw] rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border-accent)] shadow-2xl z-40 flex flex-col overflow-hidden text-xs"
        >
          {/* Draggable Title Bar */}
          <div
            onMouseDown={startDragFloating}
            className="px-3 py-2 bg-[var(--bg-panel)] border-b border-[var(--border-subtle)] flex items-center justify-between cursor-move select-none"
          >
            <div className="flex items-center gap-2">
              <GripHorizontal className="w-3.5 h-3.5 text-[var(--text-muted)]" />
              <FileCode2 className="w-3.5 h-3.5 text-purple-400" />
              <span className="font-bold text-white">
                Snippets Playbook ({filteredSnippets.length}/{snippets.length})
              </span>
            </div>

            <div
              onMouseDown={(e) => e.stopPropagation()}
              className="flex items-center gap-1"
            >
              <button
                onClick={() => {
                  setSnippetsOpen(false);
                  setActiveSection("snippets");
                  setActiveTab("vault");
                }}
                className="px-2 py-0.5 rounded hover:bg-white/10 text-[11px] text-[var(--text-secondary)] hover:text-white"
              >
                Manage
              </button>
              <button
                onClick={() => setSnippetsPinned((v) => !v)}
                className={`p-1 rounded transition ${
                  snippetsPinned
                    ? "bg-purple-500/25 text-purple-200 border border-purple-400/40"
                    : "text-[var(--text-muted)] hover:text-white hover:bg-white/10"
                }`}
                title={
                  snippetsPinned
                    ? "Pinned open (stays open when running commands)"
                    : "Pin window open"
                }
              >
                <Pin className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setSnippetsOpen(false)}
                className="p-1 rounded text-[var(--text-muted)] hover:text-white hover:bg-white/10"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Search + Category Pills */}
          <div className="p-2.5 border-b border-[var(--border-subtle)] space-y-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-2.5 top-2" />
              <input
                autoFocus
                value={snippetQuery}
                onChange={(e) => {
                  setSnippetQuery(e.target.value);
                  setSelectedIdx(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setSnippetsOpen(false);
                  } else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setSelectedIdx((i) =>
                      filteredSnippets.length > 0
                        ? (i + 1) % filteredSnippets.length
                        : 0
                    );
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setSelectedIdx((i) =>
                      filteredSnippets.length > 0
                        ? (i - 1 + filteredSnippets.length) %
                          filteredSnippets.length
                        : 0
                    );
                  } else if (
                    e.key === "Enter" &&
                    filteredSnippets[clampedIdx]
                  ) {
                    e.preventDefault();
                    executeSnippet(filteredSnippets[clampedIdx], "run");
                  } else if (e.key === "Tab" && filteredSnippets[clampedIdx]) {
                    e.preventDefault();
                    executeSnippet(filteredSnippets[clampedIdx], "insert");
                  }
                }}
                placeholder="Search name, command, category, #tag..."
                className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-black/45 border border-[var(--border-subtle)] focus:border-purple-400 text-xs text-white focus:outline-none"
              />
            </div>

            {categories.length > 1 && (
              <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
                <button
                  onClick={() => {
                    setSnippetCategory("ALL");
                    setSelectedIdx(0);
                  }}
                  className={`px-2 py-0.5 rounded-md text-[10px] font-semibold shrink-0 transition ${
                    snippetCategory === "ALL"
                      ? "bg-purple-500/25 text-purple-200 border border-purple-400/40"
                      : "bg-white/5 text-[var(--text-muted)] hover:text-white"
                  }`}
                >
                  All
                </button>
                {categories.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => {
                      setSnippetCategory(cat);
                      setSelectedIdx(0);
                    }}
                    className={`px-2 py-0.5 rounded-md text-[10px] font-medium shrink-0 transition ${
                      snippetCategory === cat
                        ? "bg-purple-500/25 text-purple-200 border border-purple-400/40"
                        : "bg-white/5 text-[var(--text-muted)] hover:text-white"
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Scrollable Snippet Rows */}
          <div className="max-h-80 overflow-y-auto divide-y divide-white/[0.04]">
            {filteredSnippets.length === 0 ? (
              <div className="p-6 text-center text-[var(--text-muted)]">
                {snippets.length === 0
                  ? "No snippets saved yet. Click Manage to load the Starter Ops Pack or add your own."
                  : "No snippets match your search."}
              </div>
            ) : (
              filteredSnippets.map((s, idx) => {
                const selected = idx === clampedIdx;
                return (
                  <div
                    key={s.id}
                    onMouseEnter={() => setSelectedIdx(idx)}
                    onClick={() => executeSnippet(s, "run")}
                    className={`px-3 py-2 flex items-center justify-between gap-2 cursor-pointer transition ${
                      selected ? "bg-[var(--bg-hover)]" : ""
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-[var(--text-primary)] truncate">
                          {s.name}
                        </span>
                        {s.category && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded bg-amber-500/10 text-[9px] text-amber-300 shrink-0">
                            <Folder className="w-2.5 h-2.5" />
                            {s.category}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] font-mono text-purple-300/85 truncate mt-0.5">
                        {s.command}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          executeSnippet(s, "run");
                        }}
                        className="p-1.5 rounded bg-emerald-500/15 hover:bg-emerald-500/30 text-emerald-300 transition"
                        title="Run in active pane (Enter)"
                      >
                        <Play className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          executeSnippet(s, "insert");
                        }}
                        className="p-1.5 rounded bg-white/5 hover:bg-white/15 text-[var(--text-secondary)] hover:text-white transition"
                        title="Insert onto prompt without pressing Enter (Tab)"
                      >
                        <CornerDownRight className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigator.clipboard.writeText(s.command);
                        }}
                        className="p-1.5 rounded bg-white/5 hover:bg-white/15 text-[var(--text-muted)] hover:text-white transition"
                        title="Copy command"
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="px-3 py-1.5 bg-[var(--bg-panel)] border-t border-[var(--border-subtle)] flex items-center justify-between text-[10px] font-mono text-[var(--text-muted)]">
            <span>Drag header to move · 📌 Pin open</span>
            <span>Enter=Run · Tab=Paste</span>
          </div>
        </div>
      )}

      {/* Bottom Micro Status Bar */}
      <div className="h-7 px-3 flex items-center justify-between border-t border-[var(--border-subtle)] bg-[var(--bg-panel)] text-[11px] shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          {showSnippetsSection && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setSnippetQuery("");
                  setSelectedIdx(0);
                  setSnippetsOpen((v) => !v);
                }}
                className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded shrink-0 transition ${
                  snippetsOpen
                    ? "bg-[var(--accent-glow)] text-[var(--text-primary)] border border-[var(--border-accent)]"
                    : "bg-white/5 text-[var(--text-secondary)] hover:text-white"
                }`}
              >
                <FileCode2 className="w-3 h-3 text-purple-400" />
                <span>Snippets ({snippets.length})</span>
              </button>
              <span className="text-[10px] font-mono text-[var(--text-muted)] hidden sm:inline">
                Tip: type <code className="text-purple-300">##</code> in terminal
              </span>
            </div>
          )}
        </div>

        <div className="text-[10px] text-[var(--text-muted)] font-mono shrink-0">
          Target: {activePane?.title ?? "—"} · Panes: {panes.length}
        </div>
      </div>
    </div>
  );
};
