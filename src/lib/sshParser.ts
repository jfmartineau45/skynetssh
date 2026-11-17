/** Parses pasted strings like `ssh -p 2222 ubuntu@10.0.1.5`, `root@[2001:db8::1]:2222`, or `host:2200` */
export function parseSshConnectionString(raw: string): {
  username?: string;
  address?: string;
  port?: number;
} | null {
  let cleaned = raw.trim();
  if (!cleaned) return null;
  cleaned = cleaned.replace(/^ssh\s+/i, "");

  let port: number | undefined;
  const portFlag = cleaned.match(/(?:^|\s)-p\s*(\d+)/);
  if (portFlag) {
    port = parseInt(portFlag[1], 10);
    cleaned = cleaned.replace(portFlag[0], " ").trim();
  }

  const tokens = cleaned.split(/\s+/).filter((t) => !t.startsWith("-"));
  const target =
    tokens.find((t) => t.includes("@") || t.includes(".") || t.includes(":")) ??
    tokens[0];
  if (!target) return null;

  let username: string | undefined;
  let hostPart = target;
  const atIdx = target.lastIndexOf("@");
  if (atIdx !== -1) {
    username = target.slice(0, atIdx);
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
      return { username, address: ipv6, port };
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

  return { username, address: hostPart, port };
}
