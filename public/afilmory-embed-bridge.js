/* Load this script inside the self-hosted Afilmory page, not the blog page. */
(() => {
  if (window.parent === window || window.__BLOG_GALLERY_BRIDGE__) return;
  window.__BLOG_GALLERY_BRIDGE__ = true;

  const allowedParents = new Set(["https://ready-jump.top", "https://www.ready-jump.top"]);
  let parentOrigin;
  let lastPath = "";
  let lastOpen = null;

  try {
    const origin = new URL(document.referrer).origin;
    if (allowedParents.has(origin)) parentOrigin = origin;
  } catch { /* Wait for the authenticated parent handshake when referrer is absent. */ }

  const style = document.createElement("style");
  style.dataset.blogGalleryBridge = "";
  style.textContent = `
    html[data-blog-gallery-embed="true"] .pb-safe {
      padding-bottom: max(
        env(safe-area-inset-bottom, 0px),
        var(--blog-gallery-safe-bottom, 0px)
      ) !important;
    }
  `;
  document.head.append(style);
  document.documentElement.dataset.blogGalleryEmbed = "true";

  const isViewerOpen = () => /^\/photos\/[^/]+\/?$/.test(window.location.pathname);

  const publish = (force = false) => {
    if (!parentOrigin) return;
    const path = window.location.pathname;
    const open = isViewerOpen();
    if (!force && path === lastPath && open === lastOpen) return;
    lastPath = path;
    lastOpen = open;
    window.parent.postMessage({
      type: "afilmory:viewer-state",
      version: 1,
      open,
    }, parentOrigin);
  };

  const applyViewport = (data) => {
    const safeBottom = Number(data?.safeBottom);
    if (Number.isFinite(safeBottom) && safeBottom >= 0 && safeBottom < 256) {
      document.documentElement.style.setProperty("--blog-gallery-safe-bottom", `${safeBottom}px`);
    }
    const visualHeight = Number(data?.visualHeight);
    if (Number.isFinite(visualHeight) && visualHeight > 0) {
      document.documentElement.style.setProperty("--blog-gallery-visual-height", `${visualHeight}px`);
    }
  };

  for (const method of ["pushState", "replaceState"]) {
    const original = window.history[method];
    window.history[method] = function (...args) {
      const result = original.apply(this, args);
      queueMicrotask(() => publish(true));
      return result;
    };
  }

  window.addEventListener("popstate", () => publish(true));
  window.addEventListener("hashchange", () => publish(true));
  window.addEventListener("pageshow", () => publish(true));
  window.addEventListener("message", event => {
    if (event.source !== window.parent || !allowedParents.has(event.origin)) return;
    const data = event.data;
    if (data?.version !== 1) return;

    parentOrigin = event.origin;
    if (data.type === "blog:request-viewer-state") publish(true);
    if (data.type === "blog:viewport") applyViewport(data);
  });

  // React Router can update routing through mechanisms that don't reliably hit
  // our history wrappers in every build. Watching pathname is cheap and makes
  // the parent navigation state deterministic.
  const routeTimer = window.setInterval(() => {
    if (document.visibilityState === "visible") publish(false);
  }, 250);

  window.addEventListener("pagehide", () => window.clearInterval(routeTimer), { once: true });

  if (parentOrigin) {
    window.parent.postMessage({ type: "afilmory:bridge-ready", version: 1 }, parentOrigin);
  }
  publish(true);
})();
