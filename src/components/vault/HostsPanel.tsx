import React, { useEffect, useMemo, useState } from "react";
import {
  Server,
  Folder,
  Plus,
  Search,
  Play,
  FolderSync,
  Edit2,
  Copy,
  Trash2,
  FolderPlus,
  Download,
  ChevronRight,
  KeyRound,
  Zap,
} from "lucide-react";
import type { HostRecord } from "../../types/models";
import { useVaultStore } from "../../store/useVaultStore";
import { useWorkspaceStore } from "../../store/useWorkspaceStore";
import {
  HostEditorDrawer,
  parseSshConnectionString,
} from "./HostEditorDrawer";
import { apiImportSshConfig } from "../../lib/ipc";

export const HostsPanel: React.FC = () => {
  const {
    groups,
    hosts,
    keys,
    saveHost,
    saveGroup,
    deleteHost,
    deleteGroup,
    reloadSnapshot,
    newHostDrawerRequested,
    setNewHostDrawerRequested,
  } = useVaultStore();
  const { openHostTerminal, openDualSftpTab } = useWorkspaceStore();

  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [quickConnectInput, setQuickConnectInput] = useState("");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingHost, setEditingHost] = useState<HostRecord | null>(null);

  useEffect(() => {
    if (newHostDrawerRequested) {
      setEditingHost(null);
      setDrawerOpen(true);
      setNewHostDrawerRequested(false);
    }
  }, [newHostDrawerRequested, setNewHostDrawerRequested]);

  const [newGroupModal, setNewGroupModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    hosts.forEach((h) => h.tags.forEach((t) => s.add(t)));
    return Array.from(s).sort();
  }, [hosts]);

  const visibleHosts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return hosts.filter((h) => {
      if (selectedGroupId && h.groupId !== selectedGroupId) return false;
      if (selectedTag && !h.tags.includes(selectedTag)) return false;
      if (!q) return true;
      return (
        h.label.toLowerCase().includes(q) ||
        h.address.toLowerCase().includes(q) ||
        h.username.toLowerCase().includes(q) ||
        h.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [hosts, selectedGroupId, selectedTag, search]);

  /** Termius-style Quick Connect Bar: `ssh user@host -p 2222` -> auto-saves to Vault & connects immediately! */
  const handleQuickConnectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseSshConnectionString(quickConnectInput);
    if (!parsed?.address) return;

    const record: HostRecord = {
      id: crypto.randomUUID(),
      label: parsed.address,
      address: parsed.address,
      port: parsed.port ?? 22,
      username: parsed.username ?? "root",
      authMethod: keys.length > 0 ? "key" : "password",
      keyId: keys[0]?.id ?? null,
      groupId: selectedGroupId,
      tags: [],
      keepaliveIntervalSecs: 30,
      updatedAt: Date.now(),
    };

    const saved = await saveHost(record);
    setQuickConnectInput("");
    openHostTerminal(saved);
  };

  const handleDuplicateHost = async (h: HostRecord) => {
    await saveHost({
      ...h,
      id: crypto.randomUUID(),
      label: `${h.label} (Copy)`,
      updatedAt: Date.now(),
    });
  };

  const handleImportOpenSshConfig = async () => {
    try {
      const count = await apiImportSshConfig();
      await reloadSnapshot();
      setToast(`Imported ${count} host(s) from ~/.ssh/config`);
      setTimeout(() => setToast(null), 4000);
    } catch (e) {
      setToast(`SSH config import error: ${String(e)}`);
      setTimeout(() => setToast(null), 4000);
    }
  };

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return;
    await saveGroup({
      id: crypto.randomUUID(),
      name: newGroupName.trim(),
      icon: "folder",
      color: "#ef4444",
      parentId: null,
      updatedAt: Date.now(),
    });
    setNewGroupName("");
    setNewGroupModal(false);
  };

  const activeGroup = groups.find((g) => g.id === selectedGroupId);

  return (
    <div className="relative flex-1 h-full flex flex-col min-h-0 overflow-hidden">
      {/* Top Action & Termius Quick-Connect Header */}
      <div className="px-6 py-4 border-b border-[var(--border-subtle)] bg-[var(--bg-panel)] space-y-3 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Quick-Connect / Smart Save Bar */}
          <form
            onSubmit={handleQuickConnectSubmit}
            className="flex-1 min-w-[280px] max-w-xl flex items-center gap-2"
          >
            <div className="relative flex-1">
              <Zap className="w-3.5 h-3.5 text-[var(--accent-primary)] absolute left-3 top-2.5" />
              <input
                value={quickConnectInput}
                onChange={(e) => setQuickConnectInput(e.target.value)}
                placeholder="Quick connect & save: ssh user@host -p 22"
                className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-black/40 border border-[var(--border-subtle)] focus:border-[var(--border-accent)] text-xs text-white placeholder-[var(--text-muted)] focus:outline-none"
              />
            </div>
            {quickConnectInput.trim() && (
              <button
                type="submit"
                className="px-3 py-1.5 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-xs font-semibold text-white shrink-0 transition"
              >
                Connect & Save
              </button>
            )}
          </form>

          {/* Termius-Style Primary Action Buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleImportOpenSshConfig}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-[var(--border-subtle)] text-xs text-[var(--text-secondary)] hover:text-white transition"
              title="Import hosts automatically from ~/.ssh/config"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Import ~/.ssh/config</span>
            </button>

            <button
              onClick={() => setNewGroupModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] transition"
            >
              <FolderPlus className="w-3.5 h-3.5 text-amber-400" />
              <span>New Group</span>
            </button>

            <button
              onClick={() => {
                setEditingHost(null);
                setDrawerOpen(true);
              }}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-xs font-semibold text-white shadow-md transition"
            >
              <Plus className="w-4 h-4" />
              <span>New Host</span>
            </button>
          </div>
        </div>

        {/* Search + Breadcrumbs + Tag Pills */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 text-xs">
            <button
              onClick={() => setSelectedGroupId(null)}
              className={`font-semibold transition ${
                !selectedGroupId
                  ? "text-[var(--text-primary)]"
                  : "text-[var(--text-muted)] hover:text-white"
              }`}
            >
              All Hosts ({hosts.length})
            </button>
            {activeGroup && (
              <>
                <ChevronRight className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                <span className="font-semibold text-[var(--accent-primary)]">
                  {activeGroup.name}
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            {allTags.map((tag) => (
              <button
                key={tag}
                onClick={() =>
                  setSelectedTag(selectedTag === tag ? null : tag)
                }
                className={`px-2 py-0.5 rounded-full text-[11px] transition ${
                  selectedTag === tag
                    ? "bg-[var(--accent-primary)] text-white"
                    : "bg-white/5 text-[var(--text-secondary)] hover:text-white"
                }`}
              >
                #{tag}
              </button>
            ))}

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-2.5 top-2" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter hosts..."
                className="w-48 pl-8 pr-2.5 py-1 rounded-lg bg-black/30 border border-[var(--border-subtle)] text-xs text-white focus:outline-none focus:border-[var(--border-accent)]"
              />
            </div>
          </div>
        </div>
      </div>

      {toast && (
        <div className="mx-6 mt-3 px-3.5 py-2 rounded-lg bg-emerald-950/70 border border-emerald-500/40 text-xs text-emerald-200">
          {toast}
        </div>
      )}

      {/* Main Termius Dashboard Canvas */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Groups Section (when at root) */}
        {!selectedGroupId && groups.length > 0 && (
          <section>
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2.5">
              Groups
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {groups.map((g) => {
                const count = hosts.filter((h) => h.groupId === g.id).length;
                return (
                  <div
                    key={g.id}
                    onClick={() => setSelectedGroupId(g.id)}
                    className="group flex items-center justify-between p-3 rounded-xl bg-[var(--bg-panel)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] hover:border-[var(--border-accent)] cursor-pointer transition"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="p-2 rounded-lg bg-amber-500/15 text-amber-400">
                        <Folder className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-[var(--text-primary)] truncate">
                          {g.name}
                        </div>
                        <div className="text-[11px] text-[var(--text-muted)]">
                          {count} {count === 1 ? "Host" : "Hosts"}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteGroup(g.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-red-500/20 text-red-400 transition"
                      title="Delete group"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Hosts Grid */}
        <section>
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2.5">
            Hosts ({visibleHosts.length})
          </h4>

          {visibleHosts.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-panel)]/50 p-12 text-center">
              <Server className="w-9 h-9 text-[var(--accent-primary)] mx-auto mb-3 opacity-80" />
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                No Saved Hosts Yet
              </h3>
              <p className="text-xs text-[var(--text-secondary)] max-w-md mx-auto mb-4">
                Add hosts the clean Termius way—click <strong>New Host</strong>{" "}
                to open the side inspector, paste{" "}
                <code className="text-white">ssh user@host</code> in the top bar,
                or import your existing <code className="text-white">~/.ssh/config</code>.
              </p>
              <button
                onClick={() => {
                  setEditingHost(null);
                  setDrawerOpen(true);
                }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-xs font-semibold text-white transition"
              >
                <Plus className="w-4 h-4" />
                <span>Add Your First Host</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {visibleHosts.map((h) => {
                const keyName = keys.find((k) => k.id === h.keyId)?.name;
                const jumpHost = hosts.find((j) => j.id === h.jumpHostId);
                return (
                  <div
                    key={h.id}
                    onDoubleClick={() => openHostTerminal(h)}
                    className="group relative flex flex-col justify-between p-3.5 rounded-xl bg-[var(--bg-panel)] hover:bg-[var(--bg-elevated)] border border-[var(--border-subtle)] hover:border-[var(--border-accent)] cursor-pointer transition shadow-xs"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="p-2 rounded-lg bg-[var(--accent-glow)] border border-[var(--border-accent)] text-[var(--accent-primary)] shrink-0">
                            <Server className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-[var(--text-primary)] truncate">
                              {h.label}
                            </div>
                            <div className="text-[11px] font-mono text-[var(--text-secondary)] truncate">
                              {h.username}@{h.address}
                              {h.port !== 22 ? `:${h.port}` : ""}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Badges: Auth Key + Jump Host + Tags */}
                      <div className="flex flex-wrap items-center gap-1 mt-2">
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/5 text-[10px] text-[var(--text-secondary)]">
                          <KeyRound className="w-2.5 h-2.5 text-amber-400" />
                          {h.authMethod === "key"
                            ? keyName || "SSH Key"
                            : h.authMethod}
                        </span>
                        {jumpHost && (
                          <span className="px-1.5 py-0.5 rounded bg-cyan-500/15 text-[10px] text-cyan-300">
                            via {jumpHost.label}
                          </span>
                        )}
                        {h.tags.map((t) => (
                          <span
                            key={t}
                            className="px-1.5 py-0.5 rounded bg-white/5 text-[10px] text-[var(--text-muted)]"
                          >
                            #{t}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Quick Connect / SFTP / Edit Footer */}
                    <div className="mt-3 pt-2.5 border-t border-white/[0.05] flex items-center justify-between">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openHostTerminal(h);
                          }}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-[11px] font-semibold text-white transition"
                        >
                          <Play className="w-2.5 h-2.5" />
                          <span>SSH</span>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openDualSftpTab(h.id);
                          }}
                          className="flex items-center gap-1 px-2 py-1 rounded-md bg-white/5 hover:bg-white/10 text-[11px] text-amber-300 transition"
                          title="Open Dual-Pane SFTP"
                        >
                          <FolderSync className="w-3 h-3" />
                          <span>SFTP</span>
                        </button>
                      </div>

                      <div className="flex items-center gap-0.5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingHost(h);
                            setDrawerOpen(true);
                          }}
                          className="p-1.5 rounded hover:bg-white/10 text-[var(--text-secondary)] hover:text-white"
                          title="Edit Host"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDuplicateHost(h);
                          }}
                          className="p-1.5 rounded hover:bg-white/10 text-[var(--text-secondary)] hover:text-white"
                          title="Duplicate Host"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteHost(h.id);
                          }}
                          className="p-1.5 rounded hover:bg-red-500/20 text-[var(--text-secondary)] hover:text-red-400"
                          title="Delete Host"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Termius-Style Slide-Over Right Host Inspector */}
      <HostEditorDrawer
        host={editingHost}
        isOpen={drawerOpen}
        defaultGroupId={selectedGroupId}
        onClose={() => setDrawerOpen(false)}
      />

      {/* New Group Modal */}
      {newGroupModal && (
        <div className="fixed inset-0 z-40 bg-black/65 flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-accent)] p-5">
            <h3 className="text-sm font-semibold mb-3">Create Host Group</h3>
            <input
              autoFocus
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateGroup()}
              placeholder="e.g. Production, Homelab, Proxmox..."
              className="w-full px-3 py-2 rounded-lg bg-black/40 border border-[var(--border-subtle)] text-xs mb-4 focus:outline-none focus:border-[var(--border-accent)]"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setNewGroupModal(false)}
                className="px-3 py-1.5 rounded-lg text-xs bg-white/5"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateGroup}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-[var(--accent-primary)] text-white"
              >
                Create Group
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
