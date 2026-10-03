/**
 * 发布编排：把「文章包」变成「微信公众号草稿」。
 *
 * 安全不变量（与 Publisher 通道同一套语义，实现独立）：
 *   1. 第一次微信副作用之前，必须先落盘 `creating`
 *   2. 落盘 `creating` 之后的任何异常/超时 —— 结果未知，保持 creating，禁止自动重试
 *   3. 同一内容重复调用 —— 读回既有草稿，不重复创建
 *   4. 单篇互斥：锁被占用即拒绝，绝不并发创建
 */
import { loadArticleBundle, LIMITS, type ArticleBundle } from "./articleBundle.js";
import {
  DeliveryLockedError,
  DeliveryOutcomeUnknownError,
  readDeliveryState,
  stateFile,
  withDeliveryLock,
  writeDeliveryState
} from "./deliveryState.js";
import { createWechatApi, readCredentialsFromEnv, type WechatApi, type WechatCredentials } from "./wechatApi.js";

export type PublishOptions = {
  bundlePath: string;
  credentials?: WechatCredentials;
  env?: NodeJS.ProcessEnv;
  /** 注入点：测试传替身，生产不传。 */
  api?: WechatApi;
  needOpenComment?: boolean;
  onlyFansCanComment?: boolean;
};

export type PublishResult = {
  ok: true;
  reused: boolean;
  mediaId: string;
  title: string;
  author?: string;
  digest?: string;
  verified: boolean;
  content: { chars: number; bytes: number };
  images: {
    uploaded: Array<{ src: string; url: string }>;
    skippedRemote: string[];
    skippedDataUri: number;
  };
  cover: { source: string; mediaId: string };
  warnings: string[];
  message: string;
};

export function summarizeBundle(bundle: ArticleBundle) {
  return {
    dir: bundle.dir,
    htmlFile: bundle.htmlPath.split("/").pop(),
    metaFile: bundle.metaPath ? bundle.metaPath.split("/").pop() : null,
    title: bundle.title,
    author: bundle.author ?? null,
    digest: bundle.digest ?? null,
    column: bundle.column ?? null,
    metaSources: bundle.metaSources,
    content: {
      chars: bundle.stats.chars,
      bytes: bundle.stats.bytes,
      limitChars: LIMITS.contentChars,
      limitBytes: LIMITS.contentBytes
    },
    bodyImages: bundle.bodyImages.map((image) => image.src),
    remoteImages: bundle.remoteImages,
    dataUriImages: bundle.dataUriCount,
    cover: bundle.cover ? { source: bundle.cover.source, bytes: bundle.cover.bytes.length } : null,
    bundleHash: bundle.hash,
    warnings: bundle.warnings,
    blockingIssues: bundle.blockingIssues
  };
}

/** 只读预检：完全不调用微信，不落盘。 */
export async function inspectArticleBundle(bundlePath: string, env: NodeJS.ProcessEnv = process.env) {
  const bundle = await loadArticleBundle(bundlePath, env);
  return { ...summarizeBundle(bundle), ready: bundle.blockingIssues.length === 0 };
}

