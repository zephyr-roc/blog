import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("shares one responsive radius across the language card collection", async () => {
  const css = await readFile(new URL("app/globals.css", root), "utf8");

  assert.match(
    css,
    /\.card-collection\s*\{[^}]*--card-radius:\s*clamp\(28px,\s*3\.2vw,\s*34px\);/,
  );
  assert.match(
    css,
    /\.glass-card\s*\{[^}]*border-radius:\s*var\(--card-radius,\s*4\.93cqw\);/,
  );
  assert.doesNotMatch(css, /\.mini-card\s*\{[^}]*border-radius:/);
});
