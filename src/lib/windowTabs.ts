import type { WorkspaceTab } from "../types/models.ts";

const handedOffPaneIds = new Set<string>();

export const markPaneSessionHandedOff = (paneId: string): void => {
  handedOffPaneIds.add(paneId);
};

export const consumePaneSessionHandedOff = (paneId: string): boolean =>
  handedOffPaneIds.delete(paneId);

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
