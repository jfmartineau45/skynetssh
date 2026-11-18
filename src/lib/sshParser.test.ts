import test from "node:test";
import assert from "node:assert/strict";
import { parseSshConnectionString } from "./sshParser.ts";
import { extractSnippetVariables, resolveSnippetCommand } from "./snippets.ts";

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
