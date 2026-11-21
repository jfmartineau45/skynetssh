export type ThemeId =
  | "skynet-obsidian"
  | "tabby-dark"
  | "termius-dark"
  | "tokyo-night"
  | "t800-hud";

export type AuthMethod = "password" | "key" | "agent";
export type HostProtocol = "ssh" | "rdp";
export type RdpDisplayMode = "smart" | "fullscreen" | "multimon";

export interface GroupRecord {
  id: string;
  name: string;
  icon: string;
  color: string;
  parentId?: string | null;
  updatedAt: number;
}

export interface HostRecord {
  id: string;
  label: string;
  protocol?: HostProtocol;
  address: string;
  port: number;
  username: string;
  authMethod: AuthMethod;
  password?: string | null;
  keyId?: string | null;
  groupId?: string | null;
  tags: string[];
  jumpHostId?: string | null;
  startupSnippetId?: string | null;
  startupCommand?: string | null;
  rdpDomain?: string | null;
  rdpDisplayMode?: RdpDisplayMode | null;
  rdpWidth?: number | null;
  rdpHeight?: number | null;
  rdpIgnoreCert?: boolean | null;
  keepaliveIntervalSecs: number;
  notes?: string | null;
  lastConnectedAt?: number | null;
  updatedAt: number;
}

export interface RdpLaunchResult {
  hostId: string;
  tunneled: boolean;
  bastionLabel?: string | null;
  localPort?: number | null;
}

export interface HostProbeResult {
  hostId: string;
  online: boolean;
  latencyMs?: number | null;
  passedProbes: number;
  totalProbes: number;
  detail: string;
}

export interface SshKeyRecord {
  id: string;
  name: string;
  algorithm: "ed25519" | "rsa" | "ecdsa" | "imported";
  publicKey: string;
  privateKeyPem: string;
  passphrase?: string | null;
  fingerprint: string;
  createdAt: number;
  updatedAt: number;
}

export type TunnelType = "local" | "remote" | "dynamic";

export interface TunnelRecord {
  id: string;
  name: string;
  hostId: string;
  tunnelType: TunnelType;
  bindAddress: string;
  bindPort: number;
  targetHost?: string | null;
  targetPort?: number | null;
  autoStart: boolean;
  updatedAt: number;
}

export interface ActiveTunnelRuntime {
  tunnelId: string;
  status: "starting" | "running" | "error" | "stopped";
  activeConnections: number;
  bytesIn: number;
  bytesOut: number;
  error?: string | null;
}

export interface SnippetRecord {
  id: string;
  name: string;
  command: string;
  description?: string | null;
  category?: string | null;
  tags: string[];
  updatedAt: number;
}

export interface KnownHostRecord {
  id: string;
  hostPort: string;
  keyType: string;
  fingerprintSha256: string;
  publicKeyBase64: string;
  firstSeenAt: number;
  updatedAt: number;
}

export interface HostKeyPromptEvent {
  requestId: string;
  hostPort: string;
  keyType: string;
  fingerprintSha256: string;
  status: "unknown" | "changed";
  previousFingerprint?: string | null;
}

export interface VaultProfile {
  id: string;
  name: string;
  kind: "personal" | "team";
  path: string;
}

export interface DiscoveredSshKey {
  name: string;
  path: string;
  publicKey?: string | null;
  fingerprint?: string | null;
  encrypted: boolean;
  alreadyInVault: boolean;
}

export interface DiscoveredSshHost {
  alias: string;
  hostname: string;
  user: string;
  port: number;
  identityFile?: string | null;
  proxyJump?: string | null;
  alreadyInVault: boolean;
}

export interface SshFolderScan {
  sshDir: string;
  keys: DiscoveredSshKey[];
  configHosts: DiscoveredSshHost[];
  knownHostsLines: number;
}

export interface TotpSetupPayload {
  secretBase32: string;
  otpauthUri: string;
  qrSvg: string;
}

export interface VaultStatus {
  initialized: boolean;
  unlocked: boolean;
  readOnly: boolean;
  vaultPath: string;
  activeProfile: VaultProfile;
  profiles: VaultProfile[];
  globalHotkey: string;
  keyringAvailable: boolean;
  keyringSaved: boolean;
  deviceAutoUnlockValid: boolean;
  deviceLeaseExpiresAt?: number | null;
  totpEnabled: boolean;
  totpAvailableOnDevice: boolean;
  totpRemainingAttempts: number;
  hostCount: number;
  keyCount: number;
  tunnelCount: number;
  snippetCount: number;
}

export interface VaultSnapshot {
  groups: GroupRecord[];
  hosts: HostRecord[];
  keys: SshKeyRecord[];
  tunnels: TunnelRecord[];
  snippets: SnippetRecord[];
  knownHosts: KnownHostRecord[];
}

export interface ShellProfile {
  id: string;
  name: string;
  executable: string;
  args: string[];
  icon: "powershell" | "cmd" | "git" | "linux" | "terminal";
}

export interface SftpEntry {
  name: string;
  path: string;
  isDir: boolean;
  isSymlink: boolean;
  size: number;
  modifiedAt?: number | null;
  permissions?: number | null;
  permissionsDisplay: string;
}

export interface TransferProgressEvent {
  transferId: string;
  fileName: string;
  direction: "upload" | "download" | "remote-to-remote";
  bytesTransferred: number;
  totalBytes: number;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  error?: string | null;
}

export interface GitSyncStatus {
  isGitRepo: boolean;
  branch?: string | null;
  remoteUrl?: string | null;
  changedFiles: number;
  ahead: number;
  behind: number;
  lastSyncMessage?: string | null;
}

/* Workspace Tabs & Recursive Split-Pane Tree */
export interface TerminalPaneConfig {
  id: string;
  kind: "ssh" | "local";
  title: string;
  hostId?: string;
  vaultKind?: "personal" | "team";
  vaultName?: string;
  shellProfile?: ShellProfile;
  sessionId?: string;
  standbyWarm?: boolean;
  connected: boolean;
  connecting: boolean;
  error?: string | null;
}

export type SplitNode =
  | {
      type: "leaf";
      id: string;
      pane: TerminalPaneConfig;
    }
  | {
      type: "split";
      id: string;
      direction: "horizontal" | "vertical";
      ratio: number; // 0.15 .. 0.85
      first: SplitNode;
      second: SplitNode;
    };

export type WorkspaceTab =
  | {
      id: "vault";
      kind: "vault";
      title: "Vault";
      pinned: true;
    }
  | {
      id: string;
      kind: "terminal";
      title: string;
      subtitle?: string;
      vaultKind?: "personal" | "team";
      vaultName?: string;
      rootNode: SplitNode;
      activePaneId: string;
      sftpDrawerOpen: boolean;
      sftpDrawerHostId?: string;
    }
  | {
      id: string;
      kind: "sftp";
      title: string;
      leftTarget: { type: "local" } | { type: "remote"; hostId: string };
      rightTarget: { type: "local" } | { type: "remote"; hostId: string };
    };
