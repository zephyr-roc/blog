/**
 * QQ's in-app iOS WebView can reserve the bottom system gesture region in
 * addition to exposing a CSS safe-area inset. Narrowly scope the gallery's
 * floating-control correction; do not change Safari or standalone QQ Browser.
 */
export function isIosQQInAppBrowser(userAgent) {
  return /\b(?:iPhone|iPad|iPod)\b/i.test(userAgent)
    && /(?:^|\s)QQ\/\d/i.test(userAgent);
}
