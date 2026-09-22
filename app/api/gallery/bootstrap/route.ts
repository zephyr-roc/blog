import { ensureGallerySyncStarted } from "../../../lib/gallery-sync-service";

export const runtime = "nodejs";

export async function POST() {
  ensureGallerySyncStarted();
  return Response.json({ started: true });
}
