# Feishu CLI MCP Server

A modular, tool-only MCP server that lets compatible AI clients use controlled
Feishu/Lark document and Base operations through the official
[`lark-cli`](https://github.com/larksuite/cli).

The project uses one MCP endpoint with focused tools. New Feishu capabilities
can be added as modules without creating another domain, certificate, process,
or ChatGPT plugin.

## Implemented tools

- `feishu_base_list_blocks`
- `feishu_docs_read`
- `feishu_docs_create`
- `feishu_docs_update`
- `feishu_base_resolve_url`
- `feishu_base_list_records`
- `feishu_base_create`
- `feishu_base_create_fields`
- `feishu_base_create_records`
- `feishu_base_update_records`

`feishu_base_create` can create a Base with its first table and initial
schema. `feishu_base_create_fields` can add one or more common field types to
an existing table. Formula and lookup fields are intentionally excluded because
they require separate expression and cross-table validation.

Deletion, arbitrary shell execution, and raw `lark-cli api` access are not
available.

## Architecture

```text
ChatGPT -> OAuth 2.1 -> /mcp -> validated tool -> execFile(lark-cli) -> Feishu
```

Feishu credentials remain in the server user's existing `lark-cli` credential
store. They are never passed through MCP arguments or committed to Git.

## Requirements

- Node.js 20+
- `lark-cli` 1.0.93+ installed and authenticated
- A working user profile with the required Feishu scopes
- Auth0 and HTTPS for remote ChatGPT access

## Install and build

```bash
git clone https://github.com/LyraWang6688/feishu-cli-mcp-server.git
cd feishu-cli-mcp-server
npm ci
npm run typecheck
npm run build
```

The safe default binds to `127.0.0.1:3100`. Check health locally:

```bash
curl http://127.0.0.1:3100/health
```

Run the MCP handshake and tool-discovery test:

```bash
npm run smoke
```

Optionally validate real read-only Feishu calls through MCP:

```bash
SMOKE_DOC_URL='https://example.feishu.cn/wiki/...' npm run smoke
SMOKE_BASE_URL='https://example.feishu.cn/base/...?table=...' npm run smoke
```

For a dedicated test document and table only, the explicit write smoke test can
validate document append and record create/update/read-back:

```bash
SMOKE_DOC_URL='https://example.feishu.cn/docx/...' \
SMOKE_BASE_URL='https://example.feishu.cn/base/...?table=...' \
SMOKE_BASE_CONTENT_FIELD='测试内容' \
SMOKE_BASE_STATUS_FIELD='测试状态' \
SMOKE_WRITE_CONFIRM='I_UNDERSTAND_THIS_WRITES_TO_FEISHU' \
npm run smoke
```

Schema creation is deliberately not part of the repeatable smoke script because
each run would leave a new Base or field. Test the two schema tools through
ChatGPT against a dedicated test resource and explicitly confirm the exact
names and field definitions.

## Discover content from a Base link

Resolve the URL with `feishu_base_resolve_url`, then pass the returned Base token
to `feishu_base_list_blocks` as `baseToken`. Optional `type` accepts `folder`,
`table`, `docx`, `dashboard`, or `workflow`; optional `parentId` restricts the list
to a folder's direct children. Omitting both lists all blocks returned by the
backend. The CLI returns the full list and exposes no limit/offset flags.

The result preserves the CLI envelope and identifiers. Use a table block's `id`
as `tableId` for `feishu_base_list_records`; use a document's `docx_token` as `doc`
for `feishu_docs_read`. Discovery does not read resource contents, list table
views, enumerate dashboard widgets, or list every Base/document in the account.
Errors remain errors, not empty resource lists. Very large results remain subject
to the existing CLI timeout and output-size limits and are not silently truncated.

This read-only tool reuses `base:read`; no new Auth0 permission is required.
Before deployment, check `lark-cli base +base-block-list --help` on the **server**:
the verified help was supplied from a Mac, and server versions may differ.
After deployment, refresh the existing ChatGPT connection's tool metadata.
Offline acceptance: `node scripts/base-block-list-smoke.mjs` after building.
Live acceptance: resolve a dedicated Base URL, list its blocks, then use a returned
table ID/document token with the existing read tools. No write is needed.

## OAuth and production safety

Remote requests use Auth0-issued RS256 access tokens. Each tool declares its
required OAuth scope, and the server enforces the same scope at runtime:

- document reads: `docs:read`
- document writes: `docs:write`
- Base reads: `base:read`
- Base, field, and record writes: `base:write`

All write tools also require `confirm=true` after the user confirms the exact
target and change. See [SECURITY.md](SECURITY.md) before adding more tools.

## Request and CLI capacity limits

| Environment variable | Default | Allowed range |
|---|---:|---:|
| `MCP_RATE_LIMIT_WINDOW_MS` | 60000 | 1000–3600000 |
| `MCP_RATE_LIMIT_MAX` | 120 | 1–10000 |
| `LARK_CLI_MAX_PENDING` | 4 | 1–32 |

The request quota is shared by all `/mcp` callers in one process, including local
smoke tests and unauthenticated requests. On HTTP 429, wait for `Retry-After`;
reconnecting OAuth does not reset the quota. Health and OAuth metadata are not
charged to this budget. CLI capacity counts executing reads and executing/queued
writes together; rejected work is not queued. See [SECURITY.md](SECURITY.md) for
proxy and multi-process limitations.

After pulling this change on the deployment host, run `npm ci` before building
because the dependency lockfile changed. Restart only after deployment approval.
No Auth0 changes or ChatGPT tool refresh are needed: the tool surface is unchanged.

Offline acceptance checks (no Feishu credentials or live writes):

```bash
npm run typecheck
npm run build
npm run security-smoke
```

## Verified lark-cli commands

- `base +base-block-list`
- `docs +fetch`
- `docs +create`
- `docs +update`
- `base +url-resolve`
- `base +record-list`
- `base +base-create`
- `base +field-create`
- `base +record-batch-create`
- `base +record-batch-update`

Run each command's `--help` on the deployment host when upgrading
`lark-cli`.

## References

- [OpenAI: Build an MCP server](https://developers.openai.com/plugins/build/mcp-server)
- [OpenAI: Authentication](https://developers.openai.com/plugins/build/auth)
- [OpenAI: Define tools](https://developers.openai.com/plugins/plan/tools)
- [Official lark-cli repository](https://github.com/larksuite/cli)

## License

MIT
