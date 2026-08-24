import type { PostMeta } from "./content";

export const SITE_URL = "https://www.ready-jump.top";
export const SITE_NAME = "积雨云的空间站";
export const SITE_DESCRIPTION =
  "积雨云的个人技术博客，记录编程语言、系统设计、Linux 与 KVM/QEMU 虚拟化、网络、NAS 和开源工具实践。";

export function absoluteUrl(path: string): string {
  return new URL(path, SITE_URL).toString();
}

export const websiteJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": `${SITE_URL}/#website`,
  url: `${SITE_URL}/`,
  name: SITE_NAME,
  alternateName: ["积雨云", "zephyr-roc"],
  description: SITE_DESCRIPTION,
  inLanguage: "zh-CN",
  publisher: {
    "@type": "Person",
    "@id": `${SITE_URL}/#person`,
    name: "积雨云",
    alternateName: "zephyr-roc",
    url: `${SITE_URL}/about`,
    sameAs: ["https://github.com/zephyr-roc"],
  },
};

export const personJsonLd = {
  "@context": "https://schema.org",
  "@type": "Person",
  "@id": `${SITE_URL}/#person`,
  name: "积雨云",
  alternateName: "zephyr-roc",
  url: `${SITE_URL}/about`,
  sameAs: ["https://github.com/zephyr-roc"],
  description:
    "关注编程语言、系统设计、Linux 虚拟化、网络与数字产品体验的独立开发者。",
};

export function blogPostingJsonLd(post: PostMeta, path: string) {
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.excerpt,
    datePublished: post.date || undefined,
    dateModified: post.date || undefined,
    inLanguage: "zh-CN",
    mainEntityOfPage: absoluteUrl(path),
    image: post.cover ? absoluteUrl(post.cover) : undefined,
    author: {
      "@type": "Person",
      "@id": `${SITE_URL}/#person`,
      name: "积雨云",
      url: `${SITE_URL}/about`,
    },
    publisher: {
      "@type": "Person",
      "@id": `${SITE_URL}/#person`,
      name: "积雨云",
    },
  };
}

export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
