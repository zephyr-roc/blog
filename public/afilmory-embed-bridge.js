/* Install this in the NAS-hosted Afilmory HTML, not the blog page. */
(() => {
  if (window.parent === window || window.__BLOG_GALLERY_BRIDGE__) return;
  window.__BLOG_GALLERY_BRIDGE__ = true;

  const allowedParents = new Set(["https://ready-jump.top", "https://www.ready-jump.top"]);
  let parentOrigin = null;
  let lastPath = "";
  let lastOpen = null;

  try {
    const origin = new URL(document.referrer).origin;
    if (allowedParents.has(origin)) parentOrigin = origin;
  } catch { /* Use the validated parent handshake when referrer is unavailable. */ }

  const publish = (force = false) => {
    if (!parentOrigin) return;
    const path = window.location.pathname;
    const open = /^\/photos\/[^/]+\/?$/.test(path);
    if (!force && path === lastPath && open === lastOpen) return;
    lastPath = path;
    lastOpen = open;
    window.parent.postMessage({ type: "afilmory:viewer-state", version: 1, open }, parentOrigin);
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
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent || !allowedParents.has(event.origin)) return;
    if (event.data?.version !== 1 || event.data?.type !== "blog:request-viewer-state") return;

    parentOrigin = event.origin;
    window.parent.postMessage({ type: "afilmory:bridge-ready", version: 1 }, parentOrigin);
    publish(true);
  });

  // Covers routers that bypass the global history wrappers.
  const routeTimer = window.setInterval(() => {
    if (document.visibilityState === "visible") publish();
  }, 500);
  window.addEventListener("pagehide", () => clearInterval(routeTimer), { once: true });

  if (parentOrigin) {
    window.parent.postMessage({ type: "afilmory:bridge-ready", version: 1 }, parentOrigin);
  }
  publish(true);
})();
