# HANDOFF — wechat-draft-mcp

> 交接文档。**新会话请先完整读完本文件，再动手。**
> 最后更新：2026-10-02

---

## 0. 一句话

一个**本地 stdio MCP 服务**：把磁盘上的文章文件夹，创建成微信公众号草稿。
供成熟 AI Host（**WorkBuddy**、**豆包工作**）在对话中调用。

用户只感知到：「我帮你传到公众号草稿箱了，你有空去看看。」

**边界：只创建草稿。不发布、不群发、不删除、不改动公众号任何设置。**

---

## 1. 现在到哪一步了

| 阶段 | 内容 | 状态 |
|---|---|---|
| **阶段 1** | 在用户自己的公众号上跑通 | 🟡 **WorkBuddy ✅ 完成** / 豆包工作 ⬜ 待验（账号没额度） |
| **阶段 2** | 打磨（补测试、装 Skill、修问题） | 🔵 进行中 |
| **阶段 3** | 做成产品上架豆包 + WorkBuddy | ⬜ 未开始 |

**已经真实发生过的事**（不是设想）：

- WorkBuddy 通过 stdio 拉起本 MCP，发现 4 个工具，成功调用 `wechat_draft_status` 与 `upload_wechat_draft`
- 真实创建了 3 条微信公众号草稿，用户本人在草稿箱里看到了
- 幂等验证：同一文章第二次调用返回既有草稿，草稿箱总数不变

---

## 2. 两个项目的位置

| 项目 | 路径 | 角色 |
|---|---|---|
| **本项目** | `~/Documents/workplace/wechat-draft-mcp/` | 连接器产品（独立 git 仓库，**无 GitHub 远程**） |
| 老仓库 | `~/Documents/workplace/wechat-draft-capability/` | 纯 Publisher 发布链（GitHub 授权 → 自动发布） |

**两者零代码依赖。** 连接器**不 import** 老仓库任何东西（有意为之：产品要能独立发布 npm 包）。

> 老仓库的 GitHub 仓库名计划从 `WeChat-Draft-Capability` 改成小写 `wechat-draft-capability`（用户操作，未完成）。
> 改完需要同步：`.env` 的 `PUBLISHER_ALLOWED_REPOSITORIES`、`src/config.ts` 默认值、`.github/workflows/publish-ready-articles.yml:145` 的硬编码仓库名、`git remote set-url`。
> **建议顺手把 workflow 那处换成 `${{ github.repository }}`**，以后再改名就不用管了。

---

## 3. 已验证的硬事实（**别再重新验证一遍**）

这些都是实测出来的，其中几条**与官方文档/社区说法相反**：

| 事实 | 验证方式 |
|---|---|
| **微信文档写的 `content` 上限 2KB 是假的** | 实测 2500B / 59494B / 24964B 全部创建成功。若按 2KB 做本地拦截，真实文章一条都传不上去 |
| **`content` 的 2 万字符限制也不严格** | 实测 20100 字符仍成功。不要用它做硬拦截 |
| **未认证个人订阅号可以用草稿箱和 `uploadimg`** | 用户的号就是未认证个人订阅号，实测通过。**社区包普遍声称"需要认证"，是错的** |
| `stable_token` 可用且优于 `cgi-bin/token` | 1 万次/分钟 vs 新号 2000 次/天 |
| 正文图片必须走 `media/uploadimg` | 不占素材库配额，仅 jpg/png 且 <1MB；外链图片会被微信过滤 |
| 封面必须走 `material/add_material` | `thumb_media_id` 只接受永久素材 |
| **IP 白名单是强制的** | 非白名单报 `40164`，错误信息里带 `request_ip`。换 Wi-Fi / 开 VPN 后 IP 会变 |
| WorkBuddy 支持本地 stdio MCP | 官方 MCP 文档（803 行）**就打包在 App 内**：`/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/dist/web-ui/docs/cn/cli/mcp.md` |
| WorkBuddy 配置路径 | `~/.workbuddy/mcp.json`（App 实际用这个；官方文档写的是 `~/.codebuddy/.mcp.json`） |
| 豆包工作自定义连接器支持 **STDIO** | 用户界面截图确认；其 `libmcp_helper.dylib` 内含 `rmcp` 的 `transport/child_process.rs` |
| 豆包工作 STDIO 表单 | `服务器名称` / `传输类型` / `命令` / `参数`(列表) / `环境变量`(键值对)。提示语"如 python、node 或 ./script.sh"→ **允许 node 绝对路径** |
| 豆包 **MCP 生态上架**需要准入 | 官方《豆包工作MCP生态准入白皮书》+ 提交表单 + 联调验收。规范里 STDIO **优先 npx、暂不支持 node** → **上架时必须发 npm 包** |
| 微信公众号**没有官方** MCP 或 CLI | 现有全是社区/个人作品 |
| `wechat-official-*` 不代表官方 | "Official Account" 是"公众号"的英文译名，不是"官方出品" |

