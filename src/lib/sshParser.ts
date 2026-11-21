/** Parses pasted strings like `ssh -p 2222 ubuntu@10.0.1.5`, `rdp://CONTOSO\Admin@10.20.1.50:3389`, `mstsc /v:10.20.1.50`, `root@[2001:db8::1]:2222`, or `host:2200` */
export function parseSshConnectionString(raw: string): {
  protocol?: "ssh" | "rdp";
  domain?: string;
  username?: string;
  address?: string;
  port?: number;
} | null {
  let cleaned = raw.trim();
  if (!cleaned) return null;

  let protocol: "ssh" | "rdp" | undefined;
  if (/^rdp:\/\//i.test(cleaned)) {
    protocol = "rdp";
    cleaned = cleaned.replace(/^rdp:\/\//i, "").replace(/\/+$/, "");
  } else if (/^mstsc(?:\.exe)?\s+/i.test(cleaned)) {
    protocol = "rdp";
    cleaned = cleaned
      .replace(/^mstsc(?:\.exe)?\s+/i, "")
      .replace(/\/v:/i, "")
      .trim();
  } else if (/^ssh:\/\//i.test(cleaned)) {
    protocol = "ssh";
    cleaned = cleaned.replace(/^ssh:\/\//i, "").replace(/\/+$/, "");
  } else if (/^ssh\s+/i.test(cleaned)) {
    protocol = "ssh";
    cleaned = cleaned.replace(/^ssh\s+/i, "");
  }

  let port: number | undefined;
  const portFlag = cleaned.match(/(?:^|\s)-p\s*(\d+)/);
  if (portFlag) {
    port = parseInt(portFlag[1], 10);
    cleaned = cleaned.replace(portFlag[0], " ").trim();
  }

  const tokens = cleaned
    .split(/\s+/)
    .filter((t) => !t.startsWith("-") && !t.startsWith("/"));
  const target =
    tokens.find((t) => t.includes("@") || t.includes(".") || t.includes(":")) ??
    tokens[0];
  if (!target) return null;

  let domain: string | undefined;
  let username: string | undefined;
  let hostPart = target;
  const atIdx = target.lastIndexOf("@");
  if (atIdx !== -1) {
    const rawUser = target.slice(0, atIdx);
    const slashIdx = rawUser.indexOf("\\");
    if (slashIdx !== -1) {
      domain = rawUser.slice(0, slashIdx) || undefined;
      username = rawUser.slice(slashIdx + 1) || undefined;
    } else {
      username = rawUser;
    }
    hostPart = target.slice(atIdx + 1);
  }

  // Bracketed IPv6: [2001:db8::1]:2222 or [2001:db8::1]
  if (hostPart.startsWith("[")) {
    const closeIdx = hostPart.indexOf("]");
    if (closeIdx !== -1) {
      const ipv6 = hostPart.slice(1, closeIdx);
      const rest = hostPart.slice(closeIdx + 1);
      if (rest.startsWith(":")) {
        const parsedPort = parseInt(rest.slice(1), 10);
        if (!Number.isNaN(parsedPort)) port = parsedPort;
      }
      if (port === 3389 && !protocol) protocol = "rdp";
      return { protocol, domain, username, address: ipv6, port };
    }
  }

  // Unbracketed: only treat `:port` as a port if there is a single colon (not raw IPv6 `2001:db8::1`)
  const firstColon = hostPart.indexOf(":");
  if (firstColon !== -1 && firstColon === hostPart.lastIndexOf(":")) {
    const parsedPort = parseInt(hostPart.slice(firstColon + 1), 10);
    if (!Number.isNaN(parsedPort)) {
      port = parsedPort;
      hostPart = hostPart.slice(0, firstColon);
    }
  }

  if (port === 3389 && !protocol) protocol = "rdp";
  return { protocol, domain, username, address: hostPart, port };
}
