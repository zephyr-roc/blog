export const GALLERY_ORIGIN = "https://nas.afilmory.ready-jump.top";

export function isArticlePath(pathname) {
  return /^\/collections\/[^/]+\/[^/]+\/?$/.test(pathname)
    || /^\/(radar|tinkering)\/[^/]+\/?$/.test(pathname);
}

export function verticalNavigationAction(dx, dy) {
  if (Math.abs(dy) < 28 || Math.abs(dy) <= Math.abs(dx) * 1.25) return null;
  return dy < 0 ? "collapse" : "expand";
}

export function readGalleryViewerMessage(event, frameWindow) {
  if (!frameWindow || event.source !== frameWindow || event.origin !== GALLERY_ORIGIN) return null;
  const data = event.data;
  if (!data || data.type !== "afilmory:viewer-state" || data.version !== 1 || typeof data.open !== "boolean") return null;
  return data.open;
}
