import React from "react";
import { Monitor, Server } from "lucide-react";
import type { HostRecord } from "../../types/models";

export interface DistroOption {
  slug: string;
  label: string;
}

export const DISTRO_OPTIONS: DistroOption[] = [
  { slug: "", label: "Auto-Detect on SSH Connect" },
  { slug: "ubuntu", label: "Ubuntu" },
  { slug: "debian", label: "Debian" },
  { slug: "proxmox", label: "Proxmox VE" },
  { slug: "rocky", label: "Rocky Linux" },
  { slug: "almalinux", label: "AlmaLinux" },
  { slug: "rhel", label: "Red Hat Enterprise Linux" },
  { slug: "fedora", label: "Fedora" },
  { slug: "centos", label: "CentOS" },
  { slug: "alpine", label: "Alpine Linux" },
  { slug: "arch", label: "Arch Linux" },
  { slug: "kali", label: "Kali Linux" },
  { slug: "opensuse", label: "openSUSE / SLES" },
  { slug: "raspberrypi", label: "Raspberry Pi OS" },
  { slug: "aws", label: "Amazon Linux (AWS)" },
  { slug: "nixos", label: "NixOS" },
  { slug: "synology", label: "Synology DSM" },
  { slug: "freebsd", label: "FreeBSD / BSD" },
  { slug: "macos", label: "macOS" },
  { slug: "windows", label: "Windows" },
  { slug: "linux", label: "Linux (Tux)" },
];

const LOCAL_OS_CACHE_KEY = "skynet_detected_os_v1";

