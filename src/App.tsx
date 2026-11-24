import React, { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { TitleBar } from "./components/chrome/TitleBar";
import { CommandPalette } from "./components/chrome/CommandPalette";
import { HostKeyModal } from "./components/chrome/HostKeyModal";
import { SnippetPromptModal } from "./components/chrome/SnippetPromptModal";
import { VaultUnlockModal } from "./components/vault/VaultUnlockModal";
import { SessionTabView } from "./components/terminal/SessionTabView";
import {
  useWorkspaceStore,
  isPopoutWindowContext,
} from "./store/useWorkspaceStore";
import { notifyStandbyMilestone } from "./lib/windowTabs";
import { useVaultStore } from "./store/useVaultStore";
import {
  apiDiscoverShells,
  apiMarkStandbyReady,
  isTauriRuntime,
} from "./lib/ipc";
import type {
  HostKeyPromptEvent,
  HostOsDetectedEvent,
  HostRecord,
  ShellProfile,
} from "./types/models";

const VaultDashboard = lazy(() =>
  import("./components/vault/VaultDashboard").then((m) => ({
    default: m.VaultDashboard,
  }))
);
const SftpDualPaneTab = lazy(() =>
  import("./components/sftp/SftpDualPaneTab").then((m) => ({
    default: m.SftpDualPaneTab,
  }))
);
const SkynetEffectsOverlay = lazy(() =>
  import("./components/chrome/SkynetEffectsOverlay").then((m) => ({
    default: m.SkynetEffectsOverlay,
  }))
);

interface PopoutActivationPayload {
  targetWindow?: string | null;
  kind?: string;
  hostId?: string | null;
  shellId?: string | null;
  sessionId?: string | null;
  title?: string;
  vaultKind?: string;
  vaultName?: string;
  tabsJson?: string | null;
}

interface DockBackEventPayload {
  tabsJson: string;
}

const FALLBACK_PWSH: ShellProfile = {
  id: "powershell",
  name: "Windows PowerShell",
  executable: "powershell.exe",
  args: ["-NoLogo"],
  icon: "powershell",
};

function resolvePopoutWorkspaceParams(
  p: PopoutActivationPayload,
  availableShells: ShellProfile[]
) {
  const kind: "ssh" | "local" = p.kind === "local" ? "local" : "ssh";
  const matched =
    availableShells.find((s) => s.id === p.shellId) ??
    availableShells[0] ??
    FALLBACK_PWSH;
  return {
    kind,
    hostId: p.hostId || undefined,
    shellProfile: kind === "local" ? matched : undefined,
    sessionId: p.sessionId || undefined,
    title: p.title || "Terminal",
    vaultKind: (p.vaultKind === "team" ? "team" : "personal") as
      | "personal"
      | "team",
    vaultName: p.vaultName || "Personal Vault",
    tabsJson: p.tabsJson || undefined,
  };
}

export const App: React.FC = () => {
  const {
    tabs,
    activeTabId,
    shells,
    setShells,
    setActiveTab,
    cycleTab,
    closeTab,
    openLocalTerminal,
    initPopoutWorkspace,
    receiveDockedTabsFromPopout,
    popoutTabToWindow,
    dockPopoutToMain,
    syncUpdatedHostInTabs,
    checkForUpdates,
    adjustFontSize,
  } = useWorkspaceStore();

  const isPopout = useMemo(() => isPopoutWindowContext(), []);
  const isStandbyBoot = useMemo(() => {
    if (typeof window === "undefined") return false;
    const w = window as unknown as {
      __SKYNET_STANDBY_POPOUT__?: boolean;
      __SKYNET_POPOUT__?: PopoutActivationPayload;
    };
    return Boolean(w.__SKYNET_STANDBY_POPOUT__) && !w.__SKYNET_POPOUT__;
  }, []);
  const [standbyActivated, setStandbyActivated] = useState(!isStandbyBoot);

  const initialPopoutParams = useMemo<PopoutActivationPayload | null>(() => {
    if (typeof window === "undefined") return null;
    const injected = (
      window as unknown as {
        __SKYNET_POPOUT__?: PopoutActivationPayload;
      }
    ).__SKYNET_POPOUT__;
    if (injected) return injected;
    const p = new URLSearchParams(window.location.search);
    if (p.get("popout") !== "1") return null;
    return {
      kind: p.get("kind") || "ssh",
      hostId: p.get("hostId"),
      shellId: p.get("shellId"),
      sessionId: p.get("sessionId"),
      title: p.get("title") || "Terminal",
      vaultKind: p.get("vaultKind") || "personal",
      vaultName: p.get("vaultName") || "Personal Vault",
    };
  }, []);

  const {
    refreshStatus,
    reloadSnapshot,
    enqueueHostKeyPrompt,
    applyDetectedHostOs,
    upsertHostInMemory,
    setActiveSection,
    setNewHostDrawerRequested,
  } = useVaultStore();

  useEffect(() => {
    if (!isTauriRuntime()) {
      setShells([FALLBACK_PWSH]);
      return;
    }

    if (initialPopoutParams) {
      initPopoutWorkspace(
        resolvePopoutWorkspaceParams(
          initialPopoutParams,
          useWorkspaceStore.getState().shells
        )
      );
    }

    if (!isStandbyBoot) {
      refreshStatus();
      apiDiscoverShells()
        .then((discovered) => {
          setShells(discovered);
        })
        .catch(() => {});
    }

    let updateCheckTimer: ReturnType<typeof setTimeout> | null = null;
    if (!isStandbyBoot && !isPopout && useWorkspaceStore.getState().autoCheckUpdates) {
      updateCheckTimer = setTimeout(() => {
        void checkForUpdates(true);
      }, 3500);
    }

    const currentLabel = getCurrentWindow().label;

    // Pre-warmed standby pop-out activation (<10ms zero-pause handoff onto hot XTerm + WebGL!)
    const unlistenActivate = listen<PopoutActivationPayload>(
      "skynet-activate-popout",
      (ev) => {
        const p = ev.payload;
        if (p.targetWindow && p.targetWindow !== currentLabel) return;
        (
          window as unknown as { __SKYNET_POPOUT__?: PopoutActivationPayload }
        ).__SKYNET_POPOUT__ = p;
        setStandbyActivated(true);
        initPopoutWorkspace(
          resolvePopoutWorkspaceParams(p, useWorkspaceStore.getState().shells)
        );
        setTimeout(() => {
          refreshStatus().catch(() => {});
          apiDiscoverShells()
            .then((discovered) => setShells(discovered))
            .catch(() => {});
        }, 120);
      }
    );

    if (isStandbyBoot) {
      unlistenActivate
        .then(() => {
          notifyStandbyMilestone("listener", () => {
            apiMarkStandbyReady().catch(() => {});
          });
        })
        .catch(() => {});
    }

    // Receive popped-out terminal tab(s) & split trees docked back into the Main window
    const unlistenDockBack = listen<DockBackEventPayload>(
      "skynet-dock-from-popout",
      (ev) => {
        if (currentLabel !== "main") return;
        receiveDockedTabsFromPopout(ev.payload.tabsJson);
      }
    );

    const unlistenHostKey = listen<HostKeyPromptEvent>(
      "ssh-host-key-prompt",
      (ev) => {
        enqueueHostKeyPrompt(ev.payload);
      }
    );

    const unlistenHostOs = listen<HostOsDetectedEvent>(
      "host-os-detected",
      (ev) => {
        applyDetectedHostOs(ev.payload.hostId, ev.payload.osIcon);
      }
    );

    const unlistenHostUpdated = listen<HostRecord>(
      "vault-host-updated",
      (ev) => {
        upsertHostInMemory(ev.payload);
        syncUpdatedHostInTabs(ev.payload);
      }
    );

    // Auto-reload when OneDrive / SharePoint / Syncthing syncs a teammate's Vault change!
    const unlistenExternalSync = listen("vault-external-sync", () => {
      if (useVaultStore.getState().status?.unlocked) {
        reloadSnapshot().catch(() => {});
      } else {
        refreshStatus().catch(() => {});
      }
    });

    return () => {
      if (updateCheckTimer) clearTimeout(updateCheckTimer);
      unlistenActivate.then((u) => u());
      unlistenDockBack.then((u) => u());
      unlistenHostKey.then((u) => u());
      unlistenHostOs.then((u) => u());
      unlistenHostUpdated.then((u) => u());
      unlistenExternalSync.then((u) => u());
    };
  }, [
    refreshStatus,
    reloadSnapshot,
    setShells,
    enqueueHostKeyPrompt,
    applyDetectedHostOs,
    upsertHostInMemory,
    syncUpdatedHostInTabs,
    initPopoutWorkspace,
    receiveDockedTabsFromPopout,
    initialPopoutParams,
    isStandbyBoot,
  ]);

  // Global Tabby Keyboard Shortcuts (TUI-Safe: never steals nano/vim/bash/tmux control codes!)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const insideTerminal = Boolean(target?.closest?.(".xterm"));

      // Ctrl+Tab / Ctrl+Shift+Tab -> Cycle Tabs
      if (e.ctrlKey && !e.altKey && e.key === "Tab") {
        e.preventDefault();
        cycleTab(e.shiftKey ? -1 : 1);
        return;
      }

      // Jump to Tab 1..9: Ctrl+Alt+1..9 anywhere (or Ctrl+1..9 outside terminal)
      if (
        e.ctrlKey &&
        !e.shiftKey &&
        (e.altKey || !insideTerminal) &&
        /^[1-9]$/.test(e.key)
      ) {
        const idx = parseInt(e.key, 10) - 1;
        if (tabs[idx]) {
          e.preventDefault();
          setActiveTab(tabs[idx].id);
        }
        return;
      }

      // Zoom terminal font size: Ctrl+Alt+=/−/0 inside terminal (so nano ^_ Go-To-Line & bash ^_ Undo never break!),
      // or Ctrl+=/−/0 outside terminal
      if (e.ctrlKey && (e.altKey || !insideTerminal) && !e.shiftKey) {
        if (e.key === "=" || e.key === "+") {
          e.preventDefault();
          adjustFontSize(1);
          return;
        }
        if (e.key === "-") {
          e.preventDefault();
          adjustFontSize(-1);
          return;
        }
        if (e.key === "0") {
          e.preventDefault();
          adjustFontSize("reset");
          return;
        }
      }

      // Alt+Shift+P -> Toggle Always-on-Top Pin on current window
      if (e.altKey && e.shiftKey && !e.ctrlKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("skynet-toggle-pin"));
        return;
      }

      // Ctrl+Shift+T (New Local Shell), Ctrl+Shift+W (Close Tab), Ctrl+Shift+N (New Vault Host), Ctrl+Shift+O (Pop Out / Dock Back)
      if (e.ctrlKey && e.shiftKey && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === "t" && shells[0]) {
          e.preventDefault();
          openLocalTerminal(shells[0]);
        } else if (k === "w" && activeTabId !== "vault") {
          e.preventDefault();
          closeTab(activeTabId);
        } else if (k === "o") {
          const curTab = tabs.find((t) => t.id === activeTabId);
          if (curTab?.kind === "terminal") {
            e.preventDefault();
            if (isPopout) {
              void dockPopoutToMain(activeTabId);
            } else {
              void popoutTabToWindow(activeTabId);
            }
          }
        } else if (k === "n" && !isPopout) {
          e.preventDefault();
          setActiveSection("hosts");
          setActiveTab("vault");
          setNewHostDrawerRequested(true);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    tabs,
    shells,
    activeTabId,
    isPopout,
    setActiveTab,
    cycleTab,
    closeTab,
    openLocalTerminal,
    popoutTabToWindow,
    dockPopoutToMain,
    adjustFontSize,
    setActiveSection,
    setNewHostDrawerRequested,
  ]);

  return (
    <div className="flex flex-col w-screen h-screen overflow-hidden bg-[var(--bg-app)] text-[var(--text-primary)] border border-[var(--border-subtle)]">
      <TitleBar isPopout={isPopout} />

      {/* Keep terminal & SFTP tabs mounted when switching tabs so xterm WebGL buffers & scrollback stay alive! */}
      <div className="relative flex-1 min-h-0 overflow-hidden">
        {tabs.map((tab) => {
          const visible = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              style={{ display: visible ? "flex" : "none" }}
              className="w-full h-full min-h-0 overflow-hidden"
            >
              {tab.kind === "vault" && (
                <Suspense fallback={null}>
                  <VaultDashboard />
                </Suspense>
              )}
              {tab.kind === "terminal" && <SessionTabView tab={tab} />}
              {tab.kind === "sftp" && (
                <Suspense fallback={null}>
                  <SftpDualPaneTab tab={tab} />
                </Suspense>
              )}
            </div>
          );
        })}
      </div>

      {standbyActivated && (
        <Suspense fallback={null}>
          <SkynetEffectsOverlay />
        </Suspense>
      )}
      {standbyActivated && <VaultUnlockModal />}
      {standbyActivated && <HostKeyModal />}
      {standbyActivated && <SnippetPromptModal />}
      {standbyActivated && <CommandPalette />}
    </div>
  );
};

export default App;
