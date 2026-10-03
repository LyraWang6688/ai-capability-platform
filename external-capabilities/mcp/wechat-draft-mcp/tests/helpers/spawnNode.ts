/**
 * 子进程测试辅助：跑编译后的 CLI / MCP 入口，并保证环境里不带宿主的真实凭证。
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";

/** 编译产物里的某个源文件（测试与源一起被 tsc 输出到 dist-test/）。 */
export function srcFile(name: string): string {
  return fileURLToPath(new URL(`../../src/${name}`, import.meta.url));
}

/** 复制当前环境，但剥掉所有 WECHAT_* 变量 —— 除非显式传入。 */
export function nodeEnv(extra: Record<string, string | undefined> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (key.startsWith("WECHAT_")) continue;
    env[key] = value;
  }
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined) env[key] = value;
  }
  return env;
}

export type RunResult = { code: number | null; stdout: string; stderr: string };

export function runNode(
  args: string[],
  options: { env?: Record<string, string>; cwd?: string; timeoutMs?: number } = {}
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: options.cwd,
      env: options.env ?? nodeEnv(),
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`子进程超时未退出：node ${args.join(" ")}`));
    }, options.timeoutMs ?? 20_000);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

export type JsonRpcMessage = {
  jsonrpc?: string;
  id?: number;
  method?: string;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
};

/**
 * 极简 MCP stdio 客户端。
 * 同时记录「所有 stdout 行」与「无法解析成 JSON 的行」，用于断言协议通道纯净。
 */
export class StdioMcpClient {
  readonly stdoutLines: string[] = [];
  readonly nonJsonLines: string[] = [];
  stderr = "";
  readonly child: ChildProcessWithoutNullStreams;

  private buffer = "";
  private readonly waiters = new Map<number, (message: JsonRpcMessage) => void>();
  private nextId = 1;

  constructor(args: string[], env: Record<string, string>) {
    this.child = spawn(process.execPath, args, { env, stdio: ["pipe", "pipe", "pipe"] });
    this.child.stdout.on("data", (chunk: Buffer) => this.consume(chunk.toString("utf8")));
    this.child.stderr.on("data", (chunk: Buffer) => {
      this.stderr += chunk.toString("utf8");
    });
  }

  get pid(): number | undefined {
    return this.child.pid;
  }

  async request(method: string, params: Record<string, unknown> = {}): Promise<JsonRpcMessage> {
    const id = this.nextId++;
    const promise = new Promise<JsonRpcMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(id);
        reject(new Error(`等待 ${method} 响应超时。stdout=${JSON.stringify(this.stdoutLines)}\nstderr=${this.stderr}`));
      }, 10_000);
      this.waiters.set(id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
    });
    this.write({ jsonrpc: "2.0", id, method, params });
    return promise;
  }

  notify(method: string, params: Record<string, unknown> = {}): void {
    this.write({ jsonrpc: "2.0", method, params });
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<{ isError?: boolean; text: string }> {
    const response = await this.request("tools/call", { name, arguments: args });
    const result = response.result as { isError?: boolean; content?: Array<{ type: string; text: string }> } | undefined;
    return { isError: result?.isError, text: result?.content?.[0]?.text ?? "" };
  }

  async close(): Promise<void> {
    this.child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.child.kill("SIGKILL");
        resolve();
      }, 2000);
      this.child.on("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private write(message: unknown): void {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private consume(chunk: string): void {
    this.buffer += chunk;
    let index = this.buffer.indexOf("\n");
    while (index >= 0) {
      const line = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 1);
      this.handleLine(line);
      index = this.buffer.indexOf("\n");
    }
  }

  private handleLine(line: string): void {
    if (!line.trim()) return;
    this.stdoutLines.push(line);
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      this.nonJsonLines.push(line);
      return;
    }
    if (typeof message.id === "number") {
      this.waiters.get(message.id)?.(message);
      this.waiters.delete(message.id);
    }
  }
}
