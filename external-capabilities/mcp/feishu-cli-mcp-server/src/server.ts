import express, { type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { config } from "./config.js";
import {
  bearerChallenge,
  FEISHU_SCOPES,
  protectedResourceMetadataUrl,
  type AuthContext,
  verifyAccessToken,
} from "./oauth.js";
import { registerBaseTools } from "./tools/base.js";
import { registerDocsTools } from "./tools/docs.js";

const localAuth: AuthContext = {
  subject: "local-smoke-test",
  clientId: "local",
  scopes: new Set(FEISHU_SCOPES),
  expiresAt: Number.MAX_SAFE_INTEGER,
};

function buildMcpServer(auth: AuthContext): McpServer {
  const server = new McpServer(
    { name: "feishu-cli-mcp-server", version: "0.1.0" },
    {
      instructions:
        "Use read tools before updates. Write tools require confirm=true only after the user confirms the exact target and change. Deletion and arbitrary CLI execution are unavailable.",
    },
  );
  registerDocsTools(server, auth.scopes);
  registerBaseTools(server, auth.scopes);
  return server;
}

function isLocalHostHeader(req: Request): boolean {
  const hostname = req.hostname.toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function rejectUnauthorized(res: Response, description: string): null {
  res.setHeader("WWW-Authenticate", bearerChallenge("invalid_token", description));
  res.status(401).json({ error: "invalid_token", error_description: description });
  return null;
}

async function authorize(req: Request, res: Response): Promise<AuthContext | null> {
  if (!config.allowRemote) {
    if (isLocalHostHeader(req)) return localAuth;
    res.status(403).json({ error: "Remote MCP access is disabled until OAuth is configured." });
    return null;
  }

  const header = req.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match?.[1]) return rejectUnauthorized(res, "A bearer access token is required");

  try {
    return await verifyAccessToken(match[1]);
  } catch (error) {
    console.warn("Rejected OAuth access token", error instanceof Error ? error.message : "unknown error");
    return rejectUnauthorized(res, "The access token is invalid or expired");
  }
}

function protectedResourceMetadata(_req: Request, res: Response): void {
  if (!config.publicBaseUrl || !config.auth0Issuer) {
    res.status(404).json({ error: "OAuth is not configured" });
    return;
  }

  res.setHeader("Cache-Control", "public, max-age=3600");
  res.json({
    resource: config.auth0Audience,
    authorization_servers: [config.auth0Issuer],
    scopes_supported: FEISHU_SCOPES,
    bearer_methods_supported: ["header"],
    resource_name: "Feishu MCP",
  });
}

const app = express();
app.disable("x-powered-by");
// A shared process budget, not an IP limit: forwarded headers cannot evade it.
// Run before parsing, token verification, MCP allocation, and CLI execution.
app.use("/mcp", rateLimit({
  windowMs: config.rateLimitWindowMs,
  limit: config.rateLimitMax,
  keyGenerator: () => "mcp-process",
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "rate_limit_exceeded", error_description: "Too many MCP requests. Retry after the indicated delay." },
}));
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "feishu-cli-mcp-server", version: "0.1.0" });
});

app.get("/.well-known/oauth-protected-resource", protectedResourceMetadata);
app.get("/.well-known/oauth-protected-resource/mcp", protectedResourceMetadata);

app.post("/mcp", async (req, res) => {
  const auth = await authorize(req, res);
  if (!auth) return;

  const server = buildMcpServer(auth);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("MCP request failed", error);
    if (!res.headersSent) res.status(500).json({ error: "MCP request failed" });
  }
});

app.get("/mcp", (_req, res) => {
  res.status(405).setHeader("Allow", "POST").json({ error: "Method not allowed in stateless mode" });
});

app.delete("/mcp", (_req, res) => {
  res.status(405).setHeader("Allow", "POST").json({ error: "Method not allowed in stateless mode" });
});

app.listen(config.port, config.host, () => {
  const mode = config.allowRemote ? "Auth0 OAuth" : "local-only";
  console.error(`feishu-cli-mcp-server listening on http://${config.host}:${config.port} (${mode})`);
  if (config.allowRemote) console.error(`OAuth resource metadata: ${protectedResourceMetadataUrl()}`);
});
