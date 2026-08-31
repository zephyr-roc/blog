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
  assert.doesNotMatch(component, />COLLECTION</);
  assert.doesNotMatch(component, /featured|collection-card--featured|collection-card--companion/);
  assert.doesNotMatch(css, /collection-card--featured|collection-card--companion/);
});

test("curates seven homepage language collections with C#, React and without Nim", async () => {
  const page = await readFile(new URL("app/page.tsx", root), "utf8");
  const css = await readFile(new URL("app/globals.css", root), "utf8");

  assert.match(page, /HOME_COLLECTION_ORDER\s*=\s*\["kotlin", "java", "rust", "csharp", "react", "ocaml", "zig"\]/);
  assert.match(page, /HOME_COLLECTIONS_HIDDEN\s*=\s*new Set\(\["tinkering", "deep-radar"\]\)/);
  assert.match(page, /postCountDifference\s*=\s*b\.postCount\s*-\s*a\.postCount/);
  assert.match(page, /collectionScores\s*=\s*collections\.map\(\(collection\)\s*=>\s*Math\.log2\(collection\.postCount\s*\+\s*1\)\)/);
  assert.match(page, /1\s*\+\s*\(\(collectionScores\[index\]\s*-\s*lowestScore\)\s*\/\s*scoreRange\)\s*\*\s*0\.6/);
  assert.match(page, /row\.map\(\(\{\s*collection,\s*ratio\s*\}\)\s*=>/);
  assert.match(page, /"--collection-ratio":\s*ratio\.toFixed\(4\)/);
  assert.match(page, /createWatchLayout\(weightedCollections\)/);
  assert.match(page, /rowCount\s*=\s*Math\.ceil\(items\.length\s*\/\s*3\)/);
  assert.match(page, /centerRowIndex\s*=\s*Math\.floor\(rowCount\s*\/\s*2\)/);
  assert.match(page, /fillOrder\.slice\(0,\s*remainder\)\.forEach/);
  assert.match(page, /rows\[rowIndex\]\s*=\s*items\.slice\(offset,\s*offset\s*\+\s*rowSizes\[rowIndex\]\)/);
  assert.match(page, /desktopHeight\s*=\s*center\s*\?\s*250\s*:\s*176/);
  assert.match(page, /compactHeight\s*=\s*center\s*\?\s*210\s*:\s*142/);
  assert.match(page, /"--collection-row-width":\s*`\$\{ratioSum\s*\*\s*desktopHeight\s*\+\s*gaps\}px`/);
  assert.match(css, /\.card-collection\s*\{[^}]*gap:\s*18px;/);
  assert.match(css, /\.card-collection__row\s*\{[^}]*gap:\s*18px;/);
  assert.match(css, /\.card-collection__row\s*\{[^}]*width:\s*min\(100%,\s*var\(--collection-row-width\)\);/);
  assert.doesNotMatch(css, /\.card-collection\s*\{[^}]*gap:\s*10px;/);
  assert.match(css, /\.collection-card__clip\s*\{[^}]*overflow:\s*hidden;[^}]*border-radius:\s*inherit;[^}]*clip-path:\s*inset\(0 round var\(--card-radius,\s*4\.93cqw\)\);/);
  assert.match(css, /\.collection-card__content\s*\{[^}]*max-height:\s*calc\(100%\s*-\s*clamp\(28px,\s*14cqmin,\s*56px\)\);[^}]*overflow:\s*hidden;/);
  assert.match(css, /@media \(max-width:\s*1180px\)[\s\S]*?\.card-collection__row\s*\{[^}]*width:\s*min\(100%,\s*var\(--collection-row-compact-width\)\);/);
  assert.match(css, /@media \(max-width:\s*640px\)[\s\S]*?\.card-collection__row\s*\{[^}]*display:\s*contents;/);

  for (const slug of ["java", "rust", "csharp", "react", "ocaml"]) {
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

  assert.match(component, /\["kotlin", "java", "rust", "csharp", "react", "ocaml", "zig"\]/);
  assert.doesNotMatch(component, /java-steam|java-cup|>λ<|>R</);

  for (const name of ["kotlin", "java", "rust", "csharp", "react", "ocaml", "zig"]) {
    const svg = await readFile(
      new URL(`public/language-logos/${name}.svg`, root),
      "utf8",
    );
    assert.match(svg, /^<svg[^>]+viewBox=/);
  }
});
