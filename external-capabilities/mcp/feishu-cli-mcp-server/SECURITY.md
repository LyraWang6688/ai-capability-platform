# Security policy

## Never commit credentials

Do not commit Feishu/Lark app secrets, OAuth tokens, SSH keys, MCP bearer tokens,
real document URLs, or exported business data. The server intentionally reuses
the local `lark-cli` credential store instead of accepting Feishu credentials in
MCP tool arguments.

If a secret is committed, revoke and rotate it immediately. Removing the file in
a later commit does not remove the secret from Git history.

## Remote exposure

Version 0.1 binds to loopback and rejects non-local Host headers by default.
Do not expose `/mcp` through Nginx until OAuth 2.1 authentication is configured.
A static bearer token may help test compatible non-ChatGPT clients, but it is not
a substitute for the OAuth flow expected by ChatGPT.

## Resource limits

`/mcp` has a process-wide request budget before JSON parsing and OAuth checks:
120 requests per 60 seconds by default, including failed authentication and MCP
handshake requests. Excess requests receive HTTP 429 with `Retry-After` (not an
OAuth challenge). Health and OAuth metadata routes remain available.

This is intentionally a shared budget, not an IP-based quota. Neither socket IP
nor client-supplied forwarding headers select the counter, so no `trust proxy`
change is needed. An abusive caller can temporarily consume the shared budget;
this protects expensive backend work, not availability against network DDoS.

CLI work also has a shared cap of 4 running/queued operations. Reads may run in
parallel; writes retain serial execution. When full, a tool error is returned
without starting or queuing the rejected operation. Capacity is released on
success, failure, and timeout. This tool error is distinct from HTTP 429.

These in-memory controls assume the current single-process PM2 deployment.
Restarting resets counters. Multiple workers/replicas require a shared limiter
and a coordinated CLI queue before scaling; do not multiply processes to evade
the budget. Limits do not replace OAuth, scope checks, or write confirmation.

## Tool surface

This project uses `execFile` with fixed argument arrays. It does not invoke a
shell and does not expose arbitrary `lark-cli api` or delete operations. Keep new
tools equally narrow and validate every argument.
