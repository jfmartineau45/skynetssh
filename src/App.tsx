import React, { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { TitleBar } from "./components/chrome/TitleBar";
import { CommandPalette } from "./components/chrome/CommandPalette";
import { HostKeyModal } from "./components/chrome/HostKeyModal";
import { VaultUnlockModal } from "./components/vault/VaultUnlockModal";
import { VaultDashboard } from "./components/vault/VaultDashboard";
import { SessionTabView } from "./components/terminal/SessionTabView";
import { SftpDualPaneTab } from "./components/sftp/SftpDualPaneTab";
import { useWorkspaceStore } from "./store/useWorkspaceStore";
import { useVaultStore } from "./store/useVaultStore";
import { apiDiscoverShells, isTauriRuntime } from "./lib/ipc";
import type { HostKeyPromptEvent } from "./types/models";

export const App: React.FC = () => {
  const { tabs, activeTabId, setShells } = useWorkspaceStore();
  const { refreshStatus, enqueueHostKeyPrompt } = useVaultStore();

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

    const unlistenPromise = listen<HostKeyPromptEvent>(
      "ssh-host-key-prompt",
      (ev) => {
        enqueueHostKeyPrompt(ev.payload);
      }
    );

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [refreshStatus, setShells, enqueueHostKeyPrompt]);

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
      <CommandPalette />
    </div>
  );
};

export default App;
