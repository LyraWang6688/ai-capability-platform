/**
 * 文章包解析。
 *
 * 输入：一个目录（或指向 HTML 的绝对路径）；输出：一份可直接送微信的规范化文章。
 *
 * 兼容两种布局：
 *   通用布局：article.html + metadata.json + cover.png + images/
 *   本仓库布局：content.html + meta.json + assets.json + assets/cover.jpg
 * 两者用同一套发现顺序，模型不需要知道我们内部约定。
 *
 * 关键约束：哈希必须基于**改写图片 src 之前**的原始内容，否则第一次上传后
 * 重算哈希就变了，幂等会失效。
 */
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { PathNotAllowedError, resolveInsideBundle, resolveSafePath } from "./security.js";

export type BodyImage = {
  /** HTML 里原始的 src 字面量 */
  src: string;
  absolutePath: string;
  fileName: string;
  bytes: Buffer;
};

export type ArticleBundle = {
  dir: string;
  htmlPath: string;
  metaPath?: string;
  metaSources: Record<string, string>;
  title: string;
  author?: string;
  digest?: string;
  column?: string;
  /** 已剥离文档骨架、未改写图片 src 的正文 */
  contentHtml: string;
  bodyImages: BodyImage[];
  remoteImages: string[];
  dataUriCount: number;
  cover?: { source: string; fileName: string; bytes: Buffer };
  /** 幂等键：内容 + 元数据 + 封面 + 正文图片全部参与 */
  hash: string;
  stats: { chars: number; bytes: number };
  warnings: string[];
  blockingIssues: string[];
};

const HTML_CANDIDATES = ["article.html", "content.html", "wechat.html", "index.html", "正文.html", "文章.html"];
const META_CANDIDATES = ["metadata.json", "meta.json"];
const ASSETS_CANDIDATES = ["assets.json"];
const COVER_BASENAMES = ["cover", "封面", "thumb", "thumbnail", "banner", "头图"];
const COVER_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"];
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"]);

/** 微信 draft/add 的字段上限。默认取宽松值，真失败交给微信报错，避免用错的限制拦掉合法内容。 */
export const LIMITS = {
  titleChars: Number(process.env.WECHAT_TITLE_MAX_CHARS || 64),
  authorChars: Number(process.env.WECHAT_AUTHOR_MAX_CHARS || 16),
  digestChars: Number(process.env.WECHAT_DIGEST_MAX_CHARS || 120),
  contentChars: Number(process.env.WECHAT_CONTENT_MAX_CHARS || 20000),
  contentBytes: Number(process.env.WECHAT_CONTENT_MAX_BYTES || 1024 * 1024)
};

