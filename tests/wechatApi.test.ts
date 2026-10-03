/**
 * 微信 API 客户端：请求形状、token 复用、错误分类、结果未知判定。
 *
 * 真实故障形态（连接被重置 / 超时）必须走真 HTTP，所以这里用 mock 微信服务器，
 * 而不是 stub fetch。
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import {
  WechatApiError,
  createWechatApi,
  ensureCredentialShape,
  readCredentialsFromEnv,
  type WechatCredentials
} from "../src/wechatApi.js";
import { MockWechatServer } from "./helpers/mockWechatServer.js";

const APP_ID = "wx1234567890abcdef";
const APP_SECRET = "super-secret-value-please-never-log";
const credentials = { appId: APP_ID, appSecret: APP_SECRET };

describe("wechatApi：正常路径", () => {
  let server: MockWechatServer;
  before(async () => {
    server = new MockWechatServer();
    await server.start();
  });
  after(async () => {
    await server.stop();
  });
  beforeEach(() => {
    server.clearRequests();
    server.drafts.clear();
  });

  test("checkAccess：走 stable_token，返回过期时间，绝不回显密钥", async () => {
    const api = createWechatApi({ apiBase: server.url, credentials });
    const access = await api.checkAccess();

    assert.deepEqual(access, { ok: true, expires_in: 7200 });
    const request = server.requestsFor("stable_token")[0]!;
    assert.equal(request.method, "POST");
    assert.equal(request.pathname, "/cgi-bin/stable_token");
    assert.deepEqual(request.json, {
      grant_type: "client_credential",
      appid: APP_ID,
      secret: APP_SECRET,
      force_refresh: false
    });
    // 返回给调用方的对象里不能有 token/secret。
    assert.ok(!JSON.stringify(access).includes(APP_SECRET));
  });

  test("token 只取一次并在后续请求里复用", async () => {
    const api = createWechatApi({ apiBase: server.url, credentials });
    await api.draftCount();
    await api.draftCount();
    const mediaId = await api.addDraft({ title: "复用 token", content: "<p>x</p>" });
    await api.getDraft(mediaId);

    assert.equal(server.tokenRequests, 1, "token 必须缓存复用");
    for (const request of server.requests.filter((r) => r.endpoint !== "stable_token")) {
      assert.equal(request.query.get("access_token"), "MOCK_ACCESS_TOKEN");
    }
  });

  test("uploadBodyImage：multipart 带上文件名，返回微信 URL", async () => {
    const api = createWechatApi({ apiBase: server.url, credentials });
    const url = await api.uploadBodyImage({ bytes: Buffer.from("IMAGE-BYTES"), fileName: "图片.png" });

    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/mock\/body-image-1\.png$/);
    const request = server.requestsFor("media/uploadimg")[0]!;
    assert.match(request.headers["content-type"] ?? "", /multipart\/form-data/);
    assert.deepEqual(request.fileNames, ["图片.png"]);
    assert.ok(request.text.includes("IMAGE-BYTES"), "图片字节必须真的发出去了");
  });

  test("uploadMaterial：封面走 material/add_material?type=image", async () => {
    const api = createWechatApi({ apiBase: server.url, credentials });
    const material = await api.uploadMaterial({ bytes: Buffer.from("COVER"), fileName: "cover.jpg" });

    assert.match(material.mediaId, /^MOCK_COVER_MEDIA_\d+$/);
    const request = server.requestsFor("material/add_material")[0]!;
    assert.equal(request.query.get("type"), "image");
    assert.deepEqual(request.fileNames, ["cover.jpg"]);
  });

  test("addDraft：undefined 字段不发送（微信不接受 null/undefined）", async () => {
    const api = createWechatApi({ apiBase: server.url, credentials });
    const mediaId = await api.addDraft({ title: "标题", content: "<p>正文</p>", thumb_media_id: "MID", author: undefined, digest: undefined });

    assert.match(mediaId, /^MOCK_DRAFT_MEDIA_\d+$/);
    const article = (server.requestsFor("draft/add")[0]!.json as { articles: Array<Record<string, unknown>> }).articles[0]!;
    assert.deepEqual(Object.keys(article).sort(), ["content", "thumb_media_id", "title"]);
    assert.equal("author" in article, false);
    assert.equal("digest" in article, false);
  });

  test("getDraft 与 draftCount 走只读接口", async () => {
    const api = createWechatApi({ apiBase: server.url, credentials });
    const mediaId = await api.addDraft({ title: "读回标题", content: "<p>x</p>" });

    const draft = await api.getDraft(mediaId);
    assert.equal((draft.news_item as Array<{ title: string }>)[0]!.title, "读回标题");
    assert.equal(await api.draftCount(), 1);
  });

  test("正文图片接口返回非法 URL → 报错", async () => {
    const api = createWechatApi({ apiBase: server.url, credentials });
    server.failOnce("media/uploadimg", { kind: "raw", status: 200, body: JSON.stringify({ url: "ftp://evil/x.png" }) });
    await assert.rejects(() => api.uploadBodyImage({ bytes: Buffer.from("x"), fileName: "a.png" }), /未返回合法 URL/);
  });

  test("永久素材接口没返回 media_id → 报错", async () => {
    const api = createWechatApi({ apiBase: server.url, credentials });
    server.failOnce("material/add_material", { kind: "raw", status: 200, body: JSON.stringify({}) });
    await assert.rejects(() => api.uploadMaterial({ bytes: Buffer.from("x"), fileName: "a.jpg" }), /未返回 media_id/);
  });
});

describe("wechatApi：错误分类", () => {
  let server: MockWechatServer;
  before(async () => {
    server = new MockWechatServer();
    await server.start();
  });
  after(async () => {
    await server.stop();
  });
  beforeEach(() => server.clearRequests());

  const cases: Array<{ errcode: number; expect: RegExp; errmsg?: string }> = [
    { errcode: 40164, expect: /IP 不在公众号白名单|IP白名单/, errmsg: "invalid ip 203.0.113.7, not in whitelist" },
    { errcode: 40125, expect: /AppSecret 无效/, errmsg: "invalid appsecret" },
    { errcode: 40013, expect: /AppID 无效/, errmsg: "invalid appid" },
    { errcode: 48001, expect: /接口权限/, errmsg: "api unauthorized" },
    { errcode: 45009, expect: /配额/, errmsg: "reach max api daily quota limit" },
    { errcode: 40007, expect: /素材 ID 无效/, errmsg: "invalid media_id" }
  ];

  for (const item of cases) {
    test(`errcode ${item.errcode} → 人话提示`, async () => {
      const api = createWechatApi({ apiBase: server.url, credentials });
      server.failOnce("draft/count", { kind: "errcode", errcode: item.errcode, errmsg: item.errmsg });

      await assert.rejects(
        () => api.draftCount(),
        (error: unknown) => {
          assert.ok(error instanceof WechatApiError);
          assert.equal(error.errcode, item.errcode);
          assert.equal(error.outcomeUnknown, false);
          assert.match(error.message, new RegExp(String(item.errcode)));
          assert.match(error.message, item.expect);
          return true;
        }
      );
    });
  }

  test("40164 会带上微信返回的 request_ip，便于用户直接加白名单", async () => {
    const api = createWechatApi({ apiBase: server.url, credentials });
    server.failOnce("draft/count", { kind: "errcode", errcode: 40164, errmsg: "invalid ip 203.0.113.7, not in whitelist" });

    await assert.rejects(() => api.draftCount(), (error: unknown) => {
      assert.match((error as Error).message, /request_ip=203\.0\.113\.7/);
      return true;
    });
  });

  test("48001 绝不能把用户带向「必须花 300 元认证」", async () => {
    const api = createWechatApi({ apiBase: server.url, credentials });
    server.failOnce("draft/add", { kind: "errcode", errcode: 48001, errmsg: "api unauthorized" });

    await assert.rejects(() => api.addDraft({ title: "t", content: "c" }), (error: unknown) => {
      const message = (error as Error).message;
      assert.ok(!/认证|300/.test(message), `提示里不应出现「认证」类说法：${message}`);
      return true;
    });
  });

  test("未知错误码也报 errcode，不做无根据的猜测", async () => {
    const api = createWechatApi({ apiBase: server.url, credentials });
    server.failOnce("draft/count", { kind: "errcode", errcode: 99999, errmsg: "unknown" });

    await assert.rejects(() => api.draftCount(), (error: unknown) => {
      assert.equal((error as WechatApiError).errcode, 99999);
      assert.match((error as Error).message, /99999/);
      assert.match((error as Error).message, /unknown/);
      return true;
    });
  });

  test("HTTP 500 且无 errcode → 用状态码报错", async () => {
    const api = createWechatApi({ apiBase: server.url, credentials });
    server.failOnce("draft/count", { kind: "raw", status: 502, body: "bad gateway", contentType: "text/html" });

    await assert.rejects(() => api.draftCount(), (error: unknown) => {
      assert.ok(error instanceof WechatApiError);
      assert.match((error as Error).message, /非 JSON 响应/);
      return true;
    });
  });

  test("错误信息里绝不出现 AppSecret", async () => {
    const api = createWechatApi({ apiBase: server.url, credentials });
    server.failOnce("stable_token", { kind: "errcode", errcode: 40125, errmsg: "invalid appsecret" });

    await assert.rejects(() => api.checkAccess(), (error: unknown) => {
      assert.ok(!(error as Error).message.includes(APP_SECRET));
      return true;
    });
  });
});

describe("wechatApi：结果未知（禁止自动重试）", () => {
  let server: MockWechatServer;
  before(async () => {
    server = new MockWechatServer();
    await server.start();
  });
  after(async () => {
    await server.stop();
  });
  beforeEach(() => server.clearRequests());

  test("连接被重置 → outcomeUnknown=true", async () => {
    const api = createWechatApi({ apiBase: server.url, credentials });
    server.failOnce("draft/add", { kind: "destroy" });

    await assert.rejects(() => api.addDraft({ title: "t", content: "c" }), (error: unknown) => {
      assert.ok(error instanceof WechatApiError);
      assert.equal(error.outcomeUnknown, true);
      assert.match(error.message, /结果未知/);
      return true;
    });
  });

  test("请求超时 → outcomeUnknown=true", async () => {
    const api = createWechatApi({ apiBase: server.url, credentials, timeoutMs: 150 });
    server.failOnce("draft/add", { kind: "hang" });

    await assert.rejects(() => api.addDraft({ title: "t", content: "c" }), (error: unknown) => {
      assert.equal((error as WechatApiError).outcomeUnknown, true);
      return true;
    });
  });

  test("addDraft 没返回 media_id → 结果未知，不能重试", async () => {
    const api = createWechatApi({ apiBase: server.url, credentials });
    server.failOnce("draft/add", { kind: "raw", status: 200, body: JSON.stringify({ errcode: 0 }) });

    await assert.rejects(() => api.addDraft({ title: "t", content: "c" }), (error: unknown) => {
      assert.equal((error as WechatApiError).outcomeUnknown, true);
      assert.match((error as Error).message, /草稿箱核对/);
      return true;
    });
  });
});

describe("wechatApi：凭证校验", () => {
  test("占位符未被平台替换 → 明确说是注入问题，而不是「AppID 无效」", () => {
    assert.throws(
      () => ensureCredentialShape({ appId: "${WECHAT_APP_ID}", appSecret: "real-secret" }),
      (error: unknown) => {
        assert.ok(error instanceof WechatApiError);
        assert.match((error as Error).message, /未被注入/);
        assert.ok(!/AppID 无效/.test((error as Error).message));
        return true;
      }
    );
    assert.throws(() => ensureCredentialShape({ appId: "wx1", appSecret: "${SECRET}" }), /未被注入/);
  });

  test("缺凭证 → 提示去连接器配置里填，且不要在聊天里发密钥", () => {
    assert.throws(() => ensureCredentialShape({ appId: "", appSecret: "" }), /缺少公众号凭证/);
    assert.throws(() => ensureCredentialShape({ appId: "wx1", appSecret: "" }), /缺少公众号凭证/);
    assert.throws(() => ensureCredentialShape({ appId: "   ", appSecret: "  " }), /缺少公众号凭证/);
  });

  test("宿主把凭证传成 undefined 也不崩，而是报缺凭证", () => {
    assert.throws(
      () => ensureCredentialShape({ appId: undefined, appSecret: undefined } as unknown as WechatCredentials),
      /缺少公众号凭证/
    );
  });

  test("checkAccess 会先校验凭证形状，不会白跑一次网络请求", async () => {
    const server = new MockWechatServer();
    await server.start();
    try {
      const api = createWechatApi({ apiBase: server.url, credentials: { appId: "  ", appSecret: "  " } });
      await assert.rejects(() => api.checkAccess(), /缺少公众号凭证/);
      assert.equal(server.requests.length, 0);
    } finally {
      await server.stop();
    }
  });

  test("readCredentialsFromEnv 去空白，不读取 .env", () => {
    assert.deepEqual(readCredentialsFromEnv({ WECHAT_APP_ID: " wx1 ", WECHAT_APP_SECRET: " s " } as NodeJS.ProcessEnv), {
      appId: "wx1",
      appSecret: "s"
    });
    assert.deepEqual(readCredentialsFromEnv({} as NodeJS.ProcessEnv), { appId: "", appSecret: "" });
  });
});
