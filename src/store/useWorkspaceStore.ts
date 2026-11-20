import { create } from "zustand";
import type {
  HostRecord,
  ShellProfile,
  SnippetRecord,
  SplitNode,
  TerminalPaneConfig,
  ThemeId,
  TransferProgressEvent,
  WorkspaceTab,
} from "../types/models";
import { apiPtyWrite, apiSshWrite } from "../lib/ipc";
import { extractSnippetVariables } from "../lib/snippets";
import { useVaultStore } from "./useVaultStore";

const uid = () => crypto.randomUUID();

function splitTreeAtPane(
  node: SplitNode,
  targetPaneId: string,
  direction: "horizontal" | "vertical",
  newPane: TerminalPaneConfig
): SplitNode {
  if (node.type === "leaf") {
    if (node.pane.id === targetPaneId) {
      return {
        type: "split",
        id: uid(),
        direction,
        ratio: 0.5,
        first: node,
        second: {
          type: "leaf",
          id: uid(),
          pane: newPane,
        },
      };
    }
    return node;
  }
  return {
    ...node,
    first: splitTreeAtPane(node.first, targetPaneId, direction, newPane),
    second: splitTreeAtPane(node.second, targetPaneId, direction, newPane),
  };
}

function updateRatioInTree(
  node: SplitNode,
  splitId: string,
  ratio: number
): SplitNode {
  if (node.type === "leaf") return node;
  if (node.id === splitId) {
    return { ...node, ratio: Math.min(0.85, Math.max(0.15, ratio)) };
  }
  return {
    ...node,
    first: updateRatioInTree(node.first, splitId, ratio),
    second: updateRatioInTree(node.second, splitId, ratio),
  };
}

function removePaneFromTree(
  node: SplitNode,
  targetPaneId: string
): SplitNode | null {
  if (node.type === "leaf") {
    return node.pane.id === targetPaneId ? null : node;
  }
  const nextFirst = removePaneFromTree(node.first, targetPaneId);
  const nextSecond = removePaneFromTree(node.second, targetPaneId);
  if (!nextFirst && !nextSecond) return null;
  if (!nextFirst) return nextSecond;
  if (!nextSecond) return nextFirst;
  return { ...node, first: nextFirst, second: nextSecond };
}

function updatePaneInTree(
  node: SplitNode,
  paneId: string,
  patch: Partial<TerminalPaneConfig>
): SplitNode {
  if (node.type === "leaf") {
    if (node.pane.id === paneId) {
      return { ...node, pane: { ...node.pane, ...patch } };
    }
    return node;
  }
  return {
    ...node,
    first: updatePaneInTree(node.first, paneId, patch),
    second: updatePaneInTree(node.second, paneId, patch),
  };
}

export function collectPanes(node: SplitNode): TerminalPaneConfig[] {
  if (node.type === "leaf") return [node.pane];
  return [...collectPanes(node.first), ...collectPanes(node.second)];
}

interface WorkspaceState {
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;

  terminalFontSize: number;
  adjustFontSize: (delta: number | "reset") => void;
  copyOnSelect: boolean;
  setCopyOnSelect: (val: boolean) => void;
  rightClickPaste: boolean;
  setRightClickPaste: (val: boolean) => void;
  showSnippetsSection: boolean;
  setShowSnippetsSection: (val: boolean) => void;
  inlineHashSnippets: boolean;
  setInlineHashSnippets: (val: boolean) => void;

  tabs: WorkspaceTab[];
  activeTabId: string;
  setActiveTab: (id: string) => void;
  cycleTab: (dir: 1 | -1) => void;
  closeTab: (id: string) => void;

  shells: ShellProfile[];
  setShells: (shells: ShellProfile[]) => void;

  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;

  /* Terminal Tabs & Split Panes */
  openHostTerminal: (host: HostRecord) => void;
  openLocalTerminal: (shell: ShellProfile) => void;
  openDualSftpTab: (hostId?: string) => void;

