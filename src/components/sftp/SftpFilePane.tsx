import React, { useCallback, useEffect, useState } from "react";
import {
  Folder,
  File,
  ArrowUp,
  RefreshCw,
  FolderPlus,
  Trash2,
  Upload,
  Download,
  Edit3,
  Shield,
  ArrowRightLeft,
  Laptop,
  Server,
} from "lucide-react";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { SftpEntry } from "../../types/models";
import { useVaultStore } from "../../store/useVaultStore";
import { useWorkspaceStore } from "../../store/useWorkspaceStore";
import {
  apiLocalDelete,
  apiLocalListDir,
  apiLocalMkdir,
  apiLocalRename,
  apiRemoteChmod,
  apiRemoteDelete,
  apiRemoteListDir,
  apiRemoteMkdir,
  apiRemoteRename,
  apiSftpEditLocally,
  apiSftpTransfer,
  isTauriRuntime,
} from "../../lib/ipc";

export type SftpPaneTarget =
  | { type: "local" }
  | { type: "remote"; hostId: string };

interface Props {
  target: SftpPaneTarget;
  refreshToken?: number;
  onChangeTarget?: (target: SftpPaneTarget) => void;
  onSendEntryToOtherPane?: (
    entry: SftpEntry,
    sourcePath: string,
    sourceTarget: SftpPaneTarget
  ) => void;
  onCurrentPathChange?: (path: string) => void;
  transferDirectionIcon?: "right" | "left";
  compact?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024))
  );
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function joinPath(base: string, child: string, isRemote: boolean): string {
  if (isRemote) {
    return base.endsWith("/") ? `${base}${child}` : `${base}/${child}`;
  }
  const sep = base.includes("\\") ? "\\" : "/";
  return base.endsWith(sep) ? `${base}${child}` : `${base}${sep}${child}`;
}

function parentPath(p: string, isRemote: boolean): string {
  if (isRemote) {
    if (p === "/" || !p) return "/";
    const trimmed = p.endsWith("/") ? p.slice(0, -1) : p;
    const idx = trimmed.lastIndexOf("/");
    return idx <= 0 ? "/" : trimmed.slice(0, idx);
  }
  const normalized = p.replace(/[/\\]+$/, "");
  const idx = Math.max(normalized.lastIndexOf("\\"), normalized.lastIndexOf("/"));
  if (idx <= 2 && normalized.includes(":")) {
    return normalized.slice(0, 3);
  }
  return idx > 0 ? normalized.slice(0, idx) : normalized;
}

