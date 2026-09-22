import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${pathname}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(new URL(pathname, "http://localhost"), {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("uses the page logo in the shared site header", async () => {
  const [header, css] = await Promise.all([
    readFile(new URL("app/components/SiteHeader.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);

  assert.match(
    header,
    /<img\s+[\s\S]*?className="wordmark__mark"[\s\S]*?src="\/favicon\.svg"/,
  );
  assert.doesNotMatch(header, /<span className="wordmark__mark"/);
  assert.match(
    css,
    /\.wordmark__mark\s*\{[^}]*width:\s*24px;[^}]*height:\s*24px;[^}]*object-fit:\s*contain;/,
  );
  assert.doesNotMatch(
    css,
    /\.wordmark__mark\s*\{[^}]*(?:clip-path|background:)/,
  );
});

test("shows a glass back-to-top button only when the navigation leaves enough room", async () => {
  const [layout, button, css] = await Promise.all([
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("app/components/BackToTopButton.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);

  assert.match(layout, /<BackToTopButton \/>/);
  assert.match(button, /document\.documentElement\.scrollHeight - window\.innerHeight/);
  assert.match(button, /const separateGap = navigation/);
  assert.match(button, /const canStaySeparate = separateGap >= NAVIGATION_GAP/);
  assert.match(button, /const viewportWidth = document\.documentElement\.clientWidth/);
  assert.match(button, /groupedWidth \+ MIN_VIEWPORT_EDGE_GAP \* 2 <= viewportWidth/);
  assert.match(button, /navigation\.dataset\.grouped = String\(isGrouped\)/);
  assert.match(button, /--bottom-navigation-shift/);
  assert.match(button, /--bottom-group-half-width/);
  assert.match(button, /window\.scrollY >= window\.innerHeight \* SHOW_AFTER_VIEWPORT_RATIO/);
  assert.match(button, /root\.dataset\.visible = String/);
  assert.match(button, /window\.scrollTo\(\{ top: 0, left: 0, behavior: "smooth" \}\)/);
  assert.match(button, /if \(window\.scrollY > 1\) window\.scrollTo\(0, 0\)/);
  assert.match(button, /aria-label="返回页面顶部"/);
  assert.match(button, /<Glass[\s\S]*?className="back-to-top-button__glass"/);
  assert.match(button, /backToTopGlassOptics/);
  assert.match(button, /backToTopGlassOptics:[\s\S]*?dispersion:\s*0,[\s\S]*?specular:\s*0,[\s\S]*?sheen:\s*0,/);
  assert.doesNotMatch(button, /back-to-top-button__yarn/);
  assert.match(
    css,
    /\.back-to-top-button\s*\{[^}]*position:\s*fixed;[^}]*right:\s*max\(22px, env\(safe-area-inset-right\)\);[^}]*bottom:\s*max\(20px, env\(safe-area-inset-bottom\)\);[^}]*visibility:\s*hidden;/,
  );
  assert.match(css, /\.back-to-top-button\[data-visible="true"\]\s*\{[^}]*visibility:\s*visible;/);
  assert.match(css, /\.liquid-navigation\[data-grouped="true"\]\s*\{[^}]*translateX\(calc\(-50% - var\(--bottom-navigation-shift\)\)\)/);
  assert.match(css, /\.back-to-top-button\[data-grouped="true"\]\s*\{[^}]*right:\s*calc\(50% - var\(--bottom-group-half-width\)\);/);
  assert.match(css, /--liquid-navigation-height:\s*70px/);
  assert.match(css, /@media \(max-width:\s*640px\)[\s\S]*?--liquid-navigation-height:\s*64px/);
  assert.match(css, /\.back-to-top-button\s*\{[^}]*width:\s*var\(--liquid-navigation-height\);[^}]*height:\s*var\(--liquid-navigation-height\);/);
  assert.match(css, /\.back-to-top-button__glass\s*\{[^}]*background:[\s\S]*?rgba\(17, 15, 24, \.16\);/);
  assert.match(css, /\.back-to-top-button::before\s*\{[^}]*background:\s*linear-gradient\(\s*110deg,[^}]*rgba\(255, 255, 255, \.68\) 22%/);
  assert.doesNotMatch(css, /\.back-to-top-button::before\s*\{[^}]*(?:113, 199, 255|255, 119, 193)/);
  assert.doesNotMatch(css, /fill:\s*#d94f96/);
  assert.doesNotMatch(layout, /ScrollCatCompanion/);
  assert.doesNotMatch(css, /scroll-cat/);
});

test("retains content-hashed client assets across container deployments", async () => {
  const [workflow, restoredMotionTilt] = await Promise.all([
    readFile(new URL(".github/workflows/deploy.yml", root), "utf8"),
    readFile(
      new URL(
        "public/_next/static/chunks/motionTilt-Bi1dNn-M.js",
        root,
      ),
      "utf8",
    ),
  ]);

  assert.match(workflow, /STATIC_VOLUME="blog-static-assets"/);
  assert.match(
    workflow,
    /cp -a \/app\/dist\/client\/_next\/static\/\. \/retained-static\//,
  );
  assert.match(
    workflow,
    /-v "\$STATIC_VOLUME:\/app\/dist\/client\/_next\/static:ro"/,
  );
  assert.doesNotMatch(workflow, /head -n \d+/);
  assert.match(restoredMotionTilt, /glass-card:motion-tilt/);
  assert.match(restoredMotionTilt, /glass-card:motion-reset/);
});

test("prevents the about document cache from serving a stale build for a year", async () => {
  const config = await readFile(new URL("next.config.ts", root), "utf8");

  assert.match(config, /expireTime:\s*120/);
});

test("server-renders the collection cards before client hydration", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /记录想法，/);
  assert.match(html, /分享所学/);
  assert.match(html, /data-motion-card="true"/);
  assert.match(html, /href="\/collections\/kotlin"/);
  assert.match(html, /href="\/collections\/swift"/);
  assert.match(html, /href="\/collections\/java"/);
  assert.match(html, /href="\/collections\/react"/);
  assert.doesNotMatch(html, />0<!-- --> 篇文章</);
});

test("server-renders the gallery and builds responsive animated WebP assets", async () => {
  const [builder, syncer, workflow, page, grid, manifest, packageJson, sitemap, navigation, css] = await Promise.all([
    readFile(new URL("scripts/build-gallery.mjs", root), "utf8"),
    readFile(new URL("scripts/sync-gallery-nas.mjs", root), "utf8"),
    readFile(new URL(".github/workflows/deploy.yml", root), "utf8"),
    readFile(new URL("app/gallery/page.tsx", root), "utf8"),
    readFile(new URL("app/gallery/GalleryGrid.tsx", root), "utf8"),
    readFile(new URL("app/gallery/gallery-manifest.generated.ts", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
    readFile(new URL("app/sitemap.ts", root), "utf8"),
    readFile(new URL("app/components/LiquidGlassNavigation.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);

  assert.match(packageJson, /"gallery:build": "node scripts\/build-gallery\.mjs"/);
  assert.match(packageJson, /"gallery:sync": "node scripts\/sync-gallery-nas\.mjs"/);
  assert.match(packageJson, /"prebuild": "pnpm gallery:build"/);
  assert.match(packageJson, /"photoswipe":/);
  assert.match(packageJson, /"sharp":/);
  assert.match(builder, /const targetWidths = \[480, 960, 1600, 2400\]/);
  assert.match(builder, /metadata\.pages \?\? 1/);
  assert.match(builder, /sharp\(input, \{ animated, limitInputPixels: false \}\)/);
  assert.match(builder, /\.webp\(\{/);
  assert.match(builder, /"\.heic"/);
  assert.match(builder, /"\.gif"/);
  assert.match(builder, /data:image\/webp;base64/);
  assert.match(syncer, /GALLERY_NAS_PASSWORD/);
  assert.match(syncer, /GALLERY_NAS_URL/);
  assert.match(syncer, /allowedStreamPath = "\/ugreen\/v5\/photo\/share\/external\/stream"/);
  assert.match(syncer, /fileType === "3" \? "0" : "3"/);
  assert.match(syncer, /new Map\(\)/);
  assert.match(syncer, /await fetch\(photo\.source/);
  assert.doesNotMatch(syncer, /6VeK/);
  assert.doesNotMatch(syncer, /happy\.nas\.ready-jump\.top/);
  assert.match(workflow, /GALLERY_NAS_URL: \$\{\{ secrets\.GALLERY_NAS_URL \}\}/);
  assert.match(workflow, /GALLERY_NAS_PASSWORD: \$\{\{ secrets\.GALLERY_NAS_PASSWORD \}\}/);
  assert.match(workflow, /run: pnpm gallery:sync/);
  assert.match(manifest, /export const galleryImages: GalleryImage\[\]/);
  assert.match(page, /export const dynamic = "force-static"/);
  assert.match(page, /<GalleryGrid images=\{galleryImages\} \/>/);
  assert.match(grid, /new PhotoSwipeLightbox/);
  assert.match(grid, /pswpModule: \(\) => import\("photoswipe"\)/);
  assert.match(grid, /prefers-reduced-motion: reduce/);
  assert.match(navigation, /href: "\/gallery"/);
  assert.match(sitemap, /`\$\{SITE_URL\}\/gallery`/);
  assert.match(css, /\.gallery-grid\s*\{[^}]*columns:\s*3 320px;/);

  const response = await render("/gallery");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<h1 id="gallery-title">画廊<\/h1>/);
  assert.match(html, /照片尚未挂墙/);
  assert.match(html, /href="\/gallery"/);
});

test("publishes generated Open Graph and Twitter images for every article type", async () => {
  const paths = [
    "/collections/kotlin/getting-started",
    "/tinkering/github-actions-deploy",
    "/radar/2026-08-25",
  ];

  for (const pathname of paths) {
    const response = await render(pathname);
    assert.equal(response.status, 200);

    const html = await response.text();
    assert.match(html, /property="og:image" content="https:\/\/www\.ready-jump\.top\/.+\/opengraph-image(?:\?[^"]+)?"/);
    assert.match(html, /name="twitter:card" content="summary_large_image"/);
    assert.match(html, /name="twitter:image" content="https:\/\/www\.ready-jump\.top\/.+\/twitter-image(?:\?[^"]+)?"/);
    assert.match(html, /property="og:image:width" content="1200"/);
    assert.match(html, /property="og:image:height" content="630"/);
  }
});

test("renders glass like and share actions with Giscus beneath every article", async () => {
  const [engagement, giscus, css, collectionPage, tinkeringPage, radarPage] = await Promise.all([
    readFile(new URL("app/components/ArticleEngagement.tsx", root), "utf8"),
    readFile(new URL("app/components/GiscusComments.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
    readFile(new URL("app/collections/[slug]/[post]/page.tsx", root), "utf8"),
    readFile(new URL("app/tinkering/[post]/page.tsx", root), "utf8"),
    readFile(new URL("app/radar/[post]/page.tsx", root), "utf8"),
  ]);

  assert.equal((engagement.match(/className="article-engagement__glass"/g) ?? []).length, 2);
  assert.match(engagement, /GITHUB_PROBE_URL = "https:\/\/github\.com\/favicon\.ico"/);
  assert.match(engagement, /GITHUB_PROBE_TIMEOUT = 4000/);
  assert.match(engagement, /const probe = new Image\(\)/);
  assert.match(engagement, /probe\.onload = \(\) => finish\(true\)/);
  assert.match(engagement, /probe\.onerror = \(\) => finish\(false\)/);
  assert.match(engagement, /signal\.addEventListener\("abort", abort/);
  assert.match(engagement, /window\.addEventListener\("online", checkGitHub\)/);
  assert.match(engagement, /window\.addEventListener\("offline", markUnavailable\)/);
  assert.match(engagement, /githubAvailability === "available" \? \(/);
  assert.match(engagement, /githubAvailability === "available" \? <GiscusComments \/> : null/);
  assert.match(engagement, /navigator\.share\(\{ title, url \}\)/);
  assert.match(engagement, /navigator\.clipboard\?\.writeText/);
  assert.match(engagement, /window\.location\.origin\}\$\{window\.location\.pathname/);
  assert.match(engagement, /<GiscusComments \/>/);
  assert.match(giscus, /script\.src = `\$\{GISCUS_ORIGIN\}\/client\.js`/);
  assert.match(giscus, /script\.dataset\.repo = "zephyr-roc\/blog"/);
  assert.match(giscus, /script\.dataset\.repoId = "R_kgDOT9ji4g"/);
  assert.match(giscus, /script\.dataset\.category = "Announcements"/);
  assert.match(giscus, /script\.dataset\.categoryId = "DIC_kwDOT9ji4s4DFx5B"/);
  assert.match(giscus, /script\.dataset\.mapping = "pathname"/);
  assert.match(giscus, /script\.dataset\.strict = "1"/);
  assert.match(giscus, /script\.dataset\.loading = "lazy"/);
  assert.match(giscus, /currentGiscusTheme/);
  assert.match(giscus, /postMessage\(/);

  for (const page of [collectionPage, tinkeringPage, radarPage]) {
    assert.match(page, /<ArticleEngagement/);
    assert.match(page, /title=\{post\.title\}/);
  }

  assert.match(
    css,
    /\.article-engagement__glass\s*\{[^}]*background:[\s\S]*?rgba\(17, 15, 24, \.16\);/,
  );
  assert.match(css, /\.article-engagement__actions\s*\{[^}]*display:\s*flex;/);
  assert.match(css, /\.article-comments\s*\{[^}]*margin-top:\s*52px;/);

  for (const pathname of [
    "/collections/kotlin/getting-started",
    "/tinkering/github-actions-deploy",
    "/radar/2026-08-25",
  ]) {
    const response = await render(pathname);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /class="article-engagement"/);
    assert.match(html, /aria-label="点赞，共 0 次点赞"/);
    assert.doesNotMatch(html, />分享</);
    assert.doesNotMatch(html, /id="article-comments-title">评论</);
  }
});

test("gives collection rows explicit heights for iPad Safari", async () => {
  const [home, css] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);

  assert.match(home, /"--collection-row-height": `\$\{desktopHeight\}px`/);
  assert.match(
    home,
    /"--collection-row-compact-height": `\$\{compactHeight\}px`/,
  );
  assert.match(
    css,
    /\.card-collection__row\s*\{[^}]*height:\s*var\(--collection-row-height\);/,
  );
  assert.match(
    css,
    /@media \(max-width:\s*1180px\)[\s\S]*?\.card-collection__row\s*\{[^}]*height:\s*var\(--collection-row-compact-height\);/,
  );
  assert.match(
    css,
    /@media \(max-width:\s*640px\)[\s\S]*?\.card-collection__item\s*\{[^}]*height:\s*auto;[^}]*aspect-ratio:\s*1\.5 \/ 1;/,
  );
});

test("renders working collection and post destinations", async () => {
  const collectionResponse = await render("/collections/kotlin");
  assert.equal(collectionResponse.status, 200);

  const collectionHtml = await collectionResponse.text();
  assert.match(collectionHtml, /href="\/collections\/kotlin\/getting-started"/);
  assert.match(collectionHtml, /CHAPTER 01/);
  assert.match(collectionHtml, /基础入门/);
  assert.match(collectionHtml, /并发进阶/);

  const postResponse = await render("/collections/kotlin/getting-started");
  assert.equal(postResponse.status, 200);

  const postHtml = await postResponse.text();
  assert.match(postHtml, /Kotlin/);
});

test("renders both completed Zig chapters", async () => {
  const collectionResponse = await render("/collections/zig");
  assert.equal(collectionResponse.status, 200);

  const collectionHtml = await collectionResponse.text();
  assert.match(collectionHtml, /类型与数据/);
  assert.match(collectionHtml, /跟着 Ziglings 学 Zig/);
  assert.match(
    collectionHtml,
    /href="\/collections\/zig\/comptime-generics-reflection"/,
  );
  assert.match(
    collectionHtml,
    /href="\/collections\/zig\/ziglings-journey"/,
  );

  const postResponse = await render(
    "/collections/zig/comptime-generics-reflection",
  );
  assert.equal(postResponse.status, 200);
  assert.match(await postResponse.text(), /当类型也是值/);
});

test("renders the complete Swift language guide and reference without revision history", async () => {
  const collectionResponse = await render("/collections/swift");
  assert.equal(collectionResponse.status, 200);

  const collectionHtml = await collectionResponse.text();
  assert.match(collectionHtml, /Swift 编程语言/);
  assert.match(collectionHtml, /语言指南/);
  assert.match(collectionHtml, /语言参考/);
  assert.match(collectionHtml, /29<!-- --> 篇/);
  assert.match(collectionHtml, /9<!-- --> 篇/);
  assert.match(collectionHtml, /href="\/collections\/swift\/the-basics"/);
  assert.match(collectionHtml, /href="\/collections\/swift\/generic-parameters-and-arguments"/);
  assert.doesNotMatch(collectionHtml, /修订历史/);

  const postResponse = await render("/collections/swift/generic-parameters-and-arguments");
  assert.equal(postResponse.status, 200);

  const postHtml = await postResponse.text();
  assert.match(postHtml, /泛型形参和实参/);
  assert.match(postHtml, /SwiftGG 中文版/);
  assert.match(postHtml, /class="hljs-keyword"/);
});

test("renders tinkering as a top-level page", async () => {
  const response = await render("/tinkering");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /折腾日志/);
  assert.match(html, /TINKERING · LAB/);
  assert.match(html, /class="site-header"/);
  assert.match(html, /id="tinkering-search"/);
  assert.match(html, /href="\/tinkering\/github-actions-deploy"/);
  assert.doesNotMatch(html, /浏览全部记录/);
  assert.doesNotMatch(html, /COLLECTION · 合集/);

  const legacyResponse = await render("/tinkering/notes");
  assert.equal(legacyResponse.status, 308);
  assert.match(legacyResponse.headers.get("location") ?? "", /\/tinkering$/);

  const postResponse = await render("/tinkering/github-actions-deploy");
  assert.equal(postResponse.status, 200);
});

test("renders the deep radar as a top-level daily archive", async () => {
  const response = await render("/radar");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /深潜雷达/);
  assert.match(html, /DEEP SIGNAL \/ SOURCE \/ PROOF/);
  assert.match(html, /RADAR · DAILY/);
  assert.match(html, /class="site-header"/);
  assert.match(html, /href="\/radar\/2026-08-25"/);
  assert.match(html, /href="\/radar\/feed\.xml"/);
  assert.doesNotMatch(html, /COLLECTION · 合集/);

  const postResponse = await render("/radar/2026-08-25");
  assert.equal(postResponse.status, 200);
});

test("publishes an RSS feed for deep radar subscribers", async () => {
  const response = await render("/radar/feed.xml");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^application\/rss\+xml\b/i);

  const xml = await response.text();
  assert.match(xml, /<title>深潜雷达 — 积雨云的空间站<\/title>/);
  assert.match(xml, /<link>https:\/\/www\.ready-jump\.top\/radar\/2026-08-25<\/link>/);
});

test("server-renders the about content before client hydration", async () => {
  const response = await render("/about");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /喜欢折腾代码/);
  assert.match(html, /Code × Motion/);
  assert.match(html, /CREATIVE CODE/);
  assert.match(html, /data-motion-card="true"/);
});

test("keeps the about title on exactly two smaller lines", async () => {
  const [about, css] = await Promise.all([
    readFile(new URL("app/about/page.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);

  assert.match(about, /你好，\s*<br \/>\s*我是积雨云。/);
  assert.match(css, /\.about__intro h1\s*\{[^}]*font-size:\s*clamp\(42px,\s*4\.8vw,\s*72px\);[^}]*white-space:\s*nowrap;/);
  assert.match(css, /@media \(max-width:\s*640px\)[\s\S]*?\.about__intro h1\s*\{[^}]*font-size:\s*clamp\(36px,\s*10vw,\s*50px\);/);
});

test("gives transparent post images a default white background toggle", async () => {
  const [postContent, enhancer, css] = await Promise.all([
    readFile(new URL("app/components/PostContent.tsx", root), "utf8"),
    readFile(new URL("app/components/PostImageEnhancer.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);

  assert.match(postContent, /<PostImageEnhancer \/>/);
  assert.match(enhancer, /getImageData\(0, 0, width, height\)\.data/);
  assert.match(enhancer, /pixels\[index\] < TRANSPARENT_ALPHA_CUTOFF/);
  assert.match(enhancer, /if \(!hasAlpha \|\| signal\.aborted \|\| !image\.isConnected\) return/);
  assert.match(enhancer, /frame\.dataset\.background = "white"/);
  assert.match(enhancer, /toggle\.setAttribute\("aria-pressed", "true"\)/);
  assert.match(enhancer, /关闭图片白色背景/);
  assert.match(enhancer, /开启图片白色背景/);
  assert.match(enhancer, /post-image-background-toggle__icon--sun/);
  assert.match(enhancer, /post-image-background-toggle__icon--moon/);
  assert.doesNotMatch(enhancer, />白底</);
  assert.match(
    css,
    /\.post-image-frame\s*\{[^}]*position:\s*relative;[^}]*margin:\s*1\.75rem auto;[^}]*overflow:\s*hidden;[^}]*padding:\s*48px 12px 12px;[^}]*border-radius:\s*16px;[^}]*background:\s*#fff;/,
  );
  assert.match(css, /\.post-content img\s*\{[^}]*border-radius:\s*0;/);
  assert.match(
    css,
    /\.post-image-frame\[data-background="transparent"\]\s*\{[^}]*background:\s*transparent;/,
  );
  assert.match(
    css,
    /\.post-image-background-toggle\s*\{[^}]*position:\s*absolute;[^}]*top:\s*7px;[^}]*right:\s*7px;/,
  );
  assert.doesNotMatch(css, /post-image-background-toggle__track/);
});

test("persists article-wide reading colors with automatic text contrast", async () => {
  const [postContent, appearance, css] = await Promise.all([
    readFile(new URL("app/components/PostContent.tsx", root), "utf8"),
    readFile(new URL("app/components/ReadingAppearance.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);

  assert.match(postContent, /<ReadingAppearance \/>/);
  assert.match(appearance, /blog-reading-appearance:v1/);
  assert.match(appearance, /function automaticTextColor\(background: string\)/);
  assert.match(appearance, /current\.textMode === "auto"/);
  assert.match(appearance, /textMode: "manual"/);
  assert.match(appearance, /文字颜色跟随背景/);
  assert.match(appearance, /window\.localStorage\.setItem/);
  assert.match(appearance, /shell\.dataset\.readingAppearance = "custom"/);
  assert.match(appearance, /<Glass[\s\S]*?className="reading-appearance__trigger-glass"/);
  assert.match(appearance, /className="reading-appearance__panel"/);
  assert.match(appearance, /readingAppearancePanelOptics/);
  assert.match(appearance, /readingAppearanceTriggerOptics:[\s\S]*?dispersion:\s*0,[\s\S]*?specular:\s*0,[\s\S]*?sheen:\s*0,/);
  assert.match(appearance, /readingAppearancePanelOptics:[\s\S]*?dispersion:\s*0,[\s\S]*?specular:\s*0,[\s\S]*?sheen:\s*0,/);
  assert.match(appearance, /role="dialog"/);
  assert.match(
    css,
    /\.post-shell\[data-reading-appearance="custom"\]\s*\{[^}]*background:\s*var\(--reading-background\);[^}]*color:\s*var\(--reading-text\);/,
  );
  assert.match(css, /\.reading-appearance\s*\{[^}]*position:\s*fixed;/);
  assert.match(css, /\.reading-appearance__trigger-glass\s*\{[^}]*background:[\s\S]*?rgba\(17, 15, 24, \.16\);/);
  assert.match(css, /\.reading-appearance::before\s*\{[^}]*background:\s*linear-gradient\(\s*110deg,[^}]*rgba\(255, 255, 255, \.68\) 22%/);
  assert.doesNotMatch(css, /\.reading-appearance::before\s*\{[^}]*(?:113, 199, 255|255, 119, 193)/);
  assert.match(css, /\.reading-appearance__panel\s*\{[^}]*background:[\s\S]*?rgba\(12, 10, 18, \.32\);/);
  assert.doesNotMatch(css, /\.reading-appearance__panel\s*\{[^}]*rgba\(12, 10, 18, \.94\)/);
});

test("keeps the outline and code surfaces neutral frosted glass across reading colors", async () => {
  const css = await readFile(new URL("app/globals.css", root), "utf8");

  assert.match(
    css,
    /\.post-shell\s*\{[^}]*--post-glass-surface:\s*rgba\(128, 128, 136, \.14\);[^}]*--post-glass-border:\s*color-mix\(in srgb, var\(--ink\) 14%, transparent\);/,
  );
  assert.match(
    css,
    /\.post-outline\s*\{[^}]*border:\s*1px solid var\(--post-glass-border\);[^}]*background:[\s\S]*?var\(--post-glass-surface\);[^}]*backdrop-filter:\s*blur\(18px\) saturate\(\.82\);/,
  );
  assert.match(
    css,
    /\.post-content pre\s*\{[^}]*border:\s*1px solid var\(--post-glass-border\);[^}]*background:[\s\S]*?var\(--post-glass-surface-strong\);[^}]*backdrop-filter:\s*blur\(18px\) saturate\(\.82\);/,
  );
  assert.doesNotMatch(
    css,
    /\.(?:post-outline|post-content pre)\s*\{[^}]*-webkit-backdrop-filter:/,
  );
  assert.match(css, /\.post-content pre code\s*\{[^}]*color:\s*var\(--ink\);/);
  assert.match(css, /\.post-content \.hljs-keyword,[\s\S]*?color:\s*var\(--post-code-keyword\);/);
  assert.doesNotMatch(css, /\.post-outline\s*\{[^}]*background:\s*rgba\(9, 8, 15, \.9\);/);
  assert.doesNotMatch(css, /\.post-content pre\s*\{[^}]*background:\s*rgba\(20, 20, 23, \.94\);/);
});

test("server-renders Mermaid fences as responsive article diagrams", async () => {
  const [content, postContent, css, packageJson] = await Promise.all([
    readFile(new URL("app/lib/content.ts", root), "utf8"),
    readFile(new URL("app/components/PostContent.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
  ]);

  assert.match(content, /if \(language === "mermaid"\)/);
  assert.match(content, /renderMermaidSVG\(source/);
  assert.match(content, /data-mermaid-diagram/);
  assert.match(content, /class="language-mermaid"/);
  assert.match(content, /data-mermaid-rendered="true"/);
  assert.match(content, /data-mermaid-svg="true"/);
  assert.doesNotMatch(postContent, /MermaidEnhancer/);
  assert.match(css, /\.mermaid-diagram\s*\{[^}]*backdrop-filter:\s*blur\(18px\) saturate\(\.82\);/);
  assert.match(css, /\.mermaid-diagram__canvas svg\s*\{[^}]*width:\s*auto;[^}]*max-width:\s*100%;[^}]*height:\s*auto;/);
  assert.match(packageJson, /"beautiful-mermaid":\s*"\^1\.1\.3"/);
  assert.doesNotMatch(packageJson, /"mermaid":\s*"/);

  const response = await render("/collections/java/project-loom-structured-concurrency");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(
    html,
    /<figure class="mermaid-diagram" data-mermaid-diagram data-mermaid-rendered="true">[\s\S]*?<svg[^>]*data-mermaid-svg="true"[\s\S]*?<\/svg>[\s\S]*?<\/figure>/,
  );
  assert.doesNotMatch(html, /<code class="language-mermaid">flowchart TD/);
});

test("keeps mobile device tilt exclusive to the about page", async () => {
  const [home, about, glassCard, controller, layout] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/about/page.tsx", root), "utf8"),
    readFile(new URL("app/components/GlassCard.tsx", root), "utf8"),
    readFile(new URL("app/components/GlassMotionController.tsx", root), "utf8"),
    readFile(new URL("app/layout.tsx", root), "utf8"),
  ]);

  assert.doesNotMatch(home, /["']use client["']/);
  assert.doesNotMatch(about, /["']use client["']/);
  assert.doesNotMatch(glassCard, /["']use client["']/);
  assert.match(controller, /^"use client";/);
  assert.match(controller, /document\.querySelectorAll<HTMLElement>/);
  assert.match(controller, /new MutationObserver\(syncCards\)/);
  assert.match(controller, /cardObserver\.observe\(document\.body, \{ childList: true, subtree: true \}\)/);
  assert.match(controller, /cardObserver\.disconnect\(\)/);
  assert.match(controller, /cardsRef\.current\.forEach/);
  assert.match(controller, /pathname === "\/about"/);
  assert.doesNotMatch(controller, /applyGroupTilt|groupsRef|data-motion-group/);
  assert.doesNotMatch(home, /data-motion-group="true"/);
  assert.match(about, /<MotionTiltControl \/>/);
  assert.match(layout, /<GlassMotionController \/>/);
  assert.doesNotMatch(layout, /<MotionTiltControl \/>/);
});


test("bounds CDN freshness for content-derived routes", async () => {
  const routeFiles = [
    "app/page.tsx",
    "app/about/page.tsx",
    "app/tinkering/page.tsx",
    "app/tinkering/[post]/page.tsx",
    "app/radar/page.tsx",
    "app/radar/[post]/page.tsx",
    "app/collections/[slug]/page.tsx",
    "app/collections/[slug]/[post]/page.tsx",
    "app/sitemap.ts",
    "app/radar/feed.xml/route.ts",
  ];

  const sources = await Promise.all(
    routeFiles.map((path) => readFile(new URL(path, root), "utf8")),
  );

  for (const [index, source] of sources.entries()) {
    assert.match(
      source,
      /export const revalidate = 60;/,
      `${routeFiles[index]} must not regress to an unbounded CDN lifetime`,
    );
  }

  assert.match(
    sources.at(-1),
    /max-age=0, s-maxage=60, stale-while-revalidate=60, must-revalidate/,
  );
});
