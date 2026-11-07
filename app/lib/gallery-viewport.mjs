// Physical screen dimensions are useful only for a full-width iPhone window.
// Never apply them to a desktop window, split view, zoomed page, or installed app.
export function galleryPaintHeight({ isPhone, standalone, scale, width, height, screenWidth, screenHeight, safeTop }) {
  if (!isPhone || standalone || !Number.isFinite(scale) || Math.abs(scale - 1) > .01
    || Math.abs(width - screenWidth) > 2
    || ![width, height, screenWidth, screenHeight].every(value => Number.isFinite(value) && value > 0)
    || !Number.isFinite(safeTop) || safeTop < 0 || safeTop >= screenHeight) {
    return null;
  }
  return Math.ceil(Math.max(height, screenHeight - safeTop));
}


/**
 * Height available to controls inside the embedded gallery.
 *
 * The outer gallery may intentionally paint into the browser chrome area, but
 * the iframe must stop at the real visual viewport so Afilmory's bottom bar
 * stays reachable. Nested documents don't reliably inherit the top-level
 * safe-area insets, so subtract the parent's bottom inset here.
 */
export function galleryInteractiveHeight({
  visualHeight,
  visualOffsetTop = 0,
  layoutHeight,
}) {
  const height = Number.isFinite(visualHeight) && visualHeight > 0
    ? visualHeight
    : layoutHeight;
  if (!Number.isFinite(height) || height <= 0) return null;

  const offsetTop = Number.isFinite(visualOffsetTop) && visualOffsetTop > 0
    ? visualOffsetTop
    : 0;

  // Do not subtract the iOS safe area here. The iframe should fill the real
  // visual viewport; the parent forwards the safe inset to Afilmory so its own
  // bottom chrome can pad itself exactly once.
  return Math.max(1, Math.floor(offsetTop + height));
}
