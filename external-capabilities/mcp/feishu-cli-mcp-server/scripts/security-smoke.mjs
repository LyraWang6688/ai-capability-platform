import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerBaseTools } from "../dist/tools/base.js";
import { registerDocsTools } from "../dist/tools/docs.js";

const expectedScopes = new Map([
  ["feishu_base_list_blocks", "base:read"],
  ["feishu_base_create", "base:write"],
  ["feishu_base_create_fields", "base:write"],
  ["feishu_base_create_records", "base:write"],
  ["feishu_base_list_records", "base:read"],
  ["feishu_base_resolve_url", "base:read"],
  ["feishu_base_update_records", "base:write"],
  ["feishu_docs_create", "docs:write"],
  ["feishu_docs_read", "docs:read"],
  ["feishu_docs_update", "docs:write"],
]);

const writeCalls = [
  ["feishu_base_create", { name: "confirmation-test", confirm: false }],
  ["feishu_base_create_fields", {
    baseToken: "confirmation-test",
    tableId: "confirmation-test",
    fields: [{ name: "Test", type: "text" }],
    confirm: false,
  }],
  ["feishu_base_create_records", {
    baseToken: "confirmation-test",
    tableId: "confirmation-test",
    records: [{ Test: "value" }],
    confirm: false,
  }],
  ["feishu_base_update_records", {
    baseToken: "confirmation-test",
    tableId: "confirmation-test",
    updates: [{ recordId: "confirmation-test", fields: { Test: "value" } }],
    confirm: false,
  }],
  ["feishu_docs_create", { content: "confirmation-test", confirm: false }],
  ["feishu_docs_update", {
    doc: "confirmation-test",
    command: "append",
    content: "confirmation-test",
    confirm: false,
  }],
];

const readCallArguments = new Map([
  ["feishu_base_list_blocks", { baseToken: "scope-test" }],
  ["feishu_base_list_records", { baseToken: "scope-test", tableId: "scope-test" }],
  ["feishu_base_resolve_url", { url: "https://example.com/base/scope-test" }],
  ["feishu_docs_read", { doc: "scope-test" }],
]);

function buildServer(scopes) {
  const server = new McpServer({ name: "security-smoke-server", version: "0.1.0" });
  registerDocsTools(server, scopes);
  registerBaseTools(server, scopes);
  return server;
}

async function withClient(scopes, test) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer(scopes);
  const client = new Client({ name: "security-smoke-client", version: "0.1.0" });

  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    await test(client);
  } finally {
    await client.close();
    await server.close();
  }
}

await withClient(new Set(expectedScopes.values()), async (client) => {
  const listed = await client.listTools();
  const names = listed.tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, [...expectedScopes.keys()].sort(), "MCP tool surface changed unexpectedly");

  for (const tool of listed.tools) {
    assert.doesNotMatch(tool.name, /(delete|remove|shell|exec|command|raw|api)/i, `Prohibited tool exposed: ${tool.name}`);

    const requiredScope = expectedScopes.get(tool.name);
    const schemes = tool.securitySchemes ?? tool._meta?.securitySchemes;
    assert.deepEqual(
      schemes,
      [{ type: "oauth2", scopes: [requiredScope] }],
      `Incorrect OAuth declaration for ${tool.name}`,
    );
  }

  for (const [name, args] of writeCalls) {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, true, `${name} accepted a write without confirmation`);
    assert.match(result.content?.[0]?.text ?? "", /Write operation rejected/);
  }
});

await withClient(new Set(), async (client) => {
  for (const [name, requiredScope] of expectedScopes) {
    const argumentsForValidation =
      writeCalls.find(([writeName]) => writeName === name)?.[1] ?? readCallArguments.get(name) ?? {};
    const result = await client.callTool({ name, arguments: argumentsForValidation });
    assert.equal(result.isError, true, `${name} accepted a call without ${requiredScope}`);
    assert.match(result.content?.[0]?.text ?? "", new RegExp(`insufficient_scope: this tool requires ${requiredScope}`));
  }
});

console.log("PASS: MCP security boundary checks");
