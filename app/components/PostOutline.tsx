"use client";

import { useEffect, useMemo, useState, type MouseEvent } from "react";

export type OutlineItem = {
  id: string;
  level: 2 | 3;
  text: string;
};

type OutlineGroup = {
  item: OutlineItem;
  children: OutlineItem[];
};

type OutlineTreeProps = {
  activeId: string;
  groups: OutlineGroup[];
  onNavigate: (event: MouseEvent<HTMLAnchorElement>, id: string) => void;
};

function OutlineTree({ activeId, groups, onNavigate }: OutlineTreeProps) {
  return (
    <ol className="post-outline__list">
      {groups.map(({ item, children }) => (
        <li key={item.id}>
          <a
            href={`#${item.id}`}
            data-active={activeId === item.id}
            data-outline-id={item.id}
            onClick={(event) => onNavigate(event, item.id)}
          >
            {item.text}
          </a>
          {children.length > 0 && (
            <ol>
              {children.map((child) => (
                <li key={child.id}>
                  <a
                    href={`#${child.id}`}
                    data-active={activeId === child.id}
                    data-outline-id={child.id}
                    onClick={(event) => onNavigate(event, child.id)}
                  >
                    {child.text}
                  </a>
                </li>
              ))}
            </ol>
          )}
        </li>
      ))}
    </ol>
  );
}

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

    let frame = 0;
    const updateActiveHeading = () => {
      frame = 0;
      const marker = Math.min(160, window.innerHeight * 0.22);
      let current = headings[0].id;

      for (const heading of headings) {
        if (heading.getBoundingClientRect().top > marker) break;
        current = heading.id;
      }

      const pageBottom = window.scrollY + window.innerHeight;
      if (pageBottom >= document.documentElement.scrollHeight - 2) {
        current = headings[headings.length - 1].id;
      }

      setActiveId((previous) => previous === current ? previous : current);
    };
    const scheduleUpdate = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(updateActiveHeading);
    };

    updateActiveHeading();
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [items]);

  useEffect(() => {
    const escapedId = CSS.escape(activeId);
    document
      .querySelectorAll<HTMLElement>(`.post-outline--desktop [data-outline-id="${escapedId}"]`)
      .forEach((link) => {
        const outline = link.closest<HTMLElement>(".post-outline");
        if (!outline || getComputedStyle(outline).display === "none") return;
        const linkRect = link.getBoundingClientRect();
        const outlineRect = outline.getBoundingClientRect();
        if (linkRect.top < outlineRect.top || linkRect.bottom > outlineRect.bottom) {
          outline.scrollTo({
            top: outline.scrollTop + linkRect.top - outlineRect.top - outline.clientHeight / 2,
          });
        }
      });
  }, [activeId]);

  function followLink(event: MouseEvent<HTMLAnchorElement>, id: string) {
    const heading = document.getElementById(id);
    if (!heading) return;

    event.preventDefault();
    window.history.pushState(null, "", `#${encodeURIComponent(id)}`);
    window.scrollTo({
      top: window.scrollY + heading.getBoundingClientRect().top - 28,
      behavior: "smooth",
    });
    setActiveId(id);

    if (window.matchMedia("(max-width: 1179px)").matches) {
      document
        .querySelector<HTMLDetailsElement>(".post-outline--mobile")
        ?.removeAttribute("open");
    }
  }

  return (
    <>
      <aside className="post-outline post-outline--desktop">
      <nav aria-label="文章大纲">
          <OutlineTree activeId={activeId} groups={groups} onNavigate={followLink} />
        </nav>
      </aside>
      <details className="post-outline post-outline--mobile">
        <summary>文章大纲</summary>
        <nav aria-label="文章大纲">
          <OutlineTree activeId={activeId} groups={groups} onNavigate={followLink} />
        </nav>
      </details>
    </>
  );
}