---

## 4. 架构：一套核心 + 三个壳

```
        核心（只有一份）
  读文章 → 传图 → 建草稿 → 防重复 → 读回核验
              │
    ┌─────────┼─────────┐
    ▼         ▼         ▼
 MCP 壳    CLI 壳    Skill
（产物主    （自查与   （告诉 AI
 入口）     排查）     何时用）
```

**核心逻辑不重复实现。** 这就是总共约 1400 行就能跑的原因。

---

## 5. 代码地图

| 文件 | 行数 | 职责 |
|---|---|---|
| `src/wechatApi.ts` | 259 | 微信 API 客户端。`stable_token` / `uploadBodyImage`(uploadimg) / `uploadMaterial` / `addDraft` / `getDraft` / `draftCount`。含错误码人话翻译、`${VAR}` 占位符检测 |
| `src/articleBundle.ts` | 412 | 文章包解析。兼容 `article.html`+`metadata.json` 与 `content.html`+`meta.json`+`assets.json` 两种布局。算**内容指纹**（正文原始态 + 元数据 + 封面 + 插图内容） |
| `src/security.ts` | 116 | 路径沙箱。绝对路径 / `realpath` 防 symlink 逃逸 / 分段前缀比较 / 敏感目录黑名单 |
| `src/deliveryState.ts` | 103 | 幂等账本。内容指纹 → 状态文件；`creating`/`created` 状态机；单篇互斥锁（`wx` 独占创建） |
| `src/publish.ts` | 224 | 主流程编排。**先落盘 `creating` → 再产生微信副作用**；读回核验 |
| `src/mcpServer.ts` | 166 | stdio MCP 入口，4 个工具。**第一行就把 `console.log` 重定向到 stderr**，保护 JSON-RPC 通道 |
| `src/cli.ts` | 136 | 命令行 `doctor` / `inspect` / `upload` |
| `skills/wechat-draft/SKILL.md` | 153 | 给 AI 的说明书：何时调用、文章包怎么组织、错误怎么处理 |

---

## 6. 安全不变量（**改动时必须保持**）

1. **第一次微信副作用之前，必须先落盘 `creating`**。此后任何异常都属于「结果未知」，保持 `creating`、**禁止自动重试**，由人工去草稿箱核对。
2. **内容指纹幂等**：同一账号 + 同一内容 → 读回既有草稿，绝不重复创建。
   指纹必须基于**改写图片 src 之前**的原始 HTML，否则第一次上传后哈希就变了。
3. **单篇互斥锁**：锁存在即拒绝，绝不并发创建。
4. **凭证不出本机**：由 Host 注入环境变量；不读 `.env`、不持久化、不返回给模型、不打日志。
5. **错误信息净化**：不把文件路径/凭证泄露给模型。
6. **只创建草稿**：不发布、不群发、不删除。

---

## 7. 怎么跑

```bash
cd ~/Documents/workplace/wechat-draft-mcp
npm install
npm run build

# 只读体检
node --env-file=.env dist/cli.js doctor

# 只读预检（推荐上传前必做）
node --env-file=.env dist/cli.js inspect "/绝对路径/文章目录"

# 真正上传
node --env-file=.env dist/cli.js upload "/绝对路径/文章目录"

# MCP 服务（由 Host 启动，不要手动跑）
node dist/mcpServer.js
```

本地调试时 `WECHAT_DRAFT_STATE_DIR` 可指向工作区内目录（沙箱限制下的变通），生产用默认的 `~/.wechat-draft-capability/state`。

### 文章包结构

```
我的文章/
├── article.html       正文（必需；也认 content.html）
├── metadata.json      title / author / digest（可选；也认 meta.json）
├── cover.jpg          封面（必需；也认 cover.png / 封面.* / assets.json 指定）
└── images/            正文插图（用相对路径引用）
```

---

## 8. WorkBuddy 当前配置

`~/.workbuddy/mcp.json`：

```json
{
  "mcpServers": {
    "wechat-draft": {
      "type": "stdio",
      "command": "/usr/local/bin/node",
      "args": ["/Users/wangying/Documents/workplace/wechat-draft-mcp/dist/mcpServer.js"],
      "env": { "WECHAT_APP_ID": "...", "WECHAT_APP_SECRET": "..." },
      "disabled": false
    }
  }
}
```

- **改动前务必备份**（已有备份：`~/.workbuddy/mcp.json.bak.20261002-205313`）
- **改完要在 App 里重新加载连接器**（开关关掉再打开，或重启 App）
- ⚠️ **每次改完 `src/` 必须 `npm run build`**，配置指向的是 `dist/`
- ⚠️ AppSecret **明文存在这个文件里**（这是平台的凭证注入模型）。不要分享该文件

