import { GlassCard } from "./GlassCard";

export function AboutProfileCard() {
  return (
    <GlassCard
      className="about-card"
      ariaLabel="关于积雨云的介绍卡片。使用方向键可旋转卡片，按 Escape 复位。"
    >
      <div className="about-card__edge" aria-hidden="true" />
      <div className="about-card__shine" aria-hidden="true" />
      <div className="about-card__header">
        <span>PERSONAL NOTE</span>
        <span>ABOUT · ME</span>
      </div>
      <div
        className="about-card__mark"
        aria-hidden="true"
        style={{
          border: 0,
          background: "transparent",
          boxShadow: "none",
          backdropFilter: "none",
        }}
      >
        <img
          src="/favicon.svg"
          alt=""
          style={{
            display: "block",
            width: "100%",
            height: "100%",
            objectFit: "contain",
            filter: "drop-shadow(0 8px 16px rgba(93, 65, 180, .34))",
          }}
        />
      </div>
      <div className="about-card__content">
        <p>CURRENT FOCUS</p>
        <h2>Code × Motion</h2>
        <p className="about-card__description">
          用清晰的结构承载想法，用恰到好处的动效回应每一次交互。
          喜欢折腾新工具，享受把复杂事物变简单的过程。
        </p>
        <div className="about-card__tags" aria-label="关注方向">
          <span>INTERACTION</span>
          <span>FRONTEND</span>
          <span>CREATIVE CODE</span>
        </div>
      </div>
    </GlassCard>
  );
}
