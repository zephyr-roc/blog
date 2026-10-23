export const GALLERY_ORIGIN = "https://nas.afilmory.ready-jump.top";

export function isArticlePath(pathname) {
  return /^\/collections\/[^/]+\/[^/]+\/?$/.test(pathname)
    || /^\/(radar|tinkering)\/[^/]+\/?$/.test(pathname);
}

export function verticalNavigationAction(dx, dy) {
  if (Math.abs(dy) < 28 || Math.abs(dy) <= Math.abs(dx) * 1.25) return null;
  return dy < 0 ? "collapse" : "expand";
}

// Track real page movement, not wheel/touch input: keyboard and momentum
// scrolling should behave the same, and Safari's elastic overscroll is ignored.
export function createNavigationScrollTracker(initialY, initialMaxY) {
  const clamp = (y, maxY) => Math.max(0, Math.min(y, Math.max(0, maxY)));
  let previousY = clamp(initialY, initialMaxY);
  let travel = 0;

  return (rawY, maxY) => {
    const y = clamp(rawY, maxY);
    const delta = y - previousY;
    previousY = y;

    if (y <= 48) {
      travel = 0;
      return "expand";
    }
    if (delta === 0) return null;
    travel = Math.sign(delta) === Math.sign(travel) ? travel + delta : delta;
    if (travel >= 32) {
      travel = 0;
      return "collapse";
    }
    if (travel <= -20) {
      travel = 0;
      return "expand";
    }
    return null;
  };
}

export function readGalleryViewerMessage(event, frameWindow) {
  if (!frameWindow || event.source !== frameWindow || event.origin !== GALLERY_ORIGIN) return null;
  const data = event.data;
  if (!data || data.type !== "afilmory:viewer-state" || data.version !== 1 || typeof data.open !== "boolean") return null;
  return data.open;
}