  splitPane: (
    tabId: string,
    targetPaneId: string,
    direction: "horizontal" | "vertical",
    newPane: Omit<TerminalPaneConfig, "id" | "connected" | "connecting">
  ) => void;
  resizeSplit: (tabId: string, splitId: string, ratio: number) => void;
  closePane: (tabId: string, paneId: string) => void;
  setActivePane: (tabId: string, paneId: string) => void;
  updatePane: (
    tabId: string,
    paneId: string,
    patch: Partial<TerminalPaneConfig>
  ) => void;
  toggleSftpDrawer: (tabId: string, hostId?: string) => void;

  /* Broadcast Input */
  broadcastEnabled: boolean;
  broadcastPaneIds: string[];
  toggleBroadcastMode: () => void;
  togglePaneInBroadcast: (paneId: string) => void;
  dispatchInputFromPane: (
    sourcePane: TerminalPaneConfig,
    bytes: Uint8Array
  ) => Promise<void>;
  injectSnippetToPane: (
    pane: TerminalPaneConfig,
    command: string
  ) => Promise<void>;
  pendingSnippetPrompt: {
    pane: TerminalPaneConfig;
    snippet: SnippetRecord;
    variables: string[];
  } | null;
  runSnippetOnPane: (
    pane: TerminalPaneConfig,
    snippet: SnippetRecord
  ) => Promise<void>;
  clearPendingSnippetPrompt: () => void;

  /* SFTP Transfers */
  transfers: TransferProgressEvent[];
  upsertTransfer: (ev: TransferProgressEvent) => void;
  clearCompletedTransfers: () => void;
}

const initialTheme =
  (typeof localStorage !== "undefined"
    ? (localStorage.getItem("skynet_theme") as ThemeId | null)
    : null) || "skynet-obsidian";

