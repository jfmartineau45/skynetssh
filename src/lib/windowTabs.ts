import type {
  SplitNode,
  TerminalPaneConfig,
  WorkspaceTab,
} from "../types/models.ts";

const handedOffPaneIds = new Set<string>();

export const markPaneSessionHandedOff = (paneId: string): void => {
  handedOffPaneIds.add(paneId);
};

export const consumePaneSessionHandedOff = (paneId: string): boolean =>
  handedOffPaneIds.delete(paneId);

export function collectPanesFromNode(node: SplitNode): TerminalPaneConfig[] {
  if (node.type === "leaf") return [node.pane];
  return [
    ...collectPanesFromNode(node.first),
    ...collectPanesFromNode(node.second),
  ];
}

export interface WarmPopoutReuseIds {
  tabId: string;
  leafId: string;
  paneId: string;
}

/**
 * Clones serialized `WorkspaceTab`s transferred across windows (Pop-Out or Dock Back to Main),
 * preserving every live `sessionId`, split-pane tree ratio/direction, and SFTP drawer state while
 * assigning fresh pane/tab IDs (or reusing the pre-warmed WebGL standby IDs on the first leaf).
 */
export function rehydrateTransferredTabs(
  rawTabs: WorkspaceTab[],
  warmReuse?: WarmPopoutReuseIds
): WorkspaceTab[] {
  let usedWarmLeaf = false;

  const cloneSplitNode = (
    node: SplitNode,
    paneIdMap: Map<string, string>
  ): SplitNode => {
    if (node.type === "leaf") {
      const useWarm = Boolean(warmReuse) && !usedWarmLeaf;
      if (useWarm) usedWarmLeaf = true;
      const newPaneId =
        useWarm && warmReuse ? warmReuse.paneId : crypto.randomUUID();
      const newLeafId =
        useWarm && warmReuse ? warmReuse.leafId : crypto.randomUUID();
      paneIdMap.set(node.pane.id, newPaneId);
      return {
        type: "leaf",
        id: newLeafId,
        pane: {
          ...node.pane,
          id: newPaneId,
          standbyWarm: false,
          connected: Boolean(node.pane.sessionId),
          connecting: !node.pane.sessionId,
          error: null,
        },
      };
    }
    return {
      type: "split",
      id: crypto.randomUUID(),
      direction: node.direction,
      ratio: node.ratio,
      first: cloneSplitNode(node.first, paneIdMap),
      second: cloneSplitNode(node.second, paneIdMap),
    };
  };

  return rawTabs
    .filter((t) => t.kind !== "vault")
    .map((tab, idx) => {
      const newTabId =
        idx === 0 && warmReuse ? warmReuse.tabId : crypto.randomUUID();
      if (tab.kind === "sftp") {
        return {
          ...tab,
          id: newTabId,
        };
      }
      const paneIdMap = new Map<string, string>();
      const rootNode = cloneSplitNode(tab.rootNode, paneIdMap);
      const allPanes = collectPanesFromNode(rootNode);
      const mappedActive =
        paneIdMap.get(tab.activePaneId) ?? allPanes[0]?.id ?? newTabId;
      return {
        ...tab,
        id: newTabId,
        rootNode,
        activePaneId: mappedActive,
      };
    });
}

export function reorderTabList(
  tabs: WorkspaceTab[],
  sourceTabId: string,
  targetTabId: string
): WorkspaceTab[] {
  if (
    sourceTabId === targetTabId ||
    sourceTabId === "vault" ||
    targetTabId === "vault"
  ) {
    return tabs;
  }
  const fromIdx = tabs.findIndex((t) => t.id === sourceTabId);
  const toIdx = tabs.findIndex((t) => t.id === targetTabId);
  if (fromIdx < 0 || toIdx < 0) return tabs;
  const next = [...tabs];
  const [moved] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, moved);
  return next;
}

let standbyListenerReady = false;
let standbyXtermReady = false;
let standbySignaled = false;

export function notifyStandbyMilestone(
  milestone: "listener" | "xterm",
  onBothReady: () => void
): void {
  if (milestone === "listener") standbyListenerReady = true;
  if (milestone === "xterm") standbyXtermReady = true;
  if (standbyListenerReady && standbyXtermReady && !standbySignaled) {
    standbySignaled = true;
    onBothReady();
  }
}
