# Project architecture

Read this reference when locating code, deciding where a change belongs, or determining whether Auth0 or deployment configuration must change.

## Runtime path

```text
ChatGPT -> Auth0 OAuth 2.1 -> Nginx HTTPS -> POST /mcp
        -> MCP tool validation -> execFile(lark-cli) -> Feishu
```

Responsibilities stay separated:

- Auth0 authenticates the ChatGPT client and issues audience-bound access tokens.
- `src/oauth.ts` verifies RS256 tokens and enforces MCP scopes.
- `src/server.ts` publishes protected-resource metadata and registers tool modules.
- `src/tools/docs.ts` contains controlled document tools.
- `src/tools/base.ts` contains controlled Base tools.
- `src/lark-cli.ts` executes fixed argv arrays without a shell.
- The deployment user's local `lark-cli` profile holds Feishu credentials.
- Nginx terminates HTTPS and proxies only the intended public routes.
- PM2 runs the built `dist/server.js`.

## Existing authorization families

Use these scopes only when they accurately describe the new capability:

| Capability | OAuth scope |
|---|---|
| Read documents | `docs:read` |
| Create or modify documents | `docs:write` |
| Read Base schema or records | `base:read` |
| Create or modify Base schema or records | `base:write` |

A new tool inside one of these families normally does not require an Auth0 change. A genuinely new resource family may require a new scope, protected-resource metadata update, Auth0 API permission, role assignment, and user reconnection. Treat that as separate external configuration work and obtain explicit authorization first.

## Repository invariants

Preserve these constraints unless the user explicitly requests a security redesign:

- No arbitrary CLI or shell tool.
- No raw `lark-cli api` escape hatch.
- Use `execFile` with a fixed command and validated arguments.
- Never accept or return Feishu credentials through MCP inputs.
- Keep production listening on loopback behind Nginx.
- Keep OAuth enforcement active for remote access.
- Keep read and write permissions distinct.
- Require explicit confirmation immediately before writes.
- Do not add deletion capabilities as an incidental part of another request.

## Values that must be discovered, not hard-coded

Do not freeze these values into the Skill:

- Current tool count.
- Current Git branch or commit.
- Installed `lark-cli` version.
- Auth0 users, roles, grants, or client IDs.
- Document URLs, Base tokens, table IDs, view IDs, field IDs, or record IDs.
- Production deployment status.

Inspect the current repository and relevant live system when the task needs these facts.
