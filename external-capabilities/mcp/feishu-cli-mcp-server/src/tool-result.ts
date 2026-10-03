import { LarkCliError } from "./lark-cli.js";
import { bearerChallenge, type FeishuScope } from "./oauth.js";

export function successResult(result: Record<string, unknown>) {
  return {
    structuredContent: { result },
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(result),
      },
    ],
  };
}

export function errorResult(error: unknown) {
  const message =
    error instanceof LarkCliError
      ? error.message
      : "The requested Feishu operation failed unexpectedly.";

  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

export function insufficientScopeResult(scope: FeishuScope) {
  const message = `insufficient_scope: this tool requires ${scope}`;
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
    _meta: {
      "mcp/www_authenticate": [bearerChallenge("insufficient_scope", message, scope)],
    },
  };
}

export function requireConfirmation(confirm: boolean): void {
  if (!confirm) {
    throw new LarkCliError("Write operation rejected: set confirm=true only after the user confirms the exact target and change.");
  }
}
