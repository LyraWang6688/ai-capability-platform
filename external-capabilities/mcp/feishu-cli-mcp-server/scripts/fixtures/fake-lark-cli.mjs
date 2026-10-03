#!/usr/bin/env node
// Offline test executable. Never reads credentials or contacts Feishu.
import { appendFileSync } from "node:fs";
const mode = process.argv.at(-1);
appendFileSync(process.env.CLI_TEST_LOG, `${mode}\n`);
setTimeout(() => {
  if (mode === "failure") process.exit(1);
  appendFileSync(process.env.CLI_TEST_LOG, `${mode}:done\n`);
  process.stdout.write(mode === "invalid-json" ? "not json" : '{"ok":true}');
}, mode === "timeout" ? 5000 : 100);
