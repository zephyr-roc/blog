import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SiteHeader } from "../../components/SiteHeader";
import { isGalleryAdmin } from "../../lib/gallery-auth";
import { readGalleryImages } from "../../lib/gallery-runtime";
import { GalleryManager } from "./GalleryManager";

export const dynamic = "force-dynamic";
export const metadata = { title: "管理画廊", robots: { index: false, follow: false } };

export default async function ManageGalleryPage() {
  if (!isGalleryAdmin((await cookies()).get("gallery_session")?.value)) redirect("/api/gallery/auth/login");
  return <main className="experience-shell gallery-shell">
    <div className="ambient ambient--violet gallery-shell__violet" aria-hidden="true" />
    <SiteHeader edition="GALLERY · MANAGE" />
    <section className="gallery gallery-manager" aria-labelledby="manage-title">
      <header className="gallery-hero"><div><p className="hero__kicker">GALLERY / STUDIO</p>
        <h1 id="manage-title">管理画廊</h1>
        <p className="gallery-hero__lede">上传照片、修改名称与拍摄时间，公开画廊会立即更新。</p></div>
        <a className="gallery-admin-link" href="/gallery">查看画廊</a>
      </header>
      <GalleryManager initialImages={await readGalleryImages()} />
      <form action="/api/gallery/auth/logout" method="post"><button className="gallery-admin-link" type="submit">退出登录</button></form>
    </section>
  </main>;
}
