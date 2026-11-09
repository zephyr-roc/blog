/**
 * Compute the actual visual viewport without guessing from physical screen size.
 * All values are CSS pixels; page zoom should not artificially resize the
 * embedded document, so a zoomed page uses the layout viewport instead.
 */
export function galleryViewportRect({
  visualHeight,
  visualWidth,
  visualOffsetTop = 0,
  visualOffsetLeft = 0,
  visualScale = 1,
  layoutHeight,
  layoutWidth,
}) {
  const valid = value => Number.isFinite(value) && value > 0;
  const zoomed = Number.isFinite(visualScale) && Math.abs(visualScale - 1) > 0.01;
  const height = !zoomed && valid(visualHeight) ? visualHeight : layoutHeight;
  const width = !zoomed && valid(visualWidth) ? visualWidth : layoutWidth;
  if (!valid(height) || !valid(width)) return null;

  const top = !zoomed && Number.isFinite(visualOffsetTop)
    ? Math.max(0, visualOffsetTop)
    : 0;
  const left = !zoomed && Number.isFinite(visualOffsetLeft)
    ? Math.max(0, visualOffsetLeft)
    : 0;

  return {
    top: Math.floor(top),
    left: Math.floor(left),
    width: Math.floor(width),
    height: Math.floor(height),
    layoutHeight: Math.ceil(top + height),
  };
}
