import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "./config.js";

const execFileAsync = promisify(execFile);

export class LarkCliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LarkCliError";
  }
}

let writeQueue: Promise<void> = Promise.resolve();
let pendingOperations = 0;

function safeText(value: unknown): string {
  return String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 2_000);
}

async function execute(args: readonly string[]): Promise<Record<string, unknown>> {
  const childEnv = { ...process.env };
  delete childEnv.MCP_BEARER_TOKEN;

  try {
    const { stdout } = await execFileAsync(
      config.larkCliBin,
      ["--profile", config.larkProfile, ...args],
      {
        timeout: config.cliTimeoutMs,
        maxBuffer: config.cliMaxBufferBytes,
        windowsHide: true,
        env: childEnv,
      },
    );

    const trimmed = stdout.trim();
    if (!trimmed) {
      throw new LarkCliError("lark-cli returned an empty response");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new LarkCliError("lark-cli returned non-JSON output");
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new LarkCliError("lark-cli returned an unexpected JSON shape");
    }

    const envelope = parsed as Record<string, unknown>;
    if (envelope.ok !== true) {
      throw new LarkCliError(`lark-cli reported failure: ${safeText(JSON.stringify(envelope.error))}`);
    }
    return envelope;
  } catch (error) {
    if (error instanceof LarkCliError) throw error;

    const candidate = error as { stderr?: unknown; message?: unknown; killed?: boolean };
    const detail = candidate.stderr || candidate.message || "unknown execution error";
    throw new LarkCliError(`lark-cli execution failed: ${safeText(detail)}`);
  }
}

export async function runLarkCli(
  args: readonly string[],
  options: { write?: boolean } = {},
): Promise<Record<string, unknown>> {
  // Count both running reads and running/queued writes. Never grow an unbounded
  // write queue, even when accepted HTTP requests arrive faster than CLI work.
  if (pendingOperations >= config.cliMaxPending) {
    throw new LarkCliError("CLI capacity reached. Retry later; this operation was not queued or executed.");
  }
  pendingOperations += 1;
  try {
    if (!options.write) return await execute(args);

    const task = writeQueue.then(() => execute(args));
    writeQueue = task.then(
      () => undefined,
      () => undefined,
    );
    return await task;
  } finally {
    pendingOperations -= 1;
  }
}