export async function publishArticleBundle(options: PublishOptions): Promise<PublishResult> {
  const env = options.env ?? process.env;
  const credentials = options.credentials ?? readCredentialsFromEnv(env);
  const bundle = await loadArticleBundle(options.bundlePath, env);

  if (bundle.blockingIssues.length > 0) {
    throw new Error(`文章不满足微信草稿要求：${bundle.blockingIssues.join("；")}`);
  }

  const api = options.api ?? createWechatApi({ credentials });
  const file = stateFile(credentials.appId, bundle.hash, env);

  return withDeliveryLock(file, async () => {
    const saved = await readDeliveryState(file);

    // 幂等重放：同一账号 + 同一内容，直接读回既有草稿，绝不重复创建。
    if (saved?.status === "created" && saved.mediaId) {
      const verified = await verifyDraft(api, saved.mediaId, bundle.title);
      return {
        ok: true as const,
        reused: true,
        mediaId: saved.mediaId,
        title: bundle.title,
        author: bundle.author,
        digest: bundle.digest,
        verified,
        content: { chars: bundle.stats.chars, bytes: bundle.stats.bytes },
        images: { uploaded: [], skippedRemote: bundle.remoteImages, skippedDataUri: bundle.dataUriCount },
        cover: { source: bundle.cover?.source ?? "", mediaId: "" },
        warnings: bundle.warnings,
        message: verified
          ? "该文章此前已上传过，已返回既有草稿，未重复创建。"
          : "该文章此前已上传过，返回既有草稿 ID，但读回核验未通过，请到公众号后台确认。"
      };
    }

    // 结果未知：上次创建中断，草稿可能已经存在，禁止自动重试。
    if (saved?.status === "creating") {
      throw new DeliveryOutcomeUnknownError(
        "这篇文章上一次的上传结果未知（可能已经创建了草稿）。请先到公众号草稿箱核对，" +
          "确认后再手动删除状态文件重试：" +
          file
      );
    }

    await api.checkAccess();

    // ★ 关键：第一次微信副作用之前先落盘 creating。
    //   此后无论发生什么，下一次调用都会看到 creating 并拒绝重试，由人工核对。
    await writeDeliveryState(file, {
      status: "creating",
      title: bundle.title,
      updatedAt: new Date().toISOString()
    });

    const uploaded: Array<{ src: string; url: string }> = [];
    let html = bundle.contentHtml;

    // 正文图片走 media/uploadimg（不占素材库配额），并把 src 换成微信 URL。
    for (const image of bundle.bodyImages) {
      const url = await api.uploadBodyImage({ bytes: image.bytes, fileName: image.fileName });
      html = rewriteImageSrc(html, image.src, url);
      uploaded.push({ src: image.src, url });
    }

    // 封面必须走永久素材，thumb_media_id 只接受永久素材。
    if (!bundle.cover) {
      throw new Error("缺少封面，无法创建草稿。");
    }
    const cover = await api.uploadMaterial({ bytes: bundle.cover.bytes, fileName: bundle.cover.fileName });

    const chars = [...html].length;
    const bytes = Buffer.byteLength(html, "utf8");
    if (chars >= LIMITS.contentChars || bytes >= LIMITS.contentBytes) {
      throw new Error(
        `替换图片地址后正文超限（${chars} 字符 / ${bytes} 字节，上限 ${LIMITS.contentChars} 字符 / ${LIMITS.contentBytes} 字节）。`
      );
    }

    const mediaId = await api.addDraft({
      article_type: "news",
      title: bundle.title,
      author: bundle.author,
      digest: bundle.digest,
      content: html,
      thumb_media_id: cover.mediaId,
      need_open_comment: options.needOpenComment ? 1 : 0,
      only_fans_can_comment: options.onlyFansCanComment ? 1 : 0
    });

    await writeDeliveryState(file, {
      status: "created",
      title: bundle.title,
      mediaId,
      imageCount: uploaded.length,
      updatedAt: new Date().toISOString()
    });

    const verified = await verifyDraft(api, mediaId, bundle.title);

    return {
      ok: true as const,
      reused: false,
      mediaId,
      title: bundle.title,
      author: bundle.author,
      digest: bundle.digest,
      verified,
      content: { chars, bytes },
      images: { uploaded, skippedRemote: bundle.remoteImages, skippedDataUri: bundle.dataUriCount },
      cover: { source: bundle.cover.source, mediaId: cover.mediaId },
      warnings: [...bundle.warnings, ...remoteImageWarnings(bundle)],
      message: verified
        ? "已创建微信公众号草稿并读回核验通过。"
        : "草稿已创建，但读回核验未通过，请到公众号后台人工检查。"
    };
  });
}

/** 只替换指定 src 属性值，不动其他内容。 */
export function rewriteImageSrc(html: string, from: string, to: string): string {
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return html.replace(new RegExp(`((?:^|\\s)src\\s*=\\s*)(["'])${escaped}\\2`, "gi"), `$1$2${to}$2`);
}

async function verifyDraft(api: WechatApi, mediaId: string, expectedTitle: string): Promise<boolean> {
  try {
    const draft = (await api.getDraft(mediaId)) as { news_item?: Array<{ title?: string }> };
    return draft.news_item?.[0]?.title === expectedTitle;
  } catch {
    return false;
  }
}

function remoteImageWarnings(bundle: ArticleBundle): string[] {
  if (bundle.remoteImages.length === 0) return [];
  return [
    `正文有 ${bundle.remoteImages.length} 张外链图片未处理。微信会过滤外部图片 URL，草稿里这些图可能不显示；` +
      `请把图片下载到文章包内改用本地路径。`
  ];
}

export { DeliveryLockedError, DeliveryOutcomeUnknownError };
