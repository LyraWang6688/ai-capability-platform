import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Synthetic envelopes test transparent forwarding, not the backend's schema.
const directory = await mkdtemp(join(tmpdir(), "base-block-list-"));
const callsPath = join(directory, "calls.jsonl");
const resultPath = join(directory, "result.json");
const executable = join(directory, "fixture.mjs");
try {
  await writeFile(callsPath, "");
  await writeFile(executable, `#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs';
appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify(process.argv.slice(2)) + '\\n');
process.stdout.write(readFileSync(${JSON.stringify(resultPath)}, 'utf8'));
`, { mode: 0o700 });
  process.env.LARK_CLI_BIN = executable;
  process.env.LARK_PROFILE = "offline-test";
  const { registerBaseTools } = await import("../dist/tools/base.js");
  const calls = async () => (await readFile(callsPath, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse);
  async function withClient(scopes, test) {
    const server = new McpServer({ name: "blocks-test", version: "1" });
    registerBaseTools(server, scopes);
    const client = new Client({ name: "blocks-test", version: "1" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    await client.connect(ct);
    try { await test(client); } finally { await client.close(); await server.close(); }
  }
  await withClient(new Set(["base:read"]), async (client) => {
    const tool = (await client.listTools()).tools.find(t => t.name === "feishu_base_list_blocks");
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.equal(tool.inputSchema.properties.limit, undefined);
    const fixture = { ok: true, data: { blocks: [
      { type: "table", id: "tblFixture", name: "Table" },
      { type: "docx", id: "blockFixture", docx_token: "docFixture", name: "Document" },
      { type: "folder", id: "folderFixture" },
      { type: "dashboard", id: "dashboardFixture" },
      { type: "workflow", id: "workflowFixture" },
    ] } };
    await writeFile(resultPath, JSON.stringify(fixture));
    const invoke = args => client.callTool({ name: "feishu_base_list_blocks", arguments: args });
    const result = await invoke({ baseToken: "fixtureBase" });
    assert.deepEqual(result.structuredContent.result, fixture);
    assert.deepEqual((await calls()).at(-1), ["--profile", "offline-test", "base", "+base-block-list", "--base-token", "fixtureBase", "--format", "json", "--as", "user"]);
    for (const type of ["folder", "table", "docx", "dashboard", "workflow"]) {
      await invoke({ baseToken: "fixtureBase", type, parentId: "folderFixture" });
      assert.deepEqual((await calls()).at(-1).slice(-6), ["--type", type, "--parent-id", "folderFixture", "--as", "user"]);
    }
    const count = (await calls()).length;
    for (const args of [{}, { baseToken: "" }, { baseToken: "x", type: "view" }, { baseToken: "x", parentId: "" }]) {
      assert.equal((await invoke(args)).isError, true);
    }
    assert.equal((await calls()).length, count, "Invalid input must not execute CLI");
    await writeFile(resultPath, '{"ok":true,"data":{"blocks":[]}}');
    assert.deepEqual((await invoke({ baseToken: "fixtureBase" })).structuredContent.result.data, { blocks: [] });
    for (const value of ['{"ok":false,"error":"permission denied"}', "not-json"]) {
      await writeFile(resultPath, value);
      const failed = await invoke({ baseToken: "fixtureBase" });
      assert.equal(failed.isError, true);
      assert.equal(failed.structuredContent, undefined, "Failure must not become an empty list");
    }
  });
  const before = (await calls()).length;
  await withClient(new Set(["base:write"]), async client => {
    const denied = await client.callTool({ name: "feishu_base_list_blocks", arguments: { baseToken: "fixtureBase" } });
    assert.equal(denied.isError, true);
    assert.match(denied.content[0].text, /insufficient_scope/);
  });
  assert.equal((await calls()).length, before, "Missing base:read must not execute CLI");
  console.log("PASS: Base block discovery argv, output, input validation and scope checks (offline)");
} finally {
  await rm(directory, { recursive: true, force: true });
}
