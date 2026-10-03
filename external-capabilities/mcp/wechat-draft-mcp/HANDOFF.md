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

| 阶段       | 内容                   | 状态                                       |
| -------- | -------------------- | ---------------------------------------- |
| **阶段 1** | 在用户自己的公众号上跑通         | 🟢 **WorkBuddy ✅ / 豆包工作 ✅**（两个宿主都已实测通过）      |
| **阶段 2** | 打磨（补测试、装 Skill、修问题）  | 🔵 进行中（测试已补 106 项；Skill 未装）                 |
| **阶段 3** | 做成产品上架豆包 + WorkBuddy | ⬜ 未开始                                    |

**已经真实发生过的事**（不是设想）：

- WorkBuddy 通过 stdio 拉起本 MCP，发现 4 个工具，成功调用 `wechat_draft_status` 与 `upload_wechat_draft`
- 真实创建了 3 条微信公众号草稿，用户本人在草稿箱里看到了
- 幂等验证：同一文章第二次调用返回既有草稿，草稿箱总数不变
- **豆包工作 2026-10-02 22:07 实测全绿**：5 步验收（status / inspect / upload / 幂等重放 / 错误路径）全部符合预期，
  并已用本机幂等账本 + `draft/get` 独立复核（不只信模型转述）。详见 §15

---

## 2. 两个项目的位置

| 项目      | 路径                                               | 角色                                |
| ------- | ------------------------------------------------ | --------------------------------- |
| **本项目** | `~/Documents/workplace/wechat-draft-mcp/`        | 连接器产品（独立 git 仓库，**无 GitHub 远程**）  |
| 老仓库     | `~/Documents/workplace/wechat-draft-capability/` | 纯 Publisher 发布链（GitHub 授权 → 自动发布） |

**两者零代码依赖。** 连接器**不 import** 老仓库任何东西（有意为之：产品要能独立发布 npm 包）。

> 老仓库的 GitHub 仓库名计划从 `WeChat-Draft-Capability` 改成小写 `wechat-draft-capability`（用户操作，未完成）。  
> 改完需要同步：`.env` 的 `PUBLISHER_ALLOWED_REPOSITORIES`、`src/config.ts` 默认值、`.github/workflows/publish-ready-articles.yml:145` 的硬编码仓库名、`git remote set-url`。  
> **建议顺手把 workflow 那处换成 `${{ github.repository }}`**，以后再改名就不用管了。

---

## 3. 已验证的硬事实（**别再重新验证一遍**）

这些都是实测出来的，其中几条**与官方文档/社区说法相反**：

| 事实                                   | 验证方式                                                                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| **微信文档写的 `content` 上限 2KB 是假的**      | 实测 2500B / 59494B / 24964B 全部创建成功。若按 2KB 做本地拦截，真实文章一条都传不上去                                                                           |
| **`content` 的 2 万字符限制也不严格**          | 实测 20100 字符仍成功。不要用它做硬拦截                                                                                                              |
| **未认证个人订阅号可以用草稿箱和 `uploadimg`**      | 用户的号就是未认证个人订阅号，实测通过。**社区包普遍声称"需要认证"，是错的**                                                                                            |
| `stable_token` 可用且优于 `cgi-bin/token` | 1 万次/分钟 vs 新号 2000 次/天                                                                                                               |
| 正文图片必须走 `media/uploadimg`            | 不占素材库配额，仅 jpg/png 且 <1MB；外链图片会被微信过滤                                                                                                  |
| 封面必须走 `material/add_material`        | `thumb_media_id` 只接受永久素材                                                                                                             |
| **IP 白名单是强制的**                       | 非白名单报 `40164`，错误信息里带 `request_ip`。换 Wi-Fi / 开 VPN 后 IP 会变                                                                            |
| WorkBuddy 支持本地 stdio MCP             | 官方 MCP 文档（803 行）**就打包在 App 内**：`/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/dist/web-ui/docs/cn/cli/mcp.md` |
| WorkBuddy 配置路径                       | `~/.workbuddy/mcp.json`（App 实际用这个；官方文档写的是 `~/.codebuddy/.mcp.json`）                                                                  |
| 豆包工作自定义连接器支持 **STDIO**               | 用户界面截图确认；其 `libmcp_helper.dylib` 内含 `rmcp` 的 `transport/child_process.rs`                                                            |
| 豆包工作 STDIO 表单                        | `服务器名称` / `传输类型` / `命令` / `参数`(列表) / `环境变量`(键值对)。提示语"如 python、node 或 ./script.sh"→ **允许 node 绝对路径**                                  |
| 豆包 **MCP 生态上架**需要准入                  | 官方《豆包工作MCP生态准入白皮书》+ 提交表单 + 联调验收。规范里 STDIO **优先 npx、暂不支持 node** → **上架时必须发 npm 包**                                                    |
| 微信公众号**没有官方** MCP 或 CLI              | 现有全是社区/个人作品                                                                                                                          |
| `wechat-official-*` 不代表官方            | "Official Account" 是"公众号"的英文译名，不是"官方出品"                                                                                              |

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

