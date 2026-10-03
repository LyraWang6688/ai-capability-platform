import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const endpoint = new URL(process.env.MCP_URL ?? "http://127.0.0.1:3100/mcp");
const headers = {};
if (process.env.MCP_BEARER_TOKEN) {
  headers.authorization = `Bearer ${process.env.MCP_BEARER_TOKEN}`;
}

const transport = new StreamableHTTPClientTransport(endpoint, {
  requestInit: { headers },
});
const client = new Client({ name: "feishu-cli-mcp-smoke", version: "0.1.0" });

function printToolResult(label, result) {
  const failed = result.isError === true;
  console.log(`${failed ? "FAIL" : "PASS"}: ${label}`);
  console.log(JSON.stringify(result, null, 2));
  if (failed) process.exitCode = 1;
}

function requireToolSuccess(label, result) {
  printToolResult(label, result);
  if (result.isError === true) {
    throw new Error(`${label} failed`);
  }
  return result.structuredContent?.result?.data;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing ${label} in MCP tool result`);
  }
  return value;
}

try {
  await client.connect(transport);

  const listed = await client.listTools();
  console.log(`PASS: MCP handshake; discovered ${listed.tools.length} tools`);
  console.log(listed.tools.map((tool) => tool.name).sort().join("\n"));

  const docUrl = process.env.SMOKE_DOC_URL;
  const baseUrl = process.env.SMOKE_BASE_URL;
  let baseCoordinates;

  if (docUrl) {
    const result = await client.callTool({
      name: "feishu_docs_read",
      arguments: {
        doc: docUrl,
        format: "markdown",
        detail: "simple",
      },
    });
    requireToolSuccess("Feishu document read", result);
  }

  if (baseUrl) {
    const resolved = await client.callTool({
      name: "feishu_base_resolve_url",
      arguments: { url: baseUrl },
    });
    const data = requireToolSuccess("Feishu Base URL resolve", resolved);
    const baseToken = requireString(data?.base_token, "base_token");
    const tableId = requireString(data?.table_id ?? data?.block_id, "table_id");
    baseCoordinates = { baseToken, tableId };

    const records = await client.callTool({
      name: "feishu_base_list_records",
      arguments: { baseToken, tableId, limit: 20 },
    });
    requireToolSuccess("Feishu Base record list", records);
  }

  const writePhrase = "I_UNDERSTAND_THIS_WRITES_TO_FEISHU";
  if (process.env.SMOKE_WRITE_CONFIRM === writePhrase) {
    if (!docUrl || !baseCoordinates) {
      throw new Error("Write smoke test requires both SMOKE_DOC_URL and SMOKE_BASE_URL");
    }

    const stamp = new Date().toISOString();
    const contentField = process.env.SMOKE_BASE_CONTENT_FIELD ?? "测试内容";
    const statusField = process.env.SMOKE_BASE_STATUS_FIELD ?? "测试状态";

    const docUpdate = await client.callTool({
      name: "feishu_docs_update",
      arguments: {
        doc: docUrl,
        command: "append",
        content: `<p>MCP 写入测试：${stamp}</p>`,
        format: "xml",
        confirm: true,
      },
    });
    requireToolSuccess("Feishu document append", docUpdate);

    const docVerification = await client.callTool({
      name: "feishu_docs_read",
      arguments: { doc: docUrl, format: "markdown", detail: "simple" },
    });
    requireToolSuccess("Feishu document read-after-write", docVerification);

    const created = await client.callTool({
      name: "feishu_base_create_records",
      arguments: {
        ...baseCoordinates,
        records: [{
          [contentField]: `MCP 创建测试 ${stamp}`,
          [statusField]: "已创建",
        }],
        confirm: true,
      },
    });
    const createData = requireToolSuccess("Feishu Base record create", created);
    const recordId = requireString(createData?.record_id_list?.[0], "record_id_list[0]");

    const updated = await client.callTool({
      name: "feishu_base_update_records",
      arguments: {
        ...baseCoordinates,
        updates: [{
          recordId,
          fields: { [statusField]: "已更新" },
        }],
        confirm: true,
      },
    });
    requireToolSuccess("Feishu Base record update", updated);

    const baseVerification = await client.callTool({
      name: "feishu_base_list_records",
      arguments: { ...baseCoordinates, limit: 20 },
    });
    requireToolSuccess("Feishu Base read-after-write", baseVerification);
  } else if (process.env.SMOKE_WRITE_CONFIRM) {
    throw new Error(`SMOKE_WRITE_CONFIRM must exactly equal ${writePhrase}`);
  }
} finally {
  await transport.close();
}
