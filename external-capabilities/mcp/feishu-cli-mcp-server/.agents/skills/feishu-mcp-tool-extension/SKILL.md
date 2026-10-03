---
name: feishu-mcp-tool-extension
description: Extend, modify, troubleshoot, validate, or release MCP tools in the feishu-cli-mcp-server repository. Use for changes to the MCP tool surface or when deployed tools are missing from ChatGPT; do not use for ordinary Feishu document or Base operations.
---

# Feishu MCP tool extension

Maintain the repository's controlled MCP wrapper around the official `lark-cli`.

## Start with the task boundary

1. Restate the requested capability as one user-visible outcome.
2. Classify the request as tool addition, tool modification, tool removal, tool-discovery troubleshooting, or release work.
3. Inspect the current branch, working tree, `README.md`, `SECURITY.md`, and only the relevant source modules.
4. Preserve unrelated changes. Do not reset, overwrite, merge, deploy, or mutate external services unless the user has authorized that action.

For repository structure, OAuth boundaries, and invariants, read [references/project-architecture.md](references/project-architecture.md).

## Verify the underlying Feishu capability

Before designing arguments or writing code:

1. Identify the narrowest official `lark-cli` shortcut that provides the capability.
2. Run that installed command with `--help` on the development or deployment host.
3. Consult the matching official `larksuite/cli` Skill or source when field schemas, side effects, or command semantics remain unclear.
4. Use `--dry-run` when the shortcut supports it and the result will clarify the request.
5. Stop if the installed CLI does not support the capability. Do not guess flags, probe raw APIs, add arbitrary shell execution, or claim unsupported behavior.

Do not copy the complete upstream `lark-suite` Skill into this repository. It documents the full CLI; this project intentionally exposes a smaller controlled surface.

## Design and implement the MCP tool

Read [references/tool-contract.md](references/tool-contract.md) before changing a tool definition.

Keep each tool focused on one recognizable operation. Reuse an existing OAuth scope when it accurately covers the capability. Changing Auth0 configuration, adding a new scope, or widening access requires a separate justification and explicit user authorization.

For writes:

- Require `confirm=true` after the user confirms the exact target and change.
- Mark annotations according to the real side effect.
- Use `runLarkCli(args, { write: true })`.
- Prefer a dedicated test resource; do not use real business data for exploratory testing.

## Validate and release

Read [references/release-runbook.md](references/release-runbook.md) for local checks, production deployment, ChatGPT metadata refresh, and rollback.

The minimum code acceptance checks are:

- TypeScript typecheck succeeds.
- Production build succeeds.
- MCP handshake succeeds.
- `tools/list` contains the intended tool definitions.
- Relevant read-only behavior is verified.
- Any live write test has explicit authorization and observable read-back.

Report separately:

- what changed in source control;
- what was deployed;
- what external configuration changed;
- what remains for the user to refresh or approve.

Never infer deployment from a successful commit, or ChatGPT visibility from a successful server restart.
