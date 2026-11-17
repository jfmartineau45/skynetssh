import React, { useState } from "react";
import { FileCode2, Plus, Trash2, Edit2 } from "lucide-react";
import type { SnippetRecord } from "../../types/models";
import { useVaultStore } from "../../store/useVaultStore";

export const SnippetsPanel: React.FC = () => {
  const { snippets, saveSnippet, deleteSnippet } = useVaultStore();

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<SnippetRecord | null>(null);
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [description, setDescription] = useState("");

  const openNew = () => {
    setEditing(null);
    setName("");
    setCommand("");
    setDescription("");
    setModalOpen(true);
  };

  const openEdit = (s: SnippetRecord) => {
    setEditing(s);
    setName(s.name);
    setCommand(s.command);
    setDescription(s.description ?? "");
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !command.trim()) return;
    await saveSnippet({
      id: editing?.id ?? crypto.randomUUID(),
      name: name.trim(),
      command: command.trim(),
      description: description.trim() || null,
      tags: [],
      updatedAt: Date.now(),
    });
    setModalOpen(false);
  };

  return (
    <div className="flex-1 h-full flex flex-col min-h-0 overflow-hidden">
      <div className="px-6 py-4 border-b border-[var(--border-subtle)] bg-[var(--bg-panel)] flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-[var(--text-primary)]">
            Command Snippets ({snippets.length})
          </h2>
          <p className="text-xs text-[var(--text-secondary)]">
            Use <code className="text-purple-300">{`{{variable}}`}</code> placeholders to prompt for arguments when running inside a terminal
          </p>
        </div>

        <button
          onClick={openNew}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-xs font-semibold text-white transition"
        >
          <Plus className="w-4 h-4" />
          <span>New Snippet</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {snippets.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-panel)]/50 p-12 text-center">
            <FileCode2 className="w-9 h-9 text-purple-400 mx-auto mb-3 opacity-80" />
            <h3 className="text-sm font-semibold mb-1">No Snippets Saved</h3>
            <p className="text-xs text-[var(--text-secondary)] max-w-md mx-auto">
              Save common Docker, systemd, Kubernetes, or diagnostic commands and run them across one or many broadcast hosts.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
            {snippets.map((s) => (
              <div
                key={s.id}
                className="p-4 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] hover:border-[var(--border-accent)] flex flex-col justify-between transition"
              >
                <div>
                  <div className="flex items-start justify-between mb-2">
                    <div className="text-xs font-bold text-[var(--text-primary)]">
                      {s.name}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => openEdit(s)}
                        className="p-1 rounded hover:bg-white/10 text-[var(--text-secondary)]"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => deleteSnippet(s.id)}
                        className="p-1 rounded hover:bg-red-500/20 text-red-400"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  {s.description && (
                    <p className="text-[11px] text-[var(--text-secondary)] mb-2">
                      {s.description}
                    </p>
                  )}
                </div>
                <pre className="p-2.5 rounded-lg bg-black/40 font-mono text-[11px] text-purple-200 overflow-x-auto">
                  {s.command}
                </pre>
              </div>
            ))}
          </div>
        )}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center p-4">
          <form
            onSubmit={handleSave}
            className="w-full max-w-md rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-accent)] p-5 space-y-3"
          >
            <h3 className="text-sm font-bold">
              {editing ? "Edit Snippet" : "New Snippet"}
            </h3>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Snippet Name (e.g. Tail Container Logs)"
              className="w-full px-3 py-2 rounded-lg bg-black/40 border border-[var(--border-subtle)] text-xs"
            />
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
              className="w-full px-3 py-2 rounded-lg bg-black/40 border border-[var(--border-subtle)] text-xs"
            />
            <textarea
              rows={5}
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="docker logs -f --tail 100 {{container_name}}"
              className="w-full p-3 rounded-lg bg-black/40 border border-[var(--border-subtle)] text-xs font-mono"
            />
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="px-3 py-1.5 rounded-lg text-xs bg-white/5"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-[var(--accent-primary)] text-white"
              >
                Save Snippet
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
