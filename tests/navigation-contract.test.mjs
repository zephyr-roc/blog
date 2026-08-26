import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("supports mouse dragging while keeping touch taps distinct", async () => {
  const navigation = await readFile(
    new URL("app/components/LiquidGlassNavigation.tsx", root),
    "utf8",
  );

  assert.match(navigation, /if \(event\.button !== 0\) return/);
  assert.doesNotMatch(
    navigation,
    /event\.button !== 0 \|\| event\.pointerType === "mouse"/,
  );
  assert.match(navigation, /wasTouchTap/);
  assert.match(navigation, /event\.pointerType !== "mouse"/);
  assert.match(navigation, /onClick=\{\(event: MouseEvent<HTMLAnchorElement>\)/);
  assert.match(navigation, /router\.push\(item\.href\)/);
  assert.match(navigation, /href: "\/tinkering"/);
  assert.match(navigation, /href: "\/radar"/);
  assert.match(navigation, /type NavigationIndex = 0 \| 1 \| 2 \| 3/);
  assert.doesNotMatch(navigation, /href: "\/collections\/tinkering"/);
});

test("uses a live backdrop lens without mirrored background copies", async () => {
  const [navigation, material, css] = await Promise.all([
    readFile(new URL("app/components/LiquidGlassNavigation.tsx", root), "utf8"),
    readFile(new URL("app/components/liquid-glass/GlassMaterial.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);

  assert.match(navigation, /data-active-index=\{activeIndex\}/);
  assert.match(navigation, /from "\.\/liquid-glass"/);
  assert.match(navigation, /navigationGlassOptics/);
  assert.match(navigation, /strength:\s*\.18/);
  assert.match(navigation, /scaleX:\s*\.2/);
  assert.match(navigation, /scaleY:\s*\.14/);
  assert.match(navigation, /depth:\s*\.94/);
  assert.match(navigation, /bend:\s*\.9/);
  assert.match(navigation, /dispersion:\s*\.8/);
  assert.match(navigation, /frost:\s*0/);
  assert.doesNotMatch(navigation, /supportedFrost/);
  assert.match(navigation, /useLiquidGlassSupport/);
  assert.match(
    navigation,
    /data-liquid-glass-supported=\{supportsLiquidGlass \? "true" : "false"\}/,
  );
  assert.match(material, /export const useLiquidGlassSupport/);
  assert.match(navigation, /className="liquid-navigation__refraction"/);
  assert.match(navigation, /className="liquid-navigation__refraction-content"/);
  assert.match(
    css,
    /\.liquid-navigation__refraction\s*\{[^}]*clip-path:\s*inset\(0 round 999px\);/,
  );
  assert.doesNotMatch(css, /\.liquid-navigation__refraction\s*\{[^}]*contain:/);
  assert.match(
    navigation,
    /blur\(\$\{supportsLiquidGlass \? 3 : 1\.4\}px\) saturate\(112%\)/,
  );
  assert.match(navigation, /className="liquid-navigation__backdrop"/);
  assert.match(navigation, /style=\{navigationBackdropStyle\}/);
  assert.doesNotMatch(
    css,
    /\.liquid-navigation__refraction\s*\{[^}]*backdrop-filter:/,
  );
  assert.match(css, /\.liquid-navigation__backdrop\s*\{/);
  assert.doesNotMatch(
    navigation,
    /cloneNode|MutationObserver|addEventListener\("scroll"|clipPath|feImage|feDisplacementMap/,
  );
  assert.doesNotMatch(navigation, /filterResolution=\{2\}/);
  assert.match(
    css,
    /\[data-active-index="1"\]\s+\.liquid-navigation__refraction\s*\{[\s\S]*?left:\s*calc\(/,
  );
  assert.match(
    css,
    /\[data-active-index="3"\]\s+\.liquid-navigation__refraction\s*\{[\s\S]*?left:\s*calc\(/,
  );
  assert.match(css, /calc\(\(100vw - 52px\) \/ 4\)/);
  assert.doesNotMatch(
    css,
    /\.liquid-navigation__refraction\s*\{[^}]*transform:/,
  );
  assert.match(
    css,
    /\.liquid-navigation__surface\[data-dragging="true"\] \.liquid-navigation__refraction\s*\{[^}]*transition:\s*none;/,
  );
});
