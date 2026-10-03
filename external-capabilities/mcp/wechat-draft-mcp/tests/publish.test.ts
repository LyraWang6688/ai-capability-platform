/**
 * 发布编排（端到端，走真实 HTTP 打到 mock 微信服务器）。
 *
 * 覆盖四条安全不变量：
 *   1. 第一次微信副作用之前必须先落盘 creating
 *   2. creating 之后异常 —— 结果未知，禁止自动重试
 *   3. 同账号同内容 —— 读回既有草稿，不重复创建
 *   4. 单篇互斥 —— 锁在即拒绝
 */
import assert from "node:assert/strict";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { LIMITS, loadArticleBundle } from "../src/articleBundle.js";
import { DeliveryLockedError, DeliveryOutcomeUnknownError, stateFile } from "../src/deliveryState.js";
import { publishArticleBundle, rewriteImageSrc } from "../src/publish.js";
import { createWechatApi, type WechatApi } from "../src/wechatApi.js";
import { PNG_OTHER, makeTempDir, writeBundle, type TempDir } from "./helpers/fixtures.js";
import { MockWechatServer, type Endpoint } from "./helpers/mockWechatServer.js";

const APP_ID = "wx1234567890abcdef";
const APP_SECRET = "cover-secret-must-never-leak";
const credentials = { appId: APP_ID, appSecret: APP_SECRET };

