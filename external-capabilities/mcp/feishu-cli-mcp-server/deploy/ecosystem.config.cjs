module.exports = {
  apps: [
    {
      name: "feishu-cli-mcp-server",
      script: "dist/server.js",
      cwd: "/home/ubuntu/feishu-cli-mcp-server",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "256M",
      env: {
        NODE_ENV: "production",
        MCP_HOST: "127.0.0.1",
        MCP_PORT: "3100",
        LARK_CLI_BIN: "/usr/bin/lark-cli",
        LARK_PROFILE: "mcp",
        MCP_ALLOW_REMOTE: "true",
        MCP_PUBLIC_BASE_URL: "https://feishu-mcp.bamamei.online",
        AUTH0_ISSUER: "https://lyra-feishu-mcp.jp.auth0.com/",
        AUTH0_AUDIENCE: "https://feishu-mcp.bamamei.online"
      }
    }
  ]
};
