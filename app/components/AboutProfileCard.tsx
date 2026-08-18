import { GlassCard } from "./GlassCard";

export function AboutProfileCard() {
  return (
    <GlassCard
      className="about-card"
      ariaLabel="关于创作者的交互式介绍卡片。使用方向键可旋转卡片，按 Escape 复位。"
    >
      <div className="about-card__edge" aria-hidden="true" />
      <div className="about-card__shine" aria-hidden="true" />
      <div className="about-card__header">
        <span>PERSONAL NOTE</span>
        <span>02 / 02</span>
      </div>
      <div className="about-card__mark" aria-hidden="true">
        <span>ME</span>
      </div>
      <div className="about-card__content">
        <p>CURRENT FOCUS</p>
        <h2>Code × Motion</h2>
        <p className="about-card__description">
          用清晰的结构承载想法，用恰到好处的动效回应每一次交互。
          这个语言卡片实验，正是我对玻璃质感、空间层次和响应式设计的一次探索。
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
