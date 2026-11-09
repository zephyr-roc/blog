import { readdir, readFile, writeFile, mkdir, access, copyFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const assets = path.join(root, "dist/client");
const fontFile = path.join(root, ".vinext/NotoSansCJKsc-Regular.otf");
await mkdir(path.dirname(fontFile), { recursive: true });
try { await access(fontFile); }
catch {
  // A fixed public font URL; no article text or other user data is sent.
  const response = await fetch("https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf");
  if (!response.ok) throw new Error(`Cannot download build font: HTTP ${response.status}`);
  await writeFile(fontFile, new Uint8Array(await response.arrayBuffer()));
}
const font = await readFile(fontFile);
globalThis.__BLOG_SOCIAL_FONT__ = font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength);
// Social cards use our logo. Read build assets locally instead of depending
// on the old production host during a migration build.
globalThis.fetch = async (input) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (["ready-jump.top", "www.ready-jump.top"].includes(url.hostname)) {
    const file = path.join(root, "public", decodeURIComponent(url.pathname));
    const body = await readFile(file);
    return new Response(body, { headers: { "content-type": url.pathname.endsWith(".svg") ? "image/svg+xml" : "image/png" } });
  }
  throw new Error(`External requests are disabled during static rendering (${url.hostname}).`);
};
const postKeys = [];
for (const collection of await readdir(path.join(root, "content/collections"), { withFileTypes: true })) {
  if (!collection.isDirectory()) continue;
  for (const name of await readdir(path.join(root, "content/collections", collection.name))) {
    if (name.endsWith(".md") && name !== "_meta.md") postKeys.push(`${collection.name}/${name.slice(0, -3)}`);
  }
}
await mkdir(path.join(root, "dist/cloudflare"), { recursive: true });
await writeFile(path.join(root, "dist/cloudflare/post-keys.json"), JSON.stringify(postKeys));

// App GET route handlers are not emitted by vinext's static export. Render
// feeds and any missing share images once here, never in the deployed Worker.
const { default: handler } = await import(new URL("../dist/server/index.js", import.meta.url));
async function exportResponse(urlPath) {
  const response = await handler(new Request(`http://localhost${urlPath}`), {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  }, { waitUntil() {}, passThroughOnException() {} });
  if (!response.ok) throw new Error(`Static export failed: ${urlPath} HTTP ${response.status}`);
  const destination = path.join(assets, urlPath.slice(1));
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, new Uint8Array(await response.arrayBuffer()));
}
await exportResponse("/radar/feed.xml");
await exportResponse("/sitemap.xml");
await exportResponse("/robots.txt");

const sharePaths = new Set();
let pages = 0;
async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await scan(file);
    else if (entry.name.endsWith(".html")) {
      pages++;
      const html = await readFile(file, "utf8");
      for (const match of html.matchAll(/<meta[^>]+(?:property="og:image"|name="twitter:image")[^>]+content="([^"]+)"/g)) {
        const url = new URL(match[1].replaceAll("&amp;", "&"), "https://www.ready-jump.top");
        if (["ready-jump.top", "www.ready-jump.top"].includes(url.hostname)) sharePaths.add(url.pathname);
      }
    }
  }
}
await scan(assets);
const cards = [...sharePaths].filter(p => !p.endsWith("/twitter-image"));
let completed = 0;
for (let index = 0; index < cards.length; index += 4) {
  await Promise.all(cards.slice(index, index + 4).map(async urlPath => {
    try { await access(path.join(assets, urlPath.slice(1))); }
    catch { await exportResponse(urlPath); }
    // Twitter routes re-export the same Open Graph image component.
    const twitterPath = urlPath.replace(/\/opengraph-image$/, "/twitter-image");
    if (twitterPath !== urlPath && sharePaths.has(twitterPath)) {
      await copyFile(path.join(assets, urlPath.slice(1)), path.join(assets, twitterPath.slice(1)));
    }
    completed++;
  }));
  console.log(`Static share cards: ${completed}/${cards.length}`);
}
// Missing article exports must fail the build rather than silently produce
// a working homepage and hundreds of 404 destinations.
for (const key of postKeys) {
  const [collection, post] = key.split("/");
  const route = collection === "tinkering" ? `tinkering/${post}`
    : collection === "deep-radar" ? `radar/${post}` : `collections/${key}`;
  await access(path.join(assets, `${route}.html`));
}
if (pages < postKeys.length) throw new Error("Static page export is incomplete.");
await writeFile(path.join(assets, "_redirects"), [
  "/gallery/manage https://nas.afilmory.ready-jump.top/ 302",
  "/tinkering/notes /tinkering 301",
  "/collections/tinkering /tinkering 301",
  "/collections/deep-radar /radar 301",
  "/collections/tinkering/:post /tinkering/:post 301",
  "/collections/deep-radar/:post /radar/:post 301",
  "",
].join("\n"));
const headers = await readFile(path.join(assets, "_headers"), "utf8");
await writeFile(path.join(assets, "_headers"), headers + `
/*.html
  Cache-Control: public, max-age=0, must-revalidate
/*.rsc
  Content-Type: text/x-component; charset=utf-8
  Cache-Control: public, max-age=0, must-revalidate
/*/opengraph-image
  Content-Type: image/png
/*/twitter-image
  Content-Type: image/png
`);
console.log(`Cloudflare static build ready: ${pages} HTML pages, ${postKeys.length} article keys, ${sharePaths.size} social images. No runtime SSR or image processing.`);
// Standard Wrangler deploy redirect: Cloudflare Builds' default deploy command
// picks this static config instead of attempting to deploy the SSR bundle.
const deployDirectory = path.join(root, ".wrangler/deploy");
await mkdir(deployDirectory, { recursive: true });
await writeFile(path.join(deployDirectory, "config.json"), JSON.stringify({ configPath: "../../wrangler.static.jsonc" }));

// All HTML, feeds and OG/Twitter cards were generated above at build time.
// EdgeOne's Vinext adapter checks for both dist/client and dist/server. Keep
// the actual Vinext server bundle intact; removing it caused deployment to
// fail even though all 209 pages were statically exported.
//
// The standalone Node package is a separate, duplicate server distribution
// which is not used by the EdgeOne adapter or the Cloudflare static Worker.
// Source maps are optional debug output, not imports or runtime dependencies.
const serverDir = path.join(root, "dist/server");
await access(path.join(serverDir, "index.js"));
await rm(path.join(root, "dist/standalone"), { recursive: true, force: true });

const files = [];
async function inspectServer(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await inspectServer(absolute);
    } else if (entry.isFile()) {
      if (entry.name.endsWith(".map")) {
        await rm(absolute);
        continue;
      }
      const size = (await stat(absolute)).size;
      files.push({ name: path.relative(serverDir, absolute), size });
    }
  }
}
await inspectServer(serverDir);
const totalServerSize = files.reduce((sum, file) => sum + file.size, 0);
const prettySize = bytes => `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
console.log(`Retained dist/server: ${files.length} files, ${prettySize(totalServerSize)} (excluding source maps).`);
for (const file of files.sort((a, b) => b.size - a.size).slice(0, 12)) {
  console.log(`  SSR file: ${prettySize(file.size)}  ${file.name}`);
}
console.log("All social cards are pre-rendered in dist/client; deploy still targets dist/client.");

