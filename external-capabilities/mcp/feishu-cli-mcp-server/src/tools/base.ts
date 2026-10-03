import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { LarkCliError, runLarkCli } from "../lark-cli.js";
import { hasScope, oauthTool } from "../oauth.js";
import { errorResult, insufficientScopeResult, requireConfirmation, successResult } from "../tool-result.js";

const token = z.string().min(1).max(512);
const fields = z.record(z.string().min(1), z.unknown());
const fieldType = z.enum([
  "text", "number", "select", "datetime", "created_at", "updated_at",
  "user", "group_chat", "created_by", "updated_by", "auto_number",
  "attachment", "location", "checkbox", "link", "button",
]);
const fieldDefinition = z.object({
  name: z.string().min(1).max(100),
  type: fieldType,
  description: z.string().max(2_000).optional(),
  multiple: z.boolean().optional(),
  options: z.array(z.object({
    name: z.string().min(1).max(100),
    hue: z.enum(["Red", "Orange", "Yellow", "Lime", "Green", "Turquoise", "Wathet", "Blue", "Carmine", "Purple", "Gray"]).optional(),
    lightness: z.enum(["Lighter", "Light", "Standard", "Dark", "Darker"]).optional(),
  })).max(1_000).optional(),
  style: z.record(z.string(), z.unknown()).optional(),
  defaultValue: z.unknown().optional(),
  linkTable: token.optional(),
  bidirectional: z.boolean().optional(),
  bidirectionalLinkFieldName: z.string().min(1).max(100).optional(),
  buttonConfig: z.object({ title: z.string().min(1).max(100) }).optional(),
});

type FieldDefinition = z.infer<typeof fieldDefinition>;

function toLarkFieldDefinition(field: FieldDefinition): Record<string, unknown> {
  const result: Record<string, unknown> = { name: field.name, type: field.type };
  if (field.description !== undefined) result.description = field.description;
  if (field.multiple !== undefined) result.multiple = field.multiple;
  if (field.options !== undefined) result.options = field.options;
  if (field.style !== undefined) result.style = field.style;
  if (field.defaultValue !== undefined) result.default_value = field.defaultValue;
  if (field.linkTable !== undefined) result.link_table = field.linkTable;
  if (field.bidirectional !== undefined) result.bidirectional = field.bidirectional;
  if (field.bidirectionalLinkFieldName !== undefined) {
    result.bidirectional_link_field_name = field.bidirectionalLinkFieldName;
  }
  if (field.buttonConfig !== undefined) result.button_config = field.buttonConfig;
  return result;
}

function validateFieldDefinitions(definitions: FieldDefinition[]): void {
  const names = new Set<string>();
  for (const field of definitions) {
    if (names.has(field.name)) throw new LarkCliError(`Duplicate field name: ${field.name}`);
    names.add(field.name);
    if (field.type === "link" && !field.linkTable) {
      throw new LarkCliError(`linkTable is required for link field: ${field.name}`);
    }
    if (field.type === "button" && !field.buttonConfig) {
      throw new LarkCliError(`buttonConfig is required for button field: ${field.name}`);
    }
  }
}