export async function loadArticleBundle(
  inputPath: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<ArticleBundle> {
  const resolved = await resolveSafePath(inputPath, env);
  const info = await stat(resolved);
  const warnings: string[] = [];
  const blockingIssues: string[] = [];

  let dir: string;
  let htmlPath: string;
  if (info.isDirectory()) {
    dir = resolved;
    htmlPath = await discoverFile(dir, HTML_CANDIDATES, [".html", ".htm"]);
  } else {
    dir = path.dirname(resolved);
    htmlPath = resolved;
  }

  const rawHtml = await readFile(htmlPath, "utf8");
  const normalizedHtml = normalizeText(rawHtml);
  const contentHtml = stripDocumentShell(normalizedHtml);

  const metaResult = await readMetadata(dir);
  const assets = await readAssets(dir);
  const extracted = extractFromHtml(normalizedHtml);
  const meta = mergeMeta({ file: metaResult.data, extracted, env });
  for (const [key, source] of Object.entries(metaResult.sources)) {
    meta.sources[key] = source;
  }

  const bodyImages = await collectBodyImages(contentHtml, dir, warnings);
  const remoteImages = collectRemoteImages(contentHtml);
  const dataUriCount = (contentHtml.match(/<img\b[^>]*\bsrc\s*=\s*["']data:/gi) || []).length;

  const cover = await discoverCover({ dir, assets, bodyImages, html: normalizedHtml, warnings });

  const stats = { chars: [...contentHtml].length, bytes: Buffer.byteLength(contentHtml, "utf8") };

  if (!meta.values.title) blockingIssues.push("缺少标题：请提供 metadata.json / meta.json 的 title，或 HTML 里的 <h1>。");
  if (stats.chars >= LIMITS.contentChars) {
    blockingIssues.push(`正文 ${stats.chars} 字符，达到上限 ${LIMITS.contentChars} 字符。`);
  }
  if (stats.bytes >= LIMITS.contentBytes) {
    blockingIssues.push(`正文 ${stats.bytes} 字节，达到上限 ${LIMITS.contentBytes} 字节。`);
  }
  if (!cover) blockingIssues.push("缺少封面：微信强制要求 thumb_media_id。请放 cover.png/jpg 或在 assets.json 指定 cover.path。");

  const hash = computeBundleHash({ contentHtml, meta: meta.values, cover, bodyImages });

  return {
    dir,
    htmlPath,
    metaPath: metaResult.path,
    metaSources: meta.sources,
    title: meta.values.title,
    author: meta.values.author,
    digest: meta.values.digest,
    column: meta.values.column,
    contentHtml,
    bodyImages,
    remoteImages,
    dataUriCount,
    cover,
    hash,
    stats,
    warnings,
    blockingIssues
  };
}

/** 归一化：去 BOM、CRLF→LF。跨机器/跨编辑器的差异不应影响内容哈希。 */
export function normalizeText(input: string): string {
  return input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

/** 微信 draft/add 只接受正文片段，不接受文档骨架。 */
export function stripDocumentShell(html: string): string {
  let out = html.replace(/<!DOCTYPE[^>]*>/gi, "");
  const body = out.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  if (body) {
    out = body[1];
  } else {
    out = out.replace(/<\/?html\b[^>]*>/gi, "").replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, "");
  }
  return out
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
}

async function discoverFile(dir: string, preferred: string[], extensions: string[]): Promise<string> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    throw new PathNotAllowedError("BUNDLE_UNREADABLE", "无法读取该文章包目录。");
  }
  for (const name of preferred) {
    if (entries.includes(name)) return path.join(dir, name);
  }
  const lower = new Map(entries.map((e) => [e.toLowerCase(), e]));
  for (const name of preferred) {
    const hit = lower.get(name.toLowerCase());
    if (hit) return path.join(dir, hit);
  }
  for (const name of entries) {
    if (extensions.includes(path.extname(name).toLowerCase())) return path.join(dir, name);
  }
  throw new PathNotAllowedError(
    "BUNDLE_NO_HTML",
    `该目录下找不到正文 HTML（已找过 ${preferred.join(" / ")} 和任意 .html 文件）。`
  );
}

async function readMetadata(dir: string): Promise<{ path?: string; data: Record<string, unknown>; sources: Record<string, string> }> {
  const sources: Record<string, string> = {};
  for (const name of META_CANDIDATES) {
    const candidate = path.join(dir, name);
    try {
      const parsed = JSON.parse(normalizeText(await readFile(candidate, "utf8"))) as Record<string, unknown>;
      for (const key of ["title", "author", "digest", "column"]) {
        if (typeof parsed[key] === "string" && (parsed[key] as string).trim()) {
          sources[key] = name;
        }
      }
      return { path: candidate, data: parsed, sources };
    } catch {
      continue;
    }
  }
  return { data: {}, sources };
}

async function readAssets(dir: string): Promise<Record<string, unknown>> {
  for (const name of ASSETS_CANDIDATES) {
    try {
      return JSON.parse(normalizeText(await readFile(path.join(dir, name), "utf8"))) as Record<string, unknown>;
    } catch {
      continue;
    }
  }
  return {};
}

function extractFromHtml(html: string) {
  const pick = (patterns: RegExp[]) => {
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) {
        const text = decodeEntities(stripTags(match[1])).trim();
        if (text) return { text, pattern: pattern.source };
      }
    }
    return undefined;
  };
  return {
    title: pick([/<meta[^>]+name=["']wechat:title["'][^>]+content=["']([^"']+)["']/i, /<h1\b[^>]*>([\s\S]*?)<\/h1>/i, /<title\b[^>]*>([\s\S]*?)<\/title>/i]),
    author: pick([/<meta[^>]+name=["']wechat:author["'][^>]+content=["']([^"']+)["']/i, /<meta[^>]+name=["']author["'][^>]+content=["']([^"']+)["']/i]),
    digest: pick([/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i])
  };
}

function mergeMeta(input: {
  file: Record<string, unknown>;
  extracted: ReturnType<typeof extractFromHtml>;
  env: NodeJS.ProcessEnv;
}) {
  const values: { title: string; author?: string; digest?: string; column?: string } = { title: "" };
  const sources: Record<string, string> = {};

  const fileTitle = asString(input.file.title);
  const fileAuthor = asString(input.file.author);
  const fileDigest = asString(input.file.digest);
  const fileColumn = asString(input.file.column);

  values.title = fileTitle || input.extracted.title?.text || "";
  values.author = fileAuthor || input.extracted.author?.text || asString(input.env.WECHAT_DEFAULT_AUTHOR);
  values.digest = fileDigest || input.extracted.digest?.text;
  values.column = fileColumn;

  if (!fileTitle && input.extracted.title) sources.title = "HTML";
  if (!fileAuthor && input.extracted.author) sources.author = "HTML";
  if (!fileDigest && input.extracted.digest) sources.digest = "HTML";
  if (!values.author && input.env.WECHAT_DEFAULT_AUTHOR) sources.author = "WECHAT_DEFAULT_AUTHOR";

  if (values.digest && [...values.digest].length > LIMITS.digestChars) {
    values.digest = [...values.digest].slice(0, LIMITS.digestChars).join("");
    sources.digest = `${sources.digest || "来源"}（已截断到 ${LIMITS.digestChars} 字）`;
  }

  return { values, sources };
}

const IMG_TAG = /<img\b[^>]*>/gi;
const SRC_ATTR = /\bsrc\s*=\s*["']([^"']+)["']/i;

async function collectBodyImages(contentHtml: string, dir: string, warnings: string[]): Promise<BodyImage[]> {
  const seen = new Map<string, BodyImage>();
  for (const tag of contentHtml.match(IMG_TAG) || []) {
    const src = tag.match(SRC_ATTR)?.[1]?.trim();
    if (!src) {
      if (/\bdata-src\s*=/i.test(tag)) {
        warnings.push("发现 <img data-src=...>：微信不渲染懒加载属性，该图不会显示，请改用 src。");
      }
      continue;
    }
    if (/^(https?:)?\/\//i.test(src) || /^data:/i.test(src)) continue;
    if (seen.has(src)) continue;

    let absolute: string;
    try {
      absolute = await resolveInsideBundle(await realDir(dir), src.split("?")[0]);
    } catch {
      warnings.push(`正文图片未找到，已跳过：${src}`);
      continue;
    }
    try {
      const bytes = await readFile(absolute);
      if (bytes.length === 0) {
        warnings.push(`正文图片为空，已跳过：${src}`);
        continue;
      }
      seen.set(src, { src, absolutePath: absolute, fileName: path.basename(absolute), bytes });
    } catch {
      warnings.push(`正文图片不可读，已跳过：${src}`);
    }
  }
  return [...seen.values()];
}

function collectRemoteImages(contentHtml: string): string[] {
  const out: string[] = [];
  for (const tag of contentHtml.match(IMG_TAG) || []) {
    const src = tag.match(SRC_ATTR)?.[1]?.trim();
    if (src && /^(https?:)?\/\//i.test(src) && !out.includes(src)) out.push(src);
  }
  return out;
}

async function discoverCover(input: {
  dir: string;
  assets: Record<string, unknown>;
  bodyImages: BodyImage[];
  html: string;
  warnings: string[];
}): Promise<ArticleBundle["cover"]> {
  // 1) assets.json 显式指定（本仓库约定）
  const assetsCover = (input.assets.cover as { path?: unknown } | undefined)?.path;
  if (typeof assetsCover === "string" && assetsCover.trim()) {
    try {
      const absolute = await resolveInsideBundle(await realDir(input.dir), assetsCover.trim());
      const bytes = await readFile(absolute);
      return { source: assetsCover.trim(), fileName: path.basename(absolute), bytes };
    } catch {
      input.warnings.push(`assets.json 指定的封面不可读：${assetsCover}`);
    }
  }

  // 2) 目录下 cover/封面/thumb + 图片扩展名
  let entries: string[] = [];
  try {
    entries = await readdir(input.dir);
  } catch {
    entries = [];
  }
  const normalized = entries.map((name) => ({ name, lower: name.toLowerCase() }));
  for (const base of COVER_BASENAMES) {
    const hit = normalized.find(
      (e) =>
        e.lower.startsWith(base.toLowerCase()) && COVER_EXTENSIONS.includes(path.extname(e.lower))
    );
    if (hit) {
      const absolute = path.join(input.dir, hit.name);
      return { source: hit.name, fileName: hit.name, bytes: await readFile(absolute) };
    }
  }

  // 3) <meta name="wechat:cover" content="...">
  const declared = input.html.match(/<meta[^>]+name=["']wechat:cover["'][^>]+content=["']([^"']+)["']/i)?.[1];
  if (declared) {
    try {
      const absolute = await resolveInsideBundle(await realDir(input.dir), declared.trim());
      return { source: declared.trim(), fileName: path.basename(absolute), bytes: await readFile(absolute) };
    } catch {
      input.warnings.push(`HTML 声明的封面不可读：${declared}`);
    }
  }

  // 4) 正文第一张本地图兜底
  const first = input.bodyImages[0];
  if (first) {
    input.warnings.push("未找到专用封面，已用正文第一张本地图片兜底；建议显式提供 cover.png。");
    return { source: first.src, fileName: first.fileName, bytes: first.bytes };
  }

  return undefined;
}

async function realDir(dir: string): Promise<string> {
  return dir;
}

/**
 * 幂等键。必须覆盖：正文（原始，未改写 src）+ 元数据 + 封面内容 + 正文图片内容。
 * 只哈希正文会漏掉「换了封面但正文没动」，那样会静默判成同一篇。
 */
function computeBundleHash(input: {
  contentHtml: string;
  meta: { title: string; author?: string; digest?: string; column?: string };
  cover?: ArticleBundle["cover"];
  bodyImages: BodyImage[];
}): string {
  const hash = createHash("sha256");
  hash.update("v1\n");
  hash.update(input.contentHtml);
  hash.update("\n--meta--\n");
  hash.update(JSON.stringify([input.meta.title, input.meta.author || "", input.meta.digest || "", input.meta.column || ""]));
  hash.update("\n--cover--\n");
  hash.update(input.cover ? createHash("sha256").update(input.cover.bytes).digest("hex") : "none");
  hash.update("\n--images--\n");
  for (const image of [...input.bodyImages].sort((a, b) => a.src.localeCompare(b.src))) {
    hash.update(image.src);
    hash.update(createHash("sha256").update(image.bytes).digest("hex"));
  }
  return hash.digest("hex");
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

export { IMAGE_EXTENSIONS };
