import type { SnippetRecord } from "../types/models";

const VAR_REGEX = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_-]*)\s*\}\}/g;

/**
 * Extracts unique `{{variable}}` placeholders while preserving Go/Docker templates like `{{.Names}}`.
 */
export function extractSnippetVariables(command: string): string[] {
  const seen = new Set<string>();
  const vars: string[] = [];
  for (const match of command.matchAll(VAR_REGEX)) {
    const name = match[1];
    if (!seen.has(name)) {
      seen.add(name);
      vars.push(name);
    }
  }
  return vars;
}

export function resolveSnippetCommand(
  command: string,
  values: Record<string, string>
): string {
  return command.replace(VAR_REGEX, (_full, name: string) => values[name] ?? "");
}

export const SUGGESTED_SNIPPET_CATEGORIES = [
  "Docker & Containers",
  "Linux & Systemd",
  "Disk & Performance",
  "Networking & TLS",
  "Proxmox & Virtualization",
  "Database & Backups",
];

export const STARTER_OPS_SNIPPETS: Omit<SnippetRecord, "id" | "updatedAt">[] = [
  {
    name: "Docker Containers Status Table",
    category: "Docker & Containers",
    description: "Clean aligned table of running containers, status, and ports",
    command: 'docker ps -a --format "table {{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.Ports}}"',
    tags: ["docker", "status"],
  },
  {
    name: "Follow Container Logs",
    category: "Docker & Containers",
    description: "Stream the last 150 lines of logs for a specific container",
    command: "docker logs -f --tail 150 {{container_name}}",
    tags: ["docker", "logs"],
  },
  {
    name: "Docker Compose Pull & Recreate",
    category: "Docker & Containers",
    description: "Pull latest images and recreate compose stack cleanly",
    command: "docker compose pull && docker compose up -d --remove-orphans",
    tags: ["docker", "deploy"],
  },
  {
    name: "Systemd Service Live Logs",
    category: "Linux & Systemd",
    description: "Tail journald logs for any systemd unit",
    command: "sudo journalctl -u {{service_name}} -n 100 -f",
    tags: ["systemd", "logs"],
  },
  {
    name: "Failed Systemd Units Check",
    category: "Linux & Systemd",
    description: "List any crashed or failed systemd services on the host",
    command: "systemctl --failed",
    tags: ["systemd", "health"],
  },
  {
    name: "Pending Security / Package Updates",
    category: "Linux & Systemd",
    description: "Refresh apt index and show upgradable packages (Debian/Ubuntu)",
    command: "sudo apt update && apt list --upgradable",
    tags: ["apt", "patching"],
  },
  {
    name: "System Health Snapshot (Disk, RAM, Load)",
    category: "Disk & Performance",
    description: "One-shot overview of uptime, load average, memory, and filesystems",
    command: "uptime && echo '---' && free -h && echo '---' && df -hT -x tmpfs -x devtmpfs",
    tags: ["health", "triage"],
  },
  {
    name: "Top 15 Largest Folders",
    category: "Disk & Performance",
    description: "Find what is eating disk space inside a directory",
    command: "sudo du -xhd1 {{target_dir}} | sort -hr | head -n 15",
    tags: ["disk", "cleanup"],
  },
  {
    name: "Listening TCP/UDP Ports & Processes",
    category: "Networking & TLS",
    description: "Show all open listening sockets and owning PIDs",
    command: "sudo ss -tulpn",
    tags: ["network", "ports"],
  },
  {
    name: "Check TLS Certificate Expiry",
    category: "Networking & TLS",
    description: "Inspect live HTTPS certificate issuer and expiration dates",
    command:
      "echo | openssl s_client -servername {{domain}} -connect {{domain}}:443 2>/dev/null | openssl x509 -noout -issuer -subject -dates",
    tags: ["tls", "ssl"],
  },
];
