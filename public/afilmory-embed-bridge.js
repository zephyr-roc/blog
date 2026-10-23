/* Load this script inside the self-hosted Afilmory page, not the blog page. */
(() => {
  if (window.parent === window || window.__BLOG_GALLERY_BRIDGE__) return;
  window.__BLOG_GALLERY_BRIDGE__ = true;
  const allowedParents = new Set(["https://ready-jump.top", "https://www.ready-jump.top"]);
  let parentOrigin;
  try {
    const origin = new URL(document.referrer).origin;
    if (allowedParents.has(origin)) parentOrigin = origin;
  } catch { /* Wait for the authenticated parent handshake when referrer is absent. */ }

  const publish = () => {
    if (!parentOrigin) return;
    window.parent.postMessage({
      type: "afilmory:viewer-state",
      version: 1,
      open: /^\/photos\/[^/]+\/?$/.test(window.location.pathname),
    }, parentOrigin);
  };
  for (const method of ["pushState", "replaceState"]) {
    const original = window.history[method];
    window.history[method] = function (...args) {
      const result = original.apply(this, args);
      publish();
      return result;
    };
  }
  window.addEventListener("popstate", publish);
  window.addEventListener("pageshow", publish);
  window.addEventListener("message", event => {
    if (event.source !== window.parent || !allowedParents.has(event.origin)) return;
    if (event.data?.type !== "blog:request-viewer-state" || event.data.version !== 1) return;
    parentOrigin = event.origin;
    publish();
  });
  publish();
})();