if (typeof document !== "undefined") {
  document.documentElement.dataset.theme = initialTheme;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  theme: initialTheme,
  setTheme: (theme) => {
    localStorage.setItem("skynet_theme", theme);
    document.documentElement.dataset.theme = theme;
    set({ theme });
  },

  terminalFontSize: Number(localStorage.getItem("skynet_font_size")) || 13.5,
  adjustFontSize: (delta) => {
    const next =
      delta === "reset"
        ? 13.5
        : Math.min(24, Math.max(10, get().terminalFontSize + delta));
    localStorage.setItem("skynet_font_size", String(next));
    set({ terminalFontSize: next });
  },
  copyOnSelect: localStorage.getItem("skynet_copy_on_select") !== "false",
  setCopyOnSelect: (copyOnSelect) => {
    localStorage.setItem("skynet_copy_on_select", String(copyOnSelect));
    set({ copyOnSelect });
  },
  rightClickPaste: localStorage.getItem("skynet_right_click_paste") !== "false",
  setRightClickPaste: (rightClickPaste) => {
    localStorage.setItem("skynet_right_click_paste", String(rightClickPaste));
    set({ rightClickPaste });
  },
  showSnippetsSection:
    localStorage.getItem("skynet_show_snippets") !== "false",
  setShowSnippetsSection: (showSnippetsSection) => {
    localStorage.setItem("skynet_show_snippets", String(showSnippetsSection));
    set({ showSnippetsSection });
  },
  inlineHashSnippets:
    localStorage.getItem("skynet_inline_hash_snippets") !== "false",
  setInlineHashSnippets: (inlineHashSnippets) => {
    localStorage.setItem(
      "skynet_inline_hash_snippets",
      String(inlineHashSnippets)
    );
    set({ inlineHashSnippets });
  },

  tabs: [{ id: "vault", kind: "vault", title: "Vault", pinned: true }],
  activeTabId: "vault",
  setActiveTab: (id) => set({ activeTabId: id }),

  cycleTab: (dir) => {
    const { tabs, activeTabId } = get();
    if (tabs.length <= 1) return;
    const idx = tabs.findIndex((t) => t.id === activeTabId);
    const nextIdx = (idx + dir + tabs.length) % tabs.length;
    set({ activeTabId: tabs[nextIdx].id });
  },

  closeTab: (id) => {
    if (id === "vault") return;
    set((state) => {
      const idx = state.tabs.findIndex((t) => t.id === id);
      const nextTabs = state.tabs.filter((t) => t.id !== id);
      let nextActive = state.activeTabId;
      if (state.activeTabId === id) {
        const fallback = nextTabs[Math.max(0, idx - 1)] ?? nextTabs[0];
        nextActive = fallback.id;
      }
      return { tabs: nextTabs, activeTabId: nextActive };
    });
  },

  shells: [],
  setShells: (shells) => set({ shells }),

  commandPaletteOpen: false,
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),

  openHostTerminal: (host) => {
    const activeVault = useVaultStore.getState().status?.activeProfile;
    const paneId = uid();
    const tabId = uid();
    const pane: TerminalPaneConfig = {
      id: paneId,
      kind: "ssh",
      title: host.label || `${host.username}@${host.address}`,
      hostId: host.id,
      vaultKind: activeVault?.kind ?? "personal",
      vaultName: activeVault?.name ?? "Personal Vault",
      connected: false,
      connecting: true,
    };
    const newTab: WorkspaceTab = {
      id: tabId,
      kind: "terminal",
      title: host.label || host.address,
      subtitle: `${host.username}@${host.address}`,
      vaultKind: activeVault?.kind ?? "personal",
      vaultName: activeVault?.name ?? "Personal Vault",
      rootNode: { type: "leaf", id: uid(), pane },
      activePaneId: paneId,
      sftpDrawerOpen: false,
      sftpDrawerHostId: host.id,
    };
    set((s) => ({ tabs: [...s.tabs, newTab], activeTabId: tabId }));
  },

  openLocalTerminal: (shell) => {
    const paneId = uid();
    const tabId = uid();
    const pane: TerminalPaneConfig = {
      id: paneId,
      kind: "local",
      title: shell.name,
      shellProfile: shell,
      connected: false,
      connecting: true,
    };
    const newTab: WorkspaceTab = {
      id: tabId,
      kind: "terminal",
      title: shell.name,
      rootNode: { type: "leaf", id: uid(), pane },
      activePaneId: paneId,
      sftpDrawerOpen: false,
    };
    set((s) => ({ tabs: [...s.tabs, newTab], activeTabId: tabId }));
  },

  openDualSftpTab: (hostId) => {
    const tabId = uid();
    const newTab: WorkspaceTab = {
      id: tabId,
      kind: "sftp",
      title: "SFTP Browser",
      leftTarget: { type: "local" },
      rightTarget: hostId ? { type: "remote", hostId } : { type: "local" },
    };
    set((s) => ({ tabs: [...s.tabs, newTab], activeTabId: tabId }));
  },

  splitPane: (tabId, targetPaneId, direction, partialPane) => {
    const newPaneId = uid();
    const fullPane: TerminalPaneConfig = {
      ...partialPane,
      id: newPaneId,
      connected: false,
      connecting: true,
    };
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== tabId || tab.kind !== "terminal") return tab;
        return {
          ...tab,
          rootNode: splitTreeAtPane(
            tab.rootNode,
            targetPaneId,
            direction,
            fullPane
          ),
          activePaneId: newPaneId,
        };
      }),
    }));
  },

  resizeSplit: (tabId, splitId, ratio) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== tabId || tab.kind !== "terminal") return tab;
        return {
          ...tab,
          rootNode: updateRatioInTree(tab.rootNode, splitId, ratio),
        };
      }),
    }));
  },

  closePane: (tabId, paneId) => {
    const state = get();
    const tab = state.tabs.find((t) => t.id === tabId);
    if (!tab || tab.kind !== "terminal") return;

    const nextRoot = removePaneFromTree(tab.rootNode, paneId);
    if (!nextRoot) {
      state.closeTab(tabId);
      return;
    }
    const remaining = collectPanes(nextRoot);
    set({
      tabs: state.tabs.map((t) =>
        t.id === tabId && t.kind === "terminal"
          ? {
              ...t,
              rootNode: nextRoot,
              activePaneId: remaining.some((p) => p.id === t.activePaneId)
                ? t.activePaneId
                : remaining[0].id,
            }
          : t
      ),
    });
  },

  setActivePane: (tabId, paneId) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId && t.kind === "terminal"
          ? { ...t, activePaneId: paneId, sftpDrawerHostId: collectPanes(t.rootNode).find((p) => p.id === paneId)?.hostId ?? t.sftpDrawerHostId }
          : t
      ),
    }));
  },

  updatePane: (tabId, paneId, patch) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId && t.kind === "terminal"
          ? { ...t, rootNode: updatePaneInTree(t.rootNode, paneId, patch) }
          : t
      ),
    }));
  },

  toggleSftpDrawer: (tabId, hostId) => {
    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== tabId || t.kind !== "terminal") return t;
        const resolvedHost =
          hostId ??
          collectPanes(t.rootNode).find((p) => p.id === t.activePaneId)
            ?.hostId ??
          collectPanes(t.rootNode).find((p) => p.kind === "ssh")?.hostId;
        return {
          ...t,
          sftpDrawerOpen: !t.sftpDrawerOpen,
          sftpDrawerHostId: resolvedHost,
        };
      }),
    }));
  },

  broadcastEnabled: false,
  broadcastPaneIds: [],
  toggleBroadcastMode: () => {
    const state = get();
    if (!state.broadcastEnabled) {
      // Default to selecting all panes in the currently active terminal tab
      const activeTab = state.tabs.find((t) => t.id === state.activeTabId);
      const initialIds =
        activeTab && activeTab.kind === "terminal"
          ? collectPanes(activeTab.rootNode).map((p) => p.id)
          : [];
      set({ broadcastEnabled: true, broadcastPaneIds: initialIds });
    } else {
      set({ broadcastEnabled: false, broadcastPaneIds: [] });
    }
  },
  togglePaneInBroadcast: (paneId) => {
    set((s) => ({
      broadcastPaneIds: s.broadcastPaneIds.includes(paneId)
        ? s.broadcastPaneIds.filter((id) => id !== paneId)
        : [...s.broadcastPaneIds, paneId],
    }));
  },

  dispatchInputFromPane: async (sourcePane, bytes) => {
    const state = get();
    const writeSingle = async (pane: TerminalPaneConfig) => {
      if (!pane.sessionId || !pane.connected) return;
      if (pane.kind === "ssh") {
        await apiSshWrite(pane.sessionId, bytes);
      } else {
        await apiPtyWrite(pane.sessionId, bytes);
      }
    };

    if (
      state.broadcastEnabled &&
      state.broadcastPaneIds.includes(sourcePane.id)
    ) {
      const allPanes = state.tabs.flatMap((t) =>
        t.kind === "terminal" ? collectPanes(t.rootNode) : []
      );
      const targets = allPanes.filter((p) =>
        state.broadcastPaneIds.includes(p.id)
      );
      await Promise.allSettled(targets.map(writeSingle));
    } else {
      await writeSingle(sourcePane);
    }
  },

  injectSnippetToPane: async (pane, command) => {
    const encoder = new TextEncoder();
    const payload = command.endsWith("\n") ? command : `${command}\r`;
    await get().dispatchInputFromPane(pane, encoder.encode(payload));
  },
  pendingSnippetPrompt: null,
  runSnippetOnPane: async (pane, snippet) => {
    const variables = extractSnippetVariables(snippet.command);
    if (variables.length === 0) {
      await get().injectSnippetToPane(pane, snippet.command);
    } else {
      set({ pendingSnippetPrompt: { pane, snippet, variables } });
    }
  },
  clearPendingSnippetPrompt: () => set({ pendingSnippetPrompt: null }),

  transfers: [],
  upsertTransfer: (ev) => {
    set((s) => {
      const exists = s.transfers.some((t) => t.transferId === ev.transferId);
      return {
        transfers: exists
          ? s.transfers.map((t) =>
              t.transferId === ev.transferId ? ev : t
            )
          : [ev, ...s.transfers].slice(0, 50),
      };
    });
  },
  clearCompletedTransfers: () => {
    set((s) => ({
      transfers: s.transfers.filter(
        (t) => t.status === "running" || t.status === "queued"
      ),
    }));
  },
}));
