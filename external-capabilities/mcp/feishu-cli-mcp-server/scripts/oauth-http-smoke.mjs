import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const port = 31992;
const publicBaseUrl = "https://feishu-mcp.example";
const issuer = "https://security-test.jp.auth0.com/";
const audience = publicBaseUrl;
const origin = `http://127.0.0.1:${port}`;

const server = spawn(process.execPath, ["dist/server.js"], {
  env: {
    ...process.env,
    MCP_HOST: "127.0.0.1",
    MCP_PORT: String(port),
    MCP_ALLOW_REMOTE: "true",
    MCP_PUBLIC_BASE_URL: publicBaseUrl,
    AUTH0_ISSUER: issuer,
    AUTH0_AUDIENCE: audience,
    MCP_RATE_LIMIT_MAX: "2",
    MCP_RATE_LIMIT_WINDOW_MS: "2000",
  },
  stdio: ["ignore", "ignore", "pipe"],
});

let serverLog = "";
server.stderr.setEncoding("utf8");
server.stderr.on("data", (chunk) => {
  serverLog += chunk;
});

async function waitUntilReady() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`${origin}/health`);
      if (response.ok) return;
    } catch {
      // The process may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`OAuth test server did not become ready.\n${serverLog}`);
}

try {
  await waitUntilReady();

  const metadataResponse = await fetch(`${origin}/.well-known/oauth-protected-resource`);
  assert.equal(metadataResponse.status, 200);
  const metadata = await metadataResponse.json();
  assert.deepEqual(metadata, {
    resource: audience,
    authorization_servers: [issuer],
    scopes_supported: ["docs:read", "docs:write", "base:read", "base:write"],
    bearer_methods_supported: ["header"],
    resource_name: "Feishu MCP",
  });

  const unauthorized = await fetch(`${origin}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(unauthorized.status, 401);
  assert.match(
    unauthorized.headers.get("www-authenticate") ?? "",
    /^Bearer .*resource_metadata="https:\/\/feishu-mcp\.example\/\.well-known\/oauth-protected-resource".*error="invalid_token"/,
  );
  assert.deepEqual(await unauthorized.json(), {
    error: "invalid_token",
    error_description: "A bearer access token is required",
  });

  const second = await fetch(`${origin}/mcp`, {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}",
  });
  assert.equal(second.status, 401);
  await second.arrayBuffer();
  // Exhausted requests must be rejected before JSON parsing or OAuth, even if
  // the caller rotates purported proxy IPs or sends a malformed bearer token.
  for (const suffix of ["", "/", ""]) {
    const blocked = await fetch(`${origin}/mcp${suffix}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `203.0.113.${Math.floor(Math.random() * 200) + 1}`,
        "x-real-ip": "198.51.100.42",
        authorization: "Bearer invalid",
      },
      body: "not json",
    });
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get("retry-after")) > 0);
    assert.equal(blocked.headers.get("www-authenticate"), null);
    assert.equal((await blocked.json()).error, "rate_limit_exceeded");
  }
  for (const path of ["/health", "/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, 200);
    await response.arrayBuffer();
  }
  await new Promise((resolve) => setTimeout(resolve, 2100));
  const recovered = await fetch(`${origin}/mcp`, {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}",
  });
  assert.equal(recovered.status, 401, "Quota must recover without bypassing OAuth");
  await recovered.arrayBuffer();

  console.log("PASS: OAuth HTTP security, rate limiting, header spoofing, and quota recovery checks");
} finally {
  server.kill("SIGTERM");
  await new Promise((resolve) => {
    if (server.exitCode !== null) return resolve();
    server.once("exit", resolve);
    setTimeout(() => {
      server.kill("SIGKILL");
      resolve();
    }, 2_000).unref();
  });
}
