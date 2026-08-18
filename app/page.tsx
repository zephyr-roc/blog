import { KotlinProfileCard } from "./components/KotlinProfileCard";
import { CompactLanguageCard } from "./components/CompactLanguageCard";

const companionLanguages = [
  {
    name: "Nim",
    kind: "nim" as const,
    index: "02",
    theme: "EFFICIENT. EXPRESSIVE.",
    description: "高效而富有表现力，编译为 C。",
    year: "2008",
  },
  {
    name: "Zig",
    kind: "zig" as const,
    index: "03",
    theme: "ROBUST. OPTIMAL.",
    description: "显式控制，面向可靠系统软件。",
    year: "2016",
  },
];

export default function Home() {
  return (
    <main className="experience-shell">
      <div className="ambient ambient--violet" aria-hidden="true" />
      <div className="ambient ambient--orange" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />

      <header className="site-header">
        <a className="wordmark" href="#card" aria-label="Language profile 首页">
          <span className="wordmark__mark" aria-hidden="true" />
          <span>LANGUAGE / PROFILE</span>
        </a>
        <span className="edition">INTERACTIVE STUDY · 01</span>
      </header>

      <section className="hero" aria-labelledby="page-title">
        <div className="hero__intro">
          <p className="hero__kicker">LANGUAGE, IN MOTION</p>
          <h1 id="page-title">
            让想法，跨越
            <br />
            每一个平台。
          </h1>
          <p className="hero__lede">
            三张关于现代语言的交互式名片。
            <br />
            移动指针，感受它的层次与光线。
          </p>
        </div>

        <div className="hero__stage" id="card">
          <div className="card-collection">
            <div className="card-collection__primary">
              <KotlinProfileCard />
            </div>
            {companionLanguages.map((language) => (
              <div className="card-collection__companion" key={language.name}>
                <CompactLanguageCard {...language} />
              </div>
            ))}
          </div>
          <div className="interaction-hint" aria-hidden="true">
            <span className="interaction-hint__line" />
            MOVE TO EXPLORE
          </div>
        </div>
      </section>

      <footer className="site-footer">
        <span>MODERN LANGUAGES · OPEN SOURCE</span>
        <div className="site-footer__actions">
          <span>KOTLIN / NIM / ZIG</span>
          <a
            className="source-download"
            href="/kotlin-nim-zig-glass-cards-source.zip"
            download
          >
            DOWNLOAD SOURCE <span aria-hidden="true">↓</span>
          </a>
        </div>
      </footer>
    </main>
  );
}
