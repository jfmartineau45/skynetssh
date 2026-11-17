import React, { useState } from "react";
import type { SftpEntry, WorkspaceTab } from "../../types/models";
import { SftpFilePane, type SftpPaneTarget } from "./SftpFilePane";
import { useWorkspaceStore } from "../../store/useWorkspaceStore";
import { apiSftpTransfer } from "../../lib/ipc";

interface Props {
  tab: Extract<WorkspaceTab, { kind: "sftp" }>;
}

export const SftpDualPaneTab: React.FC<Props> = ({ tab }) => {
  const { transfers, upsertTransfer, clearCompletedTransfers } =
    useWorkspaceStore();

  const [leftTarget, setLeftTarget] = useState<SftpPaneTarget>(tab.leftTarget);
  const [rightTarget, setRightTarget] = useState<SftpPaneTarget>(
    tab.rightTarget
  );
  const [leftPath, setLeftPath] = useState<string>("");
  const [rightPath, setRightPath] = useState<string>("");
  const [refreshKey, setRefreshKey] = useState(0);

  const buildDestPath = (
    destDir: string,
    fileName: string,
    destTarget: SftpPaneTarget
  ) => {
    if (destTarget.type === "remote") {
      const base = destDir || "/";
      return base.endsWith("/") ? `${base}${fileName}` : `${base}/${fileName}`;
    }
    const sep = destDir.includes("\\") ? "\\" : "/";
    return destDir.endsWith(sep)
      ? `${destDir}${fileName}`
      : `${destDir}${sep}${fileName}`;
  };

  const transferBetweenPanes = async (
    entry: SftpEntry,
    fromSide: "left" | "right"
  ) => {
    const srcTarget = fromSide === "left" ? leftTarget : rightTarget;
    const dstTarget = fromSide === "left" ? rightTarget : leftTarget;
    const dstDir = fromSide === "left" ? rightPath : leftPath;
    if (!dstDir) return;

    const direction =
      srcTarget.type === "local" && dstTarget.type === "remote"
        ? "upload"
        : srcTarget.type === "remote" && dstTarget.type === "local"
        ? "download"
        : srcTarget.type === "remote" && dstTarget.type === "remote"
        ? "remote-to-remote"
        : null;

    if (!direction) return;

    const transferId = crypto.randomUUID();
    await apiSftpTransfer(
      {
        transferId,
        direction,
        sourceHostId: srcTarget.type === "remote" ? srcTarget.hostId : null,
        sourcePath: entry.path,
        targetHostId: dstTarget.type === "remote" ? dstTarget.hostId : null,
        targetPath: buildDestPath(dstDir, entry.name, dstTarget),
      },
      upsertTransfer
    );
    setRefreshKey((k) => k + 1);
  };

  return (
    <div className="flex flex-col w-full h-full min-h-0 overflow-hidden">
      {/* Dual Panes */}
      <div className="flex-1 grid grid-cols-2 divide-x divide-[var(--border-subtle)] min-h-0 overflow-hidden">
        <SftpFilePane
          refreshToken={refreshKey}
          target={leftTarget}
          onChangeTarget={setLeftTarget}
          onCurrentPathChange={setLeftPath}
          onSendEntryToOtherPane={(entry) =>
            transferBetweenPanes(entry, "left")
          }
        />
        <SftpFilePane
          refreshToken={refreshKey}
          target={rightTarget}
          onChangeTarget={setRightTarget}
          onCurrentPathChange={setRightPath}
          onSendEntryToOtherPane={(entry) =>
            transferBetweenPanes(entry, "right")
          }
        />
      </div>

      {/* Live Transfer Queue Dock */}
      {transfers.length > 0 && (
        <div className="h-36 border-t border-[var(--border-accent)] bg-[var(--bg-panel)] flex flex-col shrink-0">
          <div className="px-3 py-1.5 flex items-center justify-between border-b border-[var(--border-subtle)] text-xs">
            <span className="font-semibold text-[var(--text-primary)]">
              SFTP Transfer Queue ({transfers.length})
            </span>
            <button
              onClick={clearCompletedTransfers}
              className="text-[11px] text-[var(--text-secondary)] hover:text-white"
            >
              Clear Completed
            </button>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-white/[0.04] px-3">
            {transfers.map((tr) => {
              const pct =
                tr.totalBytes > 0
                  ? Math.min(
                      100,
                      Math.round((tr.bytesTransferred / tr.totalBytes) * 100)
                    )
                  : tr.status === "completed"
                  ? 100
                  : 0;
              return (
                <div
                  key={tr.transferId}
                  className="py-1.5 flex items-center justify-between gap-4 text-xs"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="truncate font-medium">
                        [{tr.direction.toUpperCase()}] {tr.fileName}
                      </span>
                      <span
                        className={`text-[10px] uppercase font-mono ${
                          tr.status === "completed"
                            ? "text-emerald-400"
                            : tr.status === "failed"
                            ? "text-red-400"
                            : "text-amber-300"
                        }`}
                      >
                        {tr.status} ({pct}%)
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                      <div
                        style={{ width: `${pct}%` }}
                        className="h-full bg-[var(--accent-primary)] transition-all"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
