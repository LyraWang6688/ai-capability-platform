# wechat-draft-mcp

本地 MCP 服务：把一个磁盘上的文章文件夹，创建成微信公众号草稿。

**只创建草稿。不发布、不群发、不删除、不改动公众号任何设置。**

## 这是什么

一个自包含的 MCP server，供成熟 AI Host（豆包工作、WorkBuddy 等）通过 stdio 调用。
用户在对话里说「把这篇文章传到公众号草稿箱」，Host 就会调用本服务完成上传。

## 设计原则

| 原则 | 说明 |
|---|---|
| **传引用，不传正文** | 工具参数只有一个绝对路径。正文与图片从磁盘读取，不经过模型上下文，token 消耗与文章长度无关 |
| **先记账，再动手** | 第一次微信副作用之前必须先落盘 `creating`。此后任何异常都属于「结果未知」，禁止自动重试 |
| **内容指纹幂等** | 同一账号 + 同一内容重复调用返回既有草稿，不会重复创建 |
| **凭证不出本机** | AppID/AppSecret 由 Host 注入环境变量；本服务不读 `.env`、不持久化密钥、不把密钥返回给模型 |
| **只创建草稿** | 正式发布始终由用户在公众号后台人工完成 |

## 工具

| 工具 | 作用 | 副作用 |
|---|---|---|
| `wechat_draft_status` | 检查凭证、IP 白名单、草稿箱权限 | 无 |
| `inspect_wechat_article` | 预检文章文件夹 | 无 |
| `upload_wechat_draft` | 创建公众号草稿 | 有（仅草稿） |
| `get_wechat_draft` | 按 media_id 读回草稿 | 无 |

## 文章文件夹结构

```text
我的文章/
├── article.html       正文（必需；也支持 content.html）
├── metadata.json      标题/作者/摘要（可选；也支持 meta.json）
├── cover.png          封面（必需；也支持 cover.jpg / 封面.* / assets.json 指定）
└── images/            正文插图（可选，用相对路径引用）
```

## 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `WECHAT_APP_ID` | 是 | 公众号 AppID（由 Host 注入） |
| `WECHAT_APP_SECRET` | 是 | 公众号 AppSecret（由 Host 注入） |
| `WECHAT_DEFAULT_AUTHOR` | 否 | 未指定作者时的兜底值 |
| `WECHAT_DRAFT_STATE_DIR` | 否 | 幂等账本目录，默认 `~/.wechat-draft-capability/state` |
| `WECHAT_DRAFT_ALLOWED_ROOTS` | 否 | 允许读取的文章根目录，逗号分隔 |

## 命令

```bash
npm install
npm run build

# MCP 服务（由 Host 启动）
node dist/mcpServer.js

# 命令行诊断
node --env-file=.env dist/cli.js doctor
node --env-file=.env dist/cli.js inspect "/绝对路径/文章目录"
node --env-file=.env dist/cli.js upload  "/绝对路径/文章目录"
```

## 边界

- 不做 Markdown → HTML 转换。正文排版由创作侧负责。
- 不支持 `data:` URI 图片（微信素材接口不接受 base64）。
- 正文图片只支持 jpg/png 且单张 <1MB；封面走永久素材。
- 正文必须少于 20000 字符。
