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
