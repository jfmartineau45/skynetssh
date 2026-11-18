import React, { useEffect, useState } from "react";
import { FileCode2, Play, X } from "lucide-react";
import { useWorkspaceStore } from "../../store/useWorkspaceStore";
import { resolveSnippetCommand } from "../../lib/snippets";

export const SnippetPromptModal: React.FC = () => {
  const {
    pendingSnippetPrompt,
    clearPendingSnippetPrompt,
    injectSnippetToPane,
  } = useWorkspaceStore();

  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (pendingSnippetPrompt) {
      const init: Record<string, string> = {};
      for (const v of pendingSnippetPrompt.variables) init[v] = "";
      setValues(init);
    }
  }, [pendingSnippetPrompt]);

  if (!pendingSnippetPrompt) return null;

  const { pane, snippet, variables } = pendingSnippetPrompt;
  const resolved = resolveSnippetCommand(snippet.command, values);

  const handleRun = async (e: React.FormEvent) => {
    e.preventDefault();
    clearPendingSnippetPrompt();
    await injectSnippetToPane(pane, resolved);
  };

  return (
    <div
      onClick={clearPendingSnippetPrompt}
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4"
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleRun}
        className="w-full max-w-md rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-accent)] shadow-2xl p-5 space-y-3.5"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileCode2 className="w-4 h-4 text-purple-400" />
            <div>
              <div className="text-xs font-bold text-white">{snippet.name}</div>
              <div className="text-[11px] text-[var(--text-muted)]">
                Target: {pane.title}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={clearPendingSnippetPrompt}
            className="p-1 rounded hover:bg-white/10 text-[var(--text-muted)] hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-2.5">
          {variables.map((v, idx) => (
            <div key={v}>
              <label className="block text-[11px] font-mono text-purple-300 mb-1">
                {`{{${v}}}`}
              </label>
              <input
                autoFocus={idx === 0}
                required
                value={values[v] ?? ""}
                onChange={(e) =>
                  setValues((prev) => ({ ...prev, [v]: e.target.value }))
                }
                placeholder={`Enter ${v}...`}
                className="w-full px-3 py-2 rounded-lg bg-black/45 border border-[var(--border-subtle)] focus:border-purple-400 text-xs font-mono text-white focus:outline-none"
              />
            </div>
          ))}
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">
            Command Preview
          </div>
          <pre className="p-2.5 rounded-lg bg-black/50 border border-[var(--border-subtle)] text-[11px] font-mono text-emerald-300 overflow-x-auto">
            {resolved}
          </pre>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={clearPendingSnippetPrompt}
            className="px-3 py-1.5 rounded-lg text-xs bg-white/5 hover:bg-white/10 text-[var(--text-secondary)]"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-white"
          >
            <Play className="w-3.5 h-3.5" />
            <span>Run in Terminal</span>
          </button>
        </div>
      </form>
    </div>
  );
};
