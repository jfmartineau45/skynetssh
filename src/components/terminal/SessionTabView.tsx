import React, { useState } from "react";
import { FileCode2, Play, FolderSync, ExternalLink, X } from "lucide-react";
import type { SnippetRecord, WorkspaceTab } from "../../types/models";
import { useWorkspaceStore, collectPanes } from "../../store/useWorkspaceStore";
import { useVaultStore } from "../../store/useVaultStore";
import { SplitPaneNode } from "./SplitPaneNode";
import { SftpFilePane } from "../sftp/SftpFilePane";

interface Props {
  tab: Extract<WorkspaceTab, { kind: "terminal" }>;
}

function extractVariables(cmd: string): string[] {
  const matches = cmd.matchAll(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g);
  return Array.from(new Set(Array.from(matches, (m) => m[1])));
}

export const SessionTabView: React.FC<Props> = ({ tab }) => {
  const {
    injectSnippetToPane,
    toggleSftpDrawer,
    openDualSftpTab,
  } = useWorkspaceStore();
  const { snippets } = useVaultStore();

  const [snippetsBarOpen, setSnippetsBarOpen] = useState(false);
  const [paramSnippet, setParamSnippet] = useState<SnippetRecord | null>(null);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});

  const panes = collectPanes(tab.rootNode);
  const activePane =
    panes.find((p) => p.id === tab.activePaneId) ?? panes[0];

  const handleRunSnippet = async (snip: SnippetRecord) => {
    if (!activePane) return;
    const vars = extractVariables(snip.command);
    if (vars.length > 0) {
      const defaults: Record<string, string> = {};
      vars.forEach((v) => (defaults[v] = ""));
      setParamValues(defaults);
      setParamSnippet(snip);
      return;
    }
    await injectSnippetToPane(activePane, snip.command);
  };

  const confirmParameterizedSnippet = async () => {
    if (!paramSnippet || !activePane) return;
    let resolved = paramSnippet.command;
    for (const [k, v] of Object.entries(paramValues)) {
      resolved = resolved.replaceAll(new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, "g"), v);
    }
    setParamSnippet(null);
    await injectSnippetToPane(activePane, resolved);
  };

  return (
    <div className="flex flex-col w-full h-full min-h-0 overflow-hidden">
      {/* Main Split-Pane Canvas + Optional Slide-Over Quick SFTP Drawer */}
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
          <div className="w-[420px] max-w-[48%] h-full border-l border-[var(--border-accent)] bg-[var(--bg-panel)] flex flex-col shrink-0 shadow-2xl">
            <div className="h-8 px-3 flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-300">
                <FolderSync className="w-3.5 h-3.5" />
                <span>Quick SFTP Drawer</span>
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
                compact
              />
            </div>
          </div>
        )}
      </div>

      {/* Bottom Micro Status & Snippets Bar */}
      <div className="h-7 px-3 flex items-center justify-between border-t border-[var(--border-subtle)] bg-[var(--bg-panel)] text-[11px] shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSnippetsBarOpen((v) => !v)}
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded transition ${
              snippetsBarOpen
                ? "bg-[var(--accent-glow)] text-[var(--text-primary)] border border-[var(--border-accent)]"
                : "text-[var(--text-secondary)] hover:text-white"
            }`}
          >
            <FileCode2 className="w-3 h-3 text-purple-400" />
            <span>Snippets ({snippets.length})</span>
          </button>

          {snippetsBarOpen && (
            <div className="flex items-center gap-1.5 overflow-x-auto max-w-2xl">
              {snippets.length === 0 ? (
                <span className="text-[var(--text-muted)]">
                  Add snippets in the Vault tab to run them in 1 click
                </span>
              ) : (
                snippets.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => handleRunSnippet(s)}
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
        </div>

        <div className="text-[10px] text-[var(--text-muted)] font-mono">
          Panes: {panes.length}
        </div>
      </div>

      {/* Parameterized Snippet Variable Prompt Modal */}
      {paramSnippet && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-accent)] p-5 shadow-2xl">
            <h3 className="text-sm font-semibold mb-1">
              Run Snippet: {paramSnippet.name}
            </h3>
            <p className="text-xs font-mono text-[var(--text-muted)] bg-black/30 p-2 rounded mb-3">
              {paramSnippet.command}
            </p>
            <div className="space-y-2.5 mb-4">
              {Object.keys(paramValues).map((varName) => (
                <div key={varName}>
                  <label className="block text-xs text-[var(--text-secondary)] mb-1">
                    {`{{${varName}}}`}
                  </label>
                  <input
                    autoFocus
                    value={paramValues[varName]}
                    onChange={(e) =>
                      setParamValues((prev) => ({
                        ...prev,
                        [varName]: e.target.value,
                      }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") confirmParameterizedSnippet();
                    }}
                    className="w-full px-3 py-1.5 rounded-lg bg-black/40 border border-[var(--border-subtle)] text-xs text-white focus:outline-none focus:border-[var(--border-accent)]"
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setParamSnippet(null)}
                className="px-3 py-1.5 rounded-lg text-xs bg-white/5 hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                onClick={confirmParameterizedSnippet}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-white"
              >
                Execute
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
