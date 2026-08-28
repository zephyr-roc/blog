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

  assert.match(css, /\.collection-card__date\s*\{[^}]*font-size:\s*clamp\(8px,\s*1\.2cqmin,\s*11px\);/);
  assert.match(css, /\.collection-card__description\s*\{[^}]*font-size:\s*clamp\(10px,\s*2\.3cqmin,\s*15px\);/);
  assert.match(css, /\.collection-card__count\s*\{[^}]*font-size:\s*clamp\(8px,\s*1\.15cqmin,\s*11px\);/);
  assert.match(css, /\.card-collection__item\s*\{[^}]*aspect-ratio:\s*var\(--collection-ratio,\s*1\);/);
  assert.doesNotMatch(component, /fontSize:\s*"clamp\(/);
  assert.doesNotMatch(component, /className="collection-card__count"\s+style=/);
});

test("curates six homepage language collections with React and without Nim", async () => {
  const page = await readFile(new URL("app/page.tsx", root), "utf8");
  const css = await readFile(new URL("app/globals.css", root), "utf8");

  assert.match(page, /HOME_COLLECTION_ORDER\s*=\s*\["kotlin", "java", "rust", "react", "ocaml", "zig"\]/);
  assert.match(page, /HOME_COLLECTIONS_HIDDEN\s*=\s*new Set\(\["tinkering", "deep-radar"\]\)/);
  assert.match(page, /postCountDifference\s*=\s*b\.postCount\s*-\s*a\.postCount/);
  assert.match(page, /weight:\s*1\s*\+\s*Math\.log2\(collection\.postCount\s*\+\s*1\)/);
  assert.match(page, /ratio:\s*index\s*===\s*0\s*\?\s*1\.5/);
  assert.match(page, /Math\.min\(16\s*\/\s*9,\s*1\s*\+\s*Math\.log2\(collection\.postCount\s*\+\s*1\)\s*\*\s*0\.5\)/);
  assert.match(page, /row\.map\(\(\{\s*collection,\s*index,\s*weight,\s*ratio\s*\}\)\s*=>/);
  assert.match(page, /"--collection-ratio":\s*ratio\.toFixed\(4\)/);
  assert.match(page, /createWatchLayout\(weightedCollections\)/);
  assert.match(page, /smallestDifference\s*=\s*Math\.abs/);
  assert.match(page, /const centerRow\s*=\s*\[centerCandidates\[sidePair\[0\]\],\s*items\[0\],\s*centerCandidates\[sidePair\[1\]\]\]/);
  assert.match(page, /minmax\(180px,\s*\$\{weight\.toFixed\(3\)\}fr\)/);
  assert.match(css, /\.card-collection\s*\{[^}]*gap:\s*18px;/);
  assert.match(css, /\.card-collection__row\s*\{[^}]*gap:\s*18px;/);
  assert.match(css, /\.card-collection__row--2\s*\{[^}]*width:\s*min\(100%,\s*468px\);/);
  assert.match(css, /\.card-collection__row--1\s*\{[^}]*width:\s*min\(100%,\s*180px\);/);
  assert.doesNotMatch(css, /\.card-collection\s*\{[^}]*gap:\s*10px;/);
  assert.match(css, /\.collection-card__clip\s*\{[^}]*overflow:\s*hidden;[^}]*border-radius:\s*inherit;[^}]*clip-path:\s*inset\(0 round var\(--card-radius,\s*4\.93cqw\)\);/);
  assert.match(css, /\.collection-card__content\s*\{[^}]*max-height:\s*calc\(100%\s*-\s*clamp\(20px,\s*10cqmin,\s*44px\)\);[^}]*overflow:\s*hidden;/);
  assert.match(css, /@media \(max-width:\s*1180px\)[\s\S]*?\.card-collection__item\s*\{[^}]*aspect-ratio:\s*1\.5;/);

  for (const slug of ["java", "rust", "react", "ocaml"]) {
    const meta = await readFile(
      new URL(`content/collections/${slug}/_meta.md`, root),
      "utf8",
    );
    assert.match(meta, /^---\n[\s\S]+\n---\n$/);
  }
});

test("uses vendored standard SVG marks for homepage language collections", async () => {
  const component = await readFile(
    new URL("app/components/CollectionCard.tsx", root),
    "utf8",
  );

  assert.match(component, /\["kotlin", "java", "rust", "react", "ocaml", "zig"\]/);
  assert.doesNotMatch(component, /java-steam|java-cup|>λ<|>R</);

  for (const name of ["kotlin", "java", "rust", "react", "ocaml", "zig"]) {
    const svg = await readFile(
      new URL(`public/language-logos/${name}.svg`, root),
      "utf8",
    );
    assert.match(svg, /^<svg[^>]+viewBox=/);
  }
});
