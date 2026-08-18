import { AboutProfileCard } from "../components/AboutProfileCard";

export default function About() {
  return (
    <main className="experience-shell about-shell">
      <div className="ambient ambient--violet" aria-hidden="true" />
      <div className="ambient ambient--orange" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />

      <header className="site-header">
        <a className="wordmark" href="/" aria-label="返回语言卡片主页">
          <span className="wordmark__mark" aria-hidden="true" />
          <span>LANGUAGE / PROFILE</span>
        </a>
        <span className="edition">ABOUT · THE MAKER</span>
      </header>

      <section className="about" aria-labelledby="about-title">
        <div className="about__intro">
          <p className="hero__kicker">ABOUT / THE CREATOR</p>
          <h1 id="about-title">
            让复杂的技术，
            <br />
            拥有可感知的形状。
          </h1>
          <p className="about__lede">
            你好，我是这个页面的创作者。
            <br />
            我喜欢语言、界面，以及那些让数字体验变得自然的微小细节。
          </p>
        </div>

        <AboutProfileCard />
      </section>

      <footer className="site-footer">
        <span>DESIGNED WITH CURIOSITY</span>
        <span>DIGITAL CRAFT · 2026</span>
      </footer>
    </main>
  );
}
