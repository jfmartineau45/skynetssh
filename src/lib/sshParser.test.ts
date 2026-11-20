import test from "node:test";
import assert from "node:assert/strict";
import { parseSshConnectionString } from "./sshParser.ts";
import { extractSnippetVariables, resolveSnippetCommand } from "./snippets.ts";
import {
  formatModifiedDisplay,
  posixQuote,
  sortSftpEntries,
} from "./sftpUtils.ts";
import {
  consumePaneSessionHandedOff,
  markPaneSessionHandedOff,
  reorderTabList,
} from "./windowTabs.ts";

test("parseSshConnectionString handles ssh -p, host:port, and IPv6", () => {
  assert.deepEqual(
    parseSshConnectionString("ssh -p 2222 ubuntu@10.0.1.5"),
    { username: "ubuntu", address: "10.0.1.5", port: 2222 }
  );

  assert.deepEqual(
    parseSshConnectionString("root@[2001:db8::1]:2200"),
    { username: "root", address: "2001:db8::1", port: 2200 }
  );

  assert.deepEqual(
    parseSshConnectionString("admin@2001:db8::42"),
    { username: "admin", address: "2001:db8::42", port: undefined }
  );
});

test("extractSnippetVariables prompts user variables while preserving Docker {{.Names}}", () => {
  const dockerTable = 'docker ps --format "table {{.Names}}\\t{{.Status}}"';
  assert.deepEqual(extractSnippetVariables(dockerTable), []);

  const parameterized =
    "docker logs -f --tail {{lines}} {{container_name}} && echo {{container_name}}";
  assert.deepEqual(extractSnippetVariables(parameterized), [
    "lines",
    "container_name",
  ]);
  assert.equal(
    resolveSnippetCommand(parameterized, {
      lines: "200",
      container_name: "paperless-webserver",
    }),
    "docker logs -f --tail 200 paperless-webserver && echo paperless-webserver"
  );
});

test("sftpUtils formats relative modified times, quotes POSIX paths safely, and sorts newest first", () => {
  assert.equal(posixQuote("/var/log/app's $(rm -rf).log"), "'/var/log/app'\\''s $(rm -rf).log'");

  const nowMs = 1_700_000_000_000;
  assert.equal(formatModifiedDisplay(1_699_999_980, nowMs).short, "Just now");
  assert.equal(formatModifiedDisplay(1_700_000_000 - 300, nowMs).short, "5m ago");
  assert.equal(formatModifiedDisplay(1_700_000_000 - 7200, nowMs).short, "2h ago");
  const olderSameYear = formatModifiedDisplay(1_700_000_000 - 20 * 86400, nowMs).short;
  assert.ok(!olderSameYear.includes("p.m.") && !olderSameYear.includes("a.m."));
  assert.ok(olderSameYear.length <= 13);

  const items = [
    {
      name: "old-folder",
      path: "/old-folder",
      isDir: true,
      isSymlink: false,
      size: 0,
      modifiedAt: 1000,
      permissionsDisplay: "drwxr-xr-x",
    },
    {
      name: "fresh.log",
      path: "/fresh.log",
      isDir: false,
      isSymlink: false,
      size: 512,
      modifiedAt: 9999,
      permissionsDisplay: "-rw-r--r--",
    },
  ];
  // Pure modified desc (dirsFirst=false) surfaces fresh.log above old-folder!
  const sortedLatest = sortSftpEntries(items, "modified", "desc", false);
  assert.equal(sortedLatest[0].name, "fresh.log");
});

test("windowTabs reorders terminal tabs while keeping pinned Vault anchored and tracks live session handoffs", () => {
  const tabs = [
    { id: "vault" as const, kind: "vault" as const, title: "Vault", pinned: true },
    {
      id: "t1",
      kind: "sftp" as const,
      title: "Tab 1",
      leftTarget: { type: "local" as const },
      rightTarget: { type: "local" as const },
    },
    {
      id: "t2",
      kind: "sftp" as const,
      title: "Tab 2",
      leftTarget: { type: "local" as const },
      rightTarget: { type: "local" as const },
    },
  ];
  assert.deepEqual(
    reorderTabList(tabs, "t2", "t1").map((t) => t.id),
    ["vault", "t2", "t1"]
  );
  assert.deepEqual(
    reorderTabList(tabs, "t1", "vault").map((t) => t.id),
    ["vault", "t1", "t2"]
  );

  markPaneSessionHandedOff("pane-live-1");
  assert.equal(consumePaneSessionHandedOff("pane-live-1"), true);
  assert.equal(consumePaneSessionHandedOff("pane-live-1"), false);
});
