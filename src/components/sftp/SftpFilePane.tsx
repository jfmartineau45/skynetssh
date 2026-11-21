import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Folder,
  File,
  FileText,
  FileCode,
  ArrowUp,
  ArrowDown,
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
  Eye,
  EyeOff,
  Zap,
  TerminalSquare,
  Copy,
  X,
  Pencil,
} from "lucide-react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { SftpEntry } from "../../types/models";
import { useVaultStore } from "../../store/useVaultStore";
import { useWorkspaceStore } from "../../store/useWorkspaceStore";
import {
  formatModifiedDisplay,
  posixQuote,
  sortSftpEntries,
  type SftpSortDir,
  type SftpSortKey,
} from "../../lib/sftpUtils";
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
  apiSftpPreviewFile,
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
  onRunTerminalCommand?: (command: string) => void;
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
  const idx = Math.max(
    normalized.lastIndexOf("\\"),
    normalized.lastIndexOf("/")
  );
  if (idx <= 2 && normalized.includes(":")) {
    return normalized.slice(0, 3);
  }
  return idx > 0 ? normalized.slice(0, idx) : normalized;
}

function renderEntryIcon(entry: SftpEntry) {
  if (entry.isDir) {
    return <Folder className="w-4 h-4 text-amber-400 shrink-0" />;
  }
  const lower = entry.name.toLowerCase();
  if (lower.endsWith(".log") || lower.endsWith(".txt") || lower.endsWith(".md")) {
    return <FileText className="w-4 h-4 text-sky-400 shrink-0" />;
  }
  if (
    /\.(yml|yaml|json|toml|conf|cfg|ini|env|sh|py|rs|ts|js|sql|service)$/.test(
      lower
    ) ||
    lower.startsWith(".env")
  ) {
    return <FileCode className="w-4 h-4 text-purple-400 shrink-0" />;
  }
  return <File className="w-4 h-4 text-[var(--text-secondary)] shrink-0" />;
}

const REMOTE_QUICK_PATHS = [
  { label: "~", path: "" },
  { label: "/", path: "/" },
  { label: "/etc", path: "/etc" },
  { label: "/var/log", path: "/var/log" },
  { label: "/opt", path: "/opt" },
  { label: "/tmp", path: "/tmp" },
];

