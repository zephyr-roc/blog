"use client";

import { useEffect, useRef, useState } from "react";
import type { GalleryDetails, GalleryImage } from "./gallery-types";

type ToneAnalysis = {
  tone: string;
  brightness: number;
  contrast: number;
  shadows: number;
  highlights: number;
};

function formatCaptureTime(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(date);
}

function InfoRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === "") return null;
  return <div className="gallery-inspector__row"><dt>{label}</dt><dd>{value}</dd></div>;
}

function GalleryHistogram({ src, onAnalysis }: {
  src: string;
  onAnalysis: (analysis: ToneAnalysis | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled || !canvasRef.current) return;
      try {
        const sample = document.createElement("canvas");
        const scale = Math.min(1, 256 / Math.max(image.naturalWidth, image.naturalHeight));
        sample.width = Math.max(1, Math.round(image.naturalWidth * scale));
        sample.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = sample.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("Canvas is unavailable.");
        context.drawImage(image, 0, 0, sample.width, sample.height);
        const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
        const channels = Array.from({ length: 4 }, () => new Uint32Array(128));
        let luminanceSum = 0;
        let luminanceSquared = 0;
        let shadows = 0;
        let highlights = 0;
        let count = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          if (pixels[index + 3] < 128) continue;
          const [red, green, blue] = [pixels[index], pixels[index + 1], pixels[index + 2]];
          const luminance = .2126 * red + .7152 * green + .0722 * blue;
          channels[0][red >> 1] += 1;
          channels[1][green >> 1] += 1;
          channels[2][blue >> 1] += 1;
          channels[3][Math.min(127, Math.floor(luminance / 2))] += 1;
          luminanceSum += luminance;
          luminanceSquared += luminance * luminance;
          if (luminance < 64) shadows += 1;
          if (luminance > 192) highlights += 1;
          count += 1;
        }
        if (!count) throw new Error("Image has no visible pixels.");
        const mean = luminanceSum / count;
        const deviation = Math.sqrt(Math.max(0, luminanceSquared / count - mean * mean));
        onAnalysis({
          tone: mean < 90 ? "低调" : mean > 166 ? "高调" : "均衡",
          brightness: Math.round(mean / 255 * 100),
          contrast: Math.round(deviation / 128 * 100),
          shadows: Math.round(shadows / count * 100),
          highlights: Math.round(highlights / count * 100),
        });

        const canvas = canvasRef.current;
        if (!canvas) return;
        const width = Math.max(128, Math.round(canvas.clientWidth * (window.devicePixelRatio || 1)));
        canvas.width = width;
        canvas.height = 150 * (window.devicePixelRatio || 1);
        const chart = canvas.getContext("2d");
        if (!chart) return;
        const height = canvas.height;
        chart.fillStyle = "#1b1d23";
        chart.fillRect(0, 0, width, height);
        chart.strokeStyle = "rgba(255,255,255,.075)";
        for (let line = 1; line < 4; line += 1) {
          chart.beginPath();
          chart.moveTo(0, height * line / 4);
          chart.lineTo(width, height * line / 4);
          chart.stroke();
        }
        const maximum = Math.max(1, ...channels.flatMap((channel) => [...channel]));
        for (const [channelIndex, color] of ["rgba(255,255,255,.27)", "rgba(249,109,111,.52)", "rgba(97,215,151,.52)", "rgba(97,160,255,.52)"].entries()) {
          const bins = channels[channelIndex === 0 ? 3 : channelIndex - 1];
          chart.fillStyle = color;
          for (let bin = 0; bin < 128; bin += 1) {
            const bar = Math.sqrt(bins[bin] / maximum) * (height - 8);
            chart.fillRect(bin * width / 128, height - bar, Math.max(1, width / 128 - .4), bar);
          }
        }
      } catch {
        if (!cancelled) {
          setError(true);
          onAnalysis(null);
        }
      }
    };
    image.onerror = () => { if (!cancelled) setError(true); };
    image.src = src;
    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
    };
  }, [src, onAnalysis]);

  if (error) return <p className="gallery-inspector__muted">直方图暂不可用</p>;
  return <canvas ref={canvasRef} className="gallery-inspector__histogram" aria-label="照片的 RGB 与亮度直方图" role="img" />;
}

