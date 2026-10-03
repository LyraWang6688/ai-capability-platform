/**
 * 幂等账本 + 单篇互斥锁。
 *
 * 状态机：(无) → creating → created；creating 是「结果未知」的持久化承诺，
 * 一旦落盘就必须阻止自动重试，直到人工核对。
 */
import assert from "node:assert/strict";
import { readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import {
  DeliveryLockedError,
  DeliveryOutcomeUnknownError,
  readDeliveryState,
  stateDir,
  stateFile,
  withDeliveryLock,
  writeDeliveryState
} from "../src/deliveryState.js";
import { makeTempDir, type TempDir } from "./helpers/fixtures.js";

const APP_ID = "wx1234567890abcdef";
const OTHER_APP_ID = "wxffffffffffffffff";
const HASH = "a".repeat(64);

describe("deliveryState：账本", () => {
  let temp: TempDir;
  before(async () => {
    temp = await makeTempDir("wdmcp-state-");
  });
  after(async () => {
    await temp.cleanup();
  });

  test("stateDir：默认在 home 下，可由 WECHAT_DRAFT_STATE_DIR 覆盖", () => {
    assert.equal(stateDir({} as NodeJS.ProcessEnv), path.join(homedir(), ".wechat-draft-capability", "state"));
    assert.equal(stateDir({ WECHAT_DRAFT_STATE_DIR: "/tmp/x" } as NodeJS.ProcessEnv), "/tmp/x");
    assert.equal(stateDir({ WECHAT_DRAFT_STATE_DIR: "   " } as NodeJS.ProcessEnv).includes(".wechat-draft-capability"), true);
  });

  test("stateFile：按账号 + 内容哈希分文件，账号名不出现在文件名里", () => {
    const env = { WECHAT_DRAFT_STATE_DIR: temp.path } as NodeJS.ProcessEnv;
    const a = stateFile(APP_ID, HASH, env);
    const b = stateFile(APP_ID, HASH, env);
    const otherAccount = stateFile(OTHER_APP_ID, HASH, env);
    const otherContent = stateFile(APP_ID, "b".repeat(64), env);

    assert.equal(a, b);
    assert.notEqual(a, otherAccount, "换账号不能命中同一幂等记录");
    assert.notEqual(a, otherContent, "换内容不能命中同一幂等记录");
    assert.ok(a.endsWith(`-${HASH}.json`));
    assert.ok(!a.includes(APP_ID), "文件名不能包含明文 AppID");
    assert.ok(path.dirname(a) === temp.path);
  });

  test("读写往返；文件 0600、目录 0700", async () => {
    const file = path.join(temp.path, "roundtrip", "state.json");
    await writeDeliveryState(file, { status: "created", title: "标题", mediaId: "MID_1", updatedAt: "2026-10-02T00:00:00.000Z" });

    const read = await readDeliveryState(file);
    assert.deepEqual(read, { status: "created", title: "标题", mediaId: "MID_1", updatedAt: "2026-10-02T00:00:00.000Z" });

    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal((await stat(path.dirname(file))).mode & 0o777, 0o700);
  });

  test("文件不存在 → undefined（首次投递）", async () => {
    assert.equal(await readDeliveryState(path.join(temp.path, "nope.json")), undefined);
  });

  test("内容异常 → DeliveryOutcomeUnknownError，绝不当作「没上传过」", async () => {
    const badStatus = path.join(temp.path, "bad-status.json");
    await writeFile(badStatus, JSON.stringify({ status: "weird", title: "x" }));
    await assert.rejects(() => readDeliveryState(badStatus), (error: unknown) => error instanceof DeliveryOutcomeUnknownError);

    const badJson = path.join(temp.path, "bad-json.json");
    await writeFile(badJson, "{ 这不是 JSON");
    await assert.rejects(() => readDeliveryState(badJson), (error: unknown) => error instanceof DeliveryOutcomeUnknownError);
  });
});

describe("deliveryState：单篇互斥锁", () => {
  let temp: TempDir;
  before(async () => {
    temp = await makeTempDir("wdmcp-lock-");
  });
  after(async () => {
    await temp.cleanup();
  });

  test("拿锁执行期间锁文件存在，结束后释放", async () => {
    const file = path.join(temp.path, "mutex", "state.json");
    const lockPath = `${file}.lock`;
    let sawLock = false;

    const result = await withDeliveryLock(file, async () => {
      const info = await stat(lockPath);
      sawLock = true;
      assert.equal(info.isFile(), true);
      return 42;
    });

    assert.equal(result, 42);
    assert.equal(sawLock, true);
    await assert.rejects(() => stat(lockPath), /ENOENT/);
  });

  test("同一个文件并发第二次拿锁 → DeliveryLockedError（绝不并发建草稿）", async () => {
    const file = path.join(temp.path, "concurrent", "state.json");
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = withDeliveryLock(file, async () => {
      await gate;
      return "first";
    });
    await new Promise((resolve) => setTimeout(resolve, 30));

    await assert.rejects(
      () => withDeliveryLock(file, async () => "second"),
      (error: unknown) => error instanceof DeliveryLockedError
    );

    release();
    assert.equal(await first, "first");

    // 释放后可再次拿锁。
    assert.equal(await withDeliveryLock(file, async () => "third"), "third");
  });

  test("run 抛异常也要释放锁，避免永久卡死", async () => {
    const file = path.join(temp.path, "throw", "state.json");
    await assert.rejects(
      () =>
        withDeliveryLock(file, async () => {
          throw new Error("boom");
        }),
      /boom/
    );
    assert.equal(await withDeliveryLock(file, async () => "recovered"), "recovered");
  });

  test("残留锁文件 → 拒绝并提示先核对草稿箱", async () => {
    const file = path.join(temp.path, "stale", "state.json");
    const lockPath = `${file}.lock`;
    await writeDeliveryState(file, { status: "creating", title: "中断的投递", updatedAt: "2026-10-02T00:00:00.000Z" });
    await writeFile(lockPath, "", { flag: "w" });

    await assert.rejects(
      () => withDeliveryLock(file, async () => "never"),
      (error: unknown) => {
        assert.ok(error instanceof DeliveryLockedError);
        assert.match(error.message, /草稿箱/);
        return true;
      }
    );
    // 锁没被偷偷清掉，人工必须显式处理。
    assert.equal((await stat(lockPath)).isFile(), true);
    assert.equal((await readFile(file, "utf8")).includes("creating"), true);
  });
});
