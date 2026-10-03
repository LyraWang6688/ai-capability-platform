# Release runbook

Read this reference when validating, committing, deploying, troubleshooting tool discovery, or rolling back a tool change.

## 1. Preflight

Confirm the repository and branch, then inspect the working tree:

```bash
git status --short
git branch --show-current
git log -1 --oneline
```

Preserve user-owned changes. Do not use destructive reset or checkout operations.

## 2. Local validation

Install dependencies only when required, then run:

```bash
npm run typecheck
npm run build
```

Run an isolated local server when the production port requires OAuth:

```bash
(
  set -e
  MCP_PORT=3101 MCP_ALLOW_REMOTE=false node dist/server.js >/tmp/feishu-mcp-smoke.log 2>&1 &
  smoke_pid=$!
  trap 'kill "$smoke_pid" 2>/dev/null || true' EXIT
  sleep 2
  MCP_URL='http://127.0.0.1:3101/mcp' npm run smoke
)
```

Check the discovered tool names, not only the count. A `401 invalid_token` from the production OAuth endpoint without a bearer token is expected and is not a failed local tool build.

For live Feishu tests:

- use read-only calls first;
- use dedicated test resources for writes;
- obtain explicit confirmation before each external mutation class;
- read back the result;
- do not repeat non-idempotent tests merely to obtain cleaner output.

## 3. Source control

Review the diff and commit only related files. Push to the intended feature branch. A successful push does not mean production is updated.

Do not merge a pull request unless the user explicitly asks.

## 4. Production deployment

After the user authorizes deployment, use the deployment branch already configured on the server:

```bash
cd /home/ubuntu/feishu-cli-mcp-server
git status --short
git pull --ff-only
npm run typecheck
npm run build
pm2 restart feishu-cli-mcp-server --update-env
pm2 status
pm2 logs feishu-cli-mcp-server --lines 30 --nostream
```

Run `npm ci` before the build when dependency manifests changed.

Verify:

```bash
curl -i https://feishu-mcp.bamamei.online/health
curl -i -X POST https://feishu-mcp.bamamei.online/mcp \
  -H 'Content-Type: application/json' \
  --data '{}'
```

Expected outcomes are a healthy `200` response and an OAuth `401` challenge for an unauthenticated MCP POST.

## 5. ChatGPT metadata refresh

A server restart does not refresh ChatGPT's cached tool metadata. In the existing plugin connection:

1. Refresh or scan the MCP tool metadata.
2. Review new tool names, descriptions, schemas, annotations, and scopes.
3. Reconnect only when OAuth scopes or authorization state actually changed.
4. Start a new conversation and list the available tools without writing.
5. Run one representative read test, then an explicitly confirmed write test if the change is a write capability.

Do not create a second MCP connection merely because a new tool is absent from a cached tool list.

## 6. Rollback

If a release is faulty, identify the exact change and use a recoverable Git revert rather than rewriting history:

```bash
git revert <faulty-commit-sha>
npm run typecheck
npm run build
pm2 restart feishu-cli-mcp-server --update-env
```

Refresh ChatGPT metadata again when rollback changes the tool surface. Report separately whether source, production, Auth0, and ChatGPT metadata were rolled back.
