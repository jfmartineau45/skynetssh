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
  collectPanesFromNode,
  consumePaneSessionHandedOff,
  markPaneSessionHandedOff,
  notifyStandbyMilestone,
  rehydrateTransferredTabs,
  reorderTabList,
} from "./windowTabs.ts";

test("parseSshConnectionString handles ssh -p, rdp://, mstsc /v:, host:port, and IPv6", () => {
  assert.deepEqual(
    parseSshConnectionString("ssh -p 2222 ubuntu@10.0.1.5"),
    {
      protocol: "ssh",
      domain: undefined,
      username: "ubuntu",
      address: "10.0.1.5",
      port: 2222,
    }
  );

  assert.deepEqual(
    parseSshConnectionString("rdp://CONTOSO\\Administrator@10.20.1.50:3390"),
    {
      protocol: "rdp",
      domain: "CONTOSO",
      username: "Administrator",
      address: "10.20.1.50",
      port: 3390,
    }
  );

  assert.deepEqual(
    parseSshConnectionString("mstsc /v:192.168.10.25 /f"),
    {
      protocol: "rdp",
      domain: undefined,
      username: undefined,
      address: "192.168.10.25",
      port: undefined,
    }
  );

  assert.deepEqual(
    parseSshConnectionString("root@[2001:db8::1]:2200"),
    {
      protocol: undefined,
      domain: undefined,
      username: "root",
      address: "2001:db8::1",
      port: 2200,
    }
  );

  assert.deepEqual(
    parseSshConnectionString("admin@2001:db8::42"),
    {
      protocol: undefined,
      domain: undefined,
      username: "admin",
      address: "2001:db8::42",
      port: undefined,
    }
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

  let readyCount = 0;
  notifyStandbyMilestone("listener", () => {
    readyCount += 1;
  });
  assert.equal(readyCount, 0);
  notifyStandbyMilestone("xterm", () => {
    readyCount += 1;
  });
  assert.equal(readyCount, 1);

  // Verify multi-tab + split-pane dock-back preserves ALL tabs, ALL live sessionIds, and split layout!
  const popoutTabs = [
    {
      id: "pop-tab-1",
      kind: "terminal" as const,
      title: "Console 1",
      rootNode: {
        type: "leaf" as const,
        id: "l1",
        pane: {
          id: "p1",
          kind: "ssh" as const,
          title: "Console 1",
          hostId: "h1",
          sessionId: "live-ssh-1",
          connected: true,
          connecting: false,
        },
      },
      activePaneId: "p1",
      sftpDrawerOpen: false,
    },
    {
      id: "pop-tab-2",
      kind: "terminal" as const,
      title: "Console 2 Split",
      rootNode: {
        type: "split" as const,
        id: "sp1",
        direction: "horizontal" as const,
        ratio: 0.4,
        first: {
          type: "leaf" as const,
          id: "l2a",
          pane: {
            id: "p2a",
            kind: "local" as const,
            title: "PWSH",
            sessionId: "live-pty-2a",
            connected: true,
            connecting: false,
          },
        },
        second: {
          type: "leaf" as const,
          id: "l2b",
          pane: {
            id: "p2b",
            kind: "ssh" as const,
            title: "DB",
            hostId: "h2",
            sessionId: "live-ssh-2b",
            connected: true,
            connecting: false,
          },
        },
      },
      activePaneId: "p2b",
      sftpDrawerOpen: true,
      sftpDrawerHostId: "h2",
    },
  ];

  const docked = rehydrateTransferredTabs(popoutTabs);
  assert.equal(docked.length, 2);
  assert.equal(docked[0].title, "Console 1");
  assert.equal(docked[1].title, "Console 2 Split");
  assert.equal(
    docked[0].kind === "terminal" ? collectPanesFromNode(docked[0].rootNode)[0].sessionId : "",
    "live-ssh-1"
  );
  if (docked[1].kind === "terminal") {
    const p2s = collectPanesFromNode(docked[1].rootNode);
    assert.deepEqual(
      p2s.map((p) => p.sessionId),
      ["live-pty-2a", "live-ssh-2b"]
    );
    assert.equal(docked[1].activePaneId, p2s[1].id);
    assert.equal(docked[1].rootNode.type === "split" ? docked[1].rootNode.ratio : 0, 0.4);
  }
});
