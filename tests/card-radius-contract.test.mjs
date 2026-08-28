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

test("scales shared collection-card content from one proportional canvas", async () => {
  const css = await readFile(new URL("app/globals.css", root), "utf8");
  const component = await readFile(
    new URL("app/components/CollectionCard.tsx", root),
    "utf8",
  );

  assert.match(css, /\.collection-card__date\s*\{[^}]*font-size:\s*1\.16cqw;/);
  assert.match(css, /\.collection-card__description\s*\{[^}]*font-size:\s*2\.03cqw;/);
  assert.match(css, /\.collection-card__count\s*\{[^}]*font-size:\s*1\.01cqw;/);
  assert.doesNotMatch(component, /fontSize:\s*"clamp\(/);
  assert.doesNotMatch(component, /className="collection-card__count"\s+style=/);
});

test("curates six homepage language collections without removing Nim content", async () => {
  const page = await readFile(new URL("app/page.tsx", root), "utf8");

  assert.match(page, /HOME_COLLECTION_ORDER\s*=\s*\["kotlin", "java", "rust", "ts-js", "ocaml", "zig"\]/);
  assert.match(page, /HOME_COLLECTIONS_HIDDEN\s*=\s*new Set\(\["tinkering", "deep-radar", "nim"\]\)/);

  for (const slug of ["java", "rust", "ts-js", "ocaml"]) {
    const meta = await readFile(
      new URL(`content/collections/${slug}/_meta.md`, root),
      "utf8",
    );
    assert.match(meta, /^---\n[\s\S]+\n---\n$/);
  }

  const nimMeta = await readFile(
    new URL("content/collections/nim/_meta.md", root),
    "utf8",
  );
  assert.match(nimMeta, /title:\s*Nim 漫游/);
});

test("uses vendored standard SVG marks for homepage language collections", async () => {
  const component = await readFile(
    new URL("app/components/CollectionCard.tsx", root),
    "utf8",
  );

  assert.match(component, /\/language-logos\/typescript\.svg/);
  assert.match(component, /\/language-logos\/javascript\.svg/);
  assert.match(component, /\["kotlin", "java", "rust", "ocaml", "zig"\]/);
  assert.doesNotMatch(component, /java-steam|java-cup|>λ<|>R</);

  for (const name of ["kotlin", "java", "rust", "typescript", "javascript", "ocaml", "zig"]) {
    const svg = await readFile(
      new URL(`public/language-logos/${name}.svg`, root),
      "utf8",
    );
    assert.match(svg, /^<svg[^>]+viewBox=/);
  }
});
