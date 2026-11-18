import { create } from "zustand";
import type {
  ActiveTunnelRuntime,
  GitSyncStatus,
  GroupRecord,
  HostKeyPromptEvent,
  HostRecord,
  KnownHostRecord,
  SnippetRecord,
  SshFolderScan,
  SshKeyRecord,
  TotpSetupPayload,
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
  apiSetGlobalHotkey,
  apiSniffSshFolder,
  apiTunnelListActive,
  apiVaultAddProfile,
  apiVaultForgetDevice,
  apiVaultInit,
  apiVaultLock,
  apiVaultRemoveProfile,
  apiVaultSnapshot,
  apiVaultStatus,
  apiVaultSwitchProfile,
  apiVaultTotpBeginSetup,
  apiVaultTotpConfirmSetup,
  apiVaultTotpDisable,
  apiVaultUnlock,
  apiVaultUnlockKeyring,
  apiVaultUnlockTotp,
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
  newHostDrawerRequested: boolean;
  setNewHostDrawerRequested: (open: boolean) => void;

  groups: GroupRecord[];
  hosts: HostRecord[];
  keys: SshKeyRecord[];
  tunnels: TunnelRecord[];
  snippets: SnippetRecord[];
  knownHosts: KnownHostRecord[];

  activeTunnels: Record<string, ActiveTunnelRuntime>;
  gitStatus: GitSyncStatus | null;
  sshScan: SshFolderScan | null;

  /* Host Key TOFU Verification Modal Queue */
  pendingHostKeyPrompts: HostKeyPromptEvent[];
  enqueueHostKeyPrompt: (ev: HostKeyPromptEvent) => void;
  dequeueHostKeyPrompt: (requestId: string) => void;

  /* Actions */
  refreshStatus: () => Promise<void>;
  initVault: (password: string, rememberDays: number) => Promise<void>;
  unlockVault: (password: string, rememberDays: number) => Promise<void>;
  unlockWithKeyring: () => Promise<boolean>;
  unlockWithTotp: (code: string, rememberDays: number) => Promise<void>;
  lockVault: () => Promise<void>;
  forgetDevice: () => Promise<void>;
  beginTotpSetup: () => Promise<TotpSetupPayload>;
  confirmTotpSetup: (
    secretBase32: string,
    code: string,
    rememberDays: number
  ) => Promise<void>;
  disableTotp: () => Promise<void>;
  reloadSnapshot: () => Promise<void>;
  refreshTunnels: () => Promise<void>;
  refreshGitStatus: () => Promise<void>;
  refreshSshScan: () => Promise<void>;

  addVaultProfile: (
    name: string,
    kind: "personal" | "team",
    path: string
  ) => Promise<void>;
  switchVaultProfile: (profileId: string) => Promise<void>;
  removeVaultProfile: (profileId: string) => Promise<void>;
  setGlobalHotkey: (hotkey: string) => Promise<void>;

  saveGroup: (g: GroupRecord) => Promise<GroupRecord>;
  deleteGroup: (id: string) => Promise<void>;

  saveHost: (h: HostRecord) => Promise<HostRecord>;
  bulkSaveHosts: (list: HostRecord[]) => Promise<void>;
  bulkDeleteHosts: (ids: string[]) => Promise<void>;
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
  newHostDrawerRequested: false,
  setNewHostDrawerRequested: (newHostDrawerRequested) =>
    set({ newHostDrawerRequested }),

  groups: [],
  hosts: [],
  keys: [],
  tunnels: [],
  snippets: [],
  knownHosts: [],
  activeTunnels: {},
  gitStatus: null,
  sshScan: null,

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
      } else if (status.initialized && status.deviceAutoUnlockValid) {
        await get().unlockWithKeyring();
      } else {
        set({
          groups: [],
          hosts: [],
          keys: [],
          tunnels: [],
          snippets: [],
          knownHosts: [],
        });
      }
      await get().refreshSshScan();
    } catch {
      set({ loading: false });
    }
  },

  initVault: async (password, rememberDays) => {
    const snap = await apiVaultInit(password, rememberDays);
    const status = await apiVaultStatus();
    set({ ...applySnapshot(snap), status });
  },

  unlockVault: async (password, rememberDays) => {
    const snap = await apiVaultUnlock(password, rememberDays);
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
      const status = await apiVaultStatus().catch(() => null);
      if (status) set({ status });
      return false;
    }
  },

  unlockWithTotp: async (code, rememberDays) => {
    try {
      const snap = await apiVaultUnlockTotp(code, rememberDays);
      const status = await apiVaultStatus();
      set({ ...applySnapshot(snap), status });
    } catch (err) {
      const status = await apiVaultStatus().catch(() => null);
      if (status) set({ status });
      throw err;
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

  forgetDevice: async () => {
    const status = await apiVaultForgetDevice();
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

  beginTotpSetup: async () => {
    return await apiVaultTotpBeginSetup();
  },

  confirmTotpSetup: async (secretBase32, code, rememberDays) => {
    const status = await apiVaultTotpConfirmSetup(
      secretBase32,
      code,
      rememberDays
    );
    set({ status });
  },

  disableTotp: async () => {
    const status = await apiVaultTotpDisable();
    set({ status });
  },

  reloadSnapshot: async () => {
    const snap = await apiVaultSnapshot();
    const status = await apiVaultStatus();
    set({ ...applySnapshot(snap), status });
    get().refreshSshScan();
  },

  refreshSshScan: async () => {
    try {
      const sshScan = await apiSniffSshFolder();
      set({ sshScan });
    } catch {
      // ignore outside tauri
    }
  },

  addVaultProfile: async (name, kind, path) => {
    await apiVaultAddProfile(name, kind, path);
    await get().refreshStatus();
  },

  switchVaultProfile: async (profileId) => {
    await apiVaultSwitchProfile(profileId);
    await get().refreshStatus();
  },

  removeVaultProfile: async (profileId) => {
    await apiVaultRemoveProfile(profileId);
    await get().refreshStatus();
  },

  setGlobalHotkey: async (hotkey) => {
    const status = await apiSetGlobalHotkey(hotkey);
    set({ status });
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
  bulkSaveHosts: async (list) => {
    await Promise.all(list.map((h) => apiSaveHost(h)));
    await get().reloadSnapshot();
  },
  bulkDeleteHosts: async (ids) => {
    await Promise.all(ids.map((id) => apiDeleteHost(id)));
    await get().reloadSnapshot();
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
