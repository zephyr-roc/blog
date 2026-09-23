// Node's Headers requires ByteString values; URL serialization percent-encodes
// CJK characters in the NAS share path before it is used as a Referer.
export function galleryNasReferer(sourceUrl: string) {
  return new URL(sourceUrl).href;
}
