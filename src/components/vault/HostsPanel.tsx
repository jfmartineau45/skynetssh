import React, { useEffect, useMemo, useRef, useState } from "react";
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
  ChevronDown,
  KeyRound,
  Zap,
  Radar,
  LayoutGrid,
  List,
  Layers,
  Tag,
  CheckSquare,
  Square,
  ArrowUp,
  ArrowDown,
  X,
} from "lucide-react";
import type { GroupRecord, HostRecord } from "../../types/models";
import { useVaultStore } from "../../store/useVaultStore";
import { useWorkspaceStore } from "../../store/useWorkspaceStore";
import {
  HostEditorDrawer,
  parseSshConnectionString,
} from "./HostEditorDrawer";
import { apiImportSshConfig, apiProbeHost, isTauriRuntime } from "../../lib/ipc";

const TENANT_COLORS = [
  { hex: "#38bdf8", label: "Sky" },
  { hex: "#10b981", label: "Emerald" },
  { hex: "#f59e0b", label: "Amber" },
  { hex: "#a855f7", label: "Purple" },
  { hex: "#ef4444", label: "Crimson" },
  { hex: "#06b6d4", label: "Cyan" },
  { hex: "#ec4899", label: "Pink" },
];

type HostViewMode = "grid" | "list";
type HostSortKey = "label" | "address" | "group";

