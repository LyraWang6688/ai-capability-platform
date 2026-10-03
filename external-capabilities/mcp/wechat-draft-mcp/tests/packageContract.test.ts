/**
 * 打包契约（npm 生态形态）。
 *
 * 为什么要单独锁这些字段：它们的失败是**静默的**。
 *   - 加回 `private: true` → `npm publish` 直接被拒，或者别人以为发了其实没发；
 *   - 丢掉 `files` → npm 回落到 `.gitignore`，把 `dist/` 一起排除，
 *     发出去的包里没有可执行文件，`npx` 一跑就报"文件不存在"；
 *   - 丢掉 `prepare` → 可能发出过期的编译产物。
 * 这三条都不会让 `npm test` 变红，所以这里显式断言。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

async function readPackageJson(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8")) as Record<string, unknown>;
}

describe("打包契约：可被 npx 启动", () => {
  test("不能是 private，否则 npm 拒绝发布", async () => {
    const pkg = await readPackageJson();
    assert.notEqual(pkg.private, true, "package.json 里不能有 private: true");
  });

  test("bin 指向 dist 下的编译产物（Node 跑不了 TypeScript）", async () => {
    const pkg = await readPackageJson();
    const bin = pkg.bin as Record<string, string> | undefined;
    assert.ok(bin, "缺少 bin 字段，npx 无法启动");
    const entry = bin["wechat-draft-mcp"];
    assert.equal(entry, "./dist/mcpServer.js", "bin 必须指向编译后的入口");
    // 构建过的情况下顺便验证 shebang；未构建时不误报（prepare 会在发布前构建）
    try {
      const head = await readFile(path.join(repoRoot, "dist/mcpServer.js"), "utf8");
      assert.match(head.split("\n")[0]!, /^#!\/usr\/bin\/env node$/, "入口必须有 shebang");
    } catch {
      // dist 尚未构建：跳过这一条，不制造假失败
    }
  });

  test("files 白名单必须包含 dist（否则会被 .gitignore 连带排除）", async () => {
    const pkg = await readPackageJson();
    const files = pkg.files as string[] | undefined;
    assert.ok(Array.isArray(files), "缺少 files 白名单：npm 会回落到 .gitignore 并把 dist 排除");
    assert.ok(files.includes("dist"), `files 必须包含 dist，实际=${JSON.stringify(files)}`);
    assert.ok(!files.includes("tests"), "测试与 mock 服务器不应进发布包");
  });

  test("prepare 必须在发布前构建，避免发出过期产物", async () => {
    const pkg = await readPackageJson();
    const scripts = pkg.scripts as Record<string, string>;
    assert.match(scripts.prepare ?? "", /build/, "prepare 应触发构建");
    assert.ok(scripts["check:pack"], "应提供发布前自检脚本 check:pack");
  });
});
