import { invoke, Channel } from "@tauri-apps/api/core";
import type {
  ActiveTunnelRuntime,
  GitSyncStatus,
  GroupRecord,
  HostProbeResult,
  HostRecord,
  RdpLaunchResult,
  ShellProfile,
  SftpEntry,
  SnippetRecord,
  SshFolderScan,
  SshKeyRecord,
  TotpSetupPayload,
  TransferProgressEvent,
  TunnelRecord,
  VaultSnapshot,
  VaultStatus,
} from "../types/models";

export const isTauriRuntime = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/* ─── Vault & Security Commands ─── */
export const apiVaultStatus = () => invoke<VaultStatus>("vault_status");

export const apiVaultInit = (masterPassword: string, rememberDays: number) =>
  invoke<VaultSnapshot>("vault_init", { masterPassword, rememberDays });

export const apiVaultUnlock = (masterPassword: string, rememberDays: number) =>
  invoke<VaultSnapshot>("vault_unlock", { masterPassword, rememberDays });

export const apiVaultUnlockKeyring = () =>
  invoke<VaultSnapshot>("vault_unlock_keyring");

export const apiVaultUnlockTotp = (code: string, rememberDays: number) =>
  invoke<VaultSnapshot>("vault_unlock_totp", { code, rememberDays });

export const apiVaultLock = () => invoke<void>("vault_lock");

export const apiVaultForgetDevice = () =>
  invoke<VaultStatus>("vault_forget_device");

export const apiVaultTotpBeginSetup = () =>
  invoke<TotpSetupPayload>("vault_totp_begin_setup");

export const apiVaultTotpConfirmSetup = (
  secretBase32: string,
  code: string,
  rememberDays: number
) =>
  invoke<VaultStatus>("vault_totp_confirm_setup", {
    secretBase32,
    code,
    rememberDays,
  });

export const apiVaultTotpDisable = () =>
  invoke<VaultStatus>("vault_totp_disable");

export const apiVaultSnapshot = () => invoke<VaultSnapshot>("vault_snapshot");

export const apiVaultSetPath = (newPath: string) =>
  invoke<VaultStatus>("vault_set_path", { newPath });

export const apiVaultAddProfile = (
  name: string,
  kind: "personal" | "team",
  path: string
) => invoke<VaultStatus>("vault_add_profile", { name, kind, path });

export const apiVaultSwitchProfile = (profileId: string) =>
  invoke<VaultStatus>("vault_switch_profile", { profileId });

export const apiVaultRemoveProfile = (profileId: string) =>
  invoke<VaultStatus>("vault_remove_profile", { profileId });

export const apiSetGlobalHotkey = (hotkey: string) =>
  invoke<VaultStatus>("app_set_global_hotkey", { hotkey });

export const apiSniffSshFolder = () =>
  invoke<SshFolderScan>("ssh_sniff_folder");

/* ─── Vault Item CRUD ─── */
export const apiSaveGroup = (group: GroupRecord) =>
  invoke<GroupRecord>("vault_save_group", { group });

export const apiDeleteGroup = (id: string) =>
  invoke<void>("vault_delete_group", { id });

export const apiSaveHost = (host: HostRecord) =>
  invoke<HostRecord>("vault_save_host", { host });

export const apiDeleteHost = (id: string) =>
  invoke<void>("vault_delete_host", { id });

export const apiGenerateKey = (
  name: string,
  algorithm: "ed25519" | "rsa",
  passphrase?: string | null
) => invoke<SshKeyRecord>("vault_generate_key", { name, algorithm, passphrase });

export const apiImportKeyPem = (
  name: string,
  pemText: string,
  passphrase?: string | null
) => invoke<SshKeyRecord>("vault_import_key_pem", { name, pemText, passphrase });

export const apiImportKeyFile = (
  name: string,
  filePath: string,
  passphrase?: string | null
) => invoke<SshKeyRecord>("vault_import_key_file", { name, filePath, passphrase });

export const apiDeleteKey = (id: string) =>
  invoke<void>("vault_delete_key", { id });

