import React, { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { TitleBar } from "./components/chrome/TitleBar";
import { CommandPalette } from "./components/chrome/CommandPalette";
import { HostKeyModal } from "./components/chrome/HostKeyModal";
import { SnippetPromptModal } from "./components/chrome/SnippetPromptModal";
import { SkynetEffectsOverlay } from "./components/chrome/SkynetEffectsOverlay";
import { VaultUnlockModal } from "./components/vault/VaultUnlockModal";
import { VaultDashboard } from "./components/vault/VaultDashboard";
import { SessionTabView } from "./components/terminal/SessionTabView";
import { SftpDualPaneTab } from "./components/sftp/SftpDualPaneTab";
import {
  useWorkspaceStore,
  isPopoutWindowContext,
} from "./store/useWorkspaceStore";
import { useVaultStore } from "./store/useVaultStore";
import {
  apiDiscoverShells,
  apiMarkStandbyReady,
  isTauriRuntime,
} from "./lib/ipc";
import type { HostKeyPromptEvent, ShellProfile } from "./types/models";

interface PopoutActivationPayload {
  targetWindow?: string | null;
  kind?: string;
  hostId?: string | null;
  shellId?: string | null;
  sessionId?: string | null;
  title?: string;
  vaultKind?: string;
  vaultName?: string;
}

const FALLBACK_PWSH: ShellProfile = {
  id: "powershell",
  name: "Windows PowerShell",
  executable: "powershell.exe",
  args: ["-NoLogo"],
  icon: "powershell",
};

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
    receiveDockedTabFromPopout,
    popoutTabToWindow,
    dockPopoutToMain,
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

  const initialPopoutParams = useMemo(() => {
    if (typeof window === "undefined") return null;
    const injected = (
      window as unknown as {
        __SKYNET_POPOUT__?: PopoutActivationPayload;
      }
    ).__SKYNET_POPOUT__;
    if (injected) {
      return {
        kind: (injected.kind === "local" ? "local" : "ssh") as "ssh" | "local",
        hostId: injected.hostId || undefined,
        shellId: injected.shellId || undefined,
        sessionId: injected.sessionId || undefined,
        title: injected.title || "Terminal",
        vaultKind: (injected.vaultKind === "team" ? "team" : "personal") as
          | "personal"
          | "team",
        vaultName: injected.vaultName || "Personal Vault",
      };
    }
    const p = new URLSearchParams(window.location.search);
    if (p.get("popout") !== "1") return null;
    return {
      kind: (p.get("kind") === "local" ? "local" : "ssh") as "ssh" | "local",
      hostId: p.get("hostId") || undefined,
      shellId: p.get("shellId") || undefined,
      sessionId: p.get("sessionId") || undefined,
      title: p.get("title") || "Terminal",
      vaultKind: (p.get("vaultKind") === "team" ? "team" : "personal") as
        | "personal"
        | "team",
      vaultName: p.get("vaultName") || "Personal Vault",
    };
  }, []);

  const {
    refreshStatus,
    reloadSnapshot,
    enqueueHostKeyPrompt,
    setActiveSection,
    setNewHostDrawerRequested,
  } = useVaultStore();

  useEffect(() => {
    if (!isTauriRuntime()) {
      setShells([FALLBACK_PWSH]);
      return;
    }

    // Mount popped-out session IMMEDIATELY without waiting on WSL/shell discovery (~400ms saved!)
    if (initialPopoutParams) {
      const existingShells = useWorkspaceStore.getState().shells;
      const matchedShell =
        existingShells.find((s) => s.id === initialPopoutParams.shellId) ??
        existingShells[0] ??
        FALLBACK_PWSH;
      initPopoutWorkspace({
        kind: initialPopoutParams.kind,
        hostId: initialPopoutParams.hostId,
        shellProfile:
          initialPopoutParams.kind === "local" ? matchedShell : undefined,
        sessionId: initialPopoutParams.sessionId,
        title: initialPopoutParams.title,
        vaultKind: initialPopoutParams.vaultKind,
        vaultName: initialPopoutParams.vaultName,
      });
    }

    refreshStatus();
    apiDiscoverShells()
      .then((discovered) => {
        setShells(discovered);
      })
      .catch(() => {});

    const currentLabel = getCurrentWindow().label;

    // Pre-warmed standby pop-out activation (<15ms zero-pause handoff!)
    const unlistenActivate = listen<PopoutActivationPayload>(
      "skynet-activate-popout",
      (ev) => {
        const p = ev.payload;
        if (p.targetWindow && p.targetWindow !== currentLabel) return;
        (
          window as unknown as { __SKYNET_POPOUT__?: PopoutActivationPayload }
        ).__SKYNET_POPOUT__ = p;
        setStandbyActivated(true);
        const curShells = useWorkspaceStore.getState().shells;
        const kind = p.kind === "local" ? "local" : "ssh";
        const matched =
          curShells.find((s) => s.id === p.shellId) ??
          curShells[0] ??
          FALLBACK_PWSH;
        initPopoutWorkspace({
          kind,
          hostId: p.hostId || undefined,
          shellProfile: kind === "local" ? matched : undefined,
          sessionId: p.sessionId || undefined,
          title: p.title || "Terminal",
          vaultKind: p.vaultKind === "team" ? "team" : "personal",
          vaultName: p.vaultName || "Personal Vault",
        });
        refreshStatus().catch(() => {});
      }
    );

    if (isStandbyBoot) {
      unlistenActivate
        .then(() => apiMarkStandbyReady())
        .catch(() => {});
    }

    // Receive popped-out terminal docked back into the Main window
    const unlistenDockBack = listen<PopoutActivationPayload>(
      "skynet-dock-from-popout",
      (ev) => {
        if (currentLabel !== "main") return;
        const p = ev.payload;
        const curShells = useWorkspaceStore.getState().shells;
        const kind = p.kind === "local" ? "local" : "ssh";
        const matched =
          curShells.find((s) => s.id === p.shellId) ??
          curShells[0] ??
          FALLBACK_PWSH;
        receiveDockedTabFromPopout({
          kind,
          hostId: p.hostId || undefined,
          shellProfile: kind === "local" ? matched : undefined,
          sessionId: p.sessionId || undefined,
          title: p.title || "Terminal",
          vaultKind: p.vaultKind === "team" ? "team" : "personal",
          vaultName: p.vaultName || "Personal Vault",
        });
      }
    );

    const unlistenHostKey = listen<HostKeyPromptEvent>(
      "ssh-host-key-prompt",
      (ev) => {
        enqueueHostKeyPrompt(ev.payload);
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
      unlistenActivate.then((u) => u());
      unlistenDockBack.then((u) => u());
      unlistenHostKey.then((u) => u());
      unlistenExternalSync.then((u) => u());
    };
  }, [
    refreshStatus,
    reloadSnapshot,
    setShells,
    enqueueHostKeyPrompt,
    initPopoutWorkspace,
    receiveDockedTabFromPopout,
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
              {tab.kind === "vault" && <VaultDashboard />}
              {tab.kind === "terminal" && <SessionTabView tab={tab} />}
              {tab.kind === "sftp" && <SftpDualPaneTab tab={tab} />}
            </div>
          );
        })}
      </div>

      {standbyActivated && <SkynetEffectsOverlay />}
      {standbyActivated && <VaultUnlockModal />}
      {standbyActivated && <HostKeyModal />}
      {standbyActivated && <SnippetPromptModal />}
      {standbyActivated && <CommandPalette />}
    </div>
  );
};

export default App;