function readLocalOsMap(): Record<string, string> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(LOCAL_OS_CACHE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function saveLocalDetectedOs(hostId: string, osIcon: string): void {
  if (typeof localStorage === "undefined" || !hostId || !osIcon) return;
  try {
    const map = readLocalOsMap();
    map[hostId] = osIcon;
    localStorage.setItem(LOCAL_OS_CACHE_KEY, JSON.stringify(map));
  } catch {
    // ignore storage quota
  }
}

export function clearLocalDetectedOs(hostId: string): void {
  if (typeof localStorage === "undefined" || !hostId) return;
  try {
    const map = readLocalOsMap();
    if (hostId in map) {
      delete map[hostId];
      localStorage.setItem(LOCAL_OS_CACHE_KEY, JSON.stringify(map));
    }
  } catch {
    // ignore
  }
}

export function getDistroLabel(slug?: string | null): string | null {
  if (!slug) return null;
  return DISTRO_OPTIONS.find((d) => d.slug === slug)?.label ?? null;
}

export function resolveHostDistro(
  host?: Pick<
    HostRecord,
    "id" | "protocol" | "osIcon" | "label" | "username" | "tags"
  > | null
): string | null {
  if (!host) return null;
  if (host.osIcon) return host.osIcon.toLowerCase();
  if (host.protocol === "rdp") return "windows";

  const cached = readLocalOsMap()[host.id];
  if (cached) return cached.toLowerCase();

  const hay = `${host.label ?? ""} ${(host.tags ?? []).join(" ")}`.toLowerCase();
  const user = (host.username ?? "").toLowerCase();

  if (/\b(proxmox|pve)\b/.test(hay)) return "proxmox";
  if (/\bubuntu\b/.test(hay) || user === "ubuntu") return "ubuntu";
  if (/\b(raspi|raspberry|rpi)\b/.test(hay) || user === "pi") return "raspberrypi";
  if (/\bkali\b/.test(hay) || user === "kali") return "kali";
  if (/\bdebian\b/.test(hay) || user === "debian") return "debian";
  if (/\brocky\b/.test(hay) || user === "rocky") return "rocky";
  if (/\b(alma|almalinux)\b/.test(hay) || user === "almalinux") return "almalinux";
  if (/\b(rhel|redhat)\b/.test(hay)) return "rhel";
  if (/\bfedora\b/.test(hay) || user === "fedora") return "fedora";
  if (/\bcentos\b/.test(hay) || user === "centos") return "centos";
  if (/\balpine\b/.test(hay)) return "alpine";
  if (/\b(arch|manjaro)\b/.test(hay)) return "arch";
  if (/\b(opensuse|suse|sles)\b/.test(hay)) return "opensuse";
  if (/\bnixos\b/.test(hay)) return "nixos";
  if (/\b(synology|dsm|nas)\b/.test(hay)) return "synology";
  if (/\b(amzn|amazon|ec2)\b/.test(hay) || user === "ec2-user") return "aws";
  if (/\bfreebsd\b/.test(hay)) return "freebsd";
  if (/\b(macos|darwin|macbook|macmini)\b/.test(hay)) return "macos";
  if (/\b(windows|win11|win2022|win2019)\b/.test(hay)) return "windows";

  return null;
}

interface DistroIconProps {
  host?: Pick<
    HostRecord,
    "id" | "protocol" | "osIcon" | "label" | "username" | "tags"
  > | null;
  os?: string | null;
  className?: string;
}

export const DistroIcon: React.FC<DistroIconProps> = ({
  host,
  os,
  className = "w-4 h-4",
}) => {
  const slug = (os || resolveHostDistro(host) || "").toLowerCase();
  const title = getDistroLabel(slug) ?? undefined;
  const cls = `${className} shrink-0`;

  switch (slug) {
    case "ubuntu":
      return (
        <svg viewBox="0 0 24 24" className={cls} aria-label={title}>
          <title>{title}</title>
          <circle cx="12" cy="12" r="10.5" fill="#E95420" />
          <circle
            cx="12"
            cy="12"
            r="5.3"
            fill="none"
            stroke="#FFFFFF"
            strokeWidth="2"
            strokeDasharray="8.4 2.7"
          />
          <circle cx="5.2" cy="12" r="1.9" fill="#FFFFFF" stroke="#E95420" strokeWidth="0.9" />
          <circle cx="15.4" cy="6.1" r="1.9" fill="#FFFFFF" stroke="#E95420" strokeWidth="0.9" />
          <circle cx="15.4" cy="17.9" r="1.9" fill="#FFFFFF" stroke="#E95420" strokeWidth="0.9" />
        </svg>
      );

    case "debian":
      return (
        <svg viewBox="0 0 24 24" className={cls} aria-label={title}>
          <title>{title}</title>
          <path
            d="M12.6 3.2c4.9 0 8.4 3.4 8.2 7.9-.2 4.3-3.7 7.4-7.8 7.2-3.5-.2-6.1-2.8-5.9-6.1.1-2.7 2.3-4.7 4.9-4.6 2.1.1 3.7 1.8 3.5 3.8-.1 1.5-1.4 2.6-2.8 2.5-1-.1-1.8-.9-1.7-1.9"
            fill="none"
            stroke="#E11D48"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
          <path
            d="M11.6 18.4c-2.6 1.5-4.7 3.1-4.1 3.5"
            fill="none"
            stroke="#E11D48"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      );

    case "proxmox":
      return (
        <svg viewBox="0 0 24 24" className={cls} aria-label={title}>
          <title>{title}</title>
          <path
            d="M4 5l5.5 7L4 19h3.4l3.9-5 3.9 5H18.6l-5.5-7 5.5-7h-3.4l-3.9 5-3.9-5H4z"
            fill="#F97316"
          />
          <path
            d="M4 5h3.4l3.9 5-1.7 2L4 5zm16 14h-3.4l-3.9-5 1.7-2L20 19z"
            fill="#CBD5E1"
          />
        </svg>
      );

    case "alpine":
      return (
        <svg viewBox="0 0 24 24" className={cls} aria-label={title}>
          <title>{title}</title>
          <polygon points="12,2.2 21.5,7.7 21.5,16.3 12,21.8 2.5,16.3 2.5,7.7" fill="#0D597F" />
          <path
            d="M5.5 15.8l4.7-6.8 2.7 3.8 2-2.8 3.6 5.8H5.5z"
            fill="#FFFFFF"
          />
        </svg>
      );

    case "arch":
      return (
        <svg viewBox="0 0 24 24" className={cls} aria-label={title}>
          <title>{title}</title>
          <path
            d="M12 2.2c-.9 2.2-1.5 3.7-2.6 5.9.7.7 1.5 1.5 2.8 2.4-1.4-.6-2.4-1.2-3.2-1.8C7.5 11.8 5.2 16.2 2.4 21.5c2.9-1.7 5.2-2.7 7.4-3.1-.1-.5-.2-1.1-.1-1.7.1-1.3 1.1-2.3 2.3-2.2 1.2.1 2.1 1.2 2 2.5 0 .5-.1 1-.3 1.4 2.2.4 4.5 1.4 7.9 3.1-1.6-3-3-5.7-4.4-8.3-.9-.7-1.9-1.6-3.7-2.5 1.3.3 2.3.8 3.1 1.3C14.4 7.9 13.5 5.8 12 2.2z"
            fill="#1793D1"
          />
        </svg>
      );

    case "rocky":
      return (
        <svg viewBox="0 0 24 24" className={cls} aria-label={title}>
          <title>{title}</title>
          <circle cx="12" cy="12" r="10.2" fill="#10B981" />
          <path
            d="M4.3 17.5l6.8-6.9 3.3 3.3 4.8-4.9 2.4 2.5-7.2 7.3-3.3-3.3-4.3 4.3z"
            fill="#064E3B"
          />
        </svg>
      );

    case "almalinux":
      return (
        <svg viewBox="0 0 24 24" className={cls} aria-label={title}>
          <title>{title}</title>
          <circle cx="8" cy="8" r="4.2" fill="#EF4444" />
          <circle cx="16" cy="8" r="4.2" fill="#F59E0B" />
          <circle cx="8" cy="16" r="4.2" fill="#3B82F6" />
          <circle cx="16" cy="16" r="4.2" fill="#10B981" />
          <circle cx="12" cy="12" r="3" fill="#0F172A" />
        </svg>
      );

    case "rhel":
      return (
        <svg viewBox="0 0 24 24" className={cls} aria-label={title}>
          <title>{title}</title>
          <path
            d="M7.5 10.5c.8-3.3 2.5-5.2 5.4-5 2.4.2 3.8 1.9 4.5 4.8 1.8.5 3.1 1.3 3.1 2.4 0 1.8-3.8 3.1-8.6 3.1-4.9 0-8.4-1.4-8.4-3.1 0-1 1.5-1.8 4-2.2z"
            fill="#EE0000"
          />
          <path
            d="M6.8 11.4c2.8.9 7.5 1 10.6.1"
            fill="none"
            stroke="#7F1D1D"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      );

    case "fedora":
      return (
        <svg viewBox="0 0 24 24" className={cls} aria-label={title}>
          <title>{title}</title>
          <path
            d="M12 2.2C6.6 2.2 2.2 6.6 2.2 12v7.3c0 1.4 1.1 2.5 2.5 2.5H12c5.4 0 9.8-4.4 9.8-9.8S17.4 2.2 12 2.2z"
            fill="#3B82F6"
          />
          <path
            d="M13.6 7.5c-1.8 0-3.1 1.3-3.1 3.1v4.7c0 1-.8 1.8-1.8 1.8s-1.8-.8-1.8-1.8.8-1.8 1.8-1.8h4.9"
            fill="none"
            stroke="#FFFFFF"
            strokeWidth="2.1"
            strokeLinecap="round"
          />
        </svg>
      );

    case "centos":
      return (
        <svg viewBox="0 0 24 24" className={cls} aria-label={title}>
          <title>{title}</title>
          <polygon points="12,2.2 16,6.2 12,10.2 8,6.2" fill="#9333EA" />
          <polygon points="17.8,8 21.8,12 17.8,16 13.8,12" fill="#EAB308" />
          <polygon points="12,13.8 16,17.8 12,21.8 8,17.8" fill="#22C55E" />
          <polygon points="6.2,8 10.2,12 6.2,16 2.2,12" fill="#EC4899" />
        </svg>
      );

    case "kali":
      return (
        <svg viewBox="0 0 24 24" className={cls} aria-label={title}>
          <title>{title}</title>
          <circle cx="12" cy="12" r="10" fill="#1E3A8A" stroke="#38BDF8" strokeWidth="1.4" />
          <path
            d="M7 16.5c1.5-3.8 4.2-6.7 9.5-9.2-2.2 2.7-3.2 4.8-3.1 7.2 1.5-.3 2.8-.1 3.9.5-3.2.8-6.4 1.2-10.3 1.5z"
            fill="#38BDF8"
          />
        </svg>
      );

    case "opensuse":
      return (
        <svg viewBox="0 0 24 24" className={cls} aria-label={title}>
          <title>{title}</title>
          <circle cx="12" cy="12" r="10.2" fill="#73BA25" />
          <path
            d="M6.2 14.8c1.2-3.4 4.5-5.6 8.3-5.1 2.2.3 3.7 1.8 3.5 3.6-.2 1.6-1.7 2.7-3.4 2.5-1.2-.2-2-1.1-1.9-2.2"
            fill="none"
            stroke="#FFFFFF"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <circle cx="15.2" cy="10.8" r="1" fill="#FFFFFF" />
        </svg>
      );

    case "raspberrypi":
      return (
        <svg viewBox="0 0 24 24" className={cls} aria-label={title}>
          <title>{title}</title>
          <path d="M9 3.2c1.8 0 3 1.2 3 2.8-1.8 0-3-1.2-3-2.8zm6 0c-1.8 0-3 1.2-3 2.8 1.8 0 3-1.2 3-2.8z" fill="#4ADE80" />
          <circle cx="12" cy="13.8" r="6.8" fill="#E11D48" />
          <circle cx="9.6" cy="11.8" r="1.5" fill="#FDA4AF" />
          <circle cx="14.4" cy="11.8" r="1.5" fill="#FDA4AF" />
          <circle cx="12" cy="14.8" r="1.6" fill="#FDA4AF" />
          <circle cx="9.8" cy="16.8" r="1.3" fill="#FDA4AF" />
          <circle cx="14.2" cy="16.8" r="1.3" fill="#FDA4AF" />
        </svg>
      );

    case "aws":
      return (
        <svg viewBox="0 0 24 24" className={cls} aria-label={title}>
          <title>{title}</title>
          <rect x="2" y="3" width="20" height="18" rx="4.5" fill="#232F3E" />
          <path
            d="M5.5 14.6c3.8 2.6 9.2 2.6 13 0"
            fill="none"
            stroke="#FF9900"
            strokeWidth="2.1"
            strokeLinecap="round"
          />
          <path
            d="M16.4 13.4l2.5.8-.9 2.5"
            fill="none"
            stroke="#FF9900"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <text
            x="12"
            y="11.2"
            textAnchor="middle"
            fill="#FFFFFF"
            fontSize="6.5"
            fontWeight="700"
            fontFamily="sans-serif"
          >
            AWS
          </text>
        </svg>
      );

    case "nixos":
      return (
        <svg viewBox="0 0 24 24" className={cls} aria-label={title}>
          <title>{title}</title>
          <g stroke="#60A5FA" strokeWidth="2.1" strokeLinecap="round">
            <line x1="12" y1="3" x2="12" y2="21" />
            <line x1="4.2" y1="7.5" x2="19.8" y2="16.5" />
            <line x1="19.8" y1="7.5" x2="4.2" y2="16.5" />
          </g>
          <circle cx="12" cy="12" r="3" fill="#1E3A8A" stroke="#93C5FD" strokeWidth="1.5" />
        </svg>
      );

    case "synology":
      return (
        <svg viewBox="0 0 24 24" className={cls} aria-label={title}>
          <title>{title}</title>
          <rect x="3" y="4" width="18" height="16" rx="3.5" fill="#0284C7" />
          <line x1="8" y1="7.5" x2="8" y2="16.5" stroke="#E0F2FE" strokeWidth="2" strokeLinecap="round" />
          <line x1="12" y1="7.5" x2="12" y2="16.5" stroke="#E0F2FE" strokeWidth="2" strokeLinecap="round" />
          <line x1="16" y1="7.5" x2="16" y2="16.5" stroke="#38BDF8" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );

    case "freebsd":
      return (
        <svg viewBox="0 0 24 24" className={cls} aria-label={title}>
          <title>{title}</title>
          <path d="M4.2 4.2l4.2 1.8-2.4 2.4zM19.8 4.2l-4.2 1.8 2.4 2.4z" fill="#EF4444" />
          <circle cx="12" cy="13" r="8.2" fill="#DC2626" />
          <circle cx="14.5" cy="10.2" r="2" fill="#FCA5A5" opacity="0.55" />
        </svg>
      );

    case "macos":
      return (
        <svg viewBox="0 0 24 24" className={cls} aria-label={title}>
          <title>{title}</title>
          <path
            d="M14.7 3.2c.9-1.1 2.2-1.7 3.3-1.7.1 1.3-.4 2.6-1.2 3.5-.8.9-2.1 1.6-3.2 1.5-.2-1.2.3-2.4 1.1-3.3zm3.6 9.3c0-2.2 1.8-3.3 1.9-3.4-1-1.5-2.6-1.7-3.2-1.7-1.4-.1-2.7.8-3.4.8-.7 0-1.8-.8-3-.8-1.5 0-2.9.9-3.7 2.3-1.6 2.7-.4 6.8 1.1 9 .8 1.1 1.7 2.3 2.9 2.2 1.1 0 1.6-.7 3-.7 1.4 0 1.8.7 3 .7 1.3 0 2.1-1.1 2.8-2.2.9-1.3 1.3-2.6 1.3-2.7-.1 0-2.7-1-2.7-3.5z"
            fill="#E2E8F0"
          />
        </svg>
      );

    case "windows":
      return (
        <svg viewBox="0 0 24 24" className={cls} aria-label={title}>
          <title>{title}</title>
          <rect x="3" y="3" width="8.2" height="8.2" rx="1.2" fill="#00A4EF" />
          <rect x="12.8" y="3" width="8.2" height="8.2" rx="1.2" fill="#00A4EF" />
          <rect x="3" y="12.8" width="8.2" height="8.2" rx="1.2" fill="#00A4EF" />
          <rect x="12.8" y="12.8" width="8.2" height="8.2" rx="1.2" fill="#00A4EF" />
        </svg>
      );

    case "linux":
      return (
        <svg viewBox="0 0 24 24" className={cls} aria-label={title}>
          <title>{title}</title>
          <ellipse cx="12" cy="13.5" rx="6.5" ry="7.5" fill="#1E293B" stroke="#94A3B8" strokeWidth="1.2" />
          <ellipse cx="12" cy="14.5" rx="4.1" ry="5" fill="#F8FAFC" />
          <circle cx="10.3" cy="8.5" r="1.1" fill="#F8FAFC" />
          <circle cx="13.7" cy="8.5" r="1.1" fill="#F8FAFC" />
          <polygon points="12,9.8 9.8,11.6 14.2,11.6" fill="#FACC15" />
          <ellipse cx="8.8" cy="20.2" rx="2.2" ry="1.1" fill="#FACC15" />
          <ellipse cx="15.2" cy="20.2" rx="2.2" ry="1.1" fill="#FACC15" />
        </svg>
      );

    default:
      if (host?.protocol === "rdp") {
        return <Monitor className={`${cls} text-sky-400`} />;
      }
      return <Server className={`${cls} text-[var(--accent-primary)]`} />;
  }
};
