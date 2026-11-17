import { create } from "zustand";
import type {
  ActiveTunnelRuntime,
  GitSyncStatus,
  GroupRecord,
  HostKeyPromptEvent,
  HostRecord,
  KnownHostRecord,
  SnippetRecord,
  SshKeyRecord,
  TunnelRecord,
  VaultSnapshot,
  VaultStatus,
} from "../types/models";
import {
  apiDeleteGroup,
  apiDeleteHost,
  apiDeleteKey,
  apiDeleteKnownHost,
  apiDeleteSnippet,
  apiDeleteTunnel,
  apiGenerateKey,
  apiGitStatus,
  apiImportKeyFile,
  apiImportKeyPem,
  apiSaveGroup,
  apiSaveHost,
  apiSaveSnippet,
  apiSaveTunnel,
  apiTunnelListActive,
  apiVaultInit,
  apiVaultLock,
  apiVaultSnapshot,
  apiVaultStatus,
  apiVaultUnlock,
  apiVaultUnlockKeyring,
} from "../lib/ipc";

export type VaultSection =
  | "hosts"
  | "keychain"
  | "tunnels"
  | "snippets"
  | "known_hosts"
  | "sync";

interface VaultState {
  status: VaultStatus | null;
  loading: boolean;
  activeSection: VaultSection;
  setActiveSection: (section: VaultSection) => void;

  groups: GroupRecord[];
  hosts: HostRecord[];
  keys: SshKeyRecord[];
  tunnels: TunnelRecord[];
  snippets: SnippetRecord[];
  knownHosts: KnownHostRecord[];

  activeTunnels: Record<string, ActiveTunnelRuntime>;
  gitStatus: GitSyncStatus | null;

  /* Host Key TOFU Verification Modal Queue */
  pendingHostKeyPrompts: HostKeyPromptEvent[];
  enqueueHostKeyPrompt: (ev: HostKeyPromptEvent) => void;
  dequeueHostKeyPrompt: (requestId: string) => void;

  /* Actions */
  refreshStatus: () => Promise<void>;
  initVault: (password: string, saveToKeyring: boolean) => Promise<void>;
  unlockVault: (password: string, saveToKeyring: boolean) => Promise<void>;
  unlockWithKeyring: () => Promise<boolean>;
  lockVault: () => Promise<void>;
  reloadSnapshot: () => Promise<void>;
  refreshTunnels: () => Promise<void>;
  refreshGitStatus: () => Promise<void>;

  saveGroup: (g: GroupRecord) => Promise<GroupRecord>;
  deleteGroup: (id: string) => Promise<void>;

  saveHost: (h: HostRecord) => Promise<HostRecord>;
  deleteHost: (id: string) => Promise<void>;

  importKeyPem: (
    name: string,
    pemText: string,
    passphrase?: string | null
  ) => Promise<SshKeyRecord>;
  generateKey: (
    name: string,
    algorithm: "ed25519" | "rsa",
    passphrase?: string | null
  ) => Promise<SshKeyRecord>;
  importKeyFile: (
    name: string,
    filePath: string,
    passphrase?: string | null
  ) => Promise<SshKeyRecord>;
  deleteKey: (id: string) => Promise<void>;

  saveTunnel: (t: TunnelRecord) => Promise<TunnelRecord>;
  deleteTunnel: (id: string) => Promise<void>;

  saveSnippet: (s: SnippetRecord) => Promise<SnippetRecord>;
  deleteSnippet: (id: string) => Promise<void>;

  deleteKnownHost: (id: string) => Promise<void>;
}

const applySnapshot = (snap: VaultSnapshot) => ({
  groups: snap.groups,
  hosts: snap.hosts,
  keys: snap.keys,
  tunnels: snap.tunnels,
  snippets: snap.snippets,
  knownHosts: snap.knownHosts,
});

