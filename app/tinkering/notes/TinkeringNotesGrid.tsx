"use client";

import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { PostMeta } from "../../lib/content";

type TinkeringNotesGridProps = {
  posts: PostMeta[];
};

type NoteStyle = CSSProperties & {
  "--tile-accent": string;
};

const noteAccents = [
  "rgba(127, 82, 255, .30)",
  "rgba(255, 138, 52, .26)",
  "rgba(193, 69, 246, .27)",
  "rgba(84, 179, 255, .24)",
];

function getColumnCount(width: number) {
  if (width >= 1260) return 4;
  if (width >= 940) return 3;
  if (width >= 620) return 2;
  return 1;
}

export function TinkeringNotesGrid({ posts }: TinkeringNotesGridProps) {
  const [query, setQuery] = useState("");
  const [layoutReady, setLayoutReady] = useState(false);
  const waterfallRef = useRef<HTMLDivElement>(null);

  const filteredPosts = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("zh-CN");
    if (!keyword) return posts;

    return posts.filter((post) =>
      [post.title, post.excerpt, post.date]
        .join(" ")
        .toLocaleLowerCase("zh-CN")
        .includes(keyword),
    );
  }, [posts, query]);

  useLayoutEffect(() => {
    const waterfall = waterfallRef.current;
    if (!waterfall) return;

    let animationFrame = 0;
    let previousWidth = 0;

    const layout = () => {
      const width = waterfall.clientWidth;
      if (width <= 0) return;

      const styles = window.getComputedStyle(waterfall);
      const gap = Number.parseFloat(styles.columnGap || styles.gap) || 24;
      const columnCount = getColumnCount(width);
      const columnWidth = (width - gap * (columnCount - 1)) / columnCount;
      const columnHeights = Array.from({ length: columnCount }, () => 0);
      const cards = Array.from(
        waterfall.querySelectorAll<HTMLElement>(":scope > .note-tile"),
      );

      waterfall.style.setProperty("--notes-columns", String(columnCount));

      for (const card of cards) {
        card.style.width = `${columnWidth}px`;
      }

      for (const card of cards) {
        let shortestColumn = 0;

        for (let column = 1; column < columnCount; column += 1) {
          if (columnHeights[column] < columnHeights[shortestColumn]) {
            shortestColumn = column;
          }
        }

        const x = shortestColumn * (columnWidth + gap);
        const y = columnHeights[shortestColumn];

        card.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        columnHeights[shortestColumn] += card.getBoundingClientRect().height + gap;
      }

      const tallestColumn = Math.max(...columnHeights, 0);
      waterfall.style.height = `${Math.max(0, tallestColumn - gap)}px`;
      waterfall.dataset.ready = "true";
      waterfall.setAttribute("aria-busy", "false");
      setLayoutReady(true);
    };

    const scheduleLayout = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(layout);
    };

    setLayoutReady(false);
    layout();
    previousWidth = waterfall.clientWidth;

    const observer = new ResizeObserver((entries) => {
      const containerEntry = entries.find((entry) => entry.target === waterfall);
      const nextWidth = containerEntry?.contentRect.width ?? waterfall.clientWidth;

      if (Math.abs(nextWidth - previousWidth) > 0.5) {
        previousWidth = nextWidth;
        scheduleLayout();
        return;
      }

      if (entries.some((entry) => entry.target !== waterfall)) {
        scheduleLayout();
      }
    });

    observer.observe(waterfall);
    waterfall
      .querySelectorAll<HTMLElement>(":scope > .note-tile")
      .forEach((card) => observer.observe(card));

    document.fonts?.ready.then(scheduleLayout);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      observer.disconnect();
    };
  }, [filteredPosts]);

  return (
    <>
      <div className="notes-search">
        <label className="sr-only" htmlFor="tinkering-search">
          搜索折腾日志
        </label>
        <span className="notes-search__icon" aria-hidden="true">⌕</span>
        <input
          id="tinkering-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索标题、摘要或日期"
          autoComplete="off"
        />
        <span className="notes-search__count" aria-live="polite">
          {filteredPosts.length} / {posts.length}
        </span>
      </div>

      {filteredPosts.length === 0 ? (
        <div className="notes-empty">
          <strong>没有找到相关记录</strong>
          <span>换个关键词试试看。</span>
        </div>
      ) : (
        <div
          className="notes-waterfall"
          data-ready={layoutReady}
          aria-busy={!layoutReady}
          ref={waterfallRef}
        >
          {filteredPosts.map((post, index) => (
            <article
              className="note-tile"
              key={post.slug}
              style={{
                "--tile-accent": noteAccents[index % noteAccents.length],
              } as NoteStyle}
            >
              <a href={`/tinkering/${post.slug}`}>
                {post.cover && (
                  <div className="note-tile__cover">
                    <img src={post.cover} alt="" loading="lazy" />
                  </div>
                )}
                <div className="note-tile__body">
                  <span className="note-tile__index">
                    NOTE {String(index + 1).padStart(2, "0")}
                  </span>
                  <h2>{post.title}</h2>
                  {post.excerpt && <p>{post.excerpt}</p>}
                  <footer>
                    <time dateTime={post.date}>{post.date}</time>
                  </footer>
                </div>
              </a>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
