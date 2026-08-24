import type { Metadata } from "next";
import { AboutProfileCard } from "../components/AboutProfileCard";
import {
  personJsonLd,
  serializeJsonLd,
  SITE_NAME,
} from "../lib/seo";

const ABOUT_DESCRIPTION =
  "积雨云（zephyr-roc）的个人介绍：关注编程语言、系统设计、Linux 虚拟化、网络与数字产品体验。";

export const metadata: Metadata = {
  title: "关于我",
  description: ABOUT_DESCRIPTION,
  alternates: { canonical: "/about" },
  openGraph: {
    type: "profile",
    locale: "zh_CN",
    url: "/about",
    siteName: SITE_NAME,
    title: `关于我 — ${SITE_NAME}`,
    description: ABOUT_DESCRIPTION,
  },
};

export default function About() {
  return (
    <main className="experience-shell about-shell">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(personJsonLd) }}
      />
      <div className="ambient ambient--violet" aria-hidden="true" />
      <div className="ambient ambient--orange" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />

      <header className="site-header" data-nosnippet>
        <a className="wordmark" href="/" aria-label="返回主页">
          <span className="wordmark__mark" aria-hidden="true" />
          <span>积雨云的空间站</span>
        </a>
        <span className="edition">ABOUT · ME</span>
      </header>

      <section className="about" aria-labelledby="about-title">
        <div className="about__intro">
          <p className="hero__kicker" data-nosnippet>ABOUT / THE CREATOR</p>
          <h1 id="about-title">
            你好，
            <br />
            我是积雨云。
          </h1>
          <p className="about__lede">
            喜欢折腾代码、界面与那些让数字体验变得自然的微小细节。
            <br />
            这里记录我的想法、实验与随笔。
          </p>
        </div>

        <AboutProfileCard />
      </section>

      <footer className="site-footer" data-nosnippet>
        <span>DESIGNED WITH CURIOSITY</span>
        <span>DIGITAL CRAFT · 2026</span>
      </footer>
    </main>
  );
}