export const useVaultStore = create<VaultState>((set, get) => ({
  status: null,
  loading: true,
  activeSection: "hosts",
  setActiveSection: (activeSection) => set({ activeSection }),

  groups: [],
  hosts: [],
  keys: [],
  tunnels: [],
  snippets: [],
  knownHosts: [],
  activeTunnels: {},
  gitStatus: null,

  pendingHostKeyPrompts: [],
  enqueueHostKeyPrompt: (ev) =>
    set((s) => ({
      pendingHostKeyPrompts: [...s.pendingHostKeyPrompts, ev],
    })),
  dequeueHostKeyPrompt: (requestId) =>
    set((s) => ({
      pendingHostKeyPrompts: s.pendingHostKeyPrompts.filter(
        (p) => p.requestId !== requestId
      ),
    })),

  refreshStatus: async () => {
    set({ loading: true });
    try {
      const status = await apiVaultStatus();
      set({ status, loading: false });
      if (status.unlocked) {
        const snap = await apiVaultSnapshot();
        set(applySnapshot(snap));
      } else if (status.initialized && status.keyringSaved) {
        // Attempt silent Windows Credential Manager unlock
        await get().unlockWithKeyring();
      }
    } catch {
      set({ loading: false });
    }
  },

  initVault: async (password, saveToKeyring) => {
    const snap = await apiVaultInit(password, saveToKeyring);
    const status = await apiVaultStatus();
    set({ ...applySnapshot(snap), status });
  },

  unlockVault: async (password, saveToKeyring) => {
    const snap = await apiVaultUnlock(password, saveToKeyring);
    const status = await apiVaultStatus();
    set({ ...applySnapshot(snap), status });
  },

  unlockWithKeyring: async () => {
    try {
      const snap = await apiVaultUnlockKeyring();
      const status = await apiVaultStatus();
      set({ ...applySnapshot(snap), status });
      return true;
    } catch {
      return false;
    }
  },

  lockVault: async () => {
    await apiVaultLock();
    const status = await apiVaultStatus();
    set({
      status,
      groups: [],
      hosts: [],
      keys: [],
      tunnels: [],
      snippets: [],
      knownHosts: [],
    });
  },

  reloadSnapshot: async () => {
    const snap = await apiVaultSnapshot();
    const status = await apiVaultStatus();
    set({ ...applySnapshot(snap), status });
  },

  refreshTunnels: async () => {
    try {
      const list = await apiTunnelListActive();
      const map: Record<string, ActiveTunnelRuntime> = {};
      for (const item of list) map[item.tunnelId] = item;
      set({ activeTunnels: map });
    } catch {
      // ignore if locked
    }
  },

  refreshGitStatus: async () => {
    try {
      const gitStatus = await apiGitStatus();
      set({ gitStatus });
    } catch {
      set({ gitStatus: null });
    }
  },

  saveGroup: async (g) => {
    const saved = await apiSaveGroup(g);
    await get().reloadSnapshot();
    return saved;
  },
  deleteGroup: async (id) => {
    await apiDeleteGroup(id);
    await get().reloadSnapshot();
  },

  saveHost: async (h) => {
    const saved = await apiSaveHost(h);
    await get().reloadSnapshot();
    return saved;
  },
  deleteHost: async (id) => {
    await apiDeleteHost(id);
    await get().reloadSnapshot();
  },

  importKeyPem: async (name, pemText, passphrase) => {
    const saved = await apiImportKeyPem(name, pemText, passphrase);
    await get().reloadSnapshot();
    return saved;
  },
  generateKey: async (name, algorithm, passphrase) => {
    const saved = await apiGenerateKey(name, algorithm, passphrase);
    await get().reloadSnapshot();
    return saved;
  },
  importKeyFile: async (name, filePath, passphrase) => {
    const saved = await apiImportKeyFile(name, filePath, passphrase);
    await get().reloadSnapshot();
    return saved;
  },
  deleteKey: async (id) => {
    await apiDeleteKey(id);
    await get().reloadSnapshot();
  },

  saveTunnel: async (t) => {
    const saved = await apiSaveTunnel(t);
    await get().reloadSnapshot();
    return saved;
  },
  deleteTunnel: async (id) => {
    await apiDeleteTunnel(id);
    await get().reloadSnapshot();
  },

  saveSnippet: async (s) => {
    const saved = await apiSaveSnippet(s);
    await get().reloadSnapshot();
    return saved;
  },
  deleteSnippet: async (id) => {
    await apiDeleteSnippet(id);
    await get().reloadSnapshot();
  },

  deleteKnownHost: async (id) => {
    await apiDeleteKnownHost(id);
    await get().reloadSnapshot();
  },
}));
