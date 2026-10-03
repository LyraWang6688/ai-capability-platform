#!/usr/bin/env node
/**
 * 命令行入口 —— 诊断与手动执行。
 *
 * 产品主入口是 MCP（豆包工作 / WorkBuddy 调用）；CLI 的存在是为了：
 *   1. 用户自查（doctor）
 *   2. 上传前预检（inspect，完全不调用微信）
 *   3. 出问题时把「是我们的代码坏了还是宿主环境坏了」一次性分清
 *
 * 用法：
 *   node --env-file=.env --import tsx src/connector/cli.ts doctor
 *   node --env-file=.env --import tsx src/connector/cli.ts inspect "/绝对路径/文章目录"
 *   node --env-file=.env --import tsx src/connector/cli.ts upload  "/绝对路径/文章目录"
 */
import { createWechatApi, readCredentialsFromEnv } from "./wechatApi.js";
import { inspectArticleBundle, publishArticleBundle } from "./publish.js";

const [command, target, ...rest] = process.argv.slice(2);
const asJson = rest.includes("--json");

async function main() {
  switch (command) {
    case "doctor":
      return doctor();
    case "inspect":
      return inspect(target);
    case "upload":
      return upload(target);
    default:
      printUsage();
      process.exit(2);
  }
}

async function doctor() {
  const credentials = readCredentialsFromEnv();
  const api = createWechatApi({ credentials });
  try {
    const access = await api.checkAccess();
    const count = await api.draftCount();
    output({ ok: true, expiresIn: access.expires_in, draftCount: count, message: "微信连接正常" });
  } catch (error) {
    output({ ok: false, message: messageOf(error) }, true);
  }
}

async function inspect(bundlePath?: string) {
  if (!bundlePath) {
    console.error("用法：inspect <文章目录绝对路径>");
    process.exit(2);
  }
  try {
    const result = await inspectArticleBundle(bundlePath);
    if (asJson) {
      output(result);
      return;
    }
    console.log("\n=== 上传前预检（未调用微信）===\n");
    console.log("正文文件   :", result.htmlFile);
    console.log("元数据     :", result.metaFile ?? "(无)");
    console.log("标题       :", result.title, `(${[...result.title].length} 字)`);
    console.log("作者       :", result.author ?? "(未设置)");
    console.log("摘要       :", result.digest ?? "(未设置，微信会自动截取)");
    console.log("正文       :", result.content.chars, "字符 /", result.content.bytes, "字节");
    console.log("正文图片   :", result.bodyImages.length, "张本地 ·", result.remoteImages.length, "张外链 ·", result.dataUriImages, "张 data URI");
    console.log("封面       :", result.cover ? `${result.cover.source}（${result.cover.bytes} 字节）` : "❌ 未找到");
    console.log("内容指纹   :", result.bundleHash.slice(0, 24), "…");
    if (result.warnings.length) {
      console.log("\n⚠ 警告：");
      for (const w of result.warnings) console.log("  ·", w);
    }
    if (result.blockingIssues.length) {
      console.log("\n❌ 阻塞问题（必须先解决）：");
      for (const issue of result.blockingIssues) console.log("  ·", issue);
      process.exit(1);
    }
    console.log("\n✅ 可以上传\n");
  } catch (error) {
    output({ ok: false, message: messageOf(error) }, true);
  }
}

async function upload(bundlePath?: string) {
  if (!bundlePath) {
    console.error("用法：upload <文章目录绝对路径>");
    process.exit(2);
  }
  try {
    const result = await publishArticleBundle({ bundlePath });
    if (asJson) {
      output(result);
      return;
    }
    console.log("\n=== 上传结果 ===\n");
    console.log("状态       :", result.reused ? "复用既有草稿（内容未变）" : "新建草稿");
    console.log("标题       :", result.title);
    console.log("草稿 ID    :", result.mediaId);
    console.log("读回核验   :", result.verified ? "✅ 通过" : "⚠️ 未通过，请到后台人工检查");
    console.log("正文       :", result.content.chars, "字符 /", result.content.bytes, "字节");
    console.log("正文图片   :", result.images.uploaded.length, "张已上传");
    console.log("封面素材   :", result.cover.mediaId);
    if (result.warnings.length) {
      console.log("\n⚠ 警告：");
      for (const w of result.warnings) console.log("  ·", w);
    }
    console.log("\n" + result.message + "\n");
  } catch (error) {
    output({ ok: false, message: messageOf(error) }, true);
  }
}

function output(value: unknown, isError = false) {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
  if (isError) process.exit(1);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function printUsage() {
  console.error(`
用法：cli.ts <命令> [参数]

  doctor                     检查微信凭证、IP 白名单与草稿箱权限（只读）
  inspect "<文章目录>"        上传前预检，不调用微信
  upload  "<文章目录>"        真正的上传，创建公众号草稿

可选：在命令后加 --json 输出机器可读结果
`);
}

main().catch((error) => {
  console.error("CLI 异常：", messageOf(error));
  process.exit(1);
});