export const HostsPanel: React.FC = () => {
  const {
    status,
    groups,
    hosts,
    keys,
    sshScan,
    setActiveSection,
    saveHost,
    bulkSaveHosts,
    bulkDeleteHosts,
    saveGroup,
    deleteHost,
    deleteGroup,
    reloadSnapshot,
    newHostDrawerRequested,
    setNewHostDrawerRequested,
  } = useVaultStore();
  const { openHostTerminal, openDualSftpTab } = useWorkspaceStore();

  const isReadOnly = Boolean(status?.readOnly);

  const [viewMode, setViewMode] = useState<HostViewMode>(
    () => (localStorage.getItem("skynet_hosts_view") as HostViewMode) || "list"
  );
  const [groupByTenant, setGroupByTenant] = useState<boolean>(
    () => localStorage.getItem("skynet_hosts_grouped") !== "false"
  );
  const [sortKey, setSortKey] = useState<HostSortKey>("label");
  const [sortAsc, setSortAsc] = useState<boolean>(true);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [quickConnectInput, setQuickConnectInput] = useState("");

  /* Multi-Select Bulk Operations State */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkTagInput, setBulkTagInput] = useState("");
  const [bulkTagOpen, setBulkTagOpen] = useState(false);

  /* Hover-Only Online / Offline Reachability State */
  const [probeMap, setProbeMap] = useState<
    Record<
      string,
      {
        state: "probing" | "online" | "offline";
        detail: string;
        checkedAt: number;
      }
    >
  >({});
  const hoverTimersRef = useRef<Record<string, number>>({});

  const runProbeForHost = async (h: HostRecord, force = false) => {
    const existing = probeMap[h.id];
    if (!force && existing) {
      if (existing.state === "probing") return;
      if (Date.now() - existing.checkedAt < 45_000) return;
    }
    const gName = h.groupId
      ? groups.find((g) => g.id === h.groupId)?.name ?? ""
      : "";
    const isMultiPing =
      h.address.trim().startsWith("198.") ||
      h.label.toLowerCase().includes("secorall") ||
      gName.toLowerCase().includes("secorall");

    setProbeMap((prev) => ({
      ...prev,
      [h.id]: {
        state: "probing",
        detail: isMultiPing ? "Pinging (3x)..." : "Pinging...",
        checkedAt: Date.now(),
      },
    }));

    if (!isTauriRuntime()) {
      setProbeMap((prev) => ({
        ...prev,
        [h.id]: {
          state: "online",
          detail: isMultiPing ? "Online (3/3) · 18ms" : "Online · 4ms",
          checkedAt: Date.now(),
        },
      }));
      return;
    }

    try {
      const res = await apiProbeHost(h.id);
      setProbeMap((prev) => ({
        ...prev,
        [h.id]: {
          state: res.online ? "online" : "offline",
          detail: res.detail,
          checkedAt: Date.now(),
        },
      }));
    } catch {
      setProbeMap((prev) => ({
        ...prev,
        [h.id]: {
          state: "offline",
          detail: "Offline",
          checkedAt: Date.now(),
        },
      }));
    }
  };

  const handleHostHoverEnter = (h: HostRecord) => {
    if (hoverTimersRef.current[h.id]) {
      window.clearTimeout(hoverTimersRef.current[h.id]);
    }
    hoverTimersRef.current[h.id] = window.setTimeout(() => {
      void runProbeForHost(h, false);
    }, 150);
  };

  const handleHostHoverLeave = (hostId: string) => {
    if (hoverTimersRef.current[hostId]) {
      window.clearTimeout(hoverTimersRef.current[hostId]);
      delete hoverTimersRef.current[hostId];
    }
  };

  const renderHoverProbeBadge = (h: HostRecord) => {
    const pr = probeMap[h.id];
    if (!pr) return null;
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          void runProbeForHost(h, true);
        }}
        title="Click to re-check reachability"
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono border shrink-0 transition ${
          pr.state === "probing"
            ? "opacity-100 bg-amber-500/15 border-amber-400/40 text-amber-200"
            : pr.state === "online"
            ? "opacity-0 group-hover:opacity-100 bg-emerald-500/15 border-emerald-400/40 text-emerald-300"
            : "opacity-0 group-hover:opacity-100 bg-red-500/15 border-red-400/40 text-red-300"
        }`}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            pr.state === "probing"
              ? "bg-amber-400 animate-ping"
              : pr.state === "online"
              ? "bg-emerald-400"
              : "bg-red-500"
          }`}
        />
        <span>{pr.detail}</span>
      </button>
    );
  };

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
  const [editingGroup, setEditingGroup] = useState<GroupRecord | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupColor, setNewGroupColor] = useState("#38bdf8");
  const [toast, setToast] = useState<string | null>(null);

  const flashToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast((cur) => (cur === msg ? null : cur));
    }, 3500);
  };

  const changeViewMode = (mode: HostViewMode) => {
    setViewMode(mode);
    localStorage.setItem("skynet_hosts_view", mode);
  };

  const toggleGroupByTenant = () => {
    const next = !groupByTenant;
    setGroupByTenant(next);
    localStorage.setItem("skynet_hosts_grouped", String(next));
  };

  const groupMap = useMemo(() => {
    const m = new Map<string, GroupRecord>();
    for (const g of groups) m.set(g.id, g);
    return m;
  }, [groups]);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    hosts.forEach((h) => h.tags.forEach((t) => s.add(t)));
    return Array.from(s).sort();
  }, [hosts]);

  const visibleHosts = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = hosts.filter((h) => {
      if (selectedGroupId && h.groupId !== selectedGroupId) return false;
      if (selectedTag && !h.tags.includes(selectedTag)) return false;
      if (!q) return true;
      const gName = h.groupId ? groupMap.get(h.groupId)?.name ?? "" : "";
      return (
        h.label.toLowerCase().includes(q) ||
        h.address.toLowerCase().includes(q) ||
        h.username.toLowerCase().includes(q) ||
        gName.toLowerCase().includes(q) ||
        h.tags.some((t) => t.toLowerCase().includes(q))
      );
    });

    const dir = sortAsc ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortKey === "address") {
        return a.address.localeCompare(b.address) * dir;
      }
      if (sortKey === "group") {
        const ga = a.groupId ? groupMap.get(a.groupId)?.name ?? "zzz" : "zzz";
        const gb = b.groupId ? groupMap.get(b.groupId)?.name ?? "zzz" : "zzz";
        const cmp = ga.toLowerCase().localeCompare(gb.toLowerCase());
        if (cmp !== 0) return cmp * dir;
      }
      return a.label.toLowerCase().localeCompare(b.label.toLowerCase()) * dir;
    });
  }, [hosts, selectedGroupId, selectedTag, search, groupMap, sortKey, sortAsc]);

  const tenantSections = useMemo(() => {
    if (!groupByTenant || selectedGroupId) {
      return [
        {
          id: selectedGroupId ?? "__all__",
          title: selectedGroupId
            ? groupMap.get(selectedGroupId)?.name ?? "Tenant / Group"
            : `All Machines`,
          color: selectedGroupId
            ? groupMap.get(selectedGroupId)?.color ?? "#38bdf8"
            : "#ef4444",
          group: selectedGroupId ? groupMap.get(selectedGroupId) ?? null : null,
          items: visibleHosts,
        },
      ];
    }

    const byGroup = new Map<string, HostRecord[]>();
    for (const h of visibleHosts) {
      const gid = h.groupId && groupMap.has(h.groupId) ? h.groupId : "__unassigned__";
      const arr = byGroup.get(gid) ?? [];
      arr.push(h);
      byGroup.set(gid, arr);
    }

    const sections: {
      id: string;
      title: string;
      color: string;
      group: GroupRecord | null;
      items: HostRecord[];
    }[] = [];

    const sortedGroups = [...groups].sort((a, b) =>
      a.name.toLowerCase().localeCompare(b.name.toLowerCase())
    );

    for (const g of sortedGroups) {
      const items = byGroup.get(g.id) ?? [];
      if (items.length > 0 || (!search.trim() && !selectedTag)) {
        sections.push({
          id: g.id,
          title: g.name,
          color: g.color || "#38bdf8",
          group: g,
          items,
        });
      }
    }

    const unassigned = byGroup.get("__unassigned__") ?? [];
    if (unassigned.length > 0 || sections.length === 0) {
      sections.push({
        id: "__unassigned__",
        title: groups.length > 0 ? "Unassigned Machines" : "Machines",
        color: "#71717a",
        group: null,
        items: unassigned,
      });
    }

    return sections;
  }, [groupByTenant, selectedGroupId, visibleHosts, groups, groupMap, search, selectedTag]);

  const selectedHosts = useMemo(
    () => hosts.filter((h) => selectedIds.has(h.id)),
    [hosts, selectedIds]
  );

  const selectedHostTags = useMemo(() => {
    const s = new Set<string>();
    selectedHosts.forEach((h) => h.tags.forEach((t) => s.add(t)));
    return Array.from(s).sort();
  }, [selectedHosts]);

  const toggleSelectOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectGroup = (items: HostRecord[]) => {
    if (items.length === 0) return;
    const allSelected = items.every((h) => selectedIds.has(h.id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        items.forEach((h) => next.delete(h.id));
      } else {
        items.forEach((h) => next.add(h.id));
      }
      return next;
    });
  };

  const handleSortHeader = (key: HostSortKey) => {
    if (sortKey === key) setSortAsc((v) => !v);
    else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  /* Bulk Actions */
  const handleBulkAssignGroup = async (targetGroupId: string) => {
    if (selectedHosts.length === 0 || isReadOnly) return;
    const gid = targetGroupId === "__none__" ? null : targetGroupId;
    const now = Date.now();
    await bulkSaveHosts(
      selectedHosts.map((h) => ({ ...h, groupId: gid, updatedAt: now }))
    );
    const label = gid ? groupMap.get(gid)?.name ?? "Group" : "Unassigned";
    flashToast(`Moved ${selectedHosts.length} machine(s) to ${label}`);
  };

  const handleBulkAddTags = async (e: React.FormEvent) => {
    e.preventDefault();
    const newTags = bulkTagInput
      .split(",")
      .map((t) => t.trim().replace(/^#/, ""))
      .filter(Boolean);
    if (newTags.length === 0 || selectedHosts.length === 0 || isReadOnly) return;
    const now = Date.now();
    await bulkSaveHosts(
      selectedHosts.map((h) => ({
        ...h,
        tags: Array.from(new Set([...h.tags, ...newTags])),
        updatedAt: now,
      }))
    );
    setBulkTagInput("");
    setBulkTagOpen(false);
    flashToast(
      `Tagged ${selectedHosts.length} machine(s) with ${newTags
        .map((t) => `#${t}`)
        .join(", ")}`
    );
  };

  const handleBulkRemoveTag = async (tagToRemove: string) => {
    if (!tagToRemove || selectedHosts.length === 0 || isReadOnly) return;
    const now = Date.now();
    await bulkSaveHosts(
      selectedHosts.map((h) => ({
        ...h,
        tags: h.tags.filter((t) => t !== tagToRemove),
        updatedAt: now,
      }))
    );
    flashToast(`Removed #${tagToRemove} from selected machines`);
  };

  const handleBulkConnect = () => {
    const slice = selectedHosts.slice(0, 12);
    slice.forEach((h) => openHostTerminal(h));
    setSelectedIds(new Set());
  };

  const handleBulkDelete = async () => {
    if (selectedHosts.length === 0 || isReadOnly) return;
    const count = selectedHosts.length;
    await bulkDeleteHosts(selectedHosts.map((h) => h.id));
    setSelectedIds(new Set());
    flashToast(`Deleted ${count} machine(s)`);
  };

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
      tags: selectedTag ? [selectedTag] : [],
      keepaliveIntervalSecs: 30,
      updatedAt: Date.now(),
    };

    if (!isReadOnly) {
      const saved = await saveHost(record);
      setQuickConnectInput("");
      openHostTerminal(saved);
    }
  };

  const handleDuplicateHost = async (h: HostRecord) => {
    if (isReadOnly) return;
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
      flashToast(`Imported ${count} host(s) from ~/.ssh/config`);
    } catch (e) {
      flashToast(`SSH config import error: ${String(e)}`);
    }
  };

  const handleSaveGroupModal = async () => {
    if (!newGroupName.trim() || isReadOnly) return;
    await saveGroup({
      id: editingGroup?.id ?? crypto.randomUUID(),
      name: newGroupName.trim(),
      icon: "folder",
      color: newGroupColor,
      parentId: editingGroup?.parentId ?? null,
      updatedAt: Date.now(),
    });
    setNewGroupName("");
    setEditingGroup(null);
    setNewGroupModal(false);
  };

  const activeGroup = groups.find((g) => g.id === selectedGroupId);

  return (
    <div className="relative flex-1 h-full flex flex-col min-h-0 overflow-hidden">
      {/* Top Action & Quick-Connect Header */}
      <div className="px-6 py-3.5 border-b border-[var(--border-subtle)] bg-[var(--bg-panel)] space-y-2.5 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Quick-Connect / Smart Save Bar */}
          <form
            onSubmit={handleQuickConnectSubmit}
            className="flex-1 min-w-[260px] max-w-lg flex items-center gap-2"
          >
            <div className="relative flex-1">
              <Zap className="w-3.5 h-3.5 text-[var(--accent-primary)] absolute left-3 top-2.5" />
              <input
                disabled={isReadOnly}
                value={quickConnectInput}
                onChange={(e) => setQuickConnectInput(e.target.value)}
                placeholder={
                  isReadOnly
                    ? "Read-Only Vault Member Mode (SSH & SFTP enabled)"
                    : "Quick connect & save: ssh user@host -p 22"
                }
                className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-black/40 border border-[var(--border-subtle)] focus:border-[var(--border-accent)] text-xs text-white placeholder-[var(--text-muted)] focus:outline-none disabled:opacity-60"
              />
            </div>
            {quickConnectInput.trim() && !isReadOnly && (
              <button
                type="submit"
                className="px-3 py-1.5 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-xs font-semibold text-white shrink-0 transition"
              >
                Connect & Save
              </button>
            )}
          </form>

          {/* View Switcher (List vs Grid + Group by Tenant) & Primary Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center p-0.5 rounded-lg bg-black/40 border border-[var(--border-subtle)]">
              <button
                onClick={() => changeViewMode("list")}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition ${
                  viewMode === "list"
                    ? "bg-[var(--accent-primary)] text-white shadow-xs"
                    : "text-[var(--text-secondary)] hover:text-white"
                }`}
                title="Dense Multi-Tenant List View"
              >
                <List className="w-3.5 h-3.5" />
                <span>List</span>
              </button>
              <button
                onClick={() => changeViewMode("grid")}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition ${
                  viewMode === "grid"
                    ? "bg-[var(--accent-primary)] text-white shadow-xs"
                    : "text-[var(--text-secondary)] hover:text-white"
                }`}
                title="Card Grid View"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                <span>Cards</span>
              </button>
            </div>

            <button
              onClick={toggleGroupByTenant}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition ${
                groupByTenant
                  ? "bg-sky-500/15 border-sky-400/40 text-sky-200"
                  : "bg-white/5 border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-white"
              }`}
              title="Group machines into collapsible Tenant / Group sections"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>By Tenant</span>
            </button>

            {!isReadOnly && (
              <>
                <button
                  onClick={handleImportOpenSshConfig}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-[var(--border-subtle)] text-xs text-[var(--text-secondary)] hover:text-white transition"
                  title="Import hosts automatically from ~/.ssh/config"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>~/.ssh</span>
                </button>

                <button
                  onClick={() => {
                    setEditingGroup(null);
                    setNewGroupName("");
                    setNewGroupColor("#38bdf8");
                    setNewGroupModal(true);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] transition"
                >
                  <FolderPlus className="w-3.5 h-3.5 text-amber-400" />
                  <span>New Tenant / Group</span>
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
              </>
            )}
          </div>
        </div>

        {/* Filter Bar: Tenant Pills + Tag Pills + Search */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 flex-wrap text-xs">
            <button
              onClick={() => setSelectedGroupId(null)}
              className={`px-2.5 py-0.5 rounded-md font-semibold transition ${
                !selectedGroupId
                  ? "bg-white/10 text-white"
                  : "text-[var(--text-muted)] hover:text-white"
              }`}
            >
              All Tenants ({hosts.length})
            </button>
            {groups.map((g) => {
              const active = selectedGroupId === g.id;
              const cnt = hosts.filter((h) => h.groupId === g.id).length;
              return (
                <button
                  key={g.id}
                  onClick={() => setSelectedGroupId(active ? null : g.id)}
                  className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-md border text-[11px] font-medium transition ${
                    active
                      ? "bg-[var(--bg-elevated)] border-[var(--border-accent)] text-white"
                      : "bg-black/25 border-transparent text-[var(--text-secondary)] hover:text-white"
                  }`}
                >
                  <span
                    style={{ backgroundColor: g.color || "#38bdf8" }}
                    className="w-2 h-2 rounded-full shrink-0"
                  />
                  <span>{g.name}</span>
                  <span className="text-[10px] font-mono text-[var(--text-muted)]">
                    {cnt}
                  </span>
                </button>
              );
            })}
            {activeGroup && (
              <button
                onClick={() => setSelectedGroupId(null)}
                className="text-[11px] text-[var(--text-muted)] hover:text-white ml-1"
              >
                Clear
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {allTags.map((tag) => (
              <button
                key={tag}
                onClick={() =>
                  setSelectedTag(selectedTag === tag ? null : tag)
                }
                className={`px-2 py-0.5 rounded-full text-[11px] font-mono transition ${
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
                placeholder="Search machine, IP, tenant, #tag..."
                className="w-56 pl-8 pr-2.5 py-1 rounded-lg bg-black/35 border border-[var(--border-subtle)] text-xs text-white focus:outline-none focus:border-[var(--border-accent)]"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Multi-Select Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <div className="px-6 py-2 bg-[var(--bg-elevated)] border-b border-[var(--border-accent)] flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
          <div className="flex items-center gap-3">
            <span className="font-bold text-white">
              {selectedIds.size} selected
            </span>
            <button
              onClick={() =>
                setSelectedIds(new Set(visibleHosts.map((h) => h.id)))
              }
              className="text-[11px] text-sky-300 hover:underline"
            >
              Select all visible ({visibleHosts.length})
            </button>
            <button
              onClick={() => {
                setSelectedIds(new Set());
                setBulkTagOpen(false);
              }}
              className="text-[11px] text-[var(--text-muted)] hover:text-white"
            >
              Clear
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleBulkConnect}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition"
            >
              <Play className="w-3 h-3" />
              <span>Open SSH Tabs</span>
            </button>

            {!isReadOnly && (
              <>
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) {
                      void handleBulkAssignGroup(e.target.value);
                    }
                  }}
                  className="px-2.5 py-1 rounded-md bg-black/50 border border-[var(--border-subtle)] text-xs text-white"
                >
                  <option value="" disabled>
                    Move to Tenant / Group...
                  </option>
                  <option value="__none__">— Unassigned —</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>

                {bulkTagOpen ? (
                  <form
                    onSubmit={handleBulkAddTags}
                    className="flex items-center gap-1"
                  >
                    <input
                      autoFocus
                      value={bulkTagInput}
                      onChange={(e) => setBulkTagInput(e.target.value)}
                      placeholder="prod, web, client-a"
                      className="w-40 px-2 py-1 rounded bg-black/50 border border-[var(--border-accent)] text-xs font-mono text-white focus:outline-none"
                    />
                    <button
                      type="submit"
                      className="px-2 py-1 rounded bg-[var(--accent-primary)] text-white font-semibold"
                    >
                      Apply
                    </button>
                    <button
                      type="button"
                      onClick={() => setBulkTagOpen(false)}
                      className="p-1 text-[var(--text-muted)] hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </form>
                ) : (
                  <button
                    onClick={() => setBulkTagOpen(true)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-white/5 hover:bg-white/10 border border-[var(--border-subtle)] text-white transition"
                  >
                    <Tag className="w-3 h-3 text-purple-300" />
                    <span>+ Add Tag</span>
                  </button>
                )}

                {selectedHostTags.length > 0 && (
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value) {
                        void handleBulkRemoveTag(e.target.value);
                      }
                    }}
                    className="px-2 py-1 rounded-md bg-black/50 border border-[var(--border-subtle)] text-xs text-[var(--text-secondary)]"
                  >
                    <option value="" disabled>
                      Remove #tag...
                    </option>
                    {selectedHostTags.map((t) => (
                      <option key={t} value={t}>
                        Remove #{t}
                      </option>
                    ))}
                  </select>
                )}

                <button
                  onClick={handleBulkDelete}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-300 transition"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Delete</span>
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {toast && (
        <div className="mx-6 mt-3 px-3.5 py-2 rounded-lg bg-emerald-950/70 border border-emerald-500/40 text-xs text-emerald-200 shrink-0">
          {toast}
        </div>
      )}

      {/* Main Hosts Canvas */}
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {/* Auto-Sniffed ~/.ssh Discovery Strip */}
        {!isReadOnly &&
          sshScan &&
          (sshScan.keys.some((k) => !k.alreadyInVault) ||
            sshScan.configHosts.some((h) => !h.alreadyInVault)) && (
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/35 text-xs">
              <div className="flex items-center gap-2.5 text-amber-200">
                <Radar className="w-4 h-4 text-amber-400 shrink-0" />
                <span>
                  Sniffed <code>~/.ssh</code>:{" "}
                  <strong>
                    {sshScan.keys.filter((k) => !k.alreadyInVault).length}{" "}
                    unimported key(s)
                  </strong>{" "}
                  &{" "}
                  <strong>
                    {
                      sshScan.configHosts.filter((h) => !h.alreadyInVault)
                        .length
                    }{" "}
                    unimported config host(s)
                  </strong>
                </span>
              </div>
              <div className="flex items-center gap-2">
                {sshScan.keys.some((k) => !k.alreadyInVault) && (
                  <button
                    onClick={() => setActiveSection("keychain")}
                    className="px-2.5 py-1 rounded-md bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 font-semibold transition"
                  >
                    Review Keys in Keychain &rarr;
                  </button>
                )}
                {sshScan.configHosts.some((h) => !h.alreadyInVault) && (
                  <button
                    onClick={handleImportOpenSshConfig}
                    className="px-2.5 py-1 rounded-md bg-[var(--accent-primary)] text-white font-semibold transition"
                  >
                    Import Hosts Now
                  </button>
                )}
              </div>
            </div>
          )}

        {hosts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-panel)]/50 p-12 text-center">
            <Server className="w-9 h-9 text-[var(--accent-primary)] mx-auto mb-3 opacity-80" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">
              No Saved Machines Yet
            </h3>
            <p className="text-xs text-[var(--text-secondary)] max-w-md mx-auto mb-4">
              Create Tenant Groups for your clients, paste{" "}
              <code className="text-white">ssh user@host</code> in the top bar,
              or import <code className="text-white">~/.ssh/config</code>.
            </p>
            {!isReadOnly && (
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
            )}
          </div>
        ) : visibleHosts.length === 0 ? (
          <div className="py-12 text-center text-xs text-[var(--text-muted)]">
            No machines match your current search or tenant/tag filter.
          </div>
        ) : (
          tenantSections.map((sec) => {
            const isCollapsed = Boolean(collapsedGroups[sec.id]);
            const allInSecSelected =
              sec.items.length > 0 &&
              sec.items.every((h) => selectedIds.has(h.id));

            return (
              <section
                key={sec.id}
                className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)]/60 overflow-hidden"
              >
                {/* Tenant / Group Section Header */}
                <div className="px-3.5 py-2 bg-[var(--bg-panel)] border-b border-[var(--border-subtle)] flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <button
                      onClick={() => toggleSelectGroup(sec.items)}
                      className="text-[var(--text-muted)] hover:text-white shrink-0"
                      title="Select all machines in this tenant group"
                    >
                      {allInSecSelected ? (
                        <CheckSquare className="w-3.5 h-3.5 text-[var(--accent-primary)]" />
                      ) : (
                        <Square className="w-3.5 h-3.5" />
                      )}
                    </button>

                    <button
                      onClick={() =>
                        setCollapsedGroups((prev) => ({
                          ...prev,
                          [sec.id]: !prev[sec.id],
                        }))
                      }
                      className="flex items-center gap-2 text-xs font-bold text-[var(--text-primary)] truncate"
                    >
                      {isCollapsed ? (
                        <ChevronRight className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                      )}
                      <span
                        style={{ backgroundColor: sec.color }}
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                      />
                      <span className="truncate">{sec.title}</span>
                      <span className="px-1.5 py-0.2 rounded bg-white/5 text-[10px] font-mono text-[var(--text-muted)]">
                        {sec.items.length}
                      </span>
                    </button>
                  </div>

                  {!isReadOnly && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => {
                          if (sec.group) {
                            setSelectedGroupId(sec.group.id);
                          }
                          setEditingHost(null);
                          setDrawerOpen(true);
                        }}
                        className="px-2 py-0.5 rounded hover:bg-white/10 text-[11px] text-[var(--text-secondary)] hover:text-white transition"
                      >
                        + Host
                      </button>
                      {sec.group && (
                        <>
                          <button
                            onClick={() => {
                              setEditingGroup(sec.group);
                              setNewGroupName(sec.group!.name);
                              setNewGroupColor(sec.group!.color || "#38bdf8");
                              setNewGroupModal(true);
                            }}
                            className="p-1 rounded hover:bg-white/10 text-[var(--text-muted)] hover:text-white"
                            title="Rename / recolor Tenant Group"
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => deleteGroup(sec.group!.id)}
                            className="p-1 rounded hover:bg-red-500/20 text-[var(--text-muted)] hover:text-red-400"
                            title="Delete Tenant Group (keeps hosts)"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {!isCollapsed &&
                  (sec.items.length === 0 ? (
                    <div className="px-4 py-4 text-xs text-[var(--text-muted)]">
                      No machines assigned to this tenant yet. Select machines
                      and choose <strong>Move to Tenant / Group</strong>, or
                      click <strong>+ Host</strong>.
                    </div>
                  ) : viewMode === "list" ? (
                    /* DENSE MULTI-TENANT LIST VIEW */
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-white/[0.05] bg-black/20 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                            <th className="w-9 px-3 py-2" />
                            <th className="px-3 py-2">
                              <button
                                onClick={() => handleSortHeader("label")}
                                className="flex items-center gap-1 hover:text-white"
                              >
                                <span>Machine</span>
                                {sortKey === "label" &&
                                  (sortAsc ? (
                                    <ArrowUp className="w-2.5 h-2.5" />
                                  ) : (
                                    <ArrowDown className="w-2.5 h-2.5" />
                                  ))}
                              </button>
                            </th>
                            <th className="px-3 py-2">
                              <button
                                onClick={() => handleSortHeader("address")}
                                className="flex items-center gap-1 hover:text-white"
                              >
                                <span>User @ Host</span>
                                {sortKey === "address" &&
                                  (sortAsc ? (
                                    <ArrowUp className="w-2.5 h-2.5" />
                                  ) : (
                                    <ArrowDown className="w-2.5 h-2.5" />
                                  ))}
                              </button>
                            </th>
                            {!groupByTenant && (
                              <th className="px-3 py-2">
                                <button
                                  onClick={() => handleSortHeader("group")}
                                  className="flex items-center gap-1 hover:text-white"
                                >
                                  <span>Tenant / Group</span>
                                  {sortKey === "group" &&
                                    (sortAsc ? (
                                      <ArrowUp className="w-2.5 h-2.5" />
                                    ) : (
                                      <ArrowDown className="w-2.5 h-2.5" />
                                    ))}
                                </button>
                              </th>
                            )}
                            <th className="px-3 py-2">Auth / Bastion</th>
                            <th className="px-3 py-2">Tags</th>
                            <th className="px-3 py-2 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/[0.04]">
                          {sec.items.map((h) => {
                            const checked = selectedIds.has(h.id);
                            const keyName = keys.find(
                              (k) => k.id === h.keyId
                            )?.name;
                            const jumpHost = hosts.find(
                              (j) => j.id === h.jumpHostId
                            );
                            const grp = h.groupId
                              ? groupMap.get(h.groupId)
                              : null;

                            return (
                              <tr
                                key={h.id}
                                onMouseEnter={() => handleHostHoverEnter(h)}
                                onMouseLeave={() => handleHostHoverLeave(h.id)}
                                onDoubleClick={() => openHostTerminal(h)}
                                className={`group cursor-pointer transition ${
                                  checked
                                    ? "bg-[var(--accent-glow)]/40"
                                    : "hover:bg-[var(--bg-hover)]"
                                }`}
                              >
                                <td
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleSelectOne(h.id);
                                  }}
                                  className="px-3 py-2 text-[var(--text-muted)] hover:text-white"
                                >
                                  {checked ? (
                                    <CheckSquare className="w-3.5 h-3.5 text-[var(--accent-primary)]" />
                                  ) : (
                                    <Square className="w-3.5 h-3.5" />
                                  )}
                                </td>

                                <td className="px-3 py-2 font-semibold text-[var(--text-primary)]">
                                  <div className="flex items-center gap-2">
                                    <Server className="w-3.5 h-3.5 text-[var(--accent-primary)] shrink-0" />
                                    <span className="truncate max-w-[200px]">
                                      {h.label}
                                    </span>
                                    {renderHoverProbeBadge(h)}
                                  </div>
                                </td>

                                <td className="px-3 py-2 font-mono text-[11px] text-[var(--text-secondary)]">
                                  {h.username}@{h.address}
                                  {h.port !== 22 ? `:${h.port}` : ""}
                                </td>

                                {!groupByTenant && (
                                  <td className="px-3 py-2">
                                    {grp ? (
                                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-white/5 text-[11px]">
                                        <span
                                          style={{
                                            backgroundColor:
                                              grp.color || "#38bdf8",
                                          }}
                                          className="w-2 h-2 rounded-full"
                                        />
                                        <span>{grp.name}</span>
                                      </span>
                                    ) : (
                                      <span className="text-[11px] text-[var(--text-muted)]">
                                        —
                                      </span>
                                    )}
                                  </td>
                                )}

                                <td className="px-3 py-2">
                                  <div className="flex items-center gap-1.5 flex-wrap">
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
                                  </div>
                                </td>

                                <td className="px-3 py-2">
                                  <div className="flex flex-wrap gap-1">
                                    {h.tags.map((t) => (
                                      <span
                                        key={t}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setSelectedTag(
                                            selectedTag === t ? null : t
                                          );
                                        }}
                                        className="px-1.5 py-0.2 rounded bg-white/5 hover:bg-white/15 text-[10px] font-mono text-[var(--text-muted)] hover:text-white"
                                      >
                                        #{t}
                                      </span>
                                    ))}
                                  </div>
                                </td>

                                <td className="px-3 py-2 text-right">
                                  <div className="inline-flex items-center gap-1">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openHostTerminal(h);
                                      }}
                                      className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-[11px] font-semibold text-white transition"
                                    >
                                      <Play className="w-2.5 h-2.5" />
                                      <span>SSH</span>
                                    </button>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openDualSftpTab(h.id);
                                      }}
                                      className="inline-flex items-center gap-1 px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-[11px] text-amber-300 transition"
                                    >
                                      <FolderSync className="w-3 h-3" />
                                      <span>SFTP</span>
                                    </button>
                                    {!isReadOnly && (
                                      <>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setEditingHost(h);
                                            setDrawerOpen(true);
                                          }}
                                          className="p-1 rounded hover:bg-white/10 text-[var(--text-secondary)] hover:text-white"
                                          title="Edit Host"
                                        >
                                          <Edit2 className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleDuplicateHost(h);
                                          }}
                                          className="p-1 rounded hover:bg-white/10 text-[var(--text-secondary)] hover:text-white"
                                          title="Duplicate Host"
                                        >
                                          <Copy className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            deleteHost(h.id);
                                          }}
                                          className="p-1 rounded hover:bg-red-500/20 text-[var(--text-secondary)] hover:text-red-400"
                                          title="Delete Host"
                                        >
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                      </>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    /* CARD GRID VIEW */
                    <div className="p-3.5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                      {sec.items.map((h) => {
                        const checked = selectedIds.has(h.id);
                        const keyName = keys.find(
                          (k) => k.id === h.keyId
                        )?.name;
                        const jumpHost = hosts.find(
                          (j) => j.id === h.jumpHostId
                        );
                        return (
                          <div
                            key={h.id}
                            onMouseEnter={() => handleHostHoverEnter(h)}
                            onMouseLeave={() => handleHostHoverLeave(h.id)}
                            onDoubleClick={() => openHostTerminal(h)}
                            className={`group relative flex flex-col justify-between p-3.5 rounded-xl bg-[var(--bg-panel)] hover:bg-[var(--bg-elevated)] border cursor-pointer transition shadow-xs ${
                              checked
                                ? "border-[var(--accent-primary)] ring-1 ring-[var(--accent-primary)]"
                                : "border-[var(--border-subtle)] hover:border-[var(--border-accent)]"
                            }`}
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

                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleSelectOne(h.id);
                                  }}
                                  className="text-[var(--text-muted)] hover:text-white shrink-0"
                                >
                                  {checked ? (
                                    <CheckSquare className="w-4 h-4 text-[var(--accent-primary)]" />
                                  ) : (
                                    <Square className="w-4 h-4 opacity-50 group-hover:opacity-100" />
                                  )}
                                </button>
                              </div>

                              <div className="flex flex-wrap items-center gap-1 mt-2">
                                {renderHoverProbeBadge(h)}
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
                                >
                                  <FolderSync className="w-3 h-3" />
                                  <span>SFTP</span>
                                </button>
                              </div>

                              {!isReadOnly && (
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
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
              </section>
            );
          })
        )}
      </div>

      {/* Termius-Style Slide-Over Right Host Inspector */}
      <HostEditorDrawer
        host={editingHost}
        isOpen={drawerOpen}
        defaultGroupId={selectedGroupId}
        onClose={() => setDrawerOpen(false)}
      />

      {/* Create / Edit Tenant Group Modal */}
      {newGroupModal && (
        <div className="fixed inset-0 z-40 bg-black/65 flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-accent)] p-5 space-y-3.5">
            <div className="flex items-center gap-2">
              <Folder className="w-4 h-4 text-amber-400" />
              <h3 className="text-sm font-semibold">
                {editingGroup
                  ? "Edit Tenant / Group"
                  : "Create Tenant / Host Group"}
              </h3>
            </div>
            <input
              autoFocus
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSaveGroupModal()}
              placeholder="e.g. Client: Acme Corp, Core Infra, Proxmox..."
              className="w-full px-3 py-2 rounded-lg bg-black/40 border border-[var(--border-subtle)] text-xs text-white focus:outline-none focus:border-[var(--border-accent)]"
            />
            <div>
              <div className="text-[11px] text-[var(--text-secondary)] mb-1.5">
                Tenant Badge Color
              </div>
              <div className="flex items-center gap-2">
                {TENANT_COLORS.map((c) => (
                  <button
                    key={c.hex}
                    type="button"
                    onClick={() => setNewGroupColor(c.hex)}
                    style={{ backgroundColor: c.hex }}
                    className={`w-6 h-6 rounded-full transition ${
                      newGroupColor === c.hex
                        ? "ring-2 ring-white scale-110"
                        : "opacity-65 hover:opacity-100"
                    }`}
                    title={c.label}
                  />
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => {
                  setEditingGroup(null);
                  setNewGroupModal(false);
                }}
                className="px-3 py-1.5 rounded-lg text-xs bg-white/5 hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveGroupModal}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-white"
              >
                {editingGroup ? "Save" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
