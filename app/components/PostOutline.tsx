"use client";

import { useEffect, useMemo, useState } from "react";

export type OutlineItem = {
  id: string;
  level: 2 | 3;
  text: string;
};

type OutlineGroup = {
  item: OutlineItem;
  children: OutlineItem[];
};

export function PostOutline({ items }: { items: OutlineItem[] }) {
  const [activeId, setActiveId] = useState(items[0]?.id ?? "");
  const groups = useMemo(() => {
    const result: OutlineGroup[] = [];
    for (const item of items) {
      if (item.level === 2 || result.length === 0) {
        result.push({ item, children: [] });
      } else {
        result[result.length - 1].children.push(item);
      }
    }
    return result;
  }, [items]);

  useEffect(() => {
    const headings = items
      .map(({ id }) => document.getElementById(id))
      .filter((heading): heading is HTMLElement => Boolean(heading));
    if (headings.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]?.target.id) setActiveId(visible[0].target.id);
      },
      { rootMargin: "-16% 0px -72%", threshold: [0, 1] },
    );

    headings.forEach((heading) => observer.observe(heading));
    return () => observer.disconnect();
  }, [items]);

  function followLink() {
    if (window.matchMedia("(max-width: 1049px)").matches) {
      document.querySelector<HTMLDetailsElement>(".post-outline")?.removeAttribute("open");
    }
  }

  return (
    <details className="post-outline" open>
      <summary>文章大纲</summary>
      <nav aria-label="文章大纲">
        <ol className="post-outline__list">
          {groups.map(({ item, children }) => (
            <li key={item.id}>
              <a href={`#${item.id}`} data-active={activeId === item.id} onClick={followLink}>
                {item.text}
              </a>
              {children.length > 0 && (
                <ol>
                  {children.map((child) => (
                    <li key={child.id}>
                      <a href={`#${child.id}`} data-active={activeId === child.id} onClick={followLink}>
                        {child.text}
                      </a>
                    </li>
                  ))}
                </ol>
              )}
            </li>
          ))}
        </ol>
      </nav>
    </details>
  );
}
