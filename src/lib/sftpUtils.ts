import type { SftpEntry } from "../types/models";

export type SftpSortKey = "name" | "modified" | "size";
export type SftpSortDir = "asc" | "desc";

/**
 * Safely wraps a POSIX path in single quotes so spaces, `$()`, backticks, or semicolons can never execute.
 */
export function posixQuote(path: string): string {
  return `'${path.replace(/'/g, `'\\''`)}'`;
}

export function formatModifiedDisplay(
  modifiedAtSecs?: number | null,
  nowMs: number = Date.now()
): { short: string; full: string; freshLevel: "hot" | "warm" | "normal" } {
  if (!modifiedAtSecs || modifiedAtSecs <= 0) {
    return { short: "—", full: "Unknown modified time", freshLevel: "normal" };
  }

  const tsMs = modifiedAtSecs * 1000;
  const date = new Date(tsMs);
  const full = date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const diffSecs = Math.floor((nowMs - tsMs) / 1000);
  if (diffSecs >= -60 && diffSecs < 60) {
    return { short: "Just now", full, freshLevel: "hot" };
  }
  if (diffSecs >= 60 && diffSecs < 3600) {
    return {
      short: `${Math.floor(diffSecs / 60)}m ago`,
      full,
      freshLevel: "hot",
    };
  }
  if (diffSecs >= 3600 && diffSecs < 86400) {
    return {
      short: `${Math.floor(diffSecs / 3600)}h ago`,
      full,
      freshLevel: "warm",
    };
  }
  if (diffSecs >= 86400 && diffSecs < 7 * 86400) {
    return {
      short: `${Math.floor(diffSecs / 86400)}d ago`,
      full,
      freshLevel: "normal",
    };
  }

  const sameYear = date.getFullYear() === new Date(nowMs).getFullYear();
  const short = sameYear
    ? date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : date.toISOString().slice(0, 10);

  return { short, full, freshLevel: "normal" };
}

export function sortSftpEntries(
  entries: SftpEntry[],
  sortKey: SftpSortKey,
  sortDir: SftpSortDir,
  dirsFirst: boolean
): SftpEntry[] {
  const factor = sortDir === "asc" ? 1 : -1;
  return [...entries].sort((a, b) => {
    if (dirsFirst && a.isDir !== b.isDir) {
      return a.isDir ? -1 : 1;
    }
    if (sortKey === "modified") {
      const ma = a.modifiedAt ?? 0;
      const mb = b.modifiedAt ?? 0;
      if (ma !== mb) return (ma - mb) * factor;
    } else if (sortKey === "size") {
      if (a.size !== b.size) return (a.size - b.size) * factor;
    }
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase()) * factor;
  });
}
