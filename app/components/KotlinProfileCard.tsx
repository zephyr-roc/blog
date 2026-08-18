import { GlassCard } from "./GlassCard";
import { KotlinLogo } from "./KotlinLogo";

type PlatformTagProps = {
  children: string;
};

function PlatformTag({ children }: PlatformTagProps) {
  return <span className="platform-tag">{children}</span>;
}

function CardIndex() {
  return (
    <div className="card-index" aria-hidden="true">
      <span>LANGUAGE PROFILE</span>
      <span>01 / 03</span>
    </div>
  );
}

export function KotlinProfileCard() {
  return (
    <GlassCard
      className="kotlin-card"
      ariaLabel="Kotlin 语言介绍卡片。使用方向键可旋转卡片，按 Escape 复位。"
    >
      <CardIndex />

      <KotlinLogo className="kotlin-card__logo" />

      <div className="kotlin-card__meta">
        <span className="status-dot" aria-hidden="true" />
        OPEN SOURCE
      </div>

      <div className="kotlin-card__content">
        <p className="kotlin-card__eyebrow">MODERN. CONCISE. SAFE.</p>
        <h2>Kotlin</h2>
        <p className="kotlin-card__description">
          一门现代、简洁且安全的编程语言。
          <br />
          与 Java 无缝互操作，为多平台而生。
        </p>
        <div className="kotlin-card__tags" aria-label="Kotlin 支持的平台">
          <PlatformTag>JVM</PlatformTag>
          <PlatformTag>ANDROID</PlatformTag>
          <PlatformTag>MULTIPLATFORM</PlatformTag>
        </div>
      </div>

      <div className="kotlin-card__year" aria-label="Kotlin 于 2011 年发布">
        <span>SINCE</span>
        2011
      </div>
    </GlassCard>
  );
}
