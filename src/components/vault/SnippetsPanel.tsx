import React, { useMemo, useState } from "react";
import {
  FileCode2,
  Plus,
  Trash2,
  Edit2,
  Copy,
  Play,
  Folder,
  Search,
  Sparkles,
  Download,
  Upload,
  Users,
  User,
  Files,
} from "lucide-react";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { SnippetRecord } from "../../types/models";
import { useVaultStore } from "../../store/useVaultStore";
import { useWorkspaceStore, collectPanes } from "../../store/useWorkspaceStore";
import {
  extractSnippetVariables,
  STARTER_OPS_SNIPPETS,
  SUGGESTED_SNIPPET_CATEGORIES,
} from "../../lib/snippets";
import { apiExportSnippetsJson, apiImportSnippetsJson } from "../../lib/ipc";

const UNCATEGORIZED = "Uncategorized";

export const SnippetsPanel: React.FC = () => {
  const { status, snippets, saveSnippet, deleteSnippet, reloadSnapshot } =
    useVaultStore();
  const { tabs, setActiveTab, runSnippetOnPane } = useWorkspaceStore();

  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [banner, setBanner] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<SnippetRecord | null>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [command, setCommand] = useState("");
  const [description, setDescription] = useState("");

  const isTeam = status?.activeProfile?.kind === "team";
  const vaultName = status?.activeProfile?.name ?? "Vault";

  // Find most recent open terminal pane so "Run" works right from the playbook
  const targetTerminal = useMemo(() => {
    for (let i = tabs.length - 1; i >= 0; i--) {
      const t = tabs[i];
      if (t.kind === "terminal") {
        const panes = collectPanes(t.rootNode);
        const active =
          panes.find((p) => p.id === t.activePaneId && p.connected) ??
          panes.find((p) => p.connected);
        if (active) return { tabId: t.id, pane: active };
      }
    }
    return null;
  }, [tabs]);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of snippets) {
      const cat = s.category?.trim() || UNCATEGORIZED;
      counts.set(cat, (counts.get(cat) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => {
      if (a[0] === UNCATEGORIZED) return 1;
      if (b[0] === UNCATEGORIZED) return -1;
      return a[0].localeCompare(b[0]);
    });
  }, [snippets]);

  const allCategorySuggestions = useMemo(() => {
    const set = new Set<string>(SUGGESTED_SNIPPET_CATEGORIES);
    for (const [cat] of categories) {
      if (cat !== UNCATEGORIZED) set.add(cat);
    }
    return Array.from(set).sort();
  }, [categories]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const s of snippets) {
      for (const t of s.tags ?? []) {
        if (t.trim()) set.add(t.trim());
      }
    }
    return Array.from(set).sort();
  }, [snippets]);

  const filteredSnippets = useMemo(() => {
    const q = search.trim().toLowerCase();
    return snippets.filter((s) => {
      const cat = s.category?.trim() || UNCATEGORIZED;
      if (selectedCategory !== "ALL" && cat !== selectedCategory) return false;
      if (selectedTag && !(s.tags ?? []).includes(selectedTag)) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.command.toLowerCase().includes(q) ||
        (s.description ?? "").toLowerCase().includes(q) ||
        cat.toLowerCase().includes(q) ||
        (s.tags ?? []).some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [snippets, selectedCategory, selectedTag, search]);

  const groupedDisplay = useMemo(() => {
    const map = new Map<string, SnippetRecord[]>();
    for (const s of filteredSnippets) {
      const cat = s.category?.trim() || UNCATEGORIZED;
      const arr = map.get(cat) ?? [];
      arr.push(s);
      map.set(cat, arr);
    }
    return Array.from(map.entries()).sort((a, b) => {
      if (a[0] === UNCATEGORIZED) return 1;
      if (b[0] === UNCATEGORIZED) return -1;
      return a[0].localeCompare(b[0]);
    });
  }, [filteredSnippets]);

  const openNew = () => {
    setEditing(null);
    setName("");
    setCategory(
      selectedCategory !== "ALL" && selectedCategory !== UNCATEGORIZED
        ? selectedCategory
        : ""
    );
    setTagsInput("");
    setCommand("");
    setDescription("");
    setModalOpen(true);
  };

  const openEdit = (s: SnippetRecord) => {
    setEditing(s);
    setName(s.name);
    setCategory(s.category ?? "");
    setTagsInput((s.tags ?? []).join(", "));
    setCommand(s.command);
    setDescription(s.description ?? "");
    setModalOpen(true);
  };

  const handleDuplicate = async (s: SnippetRecord) => {
    await saveSnippet({
      ...s,
      id: crypto.randomUUID(),
      name: `${s.name} (Copy)`,
      updatedAt: Date.now(),
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !command.trim()) return;
    const parsedTags = tagsInput
      .split(",")
      .map((t) => t.trim().replace(/^#/, ""))
      .filter(Boolean);

    await saveSnippet({
      id: editing?.id ?? crypto.randomUUID(),
      name: name.trim(),
      command: command.trim(),
      description: description.trim() || null,
      category: category.trim() || null,
      tags: parsedTags,
      updatedAt: Date.now(),
    });
    setModalOpen(false);
  };

  const handleLoadStarterPack = async () => {
    let added = 0;
    for (const item of STARTER_OPS_SNIPPETS) {
      const exists = snippets.some(
        (s) =>
          s.name.toLowerCase() === item.name.toLowerCase() &&
          s.command.trim() === item.command.trim()
      );
      if (!exists) {
        await saveSnippet({
          id: crypto.randomUUID(),
          name: item.name,
          category: item.category ?? null,
          description: item.description ?? null,
          command: item.command,
          tags: item.tags,
          updatedAt: Date.now(),
        });
        added++;
      }
    }
    setBanner(
      added > 0
        ? `Added ${added} categorized Ops starter snippet(s) to ${vaultName}.`
        : "All starter Ops snippets are already in this Vault."
    );
  };

  const handleExportJson = async () => {
    const slug =
      selectedCategory !== "ALL" && selectedCategory !== UNCATEGORIZED
        ? selectedCategory.toLowerCase().replace(/[^a-z0-9]+/g, "-")
        : "all";
    const file = await save({
      defaultPath: `skynet-snippets-${slug}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!file) return;
    try {
      const catFilter =
        selectedCategory !== "ALL" && selectedCategory !== UNCATEGORIZED
          ? selectedCategory
          : null;
      const count = await apiExportSnippetsJson(file, catFilter);
      setBanner(`Exported ${count} snippet(s) to ${file}`);
    } catch (err) {
      setBanner(`Export error: ${String(err)}`);
    }
  };

  const handleImportJson = async () => {
    const file = await open({
      multiple: false,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!file || Array.isArray(file)) return;
    try {
      const count = await apiImportSnippetsJson(file);
      await reloadSnapshot();
      setBanner(
        count > 0
          ? `Imported ${count} new snippet(s) into ${vaultName}.`
          : "No new snippets imported (all entries already existed)."
      );
    } catch (err) {
      setBanner(`Import error: ${String(err)}`);
    }
  };

  return (
    <div className="flex-1 h-full flex flex-col min-h-0 overflow-hidden">
      {/* Top Header */}
      <div className="px-6 py-4 border-b border-[var(--border-subtle)] bg-[var(--bg-panel)] flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-[var(--text-primary)]">
              Shared Command Playbook ({snippets.length})
            </h2>
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                isTeam
                  ? "bg-sky-500/20 text-sky-300 border border-sky-400/40"
                  : "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
              }`}
            >
              {isTeam ? (
                <Users className="w-3 h-3" />
              ) : (
                <User className="w-3 h-3" />
              )}
              {isTeam ? `SHARED · ${vaultName}` : vaultName}
            </span>
          </div>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">
            Synced encrypted inside this Vault. Use{" "}
            <code className="text-purple-300">{`{{variable}}`}</code>{" "}
            placeholders to prompt before running in any SSH or Broadcast pane.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleLoadStarterPack}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-500/15 hover:bg-purple-500/25 border border-purple-400/30 text-xs font-medium text-purple-200 transition"
            title="Add 10 categorized Docker, Linux, Disk, and Network commands"
          >
            <Sparkles className="w-3.5 h-3.5 text-purple-300" />
            <span>Starter Ops Pack</span>
          </button>

          <button
            onClick={handleImportJson}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-[var(--border-subtle)] text-xs text-[var(--text-secondary)] hover:text-white transition"
            title="Import a shared Snippets JSON pack into this Vault"
          >
            <Upload className="w-3.5 h-3.5 text-emerald-400" />
            <span>Import</span>
          </button>

          {snippets.length > 0 && (
            <button
              onClick={handleExportJson}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-[var(--border-subtle)] text-xs text-[var(--text-secondary)] hover:text-white transition"
              title="Export snippets (or current category) to a shareable JSON file"
            >
              <Download className="w-3.5 h-3.5 text-sky-400" />
              <span>Export</span>
            </button>
          )}

          <button
            onClick={openNew}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-xs font-semibold text-white transition"
          >
            <Plus className="w-4 h-4" />
            <span>New Snippet</span>
          </button>
        </div>
      </div>

      {banner && (
        <div className="mx-6 mt-3 px-3.5 py-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-accent)] flex items-center justify-between text-xs text-[var(--text-primary)]">
          <span>{banner}</span>
          <button
            onClick={() => setBanner(null)}
            className="text-[var(--text-muted)] hover:text-white text-[11px]"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Body: Left Category Folders + Right Categorized Grid */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Category Folder Rail */}
        <div className="w-52 border-r border-[var(--border-subtle)] bg-[var(--bg-panel)]/40 p-3 overflow-y-auto shrink-0 space-y-1">
          <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--text-muted)]">
            Categories
          </div>

          <button
            onClick={() => setSelectedCategory("ALL")}
            className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition ${
              selectedCategory === "ALL"
                ? "bg-[var(--accent-glow)] text-white border border-[var(--border-accent)] font-semibold"
                : "text-[var(--text-secondary)] hover:text-white hover:bg-white/5"
            }`}
          >
            <span className="flex items-center gap-2 truncate">
              <Folder className="w-3.5 h-3.5 text-purple-400 shrink-0" />
              <span className="truncate">All Snippets</span>
            </span>
            <span className="text-[10px] font-mono text-[var(--text-muted)]">
              {snippets.length}
            </span>
          </button>

          {categories.map(([cat, count]) => {
            const active = selectedCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition ${
                  active
                    ? "bg-[var(--accent-glow)] text-white border border-[var(--border-accent)] font-semibold"
                    : "text-[var(--text-secondary)] hover:text-white hover:bg-white/5"
                }`}
              >
                <span className="flex items-center gap-2 truncate">
                  <Folder className="w-3.5 h-3.5 text-amber-400/80 shrink-0" />
                  <span className="truncate">{cat}</span>
                </span>
                <span className="text-[10px] font-mono text-[var(--text-muted)]">
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Search + Tag Chips */}
          <div className="px-6 py-3 border-b border-[var(--border-subtle)] flex flex-wrap items-center gap-2.5">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-3 top-2.5" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter snippets by name, command, or category..."
                className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-black/35 border border-[var(--border-subtle)] focus:border-[var(--border-accent)] text-xs text-white focus:outline-none"
              />
            </div>

            {allTags.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                {allTags.map((tag) => {
                  const active = selectedTag === tag;
                  return (
                    <button
                      key={tag}
                      onClick={() => setSelectedTag(active ? null : tag)}
                      className={`px-2 py-0.5 rounded-full text-[11px] font-mono transition ${
                        active
                          ? "bg-purple-500/30 text-purple-200 border border-purple-400/50"
                          : "bg-white/5 text-[var(--text-muted)] hover:text-white"
                      }`}
                    >
                      #{tag}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {snippets.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-panel)]/50 p-12 text-center">
                <FileCode2 className="w-9 h-9 text-purple-400 mx-auto mb-3 opacity-80" />
                <h3 className="text-sm font-semibold mb-1">
                  No Snippets in {vaultName} Yet
                </h3>
                <p className="text-xs text-[var(--text-secondary)] max-w-md mx-auto mb-4">
                  Group your team's frequent Docker, Linux, Proxmox, or diagnostic commands by category—synced conflict-free across everyone in this Vault.
                </p>
                <div className="flex items-center justify-center gap-2.5">
                  <button
                    onClick={handleLoadStarterPack}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-xs font-semibold text-white transition"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Load 10 Useful Ops Snippets</span>
                  </button>
                  <button
                    onClick={openNew}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-semibold text-white transition"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Create Custom Snippet</span>
                  </button>
                </div>
              </div>
            ) : groupedDisplay.length === 0 ? (
              <div className="text-center py-12 text-xs text-[var(--text-muted)]">
                No snippets match your current search or filter.
              </div>
            ) : (
              groupedDisplay.map(([cat, list]) => (
                <div key={cat} className="space-y-3">
                  <div className="flex items-center gap-2 text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">
                    <Folder className="w-3.5 h-3.5 text-amber-400" />
                    <span>{cat}</span>
                    <span className="text-[10px] font-mono text-[var(--text-muted)]">
                      ({list.length})
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
                    {list.map((s) => {
                      const vars = extractSnippetVariables(s.command);
                      return (
                        <div
                          key={s.id}
                          className="p-4 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] hover:border-[var(--border-accent)] flex flex-col justify-between gap-3 transition"
                        >
                          <div>
                            <div className="flex items-start justify-between gap-2 mb-1.5">
                              <div className="text-xs font-bold text-[var(--text-primary)]">
                                {s.name}
                              </div>
                              <div className="flex items-center gap-0.5 shrink-0">
                                {targetTerminal && (
                                  <button
                                    onClick={() => {
                                      setActiveTab(targetTerminal.tabId);
                                      void runSnippetOnPane(
                                        targetTerminal.pane,
                                        s
                                      );
                                    }}
                                    className="p-1 rounded hover:bg-emerald-500/20 text-emerald-400"
                                    title={`Run in ${targetTerminal.pane.title}`}
                                  >
                                    <Play className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                <button
                                  onClick={() => {
                                    navigator.clipboard.writeText(s.command);
                                    setBanner(`Copied "${s.name}" to clipboard.`);
                                  }}
                                  className="p-1 rounded hover:bg-white/10 text-[var(--text-secondary)] hover:text-white"
                                  title="Copy command"
                                >
                                  <Copy className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => handleDuplicate(s)}
                                  className="p-1 rounded hover:bg-white/10 text-[var(--text-secondary)] hover:text-white"
                                  title="Duplicate snippet"
                                >
                                  <Files className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => openEdit(s)}
                                  className="p-1 rounded hover:bg-white/10 text-[var(--text-secondary)] hover:text-white"
                                  title="Edit snippet"
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => deleteSnippet(s.id)}
                                  className="p-1 rounded hover:bg-red-500/20 text-red-400"
                                  title="Delete snippet"
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

                            {(vars.length > 0 || (s.tags?.length ?? 0) > 0) && (
                              <div className="flex flex-wrap gap-1 mb-2">
                                {vars.map((v) => (
                                  <span
                                    key={v}
                                    className="px-1.5 py-0.5 rounded bg-purple-500/15 border border-purple-400/30 text-[10px] font-mono text-purple-200"
                                  >
                                    {`{{${v}}}`}
                                  </span>
                                ))}
                                {(s.tags ?? []).map((t) => (
                                  <span
                                    key={t}
                                    className="px-1.5 py-0.5 rounded bg-white/5 text-[10px] font-mono text-[var(--text-muted)]"
                                  >
                                    #{t}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>

                          <pre className="p-2.5 rounded-lg bg-black/45 border border-[var(--border-subtle)] font-mono text-[11px] text-purple-200 overflow-x-auto">
                            {s.command}
                          </pre>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Create / Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center p-4">
          <form
            onSubmit={handleSave}
            className="w-full max-w-lg rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-accent)] p-5 space-y-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold">
                {editing ? "Edit Snippet" : `New Snippet in ${vaultName}`}
              </h3>
              <span className="text-[10px] font-mono text-[var(--text-muted)]">
                {isTeam ? "Shared with Team Vault" : "Personal Vault"}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] text-[var(--text-secondary)] mb-1">
                  Snippet Name
                </label>
                <input
                  autoFocus
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Tail Container Logs"
                  className="w-full px-3 py-2 rounded-lg bg-black/40 border border-[var(--border-subtle)] text-xs text-white focus:outline-none focus:border-[var(--border-accent)]"
                />
              </div>

              <div>
                <label className="block text-[11px] text-[var(--text-secondary)] mb-1">
                  Category Folder
                </label>
                <input
                  list="skynet-snippet-categories"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="e.g. Docker & Containers"
                  className="w-full px-3 py-2 rounded-lg bg-black/40 border border-[var(--border-subtle)] text-xs text-white focus:outline-none focus:border-[var(--border-accent)]"
                />
                <datalist id="skynet-snippet-categories">
                  {allCategorySuggestions.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] text-[var(--text-secondary)] mb-1">
                  Short Description (optional)
                </label>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What this command checks or restarts"
                  className="w-full px-3 py-2 rounded-lg bg-black/40 border border-[var(--border-subtle)] text-xs text-white focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] text-[var(--text-secondary)] mb-1">
                  Tags (comma-separated)
                </label>
                <input
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  placeholder="docker, logs, prod"
                  className="w-full px-3 py-2 rounded-lg bg-black/40 border border-[var(--border-subtle)] text-xs font-mono text-white focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] text-[var(--text-secondary)] mb-1">
                Command (use <code className="text-purple-300">{`{{var}}`}</code>{" "}
                for interactive prompts)
              </label>
              <textarea
                rows={4}
                required
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="docker logs -f --tail 150 {{container_name}}"
                className="w-full p-3 rounded-lg bg-black/40 border border-[var(--border-subtle)] text-xs font-mono text-white focus:outline-none focus:border-[var(--border-accent)]"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="px-3 py-1.5 rounded-lg text-xs bg-white/5 hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-white"
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