豆包工作那边连接器已配好（STDIO），等账号额度恢复后验证。

---

## 9. 待办（按优先级）

| # | 事项 | 说明 |
|---|---|---|
| **1** | **补自动化测试** | ⚠️ **`tests/` 现在是空的**。全项目约 1400 行，目前只靠真机验证。需要 mock 微信服务器覆盖：解析、幂等、未知结果、路径沙箱、错误分类 |
| 2 | 把 Skill 装进两个 App | 装进 `~/.workbuddy/skills/` 和豆包；装完模型会主动调用，不用用户点名 |
| 3 | 豆包工作实测 | 等额度。连接器已配好，说同样的话即可 |
| 4 | GitHub 仓库改名 | 用户操作，见 §2 的同步清单 |
| 5 | 清理旧符号链接 | `rm ~/Documents/workplace/wechat-article-pilot`（先确保新工作区可用） |
| 6 | 进 `ai-capability-store` | 见 §10 |

---

## 10. 后续：进 AI Capability Store（**先不急**）

用户有一个能力仓库 `~/Documents/workplace/ai-capability-store`（`LyraWang6688/ai-capability-store`），本 MCP 最终要作为能力资产入库。

**但用户明确决定：先独立跑，等 Store 契约稳定了再入。** Store 才开发两天。

入库时要遵守的契约（已读过）：
- 实现放 `external-capabilities/mcp/wechat-draft/`
- Provider 文档放 `external-capabilities/providers/<provider>/README.md`
- Skill 放 `skills/shared/wechat-draft/`（**Skill 与 External Capability 是平级域，不能塞一起**）
- 注册进 `external-capabilities/registry.yaml`（有 `implementation_path` 就**必须**声明 `version: X.Y.Z`）
- 依赖声明进 `dependencies/capability-map.yaml`
- **绝不能带任何密钥**（只允许认证元数据）
- 必须过 `scripts/validate_store.py`
- 走 feature branch → PR，不直接推 main
- commit 规范：`feat(capability): add <name>`
- Store 是 **MIT**；本项目是**专有声明**，未继承 MIT —— 入库前要确认许可证是否冲突

---

## 11. 踩过的坑（别再踩）

| 坑 | 教训 |
|---|---|
| macOS 自带 `sed` **不认 `\s`** | 我用它做密钥脱敏，结果**没生效，AppSecret 明文打进了对话**。以后脱敏用 `[[:space:]]` 或直接用 node |
| **zsh 交互模式默认不把 `#` 当注释** | 我给用户的命令里带了 `# 注释`，导致 `mv` 收到一堆参数。**给用户的命令块里不许有行内注释** |
| 文件沙箱只允许写工作区内 | 写 `~/Documents/`、`~/.workbuddy/`、新项目的 `.git` 都需要申请 `danger-full-access` |
| npm 需要可写缓存 | 用 `--cache /tmp/xxx`，用完删掉 |
| `npm --uninstall` 不是合法参数 | 是 `npm uninstall` |
| GUI 进程不继承 shell 的 PATH | MCP 配置里的 `command` 必须写 `node` 的**绝对路径** |
| stdout 被日志污染 → MCP 握手失败 | 已在 `mcpServer.ts` 用 `console.log` 重定向兜底 |
| 旧目录改名会让会话工作区失效 | 报 `spawn sandbox-exec ENOENT` / `read: not found`。根因是 workspace 路径不存在了 |

---

## 12. 已知遗留问题

| 问题 | 影响 | 状态 |
|---|---|---|
| **项目无自动化测试** | 改动无保护 | 待办 #1 |
| 用户 AppSecret 曾明文出现在对话记录里 | 安全 | 用户已知；如需处理要重置 AppSecret（会影响老仓库 `.env` 里的同一个密钥） |
| 示例文章 `content/articles/2026/2026-09-29-ai-tools/content.html` 里有一张**占位符图片** | 上传后草稿缺图 | 内容层问题，非代码问题 |
| 正文 `data:` URI 图片被跳过 | 不影响本地文件场景 | 有意为之 |
| 外链图片不下载、只警告 | 草稿可能裂图 | 有意为之（避免 SSRF 与体积风险） |
| 单账号 | 不支持多公众号 | 符合当前阶段范围 |

---

## 13. 下一步的第一件事

**补自动化测试。** 具体建议：

1. 写一个 mock 微信服务器（参考老仓库的 `scripts/lib` 或 PR#3 分支的 `scripts/mock-wechat-server.mjs` 思路）
2. 覆盖：文章包解析（两种布局）、内容指纹稳定性、幂等重放、`creating` 状态锁定、路径沙箱逃逸、微信错误码分类
3. 断言 **stdout 纯净性**（MCP 协议不能被日志污染）

用户的目标是**做产品上架**，没有测试的代码走不到那一步。
