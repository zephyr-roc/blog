import {
  type CSSProperties,
  type ReactNode,
} from "react";

type GlassCardProps = {
  children: ReactNode;
  className?: string;
  ariaLabel: string;
  style?: CSSProperties;
  /** When set, wraps card-perspective in a block element so a parent Link works */
  asChild?: boolean;
};

type CardStyle = CSSProperties & Record<`--${string}`, string>;

const clippedBaseStyle: CSSProperties = {
  overflow: "hidden",
  clipPath: "inset(0 round var(--card-radius, 4.93cqw))",
  WebkitClipPath: "inset(0 round var(--card-radius, 4.93cqw))",
  WebkitMaskImage: "linear-gradient(#fff 0 0)",
  contain: "paint",
  transform: "none",
};

const planarBloomStyle: CSSProperties = {
  transform: "none",
};

const initialStyle: CardStyle = {
  "--rotate-x": "0deg",
  "--rotate-y": "0deg",
  "--pointer-x": "50%",
  "--pointer-y": "50%",
  "--shadow-x": "0px",
  "--shadow-y": "34px",
  "--content-shadow-x": "0px",
  "--content-shadow-y": "12px",
  "--content-x": "0px",
  "--content-y": "0px",
  "--logo-x": "0px",
  "--logo-y": "0px",
  "--detail-x": "0px",
  "--detail-y": "0px",
};

export function GlassCard({ children, className = "", ariaLabel, style }: GlassCardProps) {
  return (
    <div className="card-perspective">
      <div
        className={`glass-card ${className}`}
        style={{ ...initialStyle, ...style } as CardStyle}
        data-active="false"
        data-motion-card="true"
        role="group"
        aria-label={ariaLabel}
        tabIndex={-1}
      >
        <div className="glass-card__base" style={clippedBaseStyle} aria-hidden="true">
          <div className="glass-card__surface" />
          <div className="glass-card__edge" />
          <div className="glass-card__shine" />
          <div className="glass-card__bloom" style={planarBloomStyle} />
        </div>
        {children}
      </div>
    </div>
  );
}
