import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";

test("admin can publish, edit and remove a photo while anonymous upload is blocked", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gallery-cms-test-"));
  const port = 39000 + Math.floor(Math.random() * 1000);
  const origin = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ["dist/standalone/server.js"], {
    env: {
      ...process.env, PORT: String(port), HOSTNAME: "127.0.0.1", GALLERY_DATA_DIR: directory,
      GALLERY_PUBLIC_ORIGIN: origin, GALLERY_GITHUB_CLIENT_ID: "test-client",
      GALLERY_GITHUB_CLIENT_SECRET: "test-secret", GALLERY_ADMIN_GITHUB_ID: "94433344",
    },
    stdio: "ignore",
  });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        const response = await fetch(`${origin}/gallery`);
        if (response.ok) { ready = true; break; }
      } catch { /* Server is starting. */ }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.ok(ready, "standalone server started");
    const payload = Buffer.from(JSON.stringify({ id: 94433344, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
    const mac = createHmac("sha256", "test-secret").update(`gallery-session-v1:${payload}`).digest("base64url");
    const headers = { Origin: origin, Cookie: `gallery_session=${payload}.${mac}` };
    const png = await sharp({ create: { width: 16, height: 12, channels: 4, background: "#ff0033" } }).png().toBuffer();
    const form = new FormData();
    form.set("photo", new File([png], "中文测试.png", { type: "image/png" }));

    let response = await fetch(`${origin}/api/gallery/manage`, { method: "POST", headers: { Origin: origin }, body: form });
    assert.equal(response.status, 403);
    response = await fetch(`${origin}/api/gallery/manage`, { method: "POST", headers: { ...headers, Origin: "https://elsewhere.example" }, body: form });
    assert.equal(response.status, 403, "cross-origin upload is rejected");
    response = await fetch(`${origin}/api/gallery/manage`, { headers: { Cookie: `gallery_session=${payload}.invalid` } });
    assert.equal(response.status, 401, "tampered session is rejected");
    response = await fetch(`${origin}/api/gallery/manage`, { method: "POST", headers, body: form });
    if (response.status !== 201) assert.fail(`Upload failed (${response.status}): ${await response.text()}`);
    const image = await response.json();
    for (const url of [image.original, image.sources[0].src, `/api/gallery/details?id=${image.id}`]) {
      response = await fetch(`${origin}${url}`);
      assert.equal(response.status, 200, url);
    }
    response = await fetch(`${origin}/api/gallery/manage`, {
      method: "PATCH", headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ id: image.id, title: "改名", capturedAt: "2024-10-13T12:00:00Z" }),
    });
    assert.equal(response.status, 200);
    response = await fetch(`${origin}/gallery`);
    assert.match(await response.text(), /改名/);
    response = await fetch(`${origin}/api/gallery/manage?id=${image.id}`, { method: "DELETE", headers });
    assert.equal(response.status, 204);
    response = await fetch(`${origin}${image.original}`);
    assert.equal(response.status, 404);
  } finally {
    server.kill("SIGTERM");
    await rm(directory, { recursive: true, force: true });
  }
});
