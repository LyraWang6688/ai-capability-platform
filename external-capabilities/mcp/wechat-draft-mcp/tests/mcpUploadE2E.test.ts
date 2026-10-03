/**
 * MCP stdio 通道的**完整上传链路**（端到端）。
 *
 * 这是此前唯一的自动化空白：`tests/wechatApi` 只测 API 层、`tests/publish` 只测编排层、
 * `tests/mcpStdio` 只测到"缺凭证报错"。真正的"子进程 + JSON-RPC + 完整上传"从没被自动化覆盖过，
 * 只能靠真机手测。
 *
 * 做法：父进程起本地 mock 微信服务器，子进程通过 `node --import` 预加载 fetch 拦截器，
 * 把发往 api.weixin.qq.com 的请求改送到 mock。**产品代码零改动**，也没有新增任何
 * "改接口地址"的环境变量（拦截器只存在于测试侧，不进发布产物）。
 */
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, test } from "node:test";
import { StdioMcpClient, assertStdoutPristine, nodeEnv, srcFile } from "./helpers/spawnNode.js";
import { MockWechatServer } from "./helpers/mockWechatServer.js";
import { makeTempDir, writeBundle, type TempDir } from "./helpers/fixtures.js";

const SERVER = srcFile("mcpServer.js");
const INTERCEPTOR = fileURLToPath(new URL("./helpers/interceptWechatFetch.js", import.meta.url));
const TITLE = "通道层端到端标题";

describe("MCP 通道：完整上传链路", () => {
  let temp: TempDir;
  let server: MockWechatServer;
  let client: StdioMcpClient | undefined;

  before(async () => {
    temp = await makeTempDir("wdmcp-channel-");
    server = new MockWechatServer();
    await server.start();
  });
  after(async () => {
    await client?.close();
    await server.stop();
    await temp.cleanup();
  });

  async function startServerClient(extraEnv: Record<string, string | undefined>): Promise<StdioMcpClient> {
    const created = new StdioMcpClient(
      [SERVER],
      nodeEnv({
        WECHAT_APP_ID: "wx_channel_e2e",
        WECHAT_APP_SECRET: "channel-e2e-secret-not-real",
        // 子进程里的 fetch 会被改送到这个 mock；缺了它拦截器会直接终止进程
        WECHAT_DRAFT_TEST_MOCK_URL: server.url,
        ...extraEnv
      }),
      ["--import", INTERCEPTOR]
    );
    const initialized = await created.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "wdmcp-channel-tests", version: "0.0.0" }
    });
    assert.equal(initialized.error, undefined, `initialize 失败：${JSON.stringify(initialized.error)}`);
    created.notify("notifications/initialized");
    return created;
  }

  async function parseTool(client: StdioMcpClient, name: string, args: Record<string, unknown>) {
    const result = await client.callTool(name, args);
    assert.equal(result.isError, undefined, `${name} 返回错误：${result.text}`);
    return JSON.parse(result.text) as Record<string, unknown>;
  }

  test("status → inspect → upload → 幂等重放 → 读回，全程走 JSON-RPC", async () => {
    const dir = await temp.sub("article");
    await writeBundle(dir, { title: TITLE, author: "通道层作者" });
    const stateDir = await temp.sub("state");

    client = await startServerClient({ WECHAT_DRAFT_STATE_DIR: stateDir });

    // ① 体检：无副作用的真实业务调用（也是豆包生态准入要求的那条）
    const status = await parseTool(client, "wechat_draft_status", {});
    assert.equal(status.ok, true);
    assert.equal(status.draftCount, 0);

    // ② 预检
    const inspect = await parseTool(client, "inspect_wechat_article", { bundle_path: dir });
    assert.equal(inspect.ready, true);
    assert.equal(inspect.title, TITLE);

    // ③ 真正的上传 —— 这一段以前没有自动化覆盖
    const first = await parseTool(client, "upload_wechat_draft", { bundle_path: dir });
    assert.equal(first.ok, true);
    assert.equal(first.reused, false);
    assert.equal(first.verified, true);
    assert.equal(first.uploadedBodyImages, 1);
    assert.match(String(first.draftMediaId), /^MOCK_DRAFT_MEDIA_\d+$/);

    // 微信侧真的收到了什么：mock 记录是父进程侧的，可信
    const article = server.requestsFor("draft/add")[0]!.json as { articles: Array<Record<string, unknown>> };
    assert.equal(article.articles[0]!.title, TITLE);
    assert.match(String(article.articles[0]!.content), /mock\/body-image-\d+\.png/, "正文图片应已改写成微信 URL");
    assert.ok(!String(article.articles[0]!.content).includes("images/fig1.png"), "本地路径不能留在正文里");
    assert.match(String(article.articles[0]!.thumb_media_id), /^MOCK_COVER_MEDIA_\d+$/);
    assert.equal(server.requestsFor("media/uploadimg")[0]!.fileNames[0], "fig1.png");

    // 账本：通过 MCP 通道写完的，落在状态目录里
    const ledgerFiles = (await readdir(stateDir)).filter((name) => name.endsWith(".json"));
    assert.equal(ledgerFiles.length, 1);
    const ledger = JSON.parse(await readFile(path.join(stateDir, ledgerFiles[0]!), "utf8")) as Record<string, unknown>;
    assert.equal(ledger.status, "created");
    assert.equal(ledger.mediaId, first.draftMediaId);

    // ④ 幂等重放：走通道再传一次，不得新建草稿
    const second = await parseTool(client, "upload_wechat_draft", { bundle_path: dir });
    assert.equal(second.reused, true);
    assert.equal(second.draftMediaId, first.draftMediaId);
    assert.equal(server.count("draft/add"), 1, "重放不得再建草稿");

    // ⑤ status 再确认草稿总数没变（mock 的 draft/count 就是真实草稿数）
    const statusAfter = await parseTool(client, "wechat_draft_status", {});
    assert.equal(statusAfter.draftCount, 1);

    // ⑥ 读回工具：这条以前只测过"缺凭证"，现在走通成功路径
    const readBack = await parseTool(client, "get_wechat_draft", { media_id: String(first.draftMediaId) });
    assert.equal(readBack.ok, true);
    assert.equal(readBack.title, TITLE);

    // 全程 stdout 只能是 JSON-RPC：上传过程中也不能冒出日志
    assertStdoutPristine(client);
  });

  test("mock 不在时拦截器必须终止进程，避免打到真微信", async () => {
    const dir = await temp.sub("article-guard");
    await writeBundle(dir, { title: "护栏", author: "A" });
    const requestsBefore = server.requests.length;
    const guardClient = new StdioMcpClient(
      [SERVER],
      nodeEnv({
        WECHAT_APP_ID: "wx_channel_e2e",
        WECHAT_APP_SECRET: "channel-e2e-secret-not-real",
        WECHAT_DRAFT_TEST_MOCK_URL: undefined, // 故意不给
        WECHAT_DRAFT_STATE_DIR: await temp.sub("state-guard")
      }),
      ["--import", INTERCEPTOR]
    );
    try {
      await assert.rejects(
        () => guardClient.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "guard", version: "0" } }),
        /进程退出|超时/
      );
      assert.match(guardClient.stderr, /WECHAT_DRAFT_TEST_MOCK_URL/, "应明确报出缺少 mock 地址");
      assert.equal(server.requests.length, requestsBefore, "护栏场景不得向 mock 发任何请求");
    } finally {
      await guardClient.close();
    }
  });
});
