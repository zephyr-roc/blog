"use client";

import Link from "next/link";
import type { ComponentProps } from "react";

// Static exports use ordinary document navigation: no runtime RSC endpoint
// is needed, and every destination can be served by Cloudflare Static Assets.
export default function SiteLink(props: ComponentProps<typeof Link>) {
  if (process.env.NEXT_PUBLIC_STATIC_EXPORT === "1") {
    const { href, children, ...rest } = props;
    delete rest.prefetch;
    delete rest.replace;
    delete rest.scroll;
    return <a {...rest} href={typeof href === "string" ? href : href.pathname ?? "/"}>{children}</a>;
  }
  return <Link {...props} />;
}
