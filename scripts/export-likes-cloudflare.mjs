import { readFile, writeFile } from "node:fs/promises";

// Run against the old origin during cutover. Never silently export zero on
// network/API errors, and never overwrite a larger count on repeated import.
const origin = new URL(process.argv[2] ?? "https://www.ready-jump.top");
const output = process.argv[3] ?? "work/likes-cloudflare.sql";
const keys = JSON.parse(await readFile(new URL("../dist/cloudflare/post-keys.json", import.meta.url), "utf8"));
const rows = [];
for (const key of keys) {
  const response = await fetch(new URL(`/api/likes/${key}`, origin), { signal: AbortSignal.timeout(15000), cache: "no-store" });
  if (!response.ok) throw new Error(`Cannot export ${key}: HTTP ${response.status}`);
  const { count } = await response.json();
  if (!Number.isSafeInteger(count) || count < 0) throw new Error(`Invalid count: ${key}`);
  if (count > 0) rows.push(`INSERT INTO post_likes(post_key, count) VALUES ('${key.replaceAll("'", "''")}', ${count}) ON CONFLICT(post_key) DO UPDATE SET count = MAX(post_likes.count, excluded.count);`);
}
const { mkdir } = await import("node:fs/promises");
const { dirname } = await import("node:path");
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `-- Snapshot ${new Date().toISOString()} from ${origin.origin}\n${rows.join("\n")}\n`);
console.log(`Exported ${keys.length} articles (${rows.length} nonzero counts) to ${output}`);
