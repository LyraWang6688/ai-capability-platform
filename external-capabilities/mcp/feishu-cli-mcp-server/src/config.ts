function integerFromEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

function booleanFromEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${name} must be true or false`);
}

function normalizedUrlFromEnv(name: string): string {
  const raw = process.env[name] ?? "";
  if (!raw) return "";

  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error(`${name} must use https`);
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function issuerFromEnv(): string {
  const raw = process.env.AUTH0_ISSUER ?? "";
  if (!raw) return "";

  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("AUTH0_ISSUER must use https");
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export const config = {
  host: process.env.MCP_HOST ?? "127.0.0.1",
  port: integerFromEnv("MCP_PORT", 3100, 1, 65535),
  rateLimitWindowMs: integerFromEnv("MCP_RATE_LIMIT_WINDOW_MS", 60_000, 1_000, 3_600_000),
  rateLimitMax: integerFromEnv("MCP_RATE_LIMIT_MAX", 120, 1, 10_000),
  cliMaxPending: integerFromEnv("LARK_CLI_MAX_PENDING", 4, 1, 32),
  larkCliBin: process.env.LARK_CLI_BIN ?? "lark-cli",
  larkProfile: process.env.LARK_PROFILE ?? "mcp",
  cliTimeoutMs: integerFromEnv("LARK_CLI_TIMEOUT_MS", 60_000, 1_000, 120_000),
  cliMaxBufferBytes: integerFromEnv(
    "LARK_CLI_MAX_BUFFER_BYTES",
    5 * 1024 * 1024,
    64 * 1024,
    20 * 1024 * 1024,
  ),
  allowRemote: booleanFromEnv("MCP_ALLOW_REMOTE", false),
  publicBaseUrl: normalizedUrlFromEnv("MCP_PUBLIC_BASE_URL"),
  auth0Issuer: issuerFromEnv(),
  auth0Audience: process.env.AUTH0_AUDIENCE ?? "",
} as const;

if (config.allowRemote) {
  if (!config.publicBaseUrl) throw new Error("MCP_PUBLIC_BASE_URL is required when MCP_ALLOW_REMOTE=true");
  if (!config.auth0Issuer) throw new Error("AUTH0_ISSUER is required when MCP_ALLOW_REMOTE=true");
  if (!config.auth0Audience) throw new Error("AUTH0_AUDIENCE is required when MCP_ALLOW_REMOTE=true");
}
