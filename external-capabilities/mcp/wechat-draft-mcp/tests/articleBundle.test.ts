/**
 * 文章包解析 + 内容指纹。
 *
 * 指纹稳定性是幂等的根基：指纹必须基于改写图片 src 之前的原始内容，
 * 且只对「真正影响草稿」的东西敏感（正文/元数据/封面/插图内容），
 * 对换行符、BOM、mtime 这类噪声不敏感。
 */
import assert from "node:assert/strict";
import { utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { loadArticleBundle, normalizeText, stripDocumentShell } from "../src/articleBundle.js";
import { PathNotAllowedError } from "../src/security.js";
import { PNG_1X1, PNG_OTHER, makeTempDir, writeBundle, writeRepoLayoutBundle, type TempDir } from "./helpers/fixtures.js";

describe("articleBundle：解析", () => {
  let temp: TempDir;
  before(async () => {
    temp = await makeTempDir("wdmcp-bundle-");
  });
  after(async () => {
    await temp.cleanup();
  });

  test("通用布局：article.html + metadata.json + cover.png + images/", async () => {
    const dir = await temp.sub("generic");
    await writeBundle(dir, { title: "通用标题", author: "作者A", digest: "摘要A", column: "专栏A" });

    const bundle = await loadArticleBundle(dir);

    assert.equal(bundle.title, "通用标题");
    assert.equal(bundle.author, "作者A");
    assert.equal(bundle.digest, "摘要A");
    assert.equal(bundle.column, "专栏A");
    assert.equal(bundle.htmlPath, path.join(dir, "article.html"));
    assert.equal(bundle.metaPath, path.join(dir, "metadata.json"));
    assert.equal(bundle.metaSources.title, "metadata.json");
    assert.equal(bundle.bodyImages.length, 1);
    assert.equal(bundle.bodyImages[0]!.src, "images/fig1.png");
    assert.ok(bundle.bodyImages[0]!.bytes.equals(PNG_1X1));
    assert.equal(bundle.cover?.source, "cover.png");
    assert.ok(bundle.cover!.bytes.equals(PNG_OTHER));
    assert.deepEqual(bundle.blockingIssues, []);
    // 文档骨架必须被剥掉，微信只接受正文片段。
    assert.ok(!/<html|<body|<head|<script/i.test(bundle.contentHtml));
    assert.ok(bundle.contentHtml.startsWith("<h1>"));
  });

  test("本仓库布局：content.html + meta.json + assets.json 指定封面", async () => {
    const dir = await temp.sub("repo");
    await writeRepoLayoutBundle(dir);

    const bundle = await loadArticleBundle(dir);

    assert.equal(path.basename(bundle.htmlPath), "content.html");
    assert.equal(path.basename(bundle.metaPath!), "meta.json");
    assert.equal(bundle.title, "仓库布局文章");
    assert.equal(bundle.author, "老王");
    assert.equal(bundle.cover?.source, "assets/cover.jpg");
    assert.ok(bundle.cover!.bytes.equals(PNG_OTHER));
    assert.equal(bundle.bodyImages.length, 1);
    assert.deepEqual(bundle.blockingIssues, []);
  });

  test("直接传 HTML 文件路径：以父目录为文章包", async () => {
    const dir = await temp.sub("htmlfile");
    const htmlPath = await writeBundle(dir, { title: "单文件标题" });

    const bundle = await loadArticleBundle(htmlPath);

    assert.equal(bundle.dir, dir);
    assert.equal(bundle.title, "单文件标题");
    assert.equal(bundle.cover?.source, "cover.png");
  });

  test("元数据优先级：文件 > HTML 提取 > env 默认作者", async () => {
    const dir = await temp.sub("meta-priority");
    await writeBundle(dir, {
      metaFileName: null,
      title: "来自H1",
      bodyHtml: '<p>正文</p>\n<img src="images/fig1.png">\n',
      html: `<!DOCTYPE html><html><head>
<meta charset="utf-8">
<meta name="wechat:title" content="来自meta标签">
<meta name="author" content="来自author标签">
<meta name="description" content="来自description标签">
<title>页面标题</title>
</head><body><h1>来自H1</h1><p>正文</p><img src="images/fig1.png"></body></html>`
    });

    const bundle = await loadArticleBundle(dir, { WECHAT_DEFAULT_AUTHOR: "默认作者" } as NodeJS.ProcessEnv);

    assert.equal(bundle.title, "来自meta标签");
    assert.equal(bundle.author, "来自author标签");
    assert.equal(bundle.digest, "来自description标签");
    assert.equal(bundle.metaSources.title, "HTML");

    const noAuthorDir = await temp.sub("meta-default-author");
    await writeBundle(noAuthorDir, { title: "无作者", metaFileName: null });
    const noAuthor = await loadArticleBundle(noAuthorDir, { WECHAT_DEFAULT_AUTHOR: "默认作者" } as NodeJS.ProcessEnv);
    assert.equal(noAuthor.author, "默认作者");
    assert.equal(noAuthor.metaSources.author, "WECHAT_DEFAULT_AUTHOR");
  });

  test("摘要超长自动截断到上限", async () => {
    const dir = await temp.sub("digest-long");
    await writeBundle(dir, { title: "长摘要", digest: "摘".repeat(200) });

    const bundle = await loadArticleBundle(dir);

    assert.equal([...bundle.digest!].length, 120);
    assert.match(bundle.metaSources.digest!, /已截断/);
  });

  test("CRLF 与 BOM 不影响解析结果", async () => {
    const plainDir = await temp.sub("plain");
    await writeBundle(plainDir, { title: "换行", author: "作者A" });
    const crlfDir = await temp.sub("crlf");
    await writeBundle(crlfDir, { title: "换行", author: "作者A", crlf: true, bom: true });

    const plain = await loadArticleBundle(plainDir);
    const crlf = await loadArticleBundle(crlfDir);

    assert.equal(plain.hash, crlf.hash);
    assert.equal(plain.contentHtml, crlf.contentHtml);
    assert.equal(normalizeText("\uFEFFa\r\nb\rc"), "a\nb\nc");
  });

  test("stripDocumentShell：去 DOCTYPE/head/script/style/注释", () => {
    const out = stripDocumentShell(
      '<!DOCTYPE html><html><head><style>p{color:red}</style><script>alert(1)</script></head><body><!--c--><p>hi</p></body></html>'
    );
    assert.equal(out, "<p>hi</p>");
  });

  test("外链图片只警告不下载；data URI 只计数", async () => {
    const dir = await temp.sub("remote");
    await writeBundle(dir, { title: "外链", includeRemoteAndDataImages: true });

    const bundle = await loadArticleBundle(dir);

    assert.deepEqual(bundle.remoteImages, ["https://example.com/remote.png"]);
    assert.equal(bundle.dataUriCount, 1);
    assert.equal(bundle.bodyImages.length, 1);
    assert.ok(bundle.bodyImages.every((image) => !image.src.startsWith("http")));
  });

  test("正文图缺失 / 为空 / data-src 懒加载 → 只警告不阻塞", async () => {
    const dir = await temp.sub("bad-images");
    await writeBundle(dir, {
      title: "坏图",
      images: { "images/empty.png": Buffer.alloc(0) },
      bodyHtml:
        '<img src="images/missing.png">\n<img src="images/empty.png">\n<img data-src="images/lazy.png">\n'
    });

    const bundle = await loadArticleBundle(dir);

    assert.equal(bundle.bodyImages.length, 0);
    assert.deepEqual(bundle.blockingIssues, []);
    assert.ok(bundle.warnings.some((w) => w.includes("images/missing.png")));
    assert.ok(bundle.warnings.some((w) => w.includes("images/empty.png")));
    assert.ok(bundle.warnings.some((w) => w.includes("data-src")));
  });

  test("无专用封面时用正文第一张本地图兜底并告警", async () => {
    const dir = await temp.sub("cover-fallback");
    await writeBundle(dir, { title: "兜底封面", cover: null });

    const bundle = await loadArticleBundle(dir);

    assert.equal(bundle.cover?.source, "images/fig1.png");
    assert.ok(bundle.warnings.some((w) => w.includes("兜底")));
  });

  test("阻塞问题：缺标题、缺封面、正文超限", async () => {
    const noTitle = await temp.sub("no-title");
    await writeBundle(noTitle, { title: "占位", metaFileName: null, html: "<html><body><p>没有标题</p></body></html>" });
    const noTitleBundle = await loadArticleBundle(noTitle);
    assert.ok(noTitleBundle.blockingIssues.some((issue) => issue.includes("缺少标题")));

    const noCover = await temp.sub("no-cover");
    await writeBundle(noCover, { title: "无封面", cover: null, images: {} });
    const noCoverBundle = await loadArticleBundle(noCover);
    assert.ok(noCoverBundle.blockingIssues.some((issue) => issue.includes("缺少封面")));

    const tooLong = await temp.sub("too-long");
    await writeBundle(tooLong, { title: "超长", bodyHtml: `<p>${"字".repeat(20_100)}</p>` });
    const tooLongBundle = await loadArticleBundle(tooLong);
    assert.ok(tooLongBundle.blockingIssues.some((issue) => issue.includes("字符")));
  });
});

describe("articleBundle：内容指纹", () => {
  let temp: TempDir;
  before(async () => {
    temp = await makeTempDir("wdmcp-hash-");
  });
  after(async () => {
    await temp.cleanup();
  });

  test("同一内容重复加载指纹稳定（幂等的前提）", async () => {
    const dir = await temp.sub("stable");
    await writeBundle(dir, { title: "稳定", author: "A", digest: "D" });

    const first = await loadArticleBundle(dir);
    const second = await loadArticleBundle(dir);

    assert.equal(first.hash, second.hash);
    assert.match(first.hash, /^[0-9a-f]{64}$/);
  });

  test("mtime 变化不影响指纹", async () => {
    const dir = await temp.sub("mtime");
    const htmlPath = await writeBundle(dir, { title: "改时间" });
    const before_ = await loadArticleBundle(dir);

    const past = new Date(Date.now() - 86_400_000);
    await utimes(htmlPath, past, past);

    const after_ = await loadArticleBundle(dir);
    assert.equal(before_.hash, after_.hash);
  });

  test("正文、元数据、封面内容、插图内容任一变化都会改变指纹", async () => {
    const base = await temp.sub("hash-base");
    await writeBundle(base, { title: "原始", author: "A", digest: "D" });
    const original = (await loadArticleBundle(base)).hash;

    const htmlChanged = await temp.sub("hash-html");
    await writeBundle(htmlChanged, { title: "原始", author: "A", digest: "D", bodyHtml: "<p>正文改了一个字</p>" });
    assert.notEqual((await loadArticleBundle(htmlChanged)).hash, original, "正文变化必须改变指纹");

    const metaChanged = await temp.sub("hash-meta");
    await writeBundle(metaChanged, { title: "原始", author: "B", digest: "D" });
    assert.notEqual((await loadArticleBundle(metaChanged)).hash, original, "元数据变化必须改变指纹");

    const coverChanged = await temp.sub("hash-cover");
    await writeBundle(coverChanged, { title: "原始", author: "A", digest: "D", cover: { name: "cover.png", bytes: PNG_1X1 } });
    assert.notEqual((await loadArticleBundle(coverChanged)).hash, original, "封面内容变化必须改变指纹");

    const imageChanged = await temp.sub("hash-image");
    await writeBundle(imageChanged, {
      title: "原始",
      author: "A",
      digest: "D",
      images: { "images/fig1.png": PNG_OTHER }
    });
    assert.notEqual((await loadArticleBundle(imageChanged)).hash, original, "插图内容变化必须改变指纹");
  });

  test("指纹覆盖插图内容而非仅文件路径", async () => {
    const dir = await temp.sub("image-content-only");
    await writeBundle(dir, { title: "图内容", images: { "images/fig1.png": PNG_1X1 } });
    const hashA = (await loadArticleBundle(dir)).hash;

    // 正文与元数据一字未改，只替换图片文件内容。
    await writeFile(path.join(dir, "images", "fig1.png"), PNG_OTHER);
    const hashB = (await loadArticleBundle(dir)).hash;

    assert.notEqual(hashA, hashB, "只改图片内容也必须视为不同内容");
  });
});

describe("articleBundle：封面发现顺序与边界", () => {
  let temp: TempDir;
  before(async () => {
    temp = await makeTempDir("wdmcp-cover-");
  });
  after(async () => {
    await temp.cleanup();
  });

  test("assets.json 指定的封面优先于目录里的 cover.png", async () => {
    const dir = await temp.sub("assets-priority");
    await writeBundle(dir, {
      title: "封面优先",
      assetsJson: { cover: { path: "assets/special.jpg" } },
      images: { "images/fig1.png": PNG_1X1, "assets/special.jpg": PNG_1X1 },
      cover: { name: "cover.png", bytes: PNG_OTHER }
    });

    const bundle = await loadArticleBundle(dir);

    assert.equal(bundle.cover?.source, "assets/special.jpg");
    assert.ok(bundle.cover!.bytes.equals(PNG_1X1), "必须用 assets.json 指定的那张");
  });

  test("目录封面支持中文名与大小写扩展名", async () => {
    const chinese = await temp.sub("cover-chinese");
    await writeBundle(chinese, { title: "中文封面", cover: { name: "封面.JPG", bytes: PNG_OTHER } });
    assert.equal((await loadArticleBundle(chinese)).cover?.source, "封面.JPG");

    const upper = await temp.sub("cover-upper");
    await writeBundle(upper, { title: "大写封面", cover: { name: "COVER.PNG", bytes: PNG_OTHER } });
    assert.equal((await loadArticleBundle(upper)).cover?.source, "COVER.PNG");
  });

  test("HTML <meta name=wechat:cover> 也能指定封面", async () => {
    const dir = await temp.sub("cover-meta");
    await writeBundle(dir, {
      title: "meta 封面",
      cover: null,
      images: { "images/fig1.png": PNG_1X1, "assets/c.png": PNG_1X1 },
      html: `<!DOCTYPE html><html><head><meta name="wechat:cover" content="assets/c.png"></head><body><h1>meta 封面</h1><p>正文</p></body></html>`
    });

    const bundle = await loadArticleBundle(dir);

    assert.equal(bundle.cover?.source, "assets/c.png");
    assert.ok(bundle.cover!.bytes.equals(PNG_1X1));
  });

  test("没有约定文件名时，任意 .htm 也能当正文", async () => {
    const dir = await temp.sub("htm-fallback");
    await writeBundle(dir, { title: "htm 正文", htmlFileName: "post.htm" });

    const bundle = await loadArticleBundle(dir);

    assert.equal(path.basename(bundle.htmlPath), "post.htm");
    assert.equal(bundle.title, "htm 正文");
  });

  test("空目录 → BUNDLE_NO_HTML，而不是抛文件系统错误", async () => {
    const dir = await temp.sub("empty-dir");

    await assert.rejects(
      () => loadArticleBundle(dir),
      (error: unknown) => {
        assert.ok(error instanceof PathNotAllowedError);
        assert.equal((error as PathNotAllowedError).code, "BUNDLE_NO_HTML");
        assert.match((error as Error).message, /找不到正文 HTML/);
        return true;
      }
    );
  });

  test("正文图引用绝对路径 → 警告并跳过（不阻塞、不外读）", async () => {
    const dir = await temp.sub("absolute-image-ref");
    await writeBundle(dir, {
      title: "绝对引用",
      bodyHtml: '<img src="/etc/hosts">\n<img src="images/fig1.png">\n'
    });

    const bundle = await loadArticleBundle(dir);

    assert.deepEqual(bundle.bodyImages.map((image) => image.src), ["images/fig1.png"]);
    assert.ok(bundle.warnings.some((warning) => warning.includes("/etc/hosts")));
    assert.deepEqual(bundle.blockingIssues, []);
  });

  test("正文图带 query 时按去 query 的路径读文件，但保留原 src 用于改写", async () => {
    const dir = await temp.sub("image-query");
    await writeBundle(dir, {
      title: "带 query",
      bodyHtml: '<img src="images/fig1.png?v=2">\n'
    });

    const bundle = await loadArticleBundle(dir);

    assert.equal(bundle.bodyImages.length, 1);
    assert.equal(bundle.bodyImages[0]!.src, "images/fig1.png?v=2");
    assert.equal(path.basename(bundle.bodyImages[0]!.absolutePath), "fig1.png");
  });

  test("封面名以 cover 开头即可命中（cover-banner.jpg）", async () => {
    const dir = await temp.sub("cover-prefix");
    await writeBundle(dir, { title: "前缀封面", cover: { name: "cover-banner.jpg", bytes: PNG_OTHER } });

    assert.equal((await loadArticleBundle(dir)).cover?.source, "cover-banner.jpg");
  });
});