export const SftpFilePane: React.FC<Props> = ({
  target,
  refreshToken = 0,
  onChangeTarget,
  onSendEntryToOtherPane,
  onCurrentPathChange,
  onRunTerminalCommand,
  compact = false,
}) => {
  const { hosts } = useVaultStore();
  const { upsertTransfer } = useWorkspaceStore();

  const paneRef = useRef<HTMLDivElement>(null);

  const [currentPath, setCurrentPath] = useState<string>("");
  const [editingPath, setEditingPath] = useState(false);
  const [pathInput, setPathInput] = useState<string>("");
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [filter, setFilter] = useState("");
  const [showHidden, setShowHidden] = useState<boolean>(true);
  const [sortKey, setSortKey] = useState<SftpSortKey>("name");
  const [sortDir, setSortDir] = useState<SftpSortDir>("asc");
  const [dirsFirst, setDirsFirst] = useState<boolean>(true);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [dragHover, setDragHover] = useState(false);

  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [mkdirName, setMkdirName] = useState("");
  const [chmodEntry, setChmodEntry] = useState<SftpEntry | null>(null);
  const [chmodOctal, setChmodOctal] = useState("755");
  const [renameEntry, setRenameEntry] = useState<SftpEntry | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const [previewEntry, setPreviewEntry] = useState<SftpEntry | null>(null);
  const [previewContent, setPreviewContent] = useState<string>("");
  const [previewTruncated, setPreviewTruncated] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);

  const isRemote = target.type === "remote";
  const currentPathRef = useRef(currentPath);
  currentPathRef.current = currentPath;

  const flashToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast((cur) => (cur === msg ? null : cur));
    }, 2400);
  };

  const loadDirectory = useCallback(
    async (requestedPath?: string) => {
      if (!isTauriRuntime()) {
        const nowSec = Math.floor(Date.now() / 1000);
        setCurrentPath(isRemote ? "/home/ubuntu" : "C:\\Users\\User");
        setPathInput(isRemote ? "/home/ubuntu" : "C:\\Users\\User");
        setEntries([
          {
            name: "deploy",
            path: "/home/ubuntu/deploy",
            isDir: true,
            isSymlink: false,
            size: 4096,
            modifiedAt: nowSec - 86400 * 3,
            permissionsDisplay: "drwxr-xr-x",
          },
          {
            name: "docker-compose.yml",
            path: "/home/ubuntu/docker-compose.yml",
            isDir: false,
            isSymlink: false,
            size: 2840,
            modifiedAt: nowSec - 180,
            permissionsDisplay: "-rw-r--r--",
          },
        ]);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const resolvedArg =
          requestedPath === undefined
            ? currentPathRef.current || null
            : requestedPath === ""
            ? null
            : requestedPath;
        const res =
          target.type === "local"
            ? await apiLocalListDir(resolvedArg)
            : await apiRemoteListDir(target.hostId, resolvedArg);
        setCurrentPath(res.path);
        setPathInput(res.path);
        setEditingPath(false);
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
    loadDirectory("");
  }, [loadDirectory]);

  useEffect(() => {
    if (refreshToken > 0 && currentPath) {
      loadDirectory(currentPath);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  const uploadLocalFiles = useCallback(
    async (localPaths: string[]) => {
      if (target.type !== "remote" || localPaths.length === 0) return;
      const baseDir = currentPathRef.current || "/";
      for (const localFile of localPaths) {
        const fileName = localFile.split(/[/\\]/).pop() || "upload.bin";
        const remoteDest = joinPath(baseDir, fileName, true);
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
      flashToast(`Uploaded ${localPaths.length} file(s)`);
      await loadDirectory(baseDir);
    },
    [target, upsertTransfer, loadDirectory]
  );

  // Native Windows Explorer Drag & Drop onto visible Remote SFTP Pane
  useEffect(() => {
    if (!isTauriRuntime() || target.type !== "remote") return;

    const isInsidePane = (physX: number, physY: number): boolean => {
      const el = paneRef.current;
      if (!el || el.offsetParent === null) return false;
      const dpr = window.devicePixelRatio || 1;
      const cssX = physX / dpr;
      const cssY = physY / dpr;
      const r = el.getBoundingClientRect();
      return (
        cssX >= r.left && cssX <= r.right && cssY >= r.top && cssY <= r.bottom
      );
    };

    const unlistenPromise = getCurrentWebview().onDragDropEvent(({ payload }) => {
      if (payload.type === "enter" || payload.type === "over") {
        setDragHover(isInsidePane(payload.position.x, payload.position.y));
      } else if (payload.type === "leave") {
        setDragHover(false);
      } else if (payload.type === "drop") {
        const inside = isInsidePane(payload.position.x, payload.position.y);
        setDragHover(false);
        if (inside && payload.paths.length > 0) {
          void uploadLocalFiles(payload.paths);
        }
      }
    });

    return () => {
      unlistenPromise.then((u) => u());
    };
  }, [target, uploadLocalFiles]);

  const handleSortClick = (key: SftpSortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Modified & Size default to descending (newest / largest first!)
      setSortDir(key === "name" ? "asc" : "desc");
      if (key === "modified") {
        setDirsFirst(false);
      } else if (key === "name") {
        setDirsFirst(true);
      }
    }
  };

  const isLatestMode =
    sortKey === "modified" && sortDir === "desc" && !dirsFirst;

  const toggleLatestQuickMode = () => {
    if (isLatestMode) {
      setSortKey("name");
      setSortDir("asc");
      setDirsFirst(true);
    } else {
      setSortKey("modified");
      setSortDir("desc");
      setDirsFirst(false);
    }
  };

  const openPreview = async (entry: SftpEntry) => {
    if (entry.isDir) return;
    setPreviewEntry(entry);
    setPreviewContent("");
    setPreviewTruncated(false);
    setPreviewLoading(true);
    try {
      const res = await apiSftpPreviewFile(
        target.type === "remote" ? target.hostId : null,
        entry.path
      );
      setPreviewContent(res.content);
      setPreviewTruncated(res.truncated);
    } catch (e) {
      setPreviewContent(`Unable to preview file: ${String(e)}`);
    } finally {
      setPreviewLoading(false);
    }
  };

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
    await uploadLocalFiles(files);
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
    flashToast(`Downloaded ${entry.name}`);
  };

  const breadcrumbs = useMemo(() => {
    if (!currentPath) return [];
    if (isRemote) {
      const parts = currentPath.split("/").filter(Boolean);
      const crumbs = [{ label: "/", fullPath: "/" }];
      let acc = "";
      for (const p of parts) {
        acc += `/${p}`;
        crumbs.push({ label: p, fullPath: acc });
      }
      return crumbs;
    }
    const parts = currentPath.split(/[/\\]/).filter(Boolean);
    const crumbs: { label: string; fullPath: string }[] = [];
    let acc = "";
    parts.forEach((p, idx) => {
      acc = idx === 0 ? `${p}\\` : `${acc.replace(/\\$/, "")}\\${p}`;
      crumbs.push({ label: p, fullPath: acc });
    });
    return crumbs;
  }, [currentPath, isRemote]);

  const sortedAndFiltered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const visible = entries.filter((e) => {
      if (!showHidden && e.name.startsWith(".")) return false;
      if (!q) return true;
      return e.name.toLowerCase().includes(q);
    });
    return sortSftpEntries(visible, sortKey, sortDir, dirsFirst);
  }, [entries, filter, showHidden, sortKey, sortDir, dirsFirst]);

  const stats = useMemo(() => {
    let dirCount = 0;
    let fileCount = 0;
    let totalBytes = 0;
    for (const item of sortedAndFiltered) {
      if (item.isDir) dirCount++;
      else {
        fileCount++;
        totalBytes += item.size;
      }
    }
    return { dirCount, fileCount, totalBytes };
  }, [sortedAndFiltered]);

  const nowMs = Date.now();

  return (
    <div
      ref={paneRef}
      className="relative flex flex-col w-full h-full min-h-0 bg-[var(--bg-app)] select-none"
    >
      {/* Drag & Drop Upload Overlay */}
      {dragHover && isRemote && (
        <div className="absolute inset-2 z-30 rounded-xl border-2 border-dashed border-amber-400 bg-black/80 backdrop-blur-xs flex flex-col items-center justify-center gap-2 pointer-events-none">
          <Upload className="w-8 h-8 text-amber-300 animate-bounce" />
          <div className="text-xs font-bold text-white">
            Drop file(s) to upload via SFTP
          </div>
          <div className="text-[11px] font-mono text-amber-300">
            Destination: {currentPath || "/"}
          </div>
        </div>
      )}

      {/* Endpoint Selector + Navigation + Filter */}
      <div className="p-2.5 border-b border-[var(--border-subtle)] bg-[var(--bg-panel)] space-y-1.5 shrink-0 overflow-hidden">
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
              {hosts
                .filter((h) => h.protocol !== "rdp")
                .map((h) => (
                  <option key={h.id} value={h.id}>
                    SSH: {h.label} ({h.username}@{h.address})
                  </option>
                ))}
            </select>
          </div>
        )}

        {/* Breadcrumb / Editable Path Bar */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => loadDirectory(parentPath(currentPath, isRemote))}
            className="p-1.5 rounded-md bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-white transition"
            title="Parent directory"
          >
            <ArrowUp className="w-3.5 h-3.5" />
          </button>

          {editingPath ? (
            <input
              autoFocus
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              onBlur={() => setEditingPath(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter") loadDirectory(pathInput);
                else if (e.key === "Escape") {
                  setPathInput(currentPath);
                  setEditingPath(false);
                }
              }}
              className="flex-1 min-w-0 px-2.5 py-1 rounded-md bg-black/50 border border-[var(--border-accent)] text-xs font-mono text-white focus:outline-none"
            />
          ) : (
            <div
              onClick={() => {
                setPathInput(currentPath);
                setEditingPath(true);
              }}
              className="flex-1 min-w-0 flex items-center gap-0.5 px-2 py-1 rounded-md bg-black/35 border border-[var(--border-subtle)] hover:border-white/20 overflow-x-auto no-scrollbar cursor-text"
              title="Click a folder segment to jump, or click empty space to type a path"
            >
              {breadcrumbs.map((bc, idx) => (
                <React.Fragment key={bc.fullPath}>
                  {idx > 0 && bc.label !== "/" && (
                    <span className="text-[10px] text-[var(--text-muted)] px-0.5">
                      /
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      loadDirectory(bc.fullPath);
                    }}
                    className="px-1 py-0.2 rounded hover:bg-white/10 text-xs font-mono text-[var(--text-primary)] shrink-0"
                  >
                    {bc.label}
                  </button>
                </React.Fragment>
              ))}
              <Pencil className="w-2.5 h-2.5 text-[var(--text-muted)] ml-auto shrink-0 opacity-60" />
            </div>
          )}

          <button
            onClick={() => loadDirectory(currentPath)}
            className="p-1.5 rounded-md bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-white transition"
            title="Refresh directory"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
            />
          </button>

          {isRemote && onRunTerminalCommand && currentPath && (
            <button
              onClick={() =>
                onRunTerminalCommand(`cd ${posixQuote(currentPath)}`)
              }
              className="p-1.5 rounded-md bg-[var(--bg-elevated)] hover:bg-emerald-500/20 border border-[var(--border-subtle)] text-emerald-400 transition"
              title="cd active SSH terminal into this folder"
            >
              <TerminalSquare className="w-3.5 h-3.5" />
            </button>
          )}

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
              title="Upload file(s) from PC (or drag & drop files here)"
            >
              <Upload className="w-3.5 h-3.5" />
              {!compact && <span>Upload</span>}
            </button>
          )}
        </div>

        {/* Remote Quick-Jump Bookmarks */}
        {isRemote && (
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
            {REMOTE_QUICK_PATHS.map((qp) => {
              const active = qp.path && currentPath === qp.path;
              return (
                <button
                  key={qp.label}
                  onClick={() => loadDirectory(qp.path)}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono shrink-0 transition ${
                    active
                      ? "bg-amber-500/25 text-amber-200 border border-amber-400/40"
                      : "bg-white/5 hover:bg-white/10 text-[var(--text-muted)] hover:text-white"
                  }`}
                >
                  {qp.label}
                </button>
              );
            })}
          </div>
        )}

        {/* Filter + Latest Modified Quick Pill + Dotfiles Toggle */}
        <div className="flex items-center gap-1.5">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter files..."
            className="flex-1 min-w-0 px-2.5 py-1 rounded-md bg-black/25 border border-[var(--border-subtle)] text-[11px] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--border-accent)]"
          />

          <button
            onClick={toggleLatestQuickMode}
            className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold border transition shrink-0 ${
              isLatestMode
                ? "bg-emerald-500/20 border-emerald-400/50 text-emerald-300 shadow-xs"
                : "bg-white/5 border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-white"
            }`}
            title="Sort newest modified files & folders right to row #1"
          >
            <Zap className="w-3 h-3" />
            <span>Latest</span>
          </button>

          <button
            onClick={() => setDirsFirst((v) => !v)}
            className={`px-1.5 py-1 rounded-md text-[10px] border transition shrink-0 ${
              dirsFirst
                ? "bg-amber-500/15 border-amber-400/35 text-amber-200"
                : "bg-white/5 border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-white"
            }`}
            title="Pin folders above files"
          >
            Dirs↑
          </button>

          <button
            onClick={() => setShowHidden((v) => !v)}
            className={`p-1 rounded-md border transition shrink-0 ${
              showHidden
                ? "bg-white/10 border-white/20 text-white"
                : "bg-white/5 border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-white"
            }`}
            title={showHidden ? "Showing dotfiles (.*)" : "Hiding dotfiles (.*)"}
          >
            {showHidden ? (
              <Eye className="w-3.5 h-3.5" />
            ) : (
              <EyeOff className="w-3.5 h-3.5" />
            )}
          </button>
        </div>

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

      {/* Interactive Sortable Column Header */}
      <div className="px-3 py-1.5 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] shrink-0">
        <button
          onClick={() => handleSortClick("name")}
          className={`flex items-center gap-1 hover:text-white transition ${
            sortKey === "name" ? "text-[var(--text-primary)]" : ""
          }`}
        >
          <span>Name</span>
          {sortKey === "name" &&
            (sortDir === "asc" ? (
              <ArrowUp className="w-2.5 h-2.5 text-[var(--accent-primary)]" />
            ) : (
              <ArrowDown className="w-2.5 h-2.5 text-[var(--accent-primary)]" />
            ))}
        </button>

        <div className="flex items-center gap-2.5">
          {!compact && <span className="w-20 text-right">Perms</span>}
          <button
            onClick={() => handleSortClick("modified")}
            className={`w-28 whitespace-nowrap flex items-center justify-end gap-1 hover:text-white transition ${
              sortKey === "modified" ? "text-emerald-300" : ""
            }`}
          >
            <span>Modified</span>
            {sortKey === "modified" &&
              (sortDir === "asc" ? (
                <ArrowUp className="w-2.5 h-2.5 text-emerald-400" />
              ) : (
                <ArrowDown className="w-2.5 h-2.5 text-emerald-400" />
              ))}
          </button>
          <button
            onClick={() => handleSortClick("size")}
            className={`w-16 flex items-center justify-end gap-1 hover:text-white transition ${
              sortKey === "size" ? "text-[var(--text-primary)]" : ""
            }`}
          >
            <span>Size</span>
            {sortKey === "size" &&
              (sortDir === "asc" ? (
                <ArrowUp className="w-2.5 h-2.5 text-[var(--accent-primary)]" />
              ) : (
                <ArrowDown className="w-2.5 h-2.5 text-[var(--accent-primary)]" />
              ))}
          </button>
        </div>
      </div>

      {error && (
        <div className="px-3 py-2 bg-red-950/70 border-b border-red-500/40 flex items-center justify-between text-xs text-red-200">
          <span className="truncate">{error}</span>
          <button
            onClick={() => setError(null)}
            className="text-red-300 hover:text-white ml-2"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {toast && (
        <div className="px-3 py-1 bg-emerald-950/70 border-b border-emerald-500/30 text-[11px] text-emerald-200">
          {toast}
        </div>
      )}

      {/* File Rows */}
      <div className="flex-1 overflow-y-auto divide-y divide-white/[0.04]">
        {sortedAndFiltered.length === 0 && !loading ? (
          <div className="p-8 text-center text-xs text-[var(--text-muted)]">
            Empty directory
          </div>
        ) : (
          sortedAndFiltered.map((entry) => {
            const mod = formatModifiedDisplay(entry.modifiedAt, nowMs);
            return (
              <div
                key={entry.path}
                onDoubleClick={() => {
                  if (entry.isDir) loadDirectory(entry.path);
                  else void openPreview(entry);
                }}
                title={`${entry.name}\nModified: ${mod.full}\nPermissions: ${entry.permissionsDisplay}`}
                className="relative group flex items-center justify-between px-3 py-1.5 hover:bg-[var(--bg-hover)] text-xs cursor-pointer transition"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1 pr-2">
                  {renderEntryIcon(entry)}
                  <span className="truncate text-[var(--text-primary)] font-medium">
                    {entry.name}
                  </span>
                  {entry.isSymlink && (
                    <span className="text-[10px] font-mono text-sky-400 shrink-0">
                      →
                    </span>
                  )}
                </div>

                {/* Metadata Columns */}
                <div className="flex items-center gap-2.5 shrink-0">
                  {!compact && (
                    <span className="font-mono text-[10px] text-[var(--text-muted)] w-20 text-right">
                      {entry.permissionsDisplay}
                    </span>
                  )}

                  <span
                    className={`font-mono text-[11px] w-28 whitespace-nowrap text-right ${
                      mod.freshLevel === "hot"
                        ? "text-emerald-300 font-semibold"
                        : mod.freshLevel === "warm"
                        ? "text-sky-300"
                        : "text-[var(--text-muted)]"
                    }`}
                  >
                    {mod.short}
                  </span>

                  <span className="font-mono text-[11px] text-[var(--text-secondary)] w-16 text-right">
                    {entry.isDir ? "—" : formatBytes(entry.size)}
                  </span>
                </div>

                {/* Floating Hover Action Pill (overlays right metadata cleanly without squishing columns!) */}
                <div className="hidden group-hover:flex items-center gap-0.5 absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-accent)] shadow-lg z-10">
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

                  {!entry.isDir && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void openPreview(entry);
                      }}
                      className="p-1 rounded hover:bg-white/10 text-purple-300"
                      title="Quick Peek file contents (64 KB)"
                    >
                      <Eye className="w-3 h-3" />
                    </button>
                  )}

                  {isRemote && !entry.isDir && onRunTerminalCommand && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onRunTerminalCommand(
                          `tail -n 100 -f ${posixQuote(entry.path)}`
                        );
                      }}
                      className="p-1 rounded hover:bg-white/10 text-emerald-300"
                      title="Tail -f live in SSH terminal"
                    >
                      <TerminalSquare className="w-3 h-3" />
                    </button>
                  )}

                  {isRemote && entry.isDir && onRunTerminalCommand && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onRunTerminalCommand(`cd ${posixQuote(entry.path)}`);
                      }}
                      className="p-1 rounded hover:bg-white/10 text-emerald-300"
                      title="cd into this folder in SSH terminal"
                    >
                      <TerminalSquare className="w-3 h-3" />
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
                              await apiSftpEditLocally(
                                target.hostId,
                                entry.path
                              );
                              flashToast(
                                `Opened ${entry.name} locally (auto-uploads on save)`
                              );
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

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      navigator.clipboard.writeText(entry.path);
                      flashToast(`Copied path: ${entry.path}`);
                    }}
                    className="p-1 rounded hover:bg-white/10 text-[var(--text-secondary)] hover:text-white"
                    title="Copy full path"
                  >
                    <Copy className="w-3 h-3" />
                  </button>

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
                    className="px-1 py-0.5 rounded hover:bg-white/10 text-[10px] text-[var(--text-secondary)] hover:text-white"
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
            );
          })
        )}
      </div>

      {/* Footer Summary */}
      <div className="h-6 px-3 border-t border-[var(--border-subtle)] bg-[var(--bg-panel)] flex items-center justify-between text-[10px] font-mono text-[var(--text-muted)] shrink-0">
        <span>
          {stats.dirCount} dir{stats.dirCount === 1 ? "" : "s"},{" "}
          {stats.fileCount} file{stats.fileCount === 1 ? "" : "s"} (
          {formatBytes(stats.totalBytes)})
        </span>
        {isRemote && <span>Drop files to upload</span>}
      </div>

      {/* Quick Peek File Viewer Modal */}
      {previewEntry && (
        <div
          onClick={() => setPreviewEntry(null)}
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl max-h-[82vh] rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-accent)] shadow-2xl flex flex-col overflow-hidden"
          >
            <div className="px-4 py-2.5 border-b border-[var(--border-subtle)] flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-bold text-white truncate">
                  {previewEntry.name}
                </div>
                <div className="text-[10px] font-mono text-[var(--text-muted)] truncate">
                  {previewEntry.path} · {formatBytes(previewEntry.size)}
                  {previewTruncated ? " (showing first 64 KB)" : ""}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(previewContent);
                    flashToast("Copied file preview to clipboard");
                  }}
                  className="px-2.5 py-1 rounded bg-white/5 hover:bg-white/10 text-[11px] text-white"
                >
                  Copy
                </button>
                {isRemote && target.type === "remote" && (
                  <button
                    onClick={async () => {
                      const hid = target.hostId;
                      const p = previewEntry.path;
                      setPreviewEntry(null);
                      await apiSftpEditLocally(hid, p);
                    }}
                    className="px-2.5 py-1 rounded bg-sky-600 hover:bg-sky-500 text-[11px] font-semibold text-white"
                  >
                    Edit Locally
                  </button>
                )}
                <button
                  onClick={() => setPreviewEntry(null)}
                  className="p-1 rounded hover:bg-white/10 text-[var(--text-muted)] hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <pre className="flex-1 overflow-auto p-4 bg-black/55 text-[11px] font-mono text-[var(--text-primary)] leading-relaxed whitespace-pre-wrap break-words select-text">
              {previewLoading ? "Loading remote file..." : previewContent}
            </pre>
          </div>
        </div>
      )}

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
