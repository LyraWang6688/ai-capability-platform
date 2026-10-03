# Tool contract

Read this reference before adding or changing an MCP tool.

## 1. Define the operation

Write down:

- the user goal;
- the official `lark-cli` shortcut;
- whether it reads, creates, updates, or deletes;
- required identifiers and optional controls;
- expected structured output;
- likely partial-success behavior;
- the existing OAuth scope that covers it.

Prefer one narrow shortcut per MCP tool. Split operations whose inputs, risks, or success criteria differ materially.

## 2. Verify the installed CLI

Run:

```bash
lark-cli <domain> <shortcut> --help
```

Use the installed help as the authority for supported flags. Consult the official `larksuite/cli` repository or its matching Skill for schema details and workflow guidance. If neither establishes a safe mapping, stop and report the unsupported boundary.

For a supported write shortcut, use `--dry-run` when available before any live test.

## 3. Validate inputs

Use strict Zod schemas with realistic bounds:

- validate URLs, tokens, IDs, enums, integers, arrays, and record shapes;
- make mutually dependent inputs explicit and validate their combination;
- reject duplicates when the CLI or API would interpret them ambiguously;
- map camelCase MCP inputs to the CLI's documented JSON keys deliberately;
- do not expose raw argument arrays, command strings, environment variables, file paths, or credentials.

## 4. Apply OAuth in both layers

Attach the correct security scheme with `oauthTool(..., scope)` and repeat the runtime check with `hasScope`. Return `insufficientScopeResult(scope)` when missing.

Do not add an Auth0 scope merely because a new tool was added. Add one only when the capability is outside the existing authorization families.

## 5. Describe side effects accurately

Set tool annotations according to behavior:

- `readOnlyHint: true` only when no external state changes.
- `destructiveHint: true` when existing state may be overwritten, removed, or irreversibly altered.
- `idempotentHint: true` only when repeating the same request has the same intended effect.
- `openWorldHint: true` for Feishu operations.

All writes require a bounded `confirm` input and `requireConfirmation(input.confirm)`. Describe the exact item the user must confirm.

## 6. Execute safely

Build a fixed argv array and call `runLarkCli`. Never invoke a shell, interpolate a command string, or expose raw `lark-cli api`.

Use:

```ts
return successResult(await runLarkCli(args));
```

for reads, and:

```ts
return successResult(await runLarkCli(args, { write: true }));
```

for writes. Route expected failures through `errorResult`; do not leak credentials, internal stack traces, or full environment details.

## 7. Register and document

Register the tool in the relevant module and ensure `src/server.ts` loads that module. Update the implemented-tool list, verified shortcut list, scope notes, limitations, and tests when affected.

Do not state a fixed expected tool count in durable instructions. During acceptance, compare discovered names against the current source plus the intended delta.