describe("publish：端到端", () => {
  let temp: TempDir;
  let server: MockWechatServer;
  let api: WechatApi;
  let env: NodeJS.ProcessEnv;

  before(async () => {
    temp = await makeTempDir("wdmcp-publish-");
    server = new MockWechatServer();
    await server.start();
    api = createWechatApi({ apiBase: server.url, credentials });
  });
  after(async () => {
    await server.stop();
    await temp.cleanup();
  });
  beforeEach(() => server.clearRequests());

  test("正常上传：正文图片改写、封面走永久素材、读回核验、账本落 created", async () => {
    const dir = await temp.sub("happy");
    await writeBundle(dir, { title: "端到端标题", author: "老王", digest: "摘要", includeRemoteAndDataImages: true });
    env = { WECHAT_DRAFT_STATE_DIR: await temp.sub("state-happy") } as NodeJS.ProcessEnv;

    const result = await publishArticleBundle({ bundlePath: dir, credentials, env, api });

    assert.equal(result.ok, true);
    assert.equal(result.reused, false);
    assert.equal(result.verified, true, "读回核验必须通过");
    assert.equal(result.title, "端到端标题");
    assert.equal(result.images.uploaded.length, 1);
    assert.deepEqual(result.images.skippedRemote, ["https://example.com/remote.png"]);
    assert.equal(result.images.skippedDataUri, 1);
    assert.ok(result.warnings.some((warning) => warning.includes("外链图片")));

    // 真正发给微信的正文必须是改写后的：本地路径消失，换成微信 URL。
    const article = (server.requestsFor("draft/add")[0]!.json as { articles: Array<Record<string, unknown>> }).articles[0]!;
    assert.ok(!String(article.content).includes("images/fig1.png"), "原始本地路径不能留在正文里");
    assert.match(String(article.content), /mock\/body-image-1\.png/);
    assert.equal(article.thumb_media_id, result.cover.mediaId);
    assert.match(String(article.thumb_media_id), /^MOCK_COVER_MEDIA_\d+$/);
    assert.equal(article.title, "端到端标题");
    assert.equal(article.author, "老王");
    assert.equal(article.digest, "摘要");
    assert.equal(article.need_open_comment, 0);
    assert.equal(article.only_fans_can_comment, 0);

    // 账本：created + mediaId。
    const bundle = await loadArticleBundle(dir, env);
    const state = JSON.parse(await readFile(stateFile(APP_ID, bundle.hash, env), "utf8")) as Record<string, unknown>;
    assert.equal(state.status, "created");
    assert.equal(state.mediaId, result.mediaId);
    assert.equal(state.imageCount, 1);

    // 只创建草稿：本次调用只碰了这几个接口，没有发布/删除类操作。
    assert.deepEqual(
      [...new Set(server.requests.map((request) => request.endpoint))].sort(),
      ["draft/add", "draft/get", "material/add_material", "media/uploadimg", "stable_token"].sort()
    );
    assert.equal(server.count("draft/add"), 1);
  });

  test("幂等重放：同账号同内容第二次调用只读回，不再创建", async () => {
    const dir = await temp.sub("replay");
    await writeBundle(dir, { title: "重放标题", author: "A" });
    env = { WECHAT_DRAFT_STATE_DIR: await temp.sub("state-replay") } as NodeJS.ProcessEnv;

    const first = await publishArticleBundle({ bundlePath: dir, credentials, env, api });
    const draftsBefore = server.drafts.size;
    assert.equal(draftsBefore >= 1, true);
    server.clearRequests();

    const second = await publishArticleBundle({ bundlePath: dir, credentials, env, api });

    assert.equal(second.reused, true);
    assert.equal(second.mediaId, first.mediaId);
    assert.equal(server.count("draft/add"), 0, "重放不得再建草稿");
    assert.equal(server.drafts.size, draftsBefore, "草稿总数不得变化");
    assert.equal(second.verified, true);
    assert.match(second.message, /已返回既有草稿/);

    // 只改封面内容 —— 必须视为新内容，建立第二条草稿（证明指纹覆盖封面）。
    await writeFile(path.join(dir, "cover.png"), Buffer.concat([PNG_OTHER, Buffer.from("changed")]));
    const third = await publishArticleBundle({ bundlePath: dir, credentials, env, api });
    assert.equal(third.reused, false);
    assert.notEqual(third.mediaId, first.mediaId);
    assert.equal(server.drafts.size, draftsBefore + 1);
  });

  test("创建草稿返回「结果未知」时：账本停在 creating，第二次调用拒绝重试", async () => {
    const dir = await temp.sub("unknown");
    await writeBundle(dir, { title: "结果未知", author: "A" });
    env = { WECHAT_DRAFT_STATE_DIR: await temp.sub("state-unknown") } as NodeJS.ProcessEnv;
    const bundle = await loadArticleBundle(dir, env);
    const file = stateFile(APP_ID, bundle.hash, env);

    server.failOnce("draft/add", { kind: "destroy" });
    await assert.rejects(() => publishArticleBundle({ bundlePath: dir, credentials, env, api }));

    const state = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
    assert.equal(state.status, "creating", "结果未知必须持久化成 creating");
    assert.equal(state.mediaId, undefined);

    const draftAddCalls = server.count("draft/add");
    await assert.rejects(
      () => publishArticleBundle({ bundlePath: dir, credentials, env, api }),
      (error: unknown) => {
        assert.ok(error instanceof DeliveryOutcomeUnknownError, `期望 DeliveryOutcomeUnknownError，实际 ${String(error)}`);
        assert.match((error as Error).message, /草稿箱核对/);
        return true;
      }
    );
    assert.equal(server.count("draft/add"), draftAddCalls, "结果未知时绝不能自动重试");
  });

  test("★ 第一次微信副作用之前，creating 必须已经落盘", async () => {
    const dir = await temp.sub("ordering");
    await writeBundle(dir, { title: "顺序", author: "A" });
    env = { WECHAT_DRAFT_STATE_DIR: await temp.sub("state-ordering") } as NodeJS.ProcessEnv;
    const bundle = await loadArticleBundle(dir, env);
    const file = stateFile(APP_ID, bundle.hash, env);

    const observations: Array<{ endpoint: Endpoint; status: string | null }> = [];
    server.setOnRequest(async (request) => {
      let status: string | null = null;
      try {
        status = (JSON.parse(await readFile(file, "utf8")) as { status?: string }).status ?? null;
      } catch {
        status = null; // 文件还不存在
      }
      observations.push({ endpoint: request.endpoint, status });
    });

    try {
      await publishArticleBundle({ bundlePath: dir, credentials, env, api });
    } finally {
      server.setOnRequest(() => {});
    }

    // 取 token 不算副作用，此时还不应该写账本。
    const tokenPhase = observations.find((item) => item.endpoint === "stable_token");
    assert.equal(tokenPhase?.status, null, "取 access_token 之前不应写账本");

    // 所有真正产生微信数据的请求，都必须看到 creating。
    for (const endpoint of ["media/uploadimg", "material/add_material", "draft/add"] as Endpoint[]) {
      const seen = observations.find((item) => item.endpoint === endpoint);
      assert.ok(seen, `mock 没有收到 ${endpoint} 请求`);
      assert.equal(seen!.status, "creating", `${endpoint} 发生时账本状态应为 creating，实际 ${String(seen!.status)}`);
    }
  });

  test("账本停在 creating 时：不碰微信，直接拒绝", async () => {
    const dir = await temp.sub("creating-lock");
    await writeBundle(dir, { title: "中断过", author: "A" });
    env = { WECHAT_DRAFT_STATE_DIR: await temp.sub("state-creating") } as NodeJS.ProcessEnv;
    const bundle = await loadArticleBundle(dir, env);
    const file = stateFile(APP_ID, bundle.hash, env);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ status: "creating", title: "中断过", updatedAt: new Date().toISOString() }));

    await assert.rejects(
      () => publishArticleBundle({ bundlePath: dir, credentials, env, api }),
      (error: unknown) => {
        assert.ok(error instanceof DeliveryOutcomeUnknownError);
        assert.match((error as Error).message, /删除状态文件/);
        assert.ok((error as Error).message.includes(file), "要告诉用户该删哪个文件");
        return true;
      }
    );
    assert.equal(server.requests.length, 0, "creating 状态下不得发起任何微信请求");
  });

  test("锁被占用：DeliveryLockedError，且不发任何请求", async () => {
    const dir = await temp.sub("locked");
    await writeBundle(dir, { title: "加锁", author: "A" });
    env = { WECHAT_DRAFT_STATE_DIR: await temp.sub("state-locked") } as NodeJS.ProcessEnv;
    const bundle = await loadArticleBundle(dir, env);
    const lockPath = `${stateFile(APP_ID, bundle.hash, env)}.lock`;
    await mkdir(path.dirname(lockPath), { recursive: true });
    await writeFile(lockPath, "");

    await assert.rejects(
      () => publishArticleBundle({ bundlePath: dir, credentials, env, api }),
      (error: unknown) => error instanceof DeliveryLockedError
    );
    assert.equal(server.requests.length, 0);
    assert.equal((await stat(lockPath)).isFile(), true, "人工处理前锁必须留着");
  });

  test("阻塞问题（缺封面）：不落账本、不发请求", async () => {
    const dir = await temp.sub("blocking");
    await writeBundle(dir, { title: "缺封面", author: "A", cover: null, images: {} });
    const stateDir = await temp.sub("state-blocking");
    env = { WECHAT_DRAFT_STATE_DIR: stateDir } as NodeJS.ProcessEnv;

    await assert.rejects(
      () => publishArticleBundle({ bundlePath: dir, credentials, env, api }),
      /不满足微信草稿要求/
    );
    assert.equal(server.requests.length, 0);
    assert.deepEqual(await readdir(stateDir), [], "预检失败不应写任何账本文件");
  });

  test("凭证占位符：报注入问题，不落 creating", async () => {
    const dir = await temp.sub("placeholder");
    await writeBundle(dir, { title: "占位符", author: "A" });
    const stateDir = await temp.sub("state-placeholder");
    env = { WECHAT_DRAFT_STATE_DIR: stateDir } as NodeJS.ProcessEnv;
    const placeholderApi = createWechatApi({
      apiBase: server.url,
      credentials: { appId: "${WECHAT_APP_ID}", appSecret: "${WECHAT_APP_SECRET}" }
    });

    await assert.rejects(
      () => publishArticleBundle({ bundlePath: dir, credentials: { appId: "${WECHAT_APP_ID}", appSecret: "${WECHAT_APP_SECRET}" }, env, api: placeholderApi }),
      /未被注入/
    );
    assert.equal(server.requests.length, 0);
    assert.deepEqual(await readdir(stateDir), []);
  });

  test("微信鉴权失败（40125）：不落 creating，可安全重试", async () => {
    const dir = await temp.sub("auth-fail");
    await writeBundle(dir, { title: "鉴权失败", author: "A" });
    const stateDir = await temp.sub("state-auth-fail");
    env = { WECHAT_DRAFT_STATE_DIR: stateDir } as NodeJS.ProcessEnv;

    server.failOnce("stable_token", { kind: "errcode", errcode: 40125, errmsg: "invalid appsecret" });
    await assert.rejects(
      () => publishArticleBundle({ bundlePath: dir, credentials, env, api }),
      (error: unknown) => {
        assert.match((error as Error).message, /AppSecret 无效/);
        assert.ok(!(error as Error).message.includes(APP_SECRET));
        return true;
      }
    );
    assert.deepEqual(await readdir(stateDir), [], "凭证错误时不该留下 creating（否则用户无法重试）");
  });

  test("改写图片地址后正文超限：报错并保持 creating（此时已有微信副作用）", async () => {
    const imageCount = 30;
    const images: Record<string, Buffer> = {};
    const tags: string[] = [];
    for (let index = 0; index < imageCount; index += 1) {
      images[`images/fig${index}.png`] = Buffer.from(`img-${index}`);
      tags.push(`<img src="images/fig${index}.png">`);
    }
    const body = `<p>${"字".repeat(LIMITS.contentChars - 200 - tags.join("\n").length)}</p>\n${tags.join("\n")}`;
    const dir = await temp.sub("post-rewrite-overflow");
    await writeBundle(dir, { title: "改写后超限", author: "A", images, bodyHtml: body, cover: { name: "cover.png", bytes: PNG_OTHER } });
    const stateDir = await temp.sub("state-post-rewrite-overflow");
    env = { WECHAT_DRAFT_STATE_DIR: stateDir } as NodeJS.ProcessEnv;

    const bundle = await loadArticleBundle(dir, env);
    assert.deepEqual(bundle.blockingIssues, [], "前置条件：改写前的正文不应超限");
    assert.ok(bundle.stats.chars < LIMITS.contentChars);

    await assert.rejects(
      () => publishArticleBundle({ bundlePath: dir, credentials, env, api }),
      /替换图片地址后正文超限/
    );

    // 已发生过副作用（图片已上传），必须停在 creating。
    const file = stateFile(APP_ID, bundle.hash, env);
    assert.equal((JSON.parse(await readFile(file, "utf8")) as { status: string }).status, "creating");
    assert.ok(server.count("draft/add") === 0, "超限不能落到建草稿这一步");
  });

  test("读回核验不通过：仍算创建成功，但明确提示人工检查", async () => {
    const dir = await temp.sub("verify-fail");
    await writeBundle(dir, { title: "核验失败", author: "A" });
    env = { WECHAT_DRAFT_STATE_DIR: await temp.sub("state-verify-fail") } as NodeJS.ProcessEnv;

    server.failOnce("draft/get", { kind: "errcode", errcode: 40007, errmsg: "invalid media_id" });
    const result = await publishArticleBundle({ bundlePath: dir, credentials, env, api });

    assert.equal(result.ok, true);
    assert.equal(result.verified, false);
    assert.match(result.message, /核验未通过|人工检查/);
  });

  test("rewriteImageSrc 只改指定 src，不动其他内容", () => {
    const html = '<img src="images/a.png"><img src=\'images/a.png\'><img src="images/a.png.bak"><img src="images/aXb1.png">';
    assert.equal(
      rewriteImageSrc(html, "images/a.png", "https://wx.example/a.png"),
      '<img src="https://wx.example/a.png"><img src=\'https://wx.example/a.png\'><img src="images/a.png.bak"><img src="images/aXb1.png">'
    );
    // src 里的正则元字符必须按字面量匹配。
    assert.equal(rewriteImageSrc('<img src="a+b(1).png">', "a+b(1).png", "https://x/y.png"), '<img src="https://x/y.png">');
  });
});

