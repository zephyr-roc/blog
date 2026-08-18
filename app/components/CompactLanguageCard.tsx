import { GlassCard } from "./GlassCard";

type LanguageKind = "nim" | "zig";

type CompactLanguageCardProps = {
  name: string;
  kind: LanguageKind;
  index: string;
  theme: string;
  description: string;
  year: string;
};

function LanguageMark({ kind, name }: Pick<CompactLanguageCardProps, "kind" | "name">) {
  return (
    <div
      className={`language-mark language-mark--${kind}`}
      role="img"
      aria-label={`${name} Logo`}
    >
      {kind === "nim" ? (
        <>
          <span className="nim-crown" aria-hidden="true" />
          <span className="language-mark__word">N</span>
        </>
      ) : (
        <img className="zig-mark" src="/zig-logomark.svg" alt="" aria-hidden="true" />
      )}
    </div>
  );
}

export function CompactLanguageCard({
  name,
  kind,
  index,
  theme,
  description,
  year,
}: CompactLanguageCardProps) {
  return (
    <GlassCard
      className={`mini-card mini-card--${kind}`}
      ariaLabel={`${name} 语言介绍卡片。使用方向键可旋转卡片，按 Escape 复位。`}
    >
      <div className="mini-card__index" aria-hidden="true">
        <span>LANGUAGE PROFILE</span>
        <span>{index} / 03</span>
      </div>

      <div className="mini-card__logo">
        <LanguageMark kind={kind} name={name} />
      </div>

      <div className="mini-card__year" aria-label={`${name} 于 ${year} 年发布`}>
        SINCE {year}
      </div>

      <div className="mini-card__content">
        <p>{theme}</p>
        <h2>{name}</h2>
        <span>{description}</span>
      </div>
    </GlassCard>
  );
}
