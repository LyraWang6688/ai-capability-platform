import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runLarkCli } from "../lark-cli.js";
import { hasScope, oauthTool } from "../oauth.js";
import { errorResult, insufficientScopeResult, requireConfirmation, successResult } from "../tool-result.js";

const docRef = z.string().min(1).max(4_096).describe("Feishu document/wiki URL or document token");
const content = z.string().min(1).max(200_000);

export function registerDocsTools(server: McpServer, scopes: ReadonlySet<string>): void {
  server.registerTool(
    "feishu_docs_read",
    oauthTool({
      title: "Read a Feishu document",
      description: "Use this when the user wants to read a Feishu Docx or Wiki document, optionally by outline, section, range, or keyword.",
      inputSchema: {
        doc: docRef,
        format: z.enum(["xml", "markdown", "im-markdown"]).default("markdown"),
        detail: z.enum(["simple", "with-ids", "full"]).default("simple"),
        scope: z.enum(["outline", "range", "keyword", "section"]).optional(),
        keyword: z.string().min(1).max(1_000).optional(),
        startBlockId: z.string().min(1).max(256).optional(),
        endBlockId: z.string().min(1).max(256).optional(),
        maxDepth: z.number().int().min(-1).max(20).optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    }, "docs:read"),
    async (input) => {
      if (!hasScope(scopes, "docs:read")) return insufficientScopeResult("docs:read");
      try {
        const args = ["docs", "+fetch", "--doc", input.doc, "--doc-format", input.format, "--detail", input.detail];
        if (input.scope) args.push("--scope", input.scope);
        if (input.keyword) args.push("--keyword", input.keyword);
        if (input.startBlockId) args.push("--start-block-id", input.startBlockId);
        if (input.endBlockId) args.push("--end-block-id", input.endBlockId);
        if (input.maxDepth !== undefined) args.push("--max-depth", String(input.maxDepth));
        args.push("--as", "user");
        return successResult(await runLarkCli(args));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "feishu_docs_create",
    oauthTool({
      title: "Create a Feishu document",
      description: "Use this when the user explicitly asks to create a new Feishu document from supplied XML or Markdown content.",
      inputSchema: {
        title: z.string().min(1).max(500).optional(),
        content,
        format: z.enum(["xml", "markdown"]).default("markdown"),
        parentToken: z.string().min(1).max(512).optional(),
        confirm: z.boolean().describe("Must be true only after the user confirms document creation"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    }, "docs:write"),
    async (input) => {
      if (!hasScope(scopes, "docs:write")) return insufficientScopeResult("docs:write");
      try {
        requireConfirmation(input.confirm);
        const args = ["docs", "+create", "--doc-format", input.format, "--content", input.content];
        if (input.title) args.push("--title", input.title);
        if (input.parentToken) args.push("--parent-token", input.parentToken);
        args.push("--as", "user");
        return successResult(await runLarkCli(args, { write: true }));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "feishu_docs_update",
    oauthTool({
      title: "Update a Feishu document",
      description: "Use this when the user explicitly asks to append, replace text, insert after a block, or replace a block in an existing Feishu document. Read the target first.",
      inputSchema: {
        doc: docRef,
        command: z.enum(["str_replace", "append", "block_insert_after", "block_replace"]),
        content,
        format: z.enum(["xml", "markdown"]).default("xml"),
        pattern: z.string().min(1).max(20_000).optional(),
        blockId: z.string().min(1).max(256).optional(),
        startBlockId: z.string().min(1).max(256).optional(),
        endBlockId: z.string().min(1).max(256).optional(),
        revisionId: z.number().int().min(-1).optional(),
        confirm: z.boolean().describe("Must be true only after the user confirms the exact update"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    }, "docs:write"),
    async (input) => {
      if (!hasScope(scopes, "docs:write")) return insufficientScopeResult("docs:write");
      try {
        requireConfirmation(input.confirm);
        if (input.command === "str_replace" && !input.pattern) {
          throw new Error("pattern is required for str_replace");
        }
        if (input.command === "block_insert_after" && !input.blockId) {
          throw new Error("blockId is required for block_insert_after");
        }
        if (input.command === "block_replace" && !input.blockId && !(input.startBlockId && input.endBlockId)) {
          throw new Error("block_replace requires blockId or both startBlockId and endBlockId");
        }

        const args = [
          "docs", "+update", "--doc", input.doc, "--command", input.command,
          "--doc-format", input.format, "--content", input.content,
        ];
        if (input.pattern) args.push("--pattern", input.pattern);
        if (input.blockId) args.push("--block-id", input.blockId);
        if (input.startBlockId) args.push("--start-block-id", input.startBlockId);
        if (input.endBlockId) args.push("--end-block-id", input.endBlockId);
        if (input.revisionId !== undefined) args.push("--revision-id", String(input.revisionId));
        args.push("--as", "user");
        return successResult(await runLarkCli(args, { write: true }));
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