export const SftpFilePane: React.FC<Props> = ({
  target,
  refreshToken = 0,
  onChangeTarget,
  onSendEntryToOtherPane,
  onCurrentPathChange,
  compact = false,
}) => {
  const { hosts } = useVaultStore();
  const { upsertTransfer } = useWorkspaceStore();

  const [currentPath, setCurrentPath] = useState<string>("");
  const [pathInput, setPathInput] = useState<string>("");
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [mkdirName, setMkdirName] = useState("");
  const [chmodEntry, setChmodEntry] = useState<SftpEntry | null>(null);
  const [chmodOctal, setChmodOctal] = useState("755");
  const [renameEntry, setRenameEntry] = useState<SftpEntry | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const isRemote = target.type === "remote";

  const loadDirectory = useCallback(
    async (requestedPath?: string) => {
      if (!isTauriRuntime()) {
        setCurrentPath(isRemote ? "/home/ubuntu" : "C:\\Users\\User");
        setPathInput(isRemote ? "/home/ubuntu" : "C:\\Users\\User");
        setEntries([
          {
            name: "deploy",
            path: "/home/ubuntu/deploy",
            isDir: true,
            isSymlink: false,
            size: 4096,
            permissionsDisplay: "drwxr-xr-x",
          },
          {
            name: "docker-compose.yml",
            path: "/home/ubuntu/docker-compose.yml",
            isDir: false,
            isSymlink: false,
            size: 2840,
            permissionsDisplay: "-rw-r--r--",
          },
        ]);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const res =
          target.type === "local"
            ? await apiLocalListDir(requestedPath ?? (currentPath || null))
            : await apiRemoteListDir(
                target.hostId,
                requestedPath ?? (currentPath || null)
              );
        setCurrentPath(res.path);
        setPathInput(res.path);
        onCurrentPathChange?.(res.path);
        setEntries(res.entries);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [target.type, target.type === "remote" ? target.hostId : "local"]
  );

  useEffect(() => {
    setCurrentPath("");
    loadDirectory(undefined);
  }, [loadDirectory]);

  useEffect(() => {
    if (refreshToken > 0 && currentPath) {
      loadDirectory(currentPath);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  const handleMkdir = async () => {
    if (!mkdirName.trim()) return;
    const full = joinPath(currentPath, mkdirName.trim(), isRemote);
    try {
      if (target.type === "local") await apiLocalMkdir(full);
      else await apiRemoteMkdir(target.hostId, full);
      setMkdirOpen(false);
      setMkdirName("");
      await loadDirectory(currentPath);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleDelete = async (entry: SftpEntry) => {
    try {
      if (target.type === "local")
        await apiLocalDelete(entry.path, entry.isDir);
      else await apiRemoteDelete(target.hostId, entry.path, entry.isDir);
      await loadDirectory(currentPath);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleRename = async () => {
    if (!renameEntry || !renameValue.trim()) return;
    const dir = parentPath(renameEntry.path, isRemote);
    const nextPath = joinPath(dir, renameValue.trim(), isRemote);
    try {
      if (target.type === "local")
        await apiLocalRename(renameEntry.path, nextPath);
      else await apiRemoteRename(target.hostId, renameEntry.path, nextPath);
      setRenameEntry(null);
      await loadDirectory(currentPath);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleChmod = async () => {
    if (!chmodEntry || target.type !== "remote") return;
    const parsed = parseInt(chmodOctal, 8);
    if (Number.isNaN(parsed)) return;
    try {
      await apiRemoteChmod(target.hostId, chmodEntry.path, parsed);
      setChmodEntry(null);
      await loadDirectory(currentPath);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleQuickUploadDialog = async () => {
    if (target.type !== "remote") return;
    const selected = await open({ multiple: true, directory: false });
    if (!selected) return;
    const files = Array.isArray(selected) ? selected : [selected];
    for (const localFile of files) {
      const fileName = localFile.split(/[/\\]/).pop() || "upload.bin";
      const remoteDest = joinPath(currentPath || "/", fileName, true);
      const transferId = crypto.randomUUID();
      await apiSftpTransfer(
        {
          transferId,
          direction: "upload",
          sourceHostId: null,
          sourcePath: localFile,
          targetHostId: target.hostId,
          targetPath: remoteDest,
        },
        upsertTransfer
      );
    }
    await loadDirectory(currentPath);
  };

  const handleQuickDownloadDialog = async (entry: SftpEntry) => {
    if (target.type !== "remote" || entry.isDir) return;
    const dest = await save({ defaultPath: entry.name });
    if (!dest) return;
    const transferId = crypto.randomUUID();
    await apiSftpTransfer(
      {
        transferId,
        direction: "download",
        sourceHostId: target.hostId,
        sourcePath: entry.path,
        targetHostId: null,
        targetPath: dest,
      },
      upsertTransfer
    );
  };

  const filtered = entries.filter((e) =>
    e.name.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="flex flex-col w-full h-full min-h-0 bg-[var(--bg-app)]">
      {/* Endpoint Selector + Toolbar */}
      <div className="p-2.5 border-b border-[var(--border-subtle)] bg-[var(--bg-panel)] space-y-2 shrink-0">
        {onChangeTarget && (
          <div className="flex items-center gap-2">
            {target.type === "local" ? (
              <Laptop className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <Server className="w-4 h-4 text-[var(--accent-primary)] shrink-0" />
            )}
            <select
              value={target.type === "local" ? "local" : target.hostId}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "local") onChangeTarget({ type: "local" });
                else onChangeTarget({ type: "remote", hostId: v });
              }}
              className="flex-1 px-2.5 py-1.5 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-accent)]"
            >
              <option value="local">Local Machine (This PC)</option>
              {hosts.map((h) => (
                <option key={h.id} value={h.id}>
                  SSH: {h.label} ({h.username}@{h.address})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Path Navigation Bar */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => loadDirectory(parentPath(currentPath, isRemote))}
            className="p-1.5 rounded-md bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-white transition"
            title="Parent directory"
          >
            <ArrowUp className="w-3.5 h-3.5" />
          </button>

          <input
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") loadDirectory(pathInput);
            }}
            className="flex-1 min-w-0 px-2.5 py-1 rounded-md bg-black/35 border border-[var(--border-subtle)] text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-accent)]"
          />

          <button
            onClick={() => loadDirectory(currentPath)}
            className="p-1.5 rounded-md bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-white transition"
            title="Refresh"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
            />
          </button>

          <button
            onClick={() => setMkdirOpen((v) => !v)}
            className="p-1.5 rounded-md bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-white transition"
            title="New Folder"
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </button>

          {isRemote && (
            <button
              onClick={handleQuickUploadDialog}
              className="flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-white text-xs font-medium transition"
              title="Upload file(s) from PC"
            >
              <Upload className="w-3.5 h-3.5" />
              {!compact && <span>Upload</span>}
            </button>
          )}
        </div>

        {/* Filter Input */}
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter files..."
          className="w-full px-2.5 py-1 rounded-md bg-black/25 border border-[var(--border-subtle)] text-[11px] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none"
        />

        {mkdirOpen && (
          <div className="flex items-center gap-1.5 pt-1">
            <input
              autoFocus
              value={mkdirName}
              onChange={(e) => setMkdirName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleMkdir()}
              placeholder="New folder name..."
              className="flex-1 px-2.5 py-1 rounded bg-black/40 border border-[var(--border-accent)] text-xs"
            />
            <button
              onClick={handleMkdir}
              className="px-2.5 py-1 rounded bg-[var(--accent-primary)] text-xs font-medium text-white"
            >
              Create
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="px-3 py-2 bg-red-950/70 border-b border-red-500/40 text-xs text-red-200">
          {error}
        </div>
      )}

      {/* File Table */}
      <div className="flex-1 overflow-y-auto divide-y divide-white/[0.04]">
        {filtered.length === 0 && !loading ? (
          <div className="p-8 text-center text-xs text-[var(--text-muted)]">
            Empty directory
          </div>
        ) : (
          filtered.map((entry) => (
            <div
              key={entry.path}
              onDoubleClick={() => {
                if (entry.isDir) loadDirectory(entry.path);
              }}
              className="group flex items-center justify-between px-3 py-1.5 hover:bg-[var(--bg-hover)] text-xs cursor-pointer transition"
            >
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                {entry.isDir ? (
                  <Folder className="w-4 h-4 text-amber-400 shrink-0" />
                ) : (
                  <File className="w-4 h-4 text-[var(--text-secondary)] shrink-0" />
                )}
                <span className="truncate text-[var(--text-primary)] font-medium">
                  {entry.name}
                </span>
              </div>

              <div className="flex items-center gap-3 shrink-0 ml-2">
                {!compact && (
                  <span className="font-mono text-[10px] text-[var(--text-muted)] w-20 text-right">
                    {entry.permissionsDisplay}
                  </span>
                )}
                <span className="font-mono text-[11px] text-[var(--text-secondary)] w-16 text-right">
                  {entry.isDir ? "—" : formatBytes(entry.size)}
                </span>

                {/* Hover Action Bar */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                  {onSendEntryToOtherPane && !entry.isDir && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onSendEntryToOtherPane(entry, currentPath, target);
                      }}
                      className="p-1 rounded bg-[var(--accent-glow)] text-[var(--accent-primary)] hover:bg-[var(--accent-primary)] hover:text-white transition"
                      title="Transfer to opposite pane"
                    >
                      <ArrowRightLeft className="w-3 h-3" />
                    </button>
                  )}

                  {isRemote && !entry.isDir && (
                    <>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleQuickDownloadDialog(entry);
                        }}
                        className="p-1 rounded hover:bg-white/10 text-emerald-400"
                        title="Download to PC"
                      >
                        <Download className="w-3 h-3" />
                      </button>
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (target.type === "remote") {
                            try {
                              await apiSftpEditLocally(target.hostId, entry.path);
                            } catch (err) {
                              setError(String(err));
                            }
                          }
                        }}
                        className="p-1 rounded hover:bg-white/10 text-sky-400"
                        title="Edit in Default Local Editor (auto-uploads on save!)"
                      >
                        <Edit3 className="w-3 h-3" />
                      </button>
                    </>
                  )}

                  {isRemote && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setChmodOctal(
                          entry.permissions
                            ? (entry.permissions & 0o777).toString(8)
                            : "755"
                        );
                        setChmodEntry(entry);
                      }}
                      className="p-1 rounded hover:bg-white/10 text-amber-300"
                      title="Change permissions (chmod)"
                    >
                      <Shield className="w-3 h-3" />
                    </button>
                  )}

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setRenameEntry(entry);
                      setRenameValue(entry.name);
                    }}
                    className="px-1.5 py-0.5 rounded hover:bg-white/10 text-[10px] text-[var(--text-secondary)]"
                    title="Rename"
                  >
                    Ren
                  </button>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(entry);
                    }}
                    className="p-1 rounded hover:bg-red-500/20 text-red-400"
                    title="Delete"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Rename Modal */}
      {renameEntry && (
        <div className="fixed inset-0 z-50 bg-black/65 flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-accent)] p-4">
            <h4 className="text-xs font-semibold mb-2">
              Rename {renameEntry.name}
            </h4>
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleRename()}
              className="w-full px-3 py-1.5 rounded bg-black/40 border border-[var(--border-subtle)] text-xs mb-3"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setRenameEntry(null)}
                className="px-3 py-1 rounded text-xs bg-white/5"
              >
                Cancel
              </button>
              <button
                onClick={handleRename}
                className="px-3 py-1 rounded text-xs bg-[var(--accent-primary)] text-white"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Chmod Modal */}
      {chmodEntry && (
        <div className="fixed inset-0 z-50 bg-black/65 flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-accent)] p-4">
            <h4 className="text-xs font-semibold mb-2">
              Permissions (chmod) — {chmodEntry.name}
            </h4>
            <input
              autoFocus
              value={chmodOctal}
              onChange={(e) => setChmodOctal(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleChmod()}
              placeholder="e.g. 755 or 600"
              className="w-full px-3 py-1.5 rounded bg-black/40 border border-[var(--border-subtle)] text-xs font-mono mb-3"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setChmodEntry(null)}
                className="px-3 py-1 rounded text-xs bg-white/5"
              >
                Cancel
              </button>
              <button
                onClick={handleChmod}
                className="px-3 py-1 rounded text-xs bg-[var(--accent-primary)] text-white"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
