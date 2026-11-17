import React, { useEffect, useState } from "react";
import {
  X,
  Server,
  KeyRound,
  Plus,
  Play,
  Save,
  Sparkles,
  Upload,
  FolderPlus,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import type { AuthMethod, HostRecord } from "../../types/models";
import { useVaultStore } from "../../store/useVaultStore";
import { useWorkspaceStore } from "../../store/useWorkspaceStore";

interface Props {
  host: HostRecord | null;
  isOpen: boolean;
  defaultGroupId?: string | null;
  onClose: () => void;
}

import { parseSshConnectionString } from "../../lib/sshParser";
export { parseSshConnectionString };

export const HostEditorDrawer: React.FC<Props> = ({
  host,
  isOpen,
  defaultGroupId,
  onClose,
}) => {
  const {
    groups,
    hosts,
    keys,
    snippets,
    saveHost,
    saveGroup,
    generateKey,
    importKeyFile,
  } = useVaultStore();
  const { openHostTerminal } = useWorkspaceStore();

  const [label, setLabel] = useState("");
  const [address, setAddress] = useState("");
  const [port, setPort] = useState(22);
  const [username, setUsername] = useState("root");
  const [authMethod, setAuthMethod] = useState<AuthMethod>("key");
  const [password, setPassword] = useState("");
  const [keyId, setKeyId] = useState<string>("");
  const [groupId, setGroupId] = useState<string>("");
  const [tagsText, setTagsText] = useState("");
  const [jumpHostId, setJumpHostId] = useState<string>("");
  const [startupSnippetId, setStartupSnippetId] = useState<string>("");
  const [startupCommand, setStartupCommand] = useState("");
  const [notes, setNotes] = useState("");

  /* Inline Group & Key creation right inside the Termius-style drawer! */
  const [inlineNewGroup, setInlineNewGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [inlineKeyBusy, setInlineKeyBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    if (host) {
      setLabel(host.label);
      setAddress(host.address);
      setPort(host.port || 22);
      setUsername(host.username || "root");
      setAuthMethod(host.authMethod);
      setPassword(host.password ?? "");
      setKeyId(host.keyId ?? keys[0]?.id ?? "");
      setGroupId(host.groupId ?? "");
      setTagsText(host.tags.join(", "));
      setJumpHostId(host.jumpHostId ?? "");
      setStartupSnippetId(host.startupSnippetId ?? "");
      setStartupCommand(host.startupCommand ?? "");
      setNotes(host.notes ?? "");
    } else {
      setLabel("");
      setAddress("");
      setPort(22);
      setUsername("root");
      setAuthMethod(keys.length > 0 ? "key" : "password");
      setPassword("");
      setKeyId(keys[0]?.id ?? "");
      setGroupId(defaultGroupId ?? "");
      setTagsText("");
      setJumpHostId("");
      setStartupSnippetId("");
      setStartupCommand("");
      setNotes("");
    }
  }, [host, isOpen, defaultGroupId, keys]);

  if (!isOpen) return null;

  const handleAddressPasteOrChange = (val: string) => {
    if (val.startsWith("ssh ") || val.includes("@")) {
      const parsed = parseSshConnectionString(val);
      if (parsed?.address) {
        setAddress(parsed.address);
        if (parsed.username) setUsername(parsed.username);
        if (parsed.port) setPort(parsed.port);
        if (!label) setLabel(parsed.address);
        return;
      }
    }
    setAddress(val);
  };

  const handleCreateGroupInline = async () => {
    if (!newGroupName.trim()) return;
    const created = await saveGroup({
      id: crypto.randomUUID(),
      name: newGroupName.trim(),
      icon: "folder",
      color: "#ef4444",
      parentId: null,
      updatedAt: Date.now(),
    });
    setGroupId(created.id);
    setNewGroupName("");
    setInlineNewGroup(false);
  };

  const handleInlineGenerateEd25519 = async () => {
    setInlineKeyBusy(true);
    try {
      const keyLabel = label || address || "Skynet Ed25519 Key";
      const created = await generateKey(`${keyLabel} (Ed25519)`, "ed25519", null);
      setKeyId(created.id);
      setAuthMethod("key");
    } catch (e) {
      setError(String(e));
    } finally {
      setInlineKeyBusy(false);
    }
  };

  const handleInlineImportKey = async () => {
    const file = await open({ multiple: false, directory: false });
    if (!file || Array.isArray(file)) return;
    setInlineKeyBusy(true);
    try {
      const fileName = file.split(/[/\\]/).pop() || "Imported Key";
      const created = await importKeyFile(fileName, file, null);
      setKeyId(created.id);
      setAuthMethod("key");
    } catch (e) {
      setError(String(e));
    } finally {
      setInlineKeyBusy(false);
    }
  };

  const persistHost = async (andConnect: boolean) => {
    if (!address.trim()) {
      setError("IP address or hostname is required.");
      return;
    }
    const record: HostRecord = {
      id: host?.id ?? crypto.randomUUID(),
      label: label.trim() || address.trim(),
      address: address.trim(),
      port: Number(port) || 22,
      username: username.trim() || "root",
      authMethod,
      password: authMethod === "password" ? password : null,
      keyId: authMethod === "key" ? keyId || null : null,
      groupId: groupId || null,
      tags: tagsText
        .split(",")
        .map((t) => t.trim().replace(/^#/, ""))
        .filter(Boolean),
      jumpHostId: jumpHostId || null,
      startupSnippetId: startupSnippetId || null,
      startupCommand: startupCommand.trim() || null,
      keepaliveIntervalSecs: 30,
      notes: notes.trim() || null,
      lastConnectedAt: host?.lastConnectedAt ?? null,
      updatedAt: Date.now(),
    };
    try {
      const saved = await saveHost(record);
      onClose();
      if (andConnect) {
        openHostTerminal(saved);
      }
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="fixed inset-y-10 right-0 z-30 w-full max-w-md bg-[var(--bg-elevated)] border-l border-[var(--border-accent)] shadow-2xl flex flex-col">
      {/* Drawer Header */}
      <div className="px-5 py-3.5 border-b border-[var(--border-subtle)] flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-[var(--accent-glow)] text-[var(--accent-primary)]">
            <Server className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-[var(--text-primary)]">
              {host ? "Edit Host" : "New Host"}
            </h3>
            <p className="text-[11px] text-[var(--text-muted)]">
              Tip: Paste <code className="text-[var(--text-secondary)]">ssh user@host -p 2222</code> directly into Address
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-white hover:bg-white/10 transition"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Scrollable Termius-Style Form Cards */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {error && (
          <div className="p-2.5 rounded-lg bg-red-950/70 border border-red-500/40 text-xs text-red-200">
            {error}
          </div>
        )}

        {/* Card 1: Address & Organization */}
        <section className="p-3.5 rounded-xl bg-black/25 border border-[var(--border-subtle)] space-y-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
            Address & Group
          </div>

          <div>
            <label className="block text-xs text-[var(--text-secondary)] mb-1">
              IP or Hostname *
            </label>
            <input
              autoFocus
              value={address}
              onChange={(e) => handleAddressPasteOrChange(e.target.value)}
              placeholder="10.0.1.25 or ssh ubuntu@prod.example.com"
              className="w-full px-3 py-2 rounded-lg bg-black/40 border border-[var(--border-subtle)] focus:border-[var(--border-accent)] text-xs text-white focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs text-[var(--text-secondary)] mb-1">
              Display Label
            </label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={address || "e.g. prod-api-01"}
              className="w-full px-3 py-2 rounded-lg bg-black/40 border border-[var(--border-subtle)] focus:border-[var(--border-accent)] text-xs text-white focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-[var(--text-secondary)]">
                  Group
                </label>
                <button
                  type="button"
                  onClick={() => setInlineNewGroup((v) => !v)}
                  className="text-[10px] text-[var(--accent-primary)] hover:underline flex items-center gap-0.5"
                >
                  <FolderPlus className="w-3 h-3" /> New
                </button>
              </div>
              <select
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
                className="w-full px-2.5 py-2 rounded-lg bg-black/40 border border-[var(--border-subtle)] text-xs text-white focus:outline-none"
              >
                <option value="">Ungrouped</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-[var(--text-secondary)] mb-1">
                Tags
              </label>
              <input
                value={tagsText}
                onChange={(e) => setTagsText(e.target.value)}
                placeholder="prod, aws, db"
                className="w-full px-2.5 py-2 rounded-lg bg-black/40 border border-[var(--border-subtle)] text-xs text-white focus:outline-none"
              />
            </div>
          </div>

          {inlineNewGroup && (
            <div className="flex items-center gap-1.5 pt-1">
              <input
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateGroupInline()}
                placeholder="Group name (e.g. Production)..."
                className="flex-1 px-2.5 py-1.5 rounded-lg bg-black/50 border border-[var(--border-accent)] text-xs"
              />
              <button
                type="button"
                onClick={handleCreateGroupInline}
                className="px-3 py-1.5 rounded-lg bg-[var(--accent-primary)] text-xs font-semibold text-white"
              >
                Add
              </button>
            </div>
          )}
        </section>

        {/* Card 2: SSH Credentials (Termius-style Segmented Auth + Inline Keychain!) */}
        <section className="p-3.5 rounded-xl bg-black/25 border border-[var(--border-subtle)] space-y-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
            SSH Credentials
          </div>

          <div className="grid grid-cols-3 gap-2.5">
            <div className="col-span-2">
              <label className="block text-xs text-[var(--text-secondary)] mb-1">
                Username
              </label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="root"
                className="w-full px-3 py-2 rounded-lg bg-black/40 border border-[var(--border-subtle)] text-xs text-white focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-secondary)] mb-1">
                Port
              </label>
              <input
                type="number"
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg bg-black/40 border border-[var(--border-subtle)] text-xs text-white font-mono focus:outline-none"
              />
            </div>
          </div>

          {/* Segmented Auth Method Pill */}
          <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-black/40 border border-[var(--border-subtle)]">
            {(
              [
                { id: "key", label: "SSH Key" },
                { id: "password", label: "Password" },
                { id: "agent", label: "SSH Agent" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setAuthMethod(opt.id)}
                className={`py-1.5 rounded-md text-xs font-medium transition ${
                  authMethod === opt.id
                    ? "bg-[var(--accent-primary)] text-white shadow"
                    : "text-[var(--text-secondary)] hover:text-white"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {authMethod === "key" && (
            <div className="space-y-2">
              <label className="block text-xs text-[var(--text-secondary)]">
                Key from Vault Keychain
              </label>
              <select
                value={keyId}
                onChange={(e) => setKeyId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-black/40 border border-[var(--border-subtle)] text-xs text-white focus:outline-none"
              >
                <option value="">-- Select an SSH Key --</option>
                {keys.map((k) => (
                  <option key={k.id} value={k.id}>
                    🔑 {k.name} ({k.algorithm.toUpperCase()})
                  </option>
                ))}
              </select>

              {/* Inline Key Actions — No leaving the form! */}
              <div className="flex items-center gap-2 pt-0.5">
                <button
                  type="button"
                  disabled={inlineKeyBusy}
                  onClick={handleInlineGenerateEd25519}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg bg-white/5 hover:bg-white/10 border border-[var(--border-subtle)] text-[11px] text-[var(--text-primary)] transition"
                >
                  <Sparkles className="w-3 h-3 text-amber-400" />
                  <span>Generate Ed25519</span>
                </button>
                <button
                  type="button"
                  disabled={inlineKeyBusy}
                  onClick={handleInlineImportKey}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg bg-white/5 hover:bg-white/10 border border-[var(--border-subtle)] text-[11px] text-[var(--text-primary)] transition"
                >
                  <Upload className="w-3 h-3 text-sky-400" />
                  <span>Import Key File</span>
                </button>
              </div>
            </div>
          )}

          {authMethod === "password" && (
            <div>
              <label className="block text-xs text-[var(--text-secondary)] mb-1">
                Password (encrypted in Vault)
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full px-3 py-2 rounded-lg bg-black/40 border border-[var(--border-subtle)] text-xs text-white focus:outline-none"
              />
            </div>
          )}

          {authMethod === "agent" && (
            <p className="text-[11px] text-[var(--text-muted)]">
              Uses keys loaded in your local Windows OpenSSH Authentication Agent
              (<code className="font-mono">ssh-agent</code>).
            </p>
          )}
        </section>

        {/* Card 3: Jump Host & Startup Automation */}
        <section className="p-3.5 rounded-xl bg-black/25 border border-[var(--border-subtle)] space-y-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
            Jump Host (Bastion) & Startup
          </div>

          <div>
            <label className="block text-xs text-[var(--text-secondary)] mb-1">
              ProxyJump / Bastion Host
            </label>
            <select
              value={jumpHostId}
              onChange={(e) => setJumpHostId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-black/40 border border-[var(--border-subtle)] text-xs text-white focus:outline-none"
            >
              <option value="">Direct Connection (No Jump Host)</option>
              {hosts
                .filter((h) => h.id !== host?.id)
                .map((h) => (
                  <option key={h.id} value={h.id}>
                    Jump via {h.label} ({h.username}@{h.address})
                  </option>
                ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-[var(--text-secondary)] mb-1">
              Startup Snippet
            </label>
            <select
              value={startupSnippetId}
              onChange={(e) => setStartupSnippetId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-black/40 border border-[var(--border-subtle)] text-xs text-white focus:outline-none"
            >
              <option value="">None</option>
              {snippets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-[var(--text-secondary)] mb-1">
              Or Custom Startup Command
            </label>
            <input
              value={startupCommand}
              onChange={(e) => setStartupCommand(e.target.value)}
              placeholder="e.g. tmux attach || tmux new"
              className="w-full px-3 py-2 rounded-lg bg-black/40 border border-[var(--border-subtle)] text-xs font-mono text-white focus:outline-none"
            />
          </div>
        </section>
      </div>

      {/* Sticky Footer Buttons */}
      <div className="p-4 border-t border-[var(--border-subtle)] bg-[var(--bg-panel)] flex items-center gap-2">
        <button
          type="button"
          onClick={() => persistHost(false)}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-semibold text-white transition"
        >
          <Save className="w-3.5 h-3.5" />
          <span>Save Host</span>
        </button>
        <button
          type="button"
          onClick={() => persistHost(true)}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-xs font-semibold text-white transition shadow-lg"
        >
          <Play className="w-3.5 h-3.5" />
          <span>Save & Connect</span>
        </button>
      </div>
    </div>
  );
};
