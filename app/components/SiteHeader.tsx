import Link from "next/link";

type SiteHeaderProps = {
  edition: string;
  home?: boolean;
};

export function SiteHeader({ edition, home = false }: SiteHeaderProps) {
  return (
    <header className="site-header" data-nosnippet>
      <Link
        className="wordmark"
        href={home ? "#collections" : "/"}
        aria-label={home ? "积雨云的空间站首页" : "返回主页"}
      >
        <img
          className="wordmark__mark"
          src="/favicon.svg"
          alt=""
          aria-hidden="true"
        />
        <span>积雨云的空间站</span>
      </Link>
      <span className="edition">{edition}</span>
    </header>
  );
}
