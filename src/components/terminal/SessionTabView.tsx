import React, { useState } from "react";
import { FileCode2, Play, FolderSync, ExternalLink, X } from "lucide-react";
import type { WorkspaceTab } from "../../types/models";
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
    runSnippetOnPane,
    showSnippetsSection,
    toggleSftpDrawer,
    openDualSftpTab,
    transfers,
    clearCompletedTransfers,
  } = useWorkspaceStore();
  const { snippets } = useVaultStore();

  const [snippetsBarOpen, setSnippetsBarOpen] = useState(false);
  const [drawerWidth, setDrawerWidth] = useState<number>(
    () => Number(localStorage.getItem("skynet_sftp_drawer_w")) || 480
  );

  const panes = collectPanes(tab.rootNode);
  const activePane =
    panes.find((p) => p.id === tab.activePaneId) ?? panes[0];

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
    <div className="flex flex-col w-full h-full min-h-0 overflow-hidden">
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

      {/* Bottom Micro Status & Snippets Bar */}
      <div className="h-7 px-3 flex items-center justify-between border-t border-[var(--border-subtle)] bg-[var(--bg-panel)] text-[11px] shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          {showSnippetsSection && (
            <>
              <button
                onClick={() => setSnippetsBarOpen((v) => !v)}
                className={`flex items-center gap-1.5 px-2 py-0.5 rounded shrink-0 transition ${
                  snippetsBarOpen
                    ? "bg-[var(--accent-glow)] text-[var(--text-primary)] border border-[var(--border-accent)]"
                    : "text-[var(--text-secondary)] hover:text-white"
                }`}
              >
                <FileCode2 className="w-3 h-3 text-purple-400" />
                <span>Snippets ({snippets.length})</span>
              </button>

              {snippetsBarOpen && (
                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar max-w-2xl">
                  {snippets.length === 0 ? (
                    <span className="text-[var(--text-muted)]">
                      Add snippets in the Vault tab to run them in 1 click
                    </span>
                  ) : (
                    snippets.map((s) => (
                      <button
                        key={s.id}
                        onClick={() =>
                          activePane && void runSnippetOnPane(activePane, s)
                        }
                        className="flex items-center gap-1 px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-[var(--text-primary)] shrink-0 transition"
                        title={s.command}
                      >
                        <Play className="w-2.5 h-2.5 text-emerald-400" />
                        <span>{s.name}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="text-[10px] text-[var(--text-muted)] font-mono shrink-0">
          Panes: {panes.length}
        </div>
      </div>
    </div>
  );
};