| 文件                             | 行数  | 职责                                                                                                                                           |
| ------------------------------ | --- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/wechatApi.ts`             | 259 | 微信 API 客户端。`stable_token` / `uploadBodyImage`(uploadimg) / `uploadMaterial` / `addDraft` / `getDraft` / `draftCount`。含错误码人话翻译、`${VAR}` 占位符检测 |
| `src/articleBundle.ts`         | 415 | 文章包解析。兼容 `article.html`+`metadata.json` 与 `content.html`+`meta.json`+`assets.json` 两种布局。算**内容指纹**（正文原始态 + 元数据 + 封面 + 插图内容）                   |
| `src/security.ts`              | 132 | 路径沙箱。绝对路径 / `realpath` 防 symlink 逃逸 / 分段前缀比较 / 敏感目录黑名单                                                                                       |
| `src/deliveryState.ts`         | 103 | 幂等账本。内容指纹 → 状态文件；`creating`/`created` 状态机；单篇互斥锁（`wx` 独占创建）                                                                                   |
| `src/publish.ts`               | 224 | 主流程编排。**先落盘 `creating` → 再产生微信副作用**；读回核验                                                                                                     |
| `src/mcpServer.ts`             | 167 | stdio MCP 入口，4 个工具。**第一行就把 `console.log` 重定向到 stderr**，保护 JSON-RPC 通道                                                                        |
| `src/cli.ts`                   | 136 | 命令行 `doctor` / `inspect` / `upload`                                                                                                          |
| `tests/**`                     | 2300 | **自动化测试（106 项）**：mock 微信服务器 + 文章包夹具 + stdio 子进程客户端，见 §14                                                                    |
| `tsconfig.test.json`           | 9   | 测试编译配置（`src` + `tests` → `dist-test/`），零额外依赖，用 node 内置 test runner                                                                |
| `skills/wechat-draft/SKILL.md` | 169 | 给 AI 的说明书：何时调用、文章包怎么组织、错误怎么处理。**源文件**；装到 WorkBuddy 用 cp（见 §16）                                    |

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

### 跑测试

```bash
npm test          # 编译 src+tests 到 dist-test/，再跑 106 项测试（约 2 秒）
npm run test:only # 跳过编译，直接重跑
```

不需要任何额外依赖（node 内置 test runner），也不会联网、不会碰真实公众号。
测试用的 mock 微信服务器监听 `127.0.0.1` 随机端口，夹具落在系统临时目录。

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

豆包工作那边连接器已配好（STDIO），**已于 2026-10-02 22:07 实测通过**（见 §15）。
配置项：服务器名 `wechat-draft` / 传输 `STDIO` / 命令 `/usr/local/bin/node` /
参数 `dist/mcpServer.js` 绝对路径 / 环境变量 `WECHAT_APP_ID` + `WECHAT_APP_SECRET`（填真值，不要填 `${...}` 占位符）。

---

## 9. 待办（按优先级）

| #     | 事项                      | 说明                                                                              |
| ----- | ----------------------- | ------------------------------------------------------------------------------- |
| ~~**1**~~ | ~~**补自动化测试**~~          | ✅ **已完成**（2026-10-02）：106 项测试全绿，`npm test`。顺带修掉 5 个真 bug，见 §14                            |
| 2     | ~~把 Skill 装进两个 App~~    | 🟡 **WorkBuddy ✅ 已装**（2026-10-02 22:58，见 §16）；豆包**本地技能目录未找到**，需在界面确认入口 |
| ~~**3**~~ | ~~**豆包工作实测**~~          | ✅ **已完成**（2026-10-02 22:07）：5 步验收全绿并独立复核，见 §15                                     |
| 4     | GitHub 仓库改名             | 用户操作，见 §2 的同步清单                                                                 |
| 5     | 清理旧符号链接                 | `rm ~/Documents/workplace/wechat-article-pilot`（先确保新工作区可用）                      |
| 6     | 进 `ai-capability-store` | 见 §10                                                                           |
| 7     | 删测试草稿（可选）               | 草稿箱里《【测试】豆包工作连接器连通性验证》是本次验收产物，确认后可删                                             |

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

| 坑                          | 教训                                                                      |
| -------------------------- | ----------------------------------------------------------------------- |
| macOS 自带 `sed` **不认 `\s`** | 我用它做密钥脱敏，结果**没生效，AppSecret 明文打进了对话**。以后脱敏用 `[[:space:]]` 或直接用 node      |
| **zsh 交互模式默认不把 `#` 当注释**   | 我给用户的命令里带了 `# 注释`，导致 `mv` 收到一堆参数。**给用户的命令块里不许有行内注释**                    |
| 文件沙箱只允许写工作区内               | 写 `~/Documents/`、`~/.workbuddy/`、新项目的 `.git` 都需要申请 `danger-full-access` |
| npm 需要可写缓存                 | 用 `--cache /tmp/xxx`，用完删掉                                               |
| `npm --uninstall` 不是合法参数   | 是 `npm uninstall`                                                       |
| GUI 进程不继承 shell 的 PATH     | MCP 配置里的 `command` 必须写 `node` 的**绝对路径**                                 |
| stdout 被日志污染 → MCP 握手失败    | 已在 `mcpServer.ts` 用 `console.log` 重定向兜底                                 |
| 旧目录改名会让会话工作区失效             | 报 `spawn sandbox-exec ENOENT` / `read: not found`。根因是 workspace 路径不存在了  |

---

## 12. 已知遗留问题

| 问题                                                                          | 影响        | 状态                                            |
| --------------------------------------------------------------------------- | --------- | --------------------------------------------- |
| ~~**项目无自动化测试**~~                                                             | ~~改动无保护~~ | ✅ 已补 106 项，`npm test`（§14）                      |
| 用户 AppSecret 曾明文出现在对话记录里                                                    | 安全        | 用户已知；如需处理要重置 AppSecret（会影响老仓库 `.env` 里的同一个密钥） |
| 示例文章 `content/articles/2026/2026-09-29-ai-tools/content.html` 里有一张**占位符图片** | 上传后草稿缺图   | 内容层问题，非代码问题                                   |
| 正文 `data:` URI 图片被跳过                                                        | 不影响本地文件场景 | 有意为之                                          |
| 外链图片不下载、只警告                                                                 | 草稿可能裂图    | 有意为之（避免 SSRF 与体积风险）                           |
| 单账号                                                                         | 不支持多公众号   | 符合当前阶段范围                                      |

---

## 13. 下一步的第一件事

**把 Skill 装进两个 App（待办 #2）。**

原待办 #1「补自动化测试」已完成，见 §14。测试补齐后代码改动已有回归保护；
再往下就是让模型在用户不点名的情况下主动调用本连接器（装 Skill），
以及等豆包额度恢复后做实测（待办 #3）。

用户的目标是**做产品上架**，没有测试的代码走不到那一步——这一步已经补上了。

---

## 14. 自动化测试（2026-10-02 补上）

`npm test`：编译 `src` + `tests` → `dist-test/`，再用 node 内置 test runner 跑
**106 项 / 15 个套件**，约 2 秒，零额外依赖、不联网、不碰真实公众号。

| 测试文件 | 覆盖 |
| --- | --- |
| `tests/articleBundle.test.ts` | 两种文章包布局、元数据优先级与来源、摘要截断、CRLF/BOM 归一化、缺图/空图/`data-src` 警告、封面兜底、阻塞问题、**内容指纹稳定性与敏感性** |
| `tests/security.test.ts` | 相对路径/NUL/不存在路径、`/etc` 与 `~/.ssh` 黑名单、`ALLOWED_ROOTS` 前缀相似不误判、symlink 逃逸、包内相对引用穿越 |
| `tests/deliveryState.test.ts` | 账本命名与账号隔离、文件权限 0600/0700、损坏账本必须报「结果未知」、互斥锁获取/释放/残留锁 |
| `tests/wechatApi.test.ts` | 请求形状、token 复用、错误码 6 类人话翻译、网络中断/超时→`outcomeUnknown`、凭证占位符、**错误信息不含 AppSecret** |
| `tests/publish.test.ts` | 端到端建草稿、图片 src 改写、**幂等重放**、**`creating` 落盘早于第一次副作用**、结果未知不重试、锁占用、预检阻塞、改写后超限、核验失败 |
| `tests/mcpStdio.test.ts` | 握手 + 4 个工具、**stdout 全为合法 JSON-RPC**、工具错误仍是纯净 JSON、缺凭证不落账本 |
| `tests/cli.test.ts` | `inspect --json` / 人类可读、退出码、上限可由环境变量覆盖、**doctor 不读 `.env`** |

测试辅助（`tests/helpers/`）：`mockWechatServer.ts` 是真的本地 HTTP 服务器（可注入
errcode / 非 JSON / 断连 / 挂起故障），`fixtures.ts` 造文章包与临时目录，
`spawnNode.ts` 跑编译后的 MCP / CLI 子进程并逐行校验 stdout。

### 补测试时发现并修掉的 5 个真 bug

| 文件 | Bug | 影响 |
| --- | --- | --- |
| `src/security.ts` | macOS 上 `/etc` 是 `/private/etc` 的符号链接，realpath 后绕过了黑名单 | `/etc/hosts` 这类路径可被读取 |
| `src/security.ts` | `resolveInsideBundle` 只做词法比较，包内一个指向 `~/.ssh/id_rsa` 的符号链接即可把包外文件读进来并上传 | 读文件逃逸 |
| `src/articleBundle.ts` | `SRC_ATTR` 用 `\bsrc`，把 `data-src="..."` 也当成真图 src | 懒加载图不触发警告，用户莫名丢图 |
| `src/articleBundle.ts` | 元数据来源判断写成 `!values.author`（默认作者已写入该字段，条件恒假） | `inspect` 显示不出「作者来自 env 默认值」 |
| `src/articleBundle.ts` | 摘要截断提示被 `loadArticleBundle` 里后写的文件来源覆盖 | 用户看不到「已截断到 120 字」 |

另有 3 处加固：`resolveSafePath` 改用传入的 `env.HOME`；`ensureCredentialShape` 对
纯空白凭证判为缺失；`rewriteImageSrc` 与 `SRC_ATTR` 用同一套「独立 src 属性」正则。

### 第二批补充（106 项）

- **封面发现顺序**：`assets.json` 指定 > 目录 `cover*`（含中文名、大写扩展名、`cover-banner.jpg`）> `<meta name="wechat:cover">` > 正文首图兜底
- **边界**：空目录报 `BUNDLE_NO_HTML`、任意 `.htm` 兜底当正文、正文图引用绝对路径只警告、带 query 的图片按去 query 读文件但保留原 src 改写
- **白名单细节**：多根目录（逗号 + 空格 + 尾部斜杠）、空值等于不限制、根目录本身放行而兄弟目录不放行
- **发布开关**：`need_open_comment` / `only_fans_can_comment` 原样传给微信；复用路径读回核验失败时 `reused:true` + `verified:false` 且提示人工确认；鉴权失败后锁已释放可重试、不残留 `.lock`
- **只读工具**：`get_wechat_draft` 无凭证时报缺凭证且不碰网络

新测试做过变异校验：把 `need_open_comment` 改回硬编码 `0`，`留言开关会原样传给微信` 立刻失败，证明断言不是空跑。

**改这些文件后记得 `npm run build`** —— WorkBuddy 配置指向 `dist/`。

---

## 15. 豆包工作验收记录（2026-10-02 22:07）

**结论：豆包工作侧 stdio 连接器全链路通过，与 WorkBuddy 表现一致。**

测试文章包：`smoke-article/`（`article.html` + `metadata.json` + `cover.png` + `images/fig1.png`，
指纹 `9a2cab78…ede2`，已加进 `.gitignore`，可反复用于连通性回归）。

### 五步验收（豆包界面里的实际返回）

| 步骤 | 调用 | 结果 |
| --- | --- | --- |
| 1 | `wechat_draft_status` | `ok:true`、`expiresInSeconds:541`、`draftCount:7`、`appIdMasked:wxa13d****` |
| 2 | `inspect_wechat_article` | `ready:true`、`blockingIssues:[]`、`warnings:[]` |
| 3 | `upload_wechat_draft` | `reused:false`、`verified:true`、`message:已创建微信公众号草稿并读回核验通过。` |
| 4 | 再传一次（幂等） | `reused:true`、**mediaId 与第 3 步完全相同**、`verified:true` |
| 5 | 预检不存在路径 | `ok:false`、`找不到该路径，请确认文件或目录存在。`（**没有编造成功、没有重试**） |

### 本机独立复核（不只信模型转述）

- 幂等账本 `~/.wechat-draft-capability/state/5ba5773ed9a5ba20-9a2cab78…ede2.json`：
  `status:created`、`imageCount:1`、`updatedAt:2026-10-02T14:07:08.993Z`（= 22:07 CST）
- 真实 media_id（账本为准）：`AX7Qh8wEmCV7sA8G4DG04IikF1AnGekwrLsGmWPrlXSRixLrAzbcyvKKV5_o3fGl`
- `draft/get` 读回：标题/作者/摘要与 `metadata.json` 完全一致；正文里本地路径已消失、
  图片已换成微信 URL；草稿总数 7 → 8
- 两个宿主的账本账号前缀相同（`5ba5773ed9a5ba20`），确认用的是同一个公众号、同一套凭证

### 这次学到的两条

1. **别拿截图里的 media_id 去核对**。截图字体里 `l` 与 `1` 无法区分（末位是 `l` 不是 `1`），
   按截图转写连续两次报 `40007 invalid media_id`，看起来像"草稿不存在"，其实是转写错了。
   要核对就读**幂等账本**或让连接器调 `get_wechat_draft` 拿真 ID。
2. **Skill 没装时，提示词必须点名工具**。本轮 5 次调用都是用户明确说"用 wechat-draft 连接器调用 xxx"，
   模型才去调；这正是待办 #2 要省掉的那句话。

### 顺带确认的既有事实

- `40164`（IP 白名单）在今天这轮之前已解决，当前网络实测可直连
- 豆包侧没有 `tools/call` 超时或返回值体积（`ResponseBodyTooLarge`）相关报错，返回值足够紧凑
- 对话里没有出现 AppSecret / access_token，只有掩码后的 AppID

---

## 16. Skill 安装记录（2026-10-02 22:58）

**源文件（唯一真源）**：`skills/wechat-draft/SKILL.md`
**WorkBuddy 部署位置**：`~/.workbuddy/skills/wechat-draft/SKILL.md`

```bash
cp /Users/wangying/Documents/workplace/wechat-draft-mcp/skills/wechat-draft/SKILL.md \
   ~/.workbuddy/skills/wechat-draft/SKILL.md
```

- 部署后校验：两个文件 sha256 一致（`07355433…b492`），权限 644 与其余 7 个技能对齐
- 目录名 = frontmatter `name` = `wechat-draft`（与已有技能约定一致）
- **不需要** `_skillhub_meta.json`：那是市场安装元数据（含 skillId / installedContentHash），手工安装不该伪造

### frontmatter 补齐了什么

对照已有 7 个技能（`github` / `humanizer` / `neodata-financial-search` / `tencent-meeting-skill` /
`wechat-article-search` / `weread-skills` / `westockdata`）补到通用字段：

| 字段 | 值 |
| --- | --- |
| `name` | `wechat-draft` |
| `description` | 触发场景 + **反向说明**（只是写文章/点评/要求正式发布时不要用） |
| `description_zh` / `description_en` | 技能面板显示用 |
| `version` | `1.0.0` |
| `display_name` / `display_name_en` | 微信公众号草稿上传 / WeChat Draft Upload |
| `visibility` | `public` |

**故意不加 `allowed-tools`**：该字段在别的技能里是工具白名单（如 `Bash,Read`），
而本技能依赖 MCP 工具（WorkBuddy 里形如 `mcp__wechat-draft__upload_wechat_draft`）。
名字写错可能反而把工具挡掉；`github` / `tencent-meeting-skill` / `weread-skills` 也都不写，属合规做法。

正文另外补了两处：开头加**工具清单表**（4 个工具 + 是否有副作用），错误处理表加一行
「用户让你核对某次上传 / 手里有 media_id → 用 `get_wechat_draft` 读回，不要凭记忆回答」。

### 装完必须做的两步

1. **重载 WorkBuddy**（重启 App，或在技能面板里刷新）——它读技能有缓存 `.skill-list-cache.json`
2. 在技能面板确认 `wechat-draft` 的调用开关是**模型可调用**（不是「仅用户可调用」）

### 验收方法（零副作用）

重启后**不提连接器名字**，直接说：

> 帮我把 `/Users/wangying/Documents/workplace/wechat-draft-mcp/smoke-article` 传到公众号草稿箱

期望模型自己调用 `upload_wechat_draft`，并返回 `reused: true`（这篇 22:07 已传过），
**草稿总数保持 8 不变**。这同时证明：技能被加载了、模型能自己把意图映射到工具、幂等仍然成立。

### 豆包工作：没找到本地技能目录

已排查（读操作）：`~/.doubao*` 不存在；`~/Library/Application Support/DoubaoWork` 与 `~/Library/Application Support/Doubao`
下 maxdepth 3 内没有 `*skill*` 目录。**结论：豆包侧没有可确认的本地技能安装入口**，
其扩展途径是界面里的自定义连接器（已配好）与 MCP 生态准入（上架流程）。
所以豆包这边继续靠**工具描述 + 用户点名**；要真正"不用点名"，要么在界面里找有没有技能/插件分区，
要么走生态上架（§3.3 的准入流程）。**不要照搬 WorkBuddy 的目录约定到豆包。**
