"use client";

import {
  useEffect,
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
  const [columnCount, setColumnCount] = useState(1);
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

  useEffect(() => {
    const waterfall = waterfallRef.current;
    if (!waterfall) return;

    const updateColumns = (width: number) => {
      setColumnCount(getColumnCount(width));
    };

    updateColumns(waterfall.clientWidth);

    const observer = new ResizeObserver(([entry]) => {
      updateColumns(entry.contentRect.width);
    });
    observer.observe(waterfall);

    return () => observer.disconnect();
  }, []);

  const columns = useMemo(() => {
    const nextColumns = Array.from(
      { length: columnCount },
      () => [] as Array<{ post: PostMeta; index: number }>,
    );

    filteredPosts.forEach((post, index) => {
      nextColumns[index % columnCount].push({ post, index });
    });

    return nextColumns;
  }, [columnCount, filteredPosts]);

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
          ref={waterfallRef}
          style={{ "--notes-columns": columnCount } as CSSProperties}
        >
          {columns.map((column, columnIndex) => (
            <div className="notes-waterfall__column" key={columnIndex}>
              {column.map(({ post, index }) => (
                <article
                  className="note-tile"
                  key={post.slug}
                  style={{
                    "--tile-accent": noteAccents[index % noteAccents.length],
                  } as NoteStyle}
                >
                  <a href={`/tinkering/${post.slug}`}>
                    <span className="note-tile__index">
                      NOTE {String(index + 1).padStart(2, "0")}
                    </span>
                    <h2>{post.title}</h2>
                    {post.excerpt && <p>{post.excerpt}</p>}
                    <footer>
                      <time dateTime={post.date}>{post.date}</time>
                    </footer>
                  </a>
                </article>
              ))}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
