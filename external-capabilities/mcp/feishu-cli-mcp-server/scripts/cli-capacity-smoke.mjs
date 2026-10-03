import assert from "node:assert/strict";
import { chmod, copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "feishu-cli-capacity-"));
try {
  const executable = join(directory, "fake-lark-cli.mjs");
  await copyFile(new URL("./fixtures/fake-lark-cli.mjs", import.meta.url), executable);
  await chmod(executable, 0o700);
  process.env.LARK_CLI_BIN = executable;
  process.env.LARK_CLI_MAX_PENDING = "2";
  process.env.LARK_CLI_TIMEOUT_MS = "1000";
  process.env.CLI_TEST_LOG = join(directory, "calls.log");
  const { runLarkCli } = await import("../dist/lark-cli.js");

  for (const write of [false, true]) {
    const prefix = write ? "write" : "read";
    const first = runLarkCli([`${prefix}-first`], { write });
    const second = runLarkCli([`${prefix}-second`], { write });
    await assert.rejects(runLarkCli(["rejected"], { write }), /capacity reached/);
    await Promise.all([first, second]);
    assert.deepEqual(await runLarkCli(["recovered"], { write }), { ok: true });
  }
  // Reads and writes share one budget, not two independent pools.
  const read = runLarkCli(["mixed-read"]);
  const write = runLarkCli(["mixed-write"], { write: true });
  await assert.rejects(runLarkCli(["rejected"]), /capacity reached/);
  await Promise.all([read, write]);

  for (const mode of ["failure", "invalid-json", "timeout"]) {
    await assert.rejects(runLarkCli([mode], { write: true }));
    // Both slots must be released after errors, including killed processes.
    await Promise.all([runLarkCli(["after-error"]), runLarkCli(["after-error"])]);
  }
  const calls = await readFile(process.env.CLI_TEST_LOG, "utf8");
  assert.ok(!calls.includes("rejected"), "Rejected work must never start a subprocess");
  assert.ok(calls.indexOf("write-first:done\n") < calls.indexOf("write-second\n"),
    "Second write must start only after the first has finished");
  console.log("PASS: bounded CLI reads/write queue, shared capacity, error recovery; offline fixture only");
} finally {
  await rm(directory, { recursive: true, force: true });
}
