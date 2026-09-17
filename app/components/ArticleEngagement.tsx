"use client";

import { useEffect, useRef, useState } from "react";
import { Glass, type GlassOptics } from "./liquid-glass";
import { GiscusComments } from "./GiscusComments";

const actionGlassOptics: Partial<GlassOptics> = {
  strength: .2,
  scaleX: .22,
  scaleY: .18,
  depth: .92,
  curvature: .72,
  bend: .88,
  bendWidth: .28,
  dispersion: 0,
  frost: 1,
  saturate: 1.35,
  specular: 0,
  sheen: 0,
  sheenWidth: 2.5,
  glow: 0,
};

const GITHUB_PROBE_URL = "https://github.com/favicon.ico";
const GITHUB_PROBE_TIMEOUT = 4000;

type GitHubAvailability = "checking" | "available" | "unavailable";

function canReachGitHub(signal: AbortSignal) {
  if (!navigator.onLine) return Promise.resolve(false);

  return new Promise<boolean>((resolve) => {
    const probe = new Image();
    let settled = false;

    const finish = (available: boolean) => {
      if (settled) return;
      settled = true;
      probe.onload = null;
      probe.onerror = null;
      signal.removeEventListener("abort", abort);
      resolve(available);
    };
    const abort = () => finish(false);

    probe.onload = () => finish(true);
    probe.onerror = () => finish(false);
    probe.referrerPolicy = "no-referrer";
    signal.addEventListener("abort", abort, { once: true });
    probe.src = GITHUB_PROBE_URL;
  });
}

function canonicalShareUrl() {
  return `${window.location.origin}${window.location.pathname}`;
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Unable to copy article URL");
}

export function ArticleEngagement({
  collectionSlug,
  postSlug,
  title,
}: {
  collectionSlug: string;
  postSlug: string;
  title: string;
}) {
  const endpoint = `/api/likes/${encodeURIComponent(collectionSlug)}/${encodeURIComponent(postSlug)}`;
  const storageKey = `blog-liked:${collectionSlug}/${postSlug}`;
  const [count, setCount] = useState(0);
  const [liked, setLiked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [githubAvailability, setGitHubAvailability] = useState<GitHubAvailability>("checking");
  const [shareStatus, setShareStatus] = useState<"idle" | "copied" | "failed">("idle");
  const shareResetTimer = useRef<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        setLiked(window.localStorage.getItem(storageKey) === "1");
      }
    });
    fetch(endpoint, { cache: "no-store", signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Unable to load like count");
        return response.json() as Promise<{ count: number }>;
      })
      .then((data) => setCount(data.count))
      .catch(() => undefined)
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [endpoint, storageKey]);

  useEffect(() => () => {
    if (shareResetTimer.current !== null) {
      window.clearTimeout(shareResetTimer.current);
    }
  }, []);

  useEffect(() => {
    let activeController: AbortController | null = null;
    let disposed = false;

    const checkGitHub = async () => {
      activeController?.abort();
      const controller = new AbortController();
      activeController = controller;
      setGitHubAvailability("checking");
      const timeout = window.setTimeout(
        () => controller.abort(),
        GITHUB_PROBE_TIMEOUT,
      );
      const available = await canReachGitHub(controller.signal);
      window.clearTimeout(timeout);

      if (!disposed && activeController === controller) {
        setGitHubAvailability(available ? "available" : "unavailable");
      }
    };

    const markUnavailable = () => {
      activeController?.abort();
      setGitHubAvailability("unavailable");
    };

    void checkGitHub();
    window.addEventListener("online", checkGitHub);
    window.addEventListener("offline", markUnavailable);

    return () => {
      disposed = true;
      activeController?.abort();
      window.removeEventListener("online", checkGitHub);
      window.removeEventListener("offline", markUnavailable);
    };
  }, []);

  const like = async () => {
    if (liked || loading) return;

    setLoading(true);
    try {
      const response = await fetch(endpoint, { method: "POST" });
      if (!response.ok) throw new Error("Unable to like post");
      const data = await response.json() as { count: number };
      setCount(data.count);
      setLiked(true);
      window.localStorage.setItem(storageKey, "1");
    } finally {
      setLoading(false);
    }
  };

  const resetShareStatusLater = () => {
    if (shareResetTimer.current !== null) {
      window.clearTimeout(shareResetTimer.current);
    }
    shareResetTimer.current = window.setTimeout(() => {
      setShareStatus("idle");
      shareResetTimer.current = null;
    }, 2200);
  };

  const share = async () => {
    const url = canonicalShareUrl();

    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        return;
      }

      await copyText(url);
      setShareStatus("copied");
      resetShareStatusLater();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;

      try {
        await copyText(url);
        setShareStatus("copied");
      } catch {
        setShareStatus("failed");
      }
      resetShareStatusLater();
    }
  };

  const shareLabel = shareStatus === "copied"
    ? "已复制链接"
    : shareStatus === "failed"
      ? "复制失败"
      : "分享";

  return (
    <footer className="article-engagement">
      <div
        className="article-engagement__actions"
        aria-label="文章操作"
        data-github-status={githubAvailability}
      >
        <div className="article-engagement__action" data-active={liked}>
          <Glass
            className="article-engagement__glass"
            radius={999}
            optics={actionGlassOptics}
            aria-hidden="true"
          >
            <span className="article-engagement__glass-tint" />
          </Glass>
          <button
            className="article-engagement__button"
            type="button"
            onClick={like}
            disabled={liked || loading}
            aria-pressed={liked}
            aria-label={liked ? `已点赞，共 ${count} 次点赞` : `点赞，共 ${count} 次点赞`}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20.8 5.9a5.3 5.3 0 0 0-7.5 0L12 7.2l-1.3-1.3a5.3 5.3 0 0 0-7.5 7.5L12 22l8.8-8.6a5.3 5.3 0 0 0 0-7.5Z" />
            </svg>
            <span>{loading ? "读取中" : liked ? "已点赞" : "点赞"}</span>
            <span className="article-engagement__count" aria-hidden="true">{count}</span>
          </button>
        </div>

        {githubAvailability === "available" ? (
          <div className="article-engagement__action">
            <Glass
              className="article-engagement__glass"
              radius={999}
              optics={actionGlassOptics}
              aria-hidden="true"
            >
              <span className="article-engagement__glass-tint" />
            </Glass>
            <button
              className="article-engagement__button"
              type="button"
              onClick={share}
              aria-label={shareLabel}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 15V3m0 0L7.5 7.5M12 3l4.5 4.5M5 12.5v6.25A2.25 2.25 0 0 0 7.25 21h9.5A2.25 2.25 0 0 0 19 18.75V12.5" />
              </svg>
              <span aria-live="polite">{shareLabel}</span>
            </button>
          </div>
        ) : null}
      </div>

      {githubAvailability === "available" ? <GiscusComments /> : null}
    </footer>
  );
}
