#!/usr/bin/env node
/**
 * MCP 服务器（stdio）—— 产品主入口。
 *
 * 宿主（豆包工作 / WorkBuddy）通过它调用本机能力：预检文章包、创建公众号草稿、体检。
 *
 * ★ stdio 模式下 stdout 是 JSON-RPC 通道。任何写入 stdout 的内容都会破坏协议握手，
 *   表现为「连接器显示已连接但一个工具都没有」或直接断连。
 *   本文件在**第一行**就把 console.log 重定向到 stderr 作为兜底防线，
 *   因为宿主不一定会给用户看子进程的 stderr。
 *
 * 边界：只创建草稿。不发布、不群发、不删除、不改账号设置。
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ── 防线 1：任何 console.log 都改走 stderr，绝不污染 JSON-RPC 通道 ───────────────
const originalLog = console.log;
console.log = (...args: unknown[]) => {
  process.stderr.write(`${args.map(String).join(" ")}\n`);
};

process.on("uncaughtException", (error) => {
  process.stderr.write(`[connector] uncaught: ${error?.message ?? error}\n`);
  process.exit(1);
});

const { inspectArticleBundle, publishArticleBundle, summarizeBundle } = await import("./publish.js");
const { createWechatApi, readCredentialsFromEnv } = await import("./wechatApi.js");

const server = new McpServer({
  name: "wechat-draft-mcp",
  version: "0.1.0"
});

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[connector] tool error: ${message}\n`);
  return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ ok: false, message }) }] };
}

const BUNDLE_PATH = z
  .string()
  .min(1)
  .describe("文章文件夹的绝对路径。正文与图片从磁盘读取，不要把 HTML 内容放到参数里。");

server.registerTool(
  "wechat_draft_status",
  {
    title: "检查公众号连接",
    description:
      "检查本机是否已配置公众号凭证、出口 IP 是否在白名单、草稿箱接口是否可用。只读，不产生任何微信数据，也不会返回密钥。上传失败时先用它排查环境问题。",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  },
  async () => {
    try {
      const credentials = readCredentialsFromEnv();
      const api = createWechatApi({ credentials });
      const access = await api.checkAccess();
      const draftCount = await api.draftCount();
      return text({
        ok: true,
        message: "公众号连接正常",
        expiresInSeconds: access.expires_in,
        draftCount,
        appIdMasked: credentials.appId ? `${credentials.appId.slice(0, 6)}****` : null
      });
    } catch (error) {
      return failure(error);
    }
  }
);

server.registerTool(
  "inspect_wechat_article",
  {
    title: "预检文章包",
    description:
      "在上传之前检查文章文件夹：能否找到正文与封面、标题作者摘要是什么、正文长度是否超限、有哪些图片、有没有阻塞问题。完全不调用微信、不产生任何数据。用户说「先看看这篇能不能传」时用它。",
    inputSchema: { bundle_path: BUNDLE_PATH },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  async ({ bundle_path }) => {
    try {
      return text(await inspectArticleBundle(bundle_path));
    } catch (error) {
      return failure(error);
    }
  }
);

server.registerTool(
  "upload_wechat_draft",
  {
    title: "上传到公众号草稿箱",
    description:
      "把磁盘上的文章创建为微信公众号草稿（只创建草稿，不发布、不群发）。" +
      "仅在用户明确要求上传、发布到草稿箱、或说「把这个传上去」时调用；用户只是让你写文章时不要调用。" +
      "同一篇文章重复调用会返回既有草稿，不会重复创建。",
    inputSchema: {
      bundle_path: BUNDLE_PATH,
      need_open_comment: z.boolean().optional().describe("是否开启留言，默认否"),
      only_fans_can_comment: z.boolean().optional().describe("是否仅粉丝可留言，默认否")
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  },
  async ({ bundle_path, need_open_comment, only_fans_can_comment }) => {
    try {
      const result = await publishArticleBundle({
        bundlePath: bundle_path,
        needOpenComment: need_open_comment,
        onlyFansCanComment: only_fans_can_comment
      });
      return text({
        ok: true,
        message: result.message,
        draftMediaId: result.mediaId,
        title: result.title,
        author: result.author ?? null,
        reused: result.reused,
        verified: result.verified,
        content: result.content,
        uploadedBodyImages: result.images.uploaded.length,
        skippedRemoteImages: result.images.skippedRemote.length,
        warnings: result.warnings
      });
    } catch (error) {
      return failure(error);
    }
  }
);

server.registerTool(
  "get_wechat_draft",
  {
    title: "按 ID 读回草稿",
    description:
      "根据草稿 media_id 从公众号读回草稿内容，用于确认某次上传是否真的成功了。当上传返回「结果未知」或用户要求核对草稿时用它。只读。",
    inputSchema: { media_id: z.string().min(1).max(512).describe("上传返回的草稿 media_id") },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  },
  async ({ media_id }) => {
    try {
      const api = createWechatApi({ credentials: readCredentialsFromEnv() });
      const draft = await api.getDraft(media_id);
      const item = (draft as { news_item?: Array<{ title?: string; author?: string; digest?: string }> }).news_item?.[0];
      return text({
        ok: true,
        title: item?.title ?? null,
        author: item?.author ?? null,
        digest: item?.digest ?? null
      });
    } catch (error) {
      return failure(error);
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write(`${JSON.stringify({ event: "connector_started", pid: process.pid })}\n`);
