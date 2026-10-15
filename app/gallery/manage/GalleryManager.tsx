"use client";

import { useState } from "react";
import type { GalleryImage } from "../gallery-types";

function localDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  const digits = (number: number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${digits(date.getMonth() + 1)}-${digits(date.getDate())}T${digits(date.getHours())}:${digits(date.getMinutes())}`;
}

export function GalleryManager({ initialImages }: { initialImages: GalleryImage[] }) {
  const [images, setImages] = useState(initialImages);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");

  async function reload() {
    const response = await fetch("/api/gallery/manage", { cache: "no-store" });
    if (response.ok) setImages(await response.json() as GalleryImage[]);
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    try {
      for (const [index, file] of Array.from(files).entries()) {
        setProgress(`正在上传 ${index + 1}/${files.length}：${file.name}`);
        const body = new FormData();
        body.set("photo", file);
        const response = await fetch("/api/gallery/manage", { method: "POST", body });
        if (!response.ok) throw new Error(`${file.name}：${await response.text()}`);
        await reload();
      }
      setProgress(`已上传 ${files.length} 张照片。`);
    } catch (error) {
      setProgress(error instanceof Error ? error.message : "上传失败，请重试。");
    } finally {
      setBusy(false);
    }
  }

  async function update(image: GalleryImage, title: string, date: string) {
    setBusy(true);
    try {
      const response = await fetch("/api/gallery/manage", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: image.id, title, capturedAt: new Date(date).toISOString() }),
      });
      if (!response.ok) throw new Error(await response.text());
      await reload();
      setProgress("照片信息已保存。");
    } catch (error) {
      setProgress(error instanceof Error ? error.message : "保存失败。");
    } finally { setBusy(false); }
  }

  async function remove(image: GalleryImage) {
    if (!window.confirm(`删除「${image.title}」及其原图？此操作无法撤销。`)) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/gallery/manage?id=${encodeURIComponent(image.id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await response.text());
      await reload();
      setProgress("照片已删除。");
    } catch (error) {
      setProgress(error instanceof Error ? error.message : "删除失败。");
    } finally { setBusy(false); }
  }

  return <div className="gallery-manager__body">
    <label className="gallery-manager__upload">
      <span>＋ 选择照片上传</span><small>JPEG / PNG / WebP / GIF / AVIF · 单张不超过 40MB · 可多选</small>
      <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" multiple disabled={busy}
        onChange={(event) => { void upload(event.currentTarget.files); event.currentTarget.value = ""; }} />
    </label>
    <p className="gallery-manager__status" role="status">{progress || `已发布 ${images.length} 张照片`}</p>
    <div className="gallery-manager__list">
      {images.map((image) => <GalleryManagerItem key={image.id} image={image} busy={busy} onSave={update} onDelete={remove} />)}
    </div>
  </div>;
}

function GalleryManagerItem({ image, busy, onSave, onDelete }: {
  image: GalleryImage; busy: boolean;
  onSave: (image: GalleryImage, title: string, date: string) => Promise<void>;
  onDelete: (image: GalleryImage) => Promise<void>;
}) {
  const [title, setTitle] = useState(image.title);
  const [date, setDate] = useState(localDateTime(image.metadata.capturedAt));
  return <article className="gallery-manager__item">
    <img src={image.sources[0]?.src} width="112" height="112" alt="" />
    <div className="gallery-manager__fields">
      <label>标题<input value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} /></label>
      <label>拍摄时间<input type="datetime-local" value={date} onChange={(event) => setDate(event.target.value)} /></label>
      <small>{image.filename}</small>
    </div>
    <div className="gallery-manager__actions">
      <button type="button" disabled={busy || !title.trim()} onClick={() => void onSave(image, title, date)}>保存</button>
      <button type="button" disabled={busy} onClick={() => void onDelete(image)}>删除</button>
    </div>
  </article>;
}
