# Provider: feishu

飞书 / Lark 开放平台（Feishu Open Platform）—— 本 Store 中与飞书云文档、多维表格（Base）相关的外部能力，其底层服务由该平台提供。

## 概览

| 项 | 说明 |
|---|---|
| Provider 标识 | `feishu` |
| 平台 | 飞书开放平台（Feishu / Lark Open Platform） |
| 官方开放接口 | 有：HTTP OpenAPI，主域名 `open.feishu.cn`（国际版 `open.larksuite.com`） |
| 官方 CLI | 有：[`lark-cli`](https://github.com/larksuite/cli)。本 Store 的能力统一经它调用，不直接拼 HTTP 请求 |
| 本 Store 下的能力 | [`feishu-cli-mcp-server`](../../mcp/feishu-cli-mcp-server/) |

## 认证模型（仅元数据）

本能力有**两层互不相同**的认证，不要混为一谈。

### 第一层：客户端 → MCP 服务

- 类型：OAuth 2.1，Auth0 签发的 RS256 access token（audience-bound）
- 权限族：`docs:read` / `docs:write` / `base:read` / `base:write`
- 每个工具声明所需 scope，服务端运行时用同一 scope 再校验一次；缺 scope 返回 `insufficient_scope`
- 本地 loopback 模式（默认）不需要 OAuth，但会拒绝非本地 Host 头
- 未配置 OAuth 2.1 之前，**不要**把 `/mcp` 暴露到 Nginx 公网入口
- `MCP_BEARER_TOKEN` 是给非 ChatGPT 客户端做临时联调的静态保护，**不能**替代 OAuth 流程

### 第二层：MCP 服务 → 飞书

- MCP 服务**不直接持有**飞书凭据。它复用在部署机上已认证的 `lark-cli` profile（`LARK_PROFILE`），以该用户身份（`--as user`）调用
- 凭据实际存放在 lark-cli 自己的凭据库里，**不在本仓库**，也不通过 MCP 参数传入或返回
- 服务端不读取 `.env`；环境变量只承载元数据（CLI 路径、profile 名、超时、并发上限等）
- 本仓库与实现代码**不存储任何凭据值**；变量名仅作引用名

> 密钥处理约定见实现目录的 [SECURITY.md](../../mcp/feishu-cli-mcp-server/SECURITY.md)。

## 接口边界

实现只暴露**固定 argv** 的 `lark-cli` 子命令，边界是有意收窄的：

- 不调用 shell，不暴露任意命令字符串或参数数组
- 不提供 `lark-cli api` 逃生舱 —— 无法调用未封装的原始接口
- 不提供删除能力
- 所有写操作都要求 `confirm=true`，且必须先由用户确认具体目标与改动
- 不通过 MCP 输入/输出传递任何飞书凭据

覆盖的资源族仅两个：**云文档（docs）** 与 **多维表格（Base）**。

## 已知约束

> 以下为实现的确定性约束；与官方文档或社区说法不一致处，以实测为准。

| 约束 | 说明 |
|---|---|
| 依赖 `lark-cli` 1.0.93+ 且已完成认证 | profile 未认证时所有工具都会失败 |
| 以**部署机**上的 `lark-cli --help` 为准 | 已核对的 help 来自开发机，服务器版本可能不同；升级 lark-cli 后必须重新核对 |
| Node.js 20+ | 运行时要求 |
| `/mcp` 请求预算是**进程级共享**的 | 默认 120 请求 / 60 秒，含握手与失败认证；超限返回 HTTP 429 + `Retry-After`，**不是** OAuth challenge |
| CLI 并发上限 4 个执行中/排队操作 | 读可并行、写串行；满员时直接返回工具错误，不排队 |
| 限流假设**单进程**部署 | 重启即清零；多 worker/replica 需要共享限流器，不能靠加进程绕过预算 |
| 远端模式需要 Auth0 + HTTPS | 本地模式默认只绑 loopback |
| Base 的公式（formula）与 lookup 字段**有意排除** | 需要单独的表达式与跨表校验，不在当前边界内 |
| 大结果**不被静默截断** | 受 CLI 超时与输出上限约束，超限即报错 |
| 资源发现不读内容 | 列 Base block 不会读取资源内容、不枚举仪表盘组件、不遍历账号下全部资源 |

## 参考

- 飞书开放平台：<https://open.feishu.cn/>
- 官方 lark-cli：<https://github.com/larksuite/cli>