export function registerBaseTools(server: McpServer, scopes: ReadonlySet<string>): void {
  server.registerTool(
    "feishu_base_list_blocks",
    oauthTool({
      title: "List resources inside a Feishu Base",
      description: "Discover tables, docx documents, folders, dashboards and workflows managed directly by a Base. Resolve a Base URL first to obtain baseToken. Without filters, the CLI returns its full backend list (no pagination). type filters resource kind; parentId lists only a folder's direct children. Use a table block's id as tableId for record tools and a docx block's docx_token with document read. This lists resources, not their content, table views, or widgets inside dashboards. Preserve returned resource types and identifiers; do not infer missing resource categories are empty.",
      inputSchema: {
        baseToken: token.describe("Base token obtained from feishu_base_resolve_url"),
        type: z.enum(["folder", "table", "docx", "dashboard", "workflow"]).optional(),
        parentId: token.optional().describe("Folder block ID; omit to list all blocks rather than only direct children"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    }, "base:read"),
    async (input) => {
      if (!hasScope(scopes, "base:read")) return insufficientScopeResult("base:read");
      try {
        const args = ["base", "+base-block-list", "--base-token", input.baseToken, "--format", "json"];
        if (input.type !== undefined) args.push("--type", input.type);
        if (input.parentId !== undefined) args.push("--parent-id", input.parentId);
        args.push("--as", "user");
        return successResult(await runLarkCli(args));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "feishu_base_create",
    oauthTool({
      title: "Create a Feishu Base",
      description: "Use this when the user explicitly asks to create a new Feishu Base, optionally with a named first table and its initial fields. The first field becomes the primary field.",
      inputSchema: {
        name: z.string().min(1).max(100),
        folderToken: token.optional(),
        timeZone: z.string().min(1).max(100).default("Asia/Shanghai"),
        tableName: z.string().min(1).max(100).optional(),
        initialFields: z.array(fieldDefinition).min(1).max(100).optional(),
        confirm: z.boolean().describe("Must be true only after the user confirms the Base name, destination, first table, and initial fields"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    }, "base:write"),
    async (input) => {
      if (!hasScope(scopes, "base:write")) return insufficientScopeResult("base:write");
      try {
        requireConfirmation(input.confirm);
        if ((input.tableName === undefined) !== (input.initialFields === undefined)) {
          throw new LarkCliError("tableName and initialFields must be provided together, or both omitted to use the platform default table schema.");
        }
        if (input.initialFields) validateFieldDefinitions(input.initialFields);
        const args = ["base", "+base-create", "--name", input.name, "--time-zone", input.timeZone];
        if (input.folderToken) args.push("--folder-token", input.folderToken);
        if (input.tableName && input.initialFields) {
          args.push("--table-name", input.tableName);
          args.push("--fields", JSON.stringify(input.initialFields.map(toLarkFieldDefinition)));
        }
        args.push("--as", "user");
        return successResult(await runLarkCli(args, { write: true }));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "feishu_base_create_fields",
    oauthTool({
      title: "Add fields to a Feishu Base table",
      description: "Use this when the user explicitly asks to add one or more fields to an existing Feishu Base table. Read or resolve the target table first. Formula and lookup fields are intentionally unavailable.",
      inputSchema: {
        baseToken: token,
        tableId: token,
        fields: z.array(fieldDefinition).min(1).max(100),
        confirm: z.boolean().describe("Must be true only after the user confirms the target table and complete field definitions"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    }, "base:write"),
    async (input) => {
      if (!hasScope(scopes, "base:write")) return insufficientScopeResult("base:write");
      try {
        requireConfirmation(input.confirm);
        validateFieldDefinitions(input.fields);
        const payload = JSON.stringify(input.fields.map(toLarkFieldDefinition));
        return successResult(await runLarkCli([
          "base", "+field-create", "--base-token", input.baseToken,
          "--table-id", input.tableId, "--json", payload, "--as", "user",
        ], { write: true }));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "feishu_base_resolve_url",
    oauthTool({
      title: "Resolve a Feishu Base URL",
      description: "Use this when the user provides a Feishu Base URL and the base token, table ID, or view ID must be resolved.",
      inputSchema: { url: z.string().url().max(4_096) },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    }, "base:read"),
    async ({ url }) => {
      if (!hasScope(scopes, "base:read")) return insufficientScopeResult("base:read");
      try {
        return successResult(await runLarkCli(["base", "+url-resolve", "--url", url, "--as", "user"]));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "feishu_base_list_records",
    oauthTool({
      title: "List Feishu Base records",
      description: "Use this when the user wants to read records from a known Feishu Base table with optional filtering, sorting, and field projection.",
      inputSchema: {
        baseToken: token,
        tableId: token,
        fieldIds: z.array(z.string().min(1).max(512)).max(100).optional(),
        filter: z.record(z.string(), z.unknown()).optional(),
        sort: z.array(z.unknown()).optional(),
        limit: z.number().int().min(1).max(200).default(100),
        offset: z.number().int().min(0).optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    }, "base:read"),
    async (input) => {
      if (!hasScope(scopes, "base:read")) return insufficientScopeResult("base:read");
      try {
        const args = [
          "base", "+record-list", "--base-token", input.baseToken,
          "--table-id", input.tableId, "--limit", String(input.limit),
          "--format", "json",
        ];
        for (const fieldId of input.fieldIds ?? []) args.push("--field-id", fieldId);
        if (input.filter) args.push("--filter-json", JSON.stringify(input.filter));
        if (input.sort) args.push("--sort-json", JSON.stringify(input.sort));
        if (input.offset !== undefined) args.push("--offset", String(input.offset));
        args.push("--as", "user");
        return successResult(await runLarkCli(args));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "feishu_base_create_records",
    oauthTool({
      title: "Create Feishu Base records",
      description: "Use this when the user explicitly asks to create one or more records in a known Feishu Base table.",
      inputSchema: {
        baseToken: token,
        tableId: token,
        records: z.array(fields).min(1).max(200),
        confirm: z.boolean().describe("Must be true only after the user confirms the target table and records"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    }, "base:write"),
    async (input) => {
      if (!hasScope(scopes, "base:write")) return insufficientScopeResult("base:write");
      try {
        requireConfirmation(input.confirm);
        const payload = JSON.stringify({ create_records: input.records });
        return successResult(await runLarkCli([
          "base", "+record-batch-create", "--base-token", input.baseToken,
          "--table-id", input.tableId, "--json", payload, "--as", "user",
        ], { write: true }));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "feishu_base_update_records",
    oauthTool({
      title: "Update Feishu Base records",
      description: "Use this when the user explicitly asks to update selected fields of known records in a Feishu Base table. Read the records first.",
      inputSchema: {
        baseToken: token,
        tableId: token,
        updates: z.array(z.object({ recordId: token, fields })).min(1).max(200),
        confirm: z.boolean().describe("Must be true only after the user confirms the exact record updates"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    }, "base:write"),
    async (input) => {
      if (!hasScope(scopes, "base:write")) return insufficientScopeResult("base:write");
      try {
        requireConfirmation(input.confirm);
        const updateRecords: Record<string, Record<string, unknown>> = {};
        for (const update of input.updates) {
          if (updateRecords[update.recordId]) {
            throw new LarkCliError(`Duplicate recordId: ${update.recordId}`);
          }
          updateRecords[update.recordId] = update.fields;
        }
        const payload = JSON.stringify({ update_records: updateRecords });
        return successResult(await runLarkCli([
          "base", "+record-batch-update", "--base-token", input.baseToken,
          "--table-id", input.tableId, "--json", payload, "--as", "user",
        ], { write: true }));
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
