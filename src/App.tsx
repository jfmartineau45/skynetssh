import React, { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { TitleBar } from "./components/chrome/TitleBar";
import { CommandPalette } from "./components/chrome/CommandPalette";
import { HostKeyModal } from "./components/chrome/HostKeyModal";
import { SnippetPromptModal } from "./components/chrome/SnippetPromptModal";
import { VaultUnlockModal } from "./components/vault/VaultUnlockModal";
import { VaultDashboard } from "./components/vault/VaultDashboard";
import { SessionTabView } from "./components/terminal/SessionTabView";
import { SftpDualPaneTab } from "./components/sftp/SftpDualPaneTab";
import { useWorkspaceStore } from "./store/useWorkspaceStore";
import { useVaultStore } from "./store/useVaultStore";
import { apiDiscoverShells, isTauriRuntime } from "./lib/ipc";
import type { HostKeyPromptEvent } from "./types/models";

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
    adjustFontSize,
  } = useWorkspaceStore();

  const {
    refreshStatus,
    reloadSnapshot,
    enqueueHostKeyPrompt,
    setActiveSection,
    setNewHostDrawerRequested,
  } = useVaultStore();

  useEffect(() => {
    if (!isTauriRuntime()) {
      setShells([
        {
          id: "pwsh",
          name: "PowerShell",
          executable: "powershell.exe",
          args: ["-NoLogo"],
          icon: "powershell",
        },
      ]);
      return;
    }

    refreshStatus();
    apiDiscoverShells()
      .then(setShells)
      .catch(() => {});

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
      unlistenHostKey.then((u) => u());
      unlistenExternalSync.then((u) => u());
    };
  }, [refreshStatus, reloadSnapshot, setShells, enqueueHostKeyPrompt]);

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

      // Ctrl+Shift+T (New Local Shell), Ctrl+Shift+W (Close Tab), Ctrl+Shift+N (New Vault Host)
      if (e.ctrlKey && e.shiftKey && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === "t" && shells[0]) {
          e.preventDefault();
          openLocalTerminal(shells[0]);
        } else if (k === "w" && activeTabId !== "vault") {
          e.preventDefault();
          closeTab(activeTabId);
        } else if (k === "n") {
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
    setActiveTab,
    cycleTab,
    closeTab,
    openLocalTerminal,
    adjustFontSize,
    setActiveSection,
    setNewHostDrawerRequested,
  ]);

  return (
    <div className="flex flex-col w-screen h-screen overflow-hidden bg-[var(--bg-app)] text-[var(--text-primary)] border border-[var(--border-subtle)]">
      <TitleBar />

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

      <VaultUnlockModal />
      <HostKeyModal />
      <SnippetPromptModal />
      <CommandPalette />
    </div>
  );
};

export default App;