export function GalleryLightboxInspector({ image, open, onToggle }: {
  image: GalleryImage;
  open: boolean;
  onToggle: () => void;
}) {
  const [details, setDetails] = useState<GalleryDetails | null>(null);
  const [analysis, setAnalysis] = useState<ToneAnalysis | null>(null);
  const [shareStatus, setShareStatus] = useState("");

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetch(`/api/gallery/details?id=${encodeURIComponent(image.remoteId)}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() as Promise<GalleryDetails> : null)
      .then((value) => { if (!controller.signal.aborted) setDetails(value); })
      .catch(() => { if (!controller.signal.aborted) setDetails(null); });
    return () => controller.abort();
  }, [image.remoteId, open]);

  const share = async () => {
    const url = new URL("/gallery", window.location.origin);
    url.searchParams.set("photo", image.remoteId);
    try {
      if (navigator.share) {
        await navigator.share({ title: image.title, url: url.toString() });
      } else {
        await navigator.clipboard.writeText(url.toString());
        setShareStatus("链接已复制");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      try {
        await navigator.clipboard.writeText(url.toString());
        setShareStatus("链接已复制");
      } catch {
        setShareStatus("复制失败");
      }
    }
    window.setTimeout(() => setShareStatus(""), 2400);
  };

  const metadata = image.metadata;
  const capture = [metadata.focalLength, metadata.aperture, metadata.shutterSpeed, metadata.iso].filter(Boolean);
  const fileSize = details?.fileSize ? `${(details.fileSize / 1024 / 1024).toFixed(1)} MB` : null;
  const megapixels = details?.width && details?.height
    ? `${Number((details.width * details.height / 1_000_000).toFixed(1))} MP` : null;

  return (
    <>
      <div className="gallery-inspector__actions">
        <button type="button" onClick={share} aria-label="分享这张照片" title="分享这张照片">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="2" /><circle cx="5" cy="12" r="2" /><circle cx="18" cy="19" r="2" /><path d="m7 11 9-5M7 13l9 5" /></svg>
        </button>
        <button type="button" onClick={onToggle} aria-expanded={open} aria-controls="gallery-inspector-panel" aria-label={open ? "收起照片信息" : "查看照片信息"} title="照片信息">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10h.01" /></svg>
        </button>
        <span className="gallery-inspector__share-status" role="status">{shareStatus}</span>
      </div>
      {open && (
        <aside
          className="gallery-inspector"
          id="gallery-inspector-panel"
          aria-label="照片信息"
          onWheelCapture={(event) => event.stopPropagation()}
          onPointerDownCapture={(event) => event.stopPropagation()}
          onTouchStartCapture={(event) => event.stopPropagation()}
        >
          <header className="gallery-inspector__header">
            <div><small>PHOTO DETAILS</small><h2>{image.title}</h2></div>
            <button type="button" onClick={onToggle} aria-label="收起照片信息">×</button>
          </header>
          <div className="gallery-inspector__scroll">
            <section>
              <h3>基本信息</h3>
              <dl>
                <InfoRow label="文件名" value={image.filename || image.title} />
                <InfoRow label="格式" value={details?.format || image.filename?.split(".").at(-1)?.toUpperCase()} />
                <InfoRow label="尺寸" value={details?.width && details?.height ? `${details.width} × ${details.height}` : null} />
                <InfoRow label="文件大小" value={fileSize} />
                <InfoRow label="像素" value={megapixels} />
                <InfoRow label="色彩空间" value={details?.colorSpace} />
                <InfoRow label="拍摄时间" value={formatCaptureTime(metadata.capturedAt)} />
                <InfoRow label="时区" value={details?.timeZone} />
                <InfoRow label="作者" value={details?.artist} />
                <InfoRow label="版权" value={details?.copyright} />
                <InfoRow label="软件" value={details?.software} />
              </dl>
            </section>
            {capture.length > 0 && (
              <section>
                <h3>拍摄参数</h3>
                <div className="gallery-inspector__chips">
                  {metadata.focalLength && <span>◎ {metadata.focalLength}</span>}
                  {metadata.aperture && <span>◉ {metadata.aperture}</span>}
                  {metadata.shutterSpeed && <span>◷ {metadata.shutterSpeed}</span>}
                  {metadata.iso && <span>▣ {metadata.iso}</span>}
                </div>
                {(details?.focalLength35mm || details?.exposureBias || details?.whiteBalance) && (
                  <dl className="gallery-inspector__extra">
                    <InfoRow label="35mm 等效焦距" value={details.focalLength35mm} />
                    <InfoRow label="曝光补偿" value={details.exposureBias} />
                    <InfoRow label="白平衡" value={details.whiteBalance} />
                  </dl>
                )}
              </section>
            )}
            {(metadata.camera || metadata.lens) && (
              <section><h3>设备信息</h3><dl>
                <InfoRow label="相机" value={metadata.camera} />
                <InfoRow label="镜头" value={metadata.lens} />
              </dl></section>
            )}
            <section>
              <h3>缩略图影调分析</h3>
              {analysis && <dl className="gallery-inspector__tones">
                <InfoRow label="影调" value={analysis.tone} />
                <InfoRow label="亮度" value={`${analysis.brightness}%`} />
                <InfoRow label="对比度" value={`${analysis.contrast}%`} />
                <InfoRow label="暗部比例" value={`${analysis.shadows}%`} />
                <InfoRow label="高光比例" value={`${analysis.highlights}%`} />
              </dl>}
              {image.sources[0]?.src && <GalleryHistogram key={image.id} src={image.sources[0].src} onAnalysis={setAnalysis} />}
            </section>
          </div>
        </aside>
      )}
    </>
  );
}
