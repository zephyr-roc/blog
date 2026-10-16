import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const keys = JSON.parse(await readFile(new URL("dist/cloudflare/post-keys.json", root), "utf8"));
const source = (await readFile(new URL("worker/static.ts", root), "utf8"))
  .replace('import postKeys from "../dist/cloudflare/post-keys.json";', `const postKeys = ${JSON.stringify(keys)};`);
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
const { default: worker } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`);

test("likes preserve counts atomically, cache reads, reject cross-site writes and unknown keys", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(await readFile(new URL("db/migrations/001_create_post_likes.sql", root), "utf8"));
  const cache = new Map();
  globalThis.caches = { default: {
    match: async r => cache.get(r.url)?.clone(),
    put: async (r, response) => { cache.set(r.url, response.clone()); },
    delete: async r => cache.delete(r.url),
  } };
  let queries = 0;
  const env = {
    DB: { exec: async sql => { assert.ok(!sql.includes("\n"), "D1 exec requires one statement per line"); return db.exec(sql); }, prepare: sql => ({ bind: (...params) => ({ first: async () => {
      queries++;
      return db.prepare(sql).get(...params) ?? null;
    } }) }) },
    ASSETS: { fetch: async () => new Response("static") },
  };
  const pending = [];
  const ctx = { waitUntil: p => pending.push(p) };
  const endpoint = `https://example.com/api/likes/${keys[0]}`;
  const request = (url = endpoint, init) => worker.fetch(new Request(url, init), env, ctx);
  assert.deepEqual(await (await request()).json(), { count: 0 });
  await Promise.all(pending);
  assert.deepEqual(await (await request()).json(), { count: 0 });
  assert.equal(queries, 1);
  assert.equal((await request(endpoint, { method: "POST", headers: { Origin: "https://evil.example" } })).status, 403);
  assert.equal((await request("https://example.com/api/likes/fake/fake")).status, 404);
  assert.equal((await request(endpoint, { method: "DELETE" })).status, 405);
  for (let count = 1; count <= 3; count++) {
    assert.deepEqual(await (await request(endpoint, { method: "POST", headers: { Origin: "https://example.com" } })).json(), { count });
    await Promise.all(pending);
  }
  assert.deepEqual(await (await request()).json(), { count: 3 });
  assert.equal(await (await request("https://example.com/gallery")).text(), "static");
  assert.equal((await request("https://example.com/api/gallery/manage")).status, 410);
  assert.equal((await worker.fetch(new Request(endpoint), { ...env, DB: undefined }, ctx)).status, 503);
  db.close();
});

test("static deployment excludes framework and image runtimes", async () => {
  const config = JSON.parse(await readFile(new URL("wrangler.static.jsonc", root), "utf8"));
  assert.equal(config.main, "worker/static.ts");
  assert.deepEqual(config.assets.run_worker_first, ["/api/*"]);
  assert.equal(config.assets.not_found_handling, "404-page");
  assert.doesNotMatch(source, /from ["'](?:vinext|sharp|node:|react)/);
  assert.ok(keys.length > 0);
});
