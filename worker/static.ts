import postKeys from "../dist/cloudflare/post-keys.json";

interface Database {
  exec(sql: string): Promise<unknown>;
  prepare(sql: string): { bind(...values: unknown[]): { first<T>(): Promise<T | null> } };
}
interface Env { ASSETS: { fetch(request: Request): Promise<Response> }; DB?: Database }
interface Context { waitUntil(promise: Promise<unknown>): void }
const articles = new Set(postKeys);
const initialized = new WeakMap<Database, Promise<unknown>>();
function ensureSchema(db: Database) {
  let ready = initialized.get(db);
  if (!ready) {
    // D1 exec treats each line as a statement, so keep CREATE on one line.
    ready = db.exec("CREATE TABLE IF NOT EXISTS post_likes (post_key TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0), updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)")
      .catch(error => { initialized.delete(db); throw error; });
    initialized.set(db, ready);
  }
  return ready;
}

function json(body: unknown, status = 200, cache = "no-store") {
  return Response.json(body, { status, headers: { "Cache-Control": cache } });
}

// HTML, RSC payloads, feeds, images and scripts are served by Static Assets
// without invoking this Worker. Only /api/* reaches this small handler.
export default {
  async fetch(request: Request, env: Env, ctx: Context): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (url.pathname.startsWith("/api/gallery/")) return json({ error: "Gallery management moved to Afilmory." }, 410);
    const match = url.pathname.match(/^\/api\/likes\/([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9-]*)$/i);
    if (!match || !articles.has(`${match[1]}/${match[2]}`)) return json({ error: "Not found" }, 404);
    if (request.method !== "GET" && request.method !== "POST") {
      return new Response(null, { status: 405, headers: { Allow: "GET, POST" } });
    }
    if (!env.DB) return json({ error: "Likes database is not configured." }, 503);
    const key = `${match[1]}/${match[2]}`;
    const cacheKey = new Request(`${url.origin}${url.pathname}`);
    const cache = (caches as unknown as { default?: Cache }).default;
    try {
      await ensureSchema(env.DB);
      if (request.method === "GET") {
        const cached = await cache?.match(cacheKey);
        if (cached) return cached;
        const row = await env.DB.prepare("SELECT count FROM post_likes WHERE post_key = ?").bind(key).first<{ count: number }>();
        const response = json({ count: row?.count ?? 0 }, 200, "public, max-age=60, s-maxage=300");
        if (cache) ctx.waitUntil(cache.put(cacheKey, response.clone()));
        return response;
      }
      if (request.headers.get("origin") !== url.origin || request.headers.get("sec-fetch-site") === "cross-site") {
        return json({ error: "Forbidden" }, 403);
      }
      const row = await env.DB.prepare(`INSERT INTO post_likes (post_key, count) VALUES (?, 1)
        ON CONFLICT(post_key) DO UPDATE SET count = post_likes.count + 1, updated_at = CURRENT_TIMESTAMP
        RETURNING count`).bind(key).first<{ count: number }>();
      if (cache) ctx.waitUntil(cache.delete(cacheKey).then(() => undefined));
      return json({ count: row!.count });
    } catch {
      return json({ error: "Likes are temporarily unavailable." }, 503);
    }
  },
};