export const apiSaveTunnel = (tunnel: TunnelRecord) =>
  invoke<TunnelRecord>("vault_save_tunnel", { tunnel });

export const apiDeleteTunnel = (id: string) =>
  invoke<void>("vault_delete_tunnel", { id });

export const apiSaveSnippet = (snippet: SnippetRecord) =>
  invoke<SnippetRecord>("vault_save_snippet", { snippet });

export const apiDeleteSnippet = (id: string) =>
  invoke<void>("vault_delete_snippet", { id });

export const apiDeleteKnownHost = (id: string) =>
  invoke<void>("vault_delete_known_host", { id });

/* ─── Importers & Git Sync ─── */
export const apiImportSshConfig = () =>
  invoke<number>("import_ssh_config");

export const apiImportTermiusJson = (filePath: string) =>
  invoke<number>("import_termius_json", { filePath });

export const apiExportSnippetsJson = (
  filePath: string,
  category?: string | null
) => invoke<number>("snippets_export_json", { filePath, category });

export const apiImportSnippetsJson = (filePath: string) =>
  invoke<number>("snippets_import_json", { filePath });

export const apiGitStatus = () => invoke<GitSyncStatus>("sync_git_status");

export const apiGitInitRemote = (remoteUrl: string) =>
  invoke<GitSyncStatus>("sync_git_init_remote", { remoteUrl });

export const apiGitSyncNow = () => invoke<GitSyncStatus>("sync_git_now");

/* ─── Local ConPTY Shells ─── */
export const apiDiscoverShells = () =>
  invoke<ShellProfile[]>("pty_discover_shells");

export const apiPtySpawn = (
  profile: ShellProfile,
  cols: number,
  rows: number,
  onData: (chunk: Uint8Array) => void
): Promise<string> => {
  const channel = new Channel<number[]>();
  channel.onmessage = (bytes) => {
    onData(new Uint8Array(bytes));
  };
  return invoke<string>("pty_spawn", {
    profile,
    cols,
    rows,
    onData: channel,
  });
};

export const apiPtyReattach = (
  sessionId: string,
  cols: number,
  rows: number,
  onData: (chunk: Uint8Array) => void
): Promise<void> => {
  const channel = new Channel<number[]>();
  channel.onmessage = (bytes) => {
    onData(new Uint8Array(bytes));
  };
  return invoke<void>("pty_reattach", {
    sessionId,
    cols,
    rows,
    onData: channel,
  });
};

export const apiPtyWrite = (sessionId: string, data: Uint8Array) =>
  invoke<void>("pty_write", { sessionId, data: Array.from(data) });

export const apiPtyResize = (sessionId: string, cols: number, rows: number) =>
  invoke<void>("pty_resize", { sessionId, cols, rows });

export const apiPtyClose = (sessionId: string) =>
  invoke<void>("pty_close", { sessionId });

/* ─── Multiplexed SSH Terminal Sessions ─── */
export const apiSshConnectShell = (
  hostId: string,
  cols: number,
  rows: number,
  onData: (chunk: Uint8Array) => void
): Promise<string> => {
  const channel = new Channel<number[]>();
  channel.onmessage = (bytes) => {
    onData(new Uint8Array(bytes));
  };
  return invoke<string>("ssh_open_shell", {
    hostId,
    cols,
    rows,
    onData: channel,
  });
};

export const apiSshReattachShell = (
  sessionId: string,
  cols: number,
  rows: number,
  onData: (chunk: Uint8Array) => void
): Promise<void> => {
  const channel = new Channel<number[]>();
  channel.onmessage = (bytes) => {
    onData(new Uint8Array(bytes));
  };
  return invoke<void>("ssh_reattach_shell", {
    sessionId,
    cols,
    rows,
    onData: channel,
  });
};

export const apiSshWrite = (sessionId: string, data: Uint8Array) =>
  invoke<void>("ssh_write", { sessionId, data: Array.from(data) });

