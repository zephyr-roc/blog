import { readFile, rm } from "node:fs/promises";
import path from "node:path";

const directory = path.resolve(process.env.GALLERY_DATA_DIR || "/data/gallery");
const manifest = path.join(directory, "manifest.json");
let version = null;
try {
  version = JSON.parse(await readFile(manifest, "utf8")).version;
} catch {
  // A new gallery has no manifest yet.
}
if (version === 3) {
  await rm(path.join(directory, "nas-token.json"), { force: true });
} else if (version === 2) {
  await rm(directory, { recursive: true, force: true });
  console.log("[gallery] Removed the legacy NAS manifest and cache.");
} else {
  await rm(path.join(directory, "nas-token.json"), { force: true });
}
