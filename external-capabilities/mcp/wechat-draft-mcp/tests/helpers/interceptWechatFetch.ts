/**
 * 测试专用：进程级 fetch 拦截器（由被测子进程通过 `node --import` 预加载）。
 *
 * 为什么需要它：
 *   MCP 服务是独立子进程，而 `createWechatApi` 的 apiBase 只能通过代码注入
 *   （有意为之：产品不提供"改接口地址"的环境变量，避免把凭据引到别的主机）。
 *   于是"子进程里的完整上传链路"没法指向本地 mock —— 这里把 `globalThis.fetch`
 *   换掉：凡是发往 api.weixin.qq.com 的请求，改送到 WECHAT_DRAFT_TEST_MOCK_URL
 *   指定的本地 mock 服务器。
 *
 * 安全边界：
 *   本文件只在测试里被 `--import` 加载，**不属于发布产物**（package.json 的
 *   `files` 白名单不含 tests/）。产品代码不读任何"改接口地址"的环境变量。
 *   缺少 WECHAT_DRAFT_TEST_MOCK_URL 时直接抛错终止进程 —— 宁可测试失败，
 *   也绝不能因为配置漏了而打到真微信。
 */
const mockBase = process.env.WECHAT_DRAFT_TEST_MOCK_URL;
if (!mockBase) {
  throw new Error(
    "拦截器必须配合 WECHAT_DRAFT_TEST_MOCK_URL 使用：缺少它就有打到真实微信的风险。"
  );
}

const REAL_HOST = "api.weixin.qq.com";
const base = new URL(mockBase);
const realFetch = globalThis.fetch.bind(globalThis);

globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const href =
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(href);
  if (url.host === REAL_HOST) {
    return realFetch(new URL(url.pathname + url.search, base), init);
  }
  return realFetch(input as RequestInfo, init);
}) as typeof fetch;
