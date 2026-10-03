/**
 * 测试夹具：临时目录 + 两种文章包布局。
 */
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/** 1x1 PNG（合法图片，便于断言字节真的被读到）。 */
export const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AF/9Y2zAAAAAElFTkSuQmCC",
  "base64"
);

/** 与 PNG_1X1 不同内容的第二张图，用于验证指纹对图片内容敏感。 */
export const PNG_OTHER = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mNk+M+ACzDhlR1VSAAAbwIB/8y3XQAAAABJRU5ErkJggg==",
  "base64"
);

export type TempDir = {
  path: string;
  cleanup: () => Promise<void>;
  /** 在该临时目录下创建一个子目录并返回其绝对路径。 */
  sub: (name: string) => Promise<string>;
};

export async function makeTempDir(prefix = "wdmcp-test-"): Promise<TempDir> {
  const base = process.env.WECHAT_DRAFT_TEST_TMP || tmpdir();
  await mkdir(base, { recursive: true });
  // macOS 上 /var 是指向 /private/var 的符号链接，而安全模块会对路径做 realpath。
  // 夹具自己也先取 realpath，断言才不会因「同一个目录的两种写法」而误判。
  const created = await realpath(await mkdtemp(path.join(base, prefix)));
  return {
    path: created,
    cleanup: async () => {
      await rm(created, { recursive: true, force: true });
    },
    sub: async (name: string) => {
      const target = path.join(created, name);
      await mkdir(target, { recursive: true });
      return target;
    }
  };
}

export type BundleSpec = {
  title?: string;
  author?: string;
  digest?: string;
  column?: string;
  /** 完整 HTML；给了它就不再用默认模板。 */
  html?: string;
  /** 插到默认模板 <body> 里的片段。 */
  bodyHtml?: string;
  /** 默认 article.html；设为 "content.html" 即本仓库布局。 */
  htmlFileName?: string;
  /** 写 metadata.json / meta.json；null 表示不写元数据文件。 */
  metaFileName?: string | null;
  /** 写 assets.json 的内容；undefined 表示不写。 */
  assetsJson?: unknown;
  cover?: { name: string; bytes: Buffer } | null;
  /** 相对路径 -> 内容。 */
  images?: Record<string, Buffer>;
  /** 正文里是否包含外链图与 data URI 图。 */
  includeRemoteAndDataImages?: boolean;
  bom?: boolean;
  crlf?: boolean;
};

const DEFAULT_BODY =
  '<p>这是一段正文。</p>\n<img src="images/fig1.png" alt="fig1">\n';

export async function writeBundle(dir: string, spec: BundleSpec = {}): Promise<string> {
  const htmlFileName = spec.htmlFileName ?? "article.html";
  const metaFileName = spec.metaFileName === undefined ? "metadata.json" : spec.metaFileName;
  const title = spec.title ?? "测试文章标题";
  const body = spec.bodyHtml ?? DEFAULT_BODY;

  let html =
    spec.html ??
    `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${title} - 页面标题</title>
</head>
<body>
<h1>${title}</h1>
${body}
${spec.includeRemoteAndDataImages ? '<img src="https://example.com/remote.png" alt="remote">\n<img src="data:image/png;base64,iVBORw0KGgo=" alt="inline">\n' : ""}
</body>
</html>`;

  if (spec.crlf) html = html.replace(/\n/g, "\r\n");
  if (spec.bom) html = `\uFEFF${html}`;
  await writeFile(path.join(dir, htmlFileName), html, "utf8");

  if (metaFileName) {
    const meta: Record<string, string> = {};
    if (spec.title !== undefined) meta.title = spec.title;
    if (spec.author !== undefined) meta.author = spec.author;
    if (spec.digest !== undefined) meta.digest = spec.digest;
    if (spec.column !== undefined) meta.column = spec.column;
    await writeFile(path.join(dir, metaFileName), JSON.stringify(meta, null, 2), "utf8");
  } else {
    // 元数据文件不存在时，标题从 <h1> 提取；这里保证默认 spec 下标题仍可解析。
  }

  const images = spec.images ?? { "images/fig1.png": PNG_1X1 };
  for (const [relative, bytes] of Object.entries(images)) {
    const target = path.join(dir, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }

  const cover = spec.cover === undefined ? { name: "cover.png", bytes: PNG_OTHER } : spec.cover;
  if (cover) {
    await writeFile(path.join(dir, cover.name), cover.bytes);
  }

  if (spec.assetsJson !== undefined) {
    await writeFile(path.join(dir, "assets.json"), JSON.stringify(spec.assetsJson, null, 2), "utf8");
  }

  return path.join(dir, htmlFileName);
}

/** 本仓库布局：content.html + meta.json + assets.json → assets/cover.jpg。 */
export async function writeRepoLayoutBundle(dir: string) {
  return writeBundle(dir, {
    htmlFileName: "content.html",
    metaFileName: "meta.json",
    title: "仓库布局文章",
    author: "老王",
    digest: "仓库布局摘要",
    cover: null,
    images: { "assets/fig1.png": PNG_1X1 },
    bodyHtml: '<p>仓库布局正文</p>\n<img src="assets/fig1.png" alt="fig">\n',
    assetsJson: { cover: { path: "assets/cover.jpg" } }
  }).then(async (htmlPath) => {
    await mkdir(path.join(dir, "assets"), { recursive: true });
    await writeFile(path.join(dir, "assets", "cover.jpg"), PNG_OTHER);
    return htmlPath;
  });
}

/** 在文章包内造一个指向包外的符号链接，用于验证 symlink 逃逸被拒。 */
export async function symlinkInside(dir: string, relative: string, target: string): Promise<string> {
  const linkPath = path.join(dir, relative);
  await mkdir(path.dirname(linkPath), { recursive: true });
  await symlink(target, linkPath);
  return linkPath;
}