describe("publish：开关、复用与重试", () => {
  let temp: TempDir;
  let server: MockWechatServer;
  let api: WechatApi;
  let env: NodeJS.ProcessEnv;

  before(async () => {
    temp = await makeTempDir("wdmcp-publish2-");
    server = new MockWechatServer();
    await server.start();
    api = createWechatApi({ apiBase: server.url, credentials });
  });
  after(async () => {
    await server.stop();
    await temp.cleanup();
  });
  beforeEach(() => {
    server.clearRequests();
    server.drafts.clear();
  });

  function articleOf(index = 0): Record<string, unknown> {
    const request = server.requestsFor("draft/add")[index]!;
    return (request.json as { articles: Array<Record<string, unknown>> }).articles[0]!;
  }

  test("留言开关会原样传给微信", async () => {
    const dir = await temp.sub("comment-flags");
    await writeBundle(dir, { title: "留言开关", author: "A" });
    env = { WECHAT_DRAFT_STATE_DIR: await temp.sub("state-comment-flags") } as NodeJS.ProcessEnv;

    await publishArticleBundle({ bundlePath: dir, credentials, env, api, needOpenComment: true, onlyFansCanComment: true });

    assert.equal(articleOf().need_open_comment, 1);
    assert.equal(articleOf().only_fans_can_comment, 1);
  });

  test("默认不开启留言", async () => {
    const dir = await temp.sub("comment-default");
    await writeBundle(dir, { title: "默认留言", author: "A" });
    env = { WECHAT_DRAFT_STATE_DIR: await temp.sub("state-comment-default") } as NodeJS.ProcessEnv;

    await publishArticleBundle({ bundlePath: dir, credentials, env, api });

    assert.equal(articleOf().need_open_comment, 0);
    assert.equal(articleOf().only_fans_can_comment, 0);
  });

  test("复用既有草稿时读回核验失败 → reused 仍为 true，但明确提示人工确认", async () => {
    const dir = await temp.sub("reuse-verify-fail");
    await writeBundle(dir, { title: "复用核验失败", author: "A" });
    env = { WECHAT_DRAFT_STATE_DIR: await temp.sub("state-reuse-verify-fail") } as NodeJS.ProcessEnv;

    const first = await publishArticleBundle({ bundlePath: dir, credentials, env, api });
    server.failOnce("draft/get", { kind: "errcode", errcode: 40007, errmsg: "invalid media_id" });
    const second = await publishArticleBundle({ bundlePath: dir, credentials, env, api });

    assert.equal(second.reused, true);
    assert.equal(second.mediaId, first.mediaId);
    assert.equal(second.verified, false);
    assert.match(second.message, /既有的草稿|核验未通过/);
    assert.equal(server.count("draft/add"), 1, "复用不得新建草稿");
  });

  test("鉴权失败后锁已释放：修好凭证就能重试成功，不会被自己卡死", async () => {
    const dir = await temp.sub("retry-after-auth-fail");
    await writeBundle(dir, { title: "重试", author: "A" });
    const stateDir = await temp.sub("state-retry");
    env = { WECHAT_DRAFT_STATE_DIR: stateDir } as NodeJS.ProcessEnv;

    server.failOnce("stable_token", { kind: "errcode", errcode: 40125, errmsg: "invalid appsecret" });
    await assert.rejects(() => publishArticleBundle({ bundlePath: dir, credentials, env, api }), /AppSecret 无效/);

    const result = await publishArticleBundle({ bundlePath: dir, credentials, env, api });

    assert.equal(result.ok, true);
    assert.equal(result.verified, true);
    assert.equal(server.drafts.size, 1, "重试只应产生一条草稿");
    const { readdir } = await import("node:fs/promises");
    assert.deepEqual((await readdir(stateDir)).filter((name) => name.endsWith(".lock")), [], "不得残留锁文件");
  });

  test("外链图片会在结果里给出人话警告，并出现在 warnings 里", async () => {
    const dir = await temp.sub("remote-warning");
    await writeBundle(dir, { title: "外链警告", author: "A", includeRemoteAndDataImages: true });
    env = { WECHAT_DRAFT_STATE_DIR: await temp.sub("state-remote-warning") } as NodeJS.ProcessEnv;

    const result = await publishArticleBundle({ bundlePath: dir, credentials, env, api });

    assert.equal(result.images.skippedRemote.length, 1);
    assert.equal(result.images.skippedDataUri, 1);
    assert.equal(result.warnings.filter((warning) => warning.includes("外链图片")).length, 1);
  });
});