export const apiSshResize = (sessionId: string, cols: number, rows: number) =>
  invoke<void>("ssh_resize", { sessionId, cols, rows });

export const apiSshClose = (sessionId: string) =>
  invoke<void>("ssh_close_shell", { sessionId });

export const apiRespondHostKeyPrompt = (requestId: string, accept: boolean) =>
  invoke<void>("ssh_respond_host_key", { requestId, accept });

export const apiProbeHost = (hostId: string) =>
  invoke<HostProbeResult>("ssh_probe_host", { hostId });

export const apiLaunchRdp = (hostId: string) =>
  invoke<RdpLaunchResult>("rdp_launch", { hostId });

/* ─── SFTP File Browser (Local & Remote) ─── */
export const apiLocalListDir = (path?: string | null) =>
  invoke<{ path: string; entries: SftpEntry[] }>("sftp_local_list", { path });

export const apiLocalMkdir = (path: string) =>
  invoke<void>("sftp_local_mkdir", { path });

export const apiLocalDelete = (path: string, isDir: boolean) =>
  invoke<void>("sftp_local_delete", { path, isDir });

export const apiLocalRename = (oldPath: string, newPath: string) =>
  invoke<void>("sftp_local_rename", { oldPath, newPath });

export const apiRemoteListDir = (hostId: string, path?: string | null) =>
  invoke<{ path: string; entries: SftpEntry[] }>("sftp_remote_list", {
    hostId,
    path,
  });

export const apiRemoteMkdir = (hostId: string, path: string) =>
  invoke<void>("sftp_remote_mkdir", { hostId, path });

export const apiRemoteDelete = (hostId: string, path: string, isDir: boolean) =>
  invoke<void>("sftp_remote_delete", { hostId, path, isDir });

export const apiRemoteRename = (
  hostId: string,
  oldPath: string,
  newPath: string
) => invoke<void>("sftp_remote_rename", { hostId, oldPath, newPath });

export const apiRemoteChmod = (hostId: string, path: string, mode: number) =>
  invoke<void>("sftp_remote_chmod", { hostId, path, mode });

export const apiSftpTransfer = (
  params: {
    transferId: string;
    direction: "upload" | "download" | "remote-to-remote";
    sourceHostId?: string | null;
    sourcePath: string;
    targetHostId?: string | null;
    targetPath: string;
  },
  onProgress: (ev: TransferProgressEvent) => void
) => {
  const channel = new Channel<TransferProgressEvent>();
  channel.onmessage = onProgress;
  return invoke<void>("sftp_transfer", { ...params, onProgress: channel });
};

export const apiSftpEditLocally = (hostId: string, remotePath: string) =>
  invoke<string>("sftp_edit_locally", { hostId, remotePath });

export const apiSftpPreviewFile = (
  hostId: string | null,
  path: string
) =>
  invoke<{ content: string; truncated: boolean }>("sftp_preview_file", {
    hostId,
    path,
  });

/* ─── Port Forwarding / Tunnels ─── */
export const apiTunnelListActive = () =>
  invoke<ActiveTunnelRuntime[]>("tunnel_list_active");

export const apiTunnelStart = (tunnelId: string) =>
  invoke<ActiveTunnelRuntime>("tunnel_start", { tunnelId });

export const apiTunnelStop = (tunnelId: string) =>
  invoke<void>("tunnel_stop", { tunnelId });

export const apiMarkStandbyReady = () =>
  invoke<void>("window_mark_standby_ready");

export const apiPopoutTerminalWindow = (params: {
  kind: "ssh" | "local";
  hostId?: string | null;
  shellId?: string | null;
  sessionId?: string | null;
  title: string;
  vaultKind?: string | null;
  vaultName?: string | null;
  tabsJson?: string | null;
  x?: number | null;
  y?: number | null;
  tearOffDrag?: boolean | null;
}) => invoke<string>("window_popout_terminal", params);

export const apiDockPopoutBackToMain = (params: {
  tabsJson: string;
  closeWindow: boolean;
}) => invoke<void>("window_dock_back_to_main", params);
