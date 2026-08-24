"use client";

import { useMemo, useState, type CSSProperties } from "react";
import type { PostMeta } from "../../lib/content";

type TinkeringNotesGridProps = {
  posts: PostMeta[];
};

export function TinkeringNotesGrid({ posts }: TinkeringNotesGridProps) {
  const [query, setQuery] = useState("");

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
        <div className="notes-waterfall">
          {filteredPosts.map((post, index) => (
            <article
              className="note-tile"
              key={post.slug}
              style={{ "--note-accent": String((index % 4) + 1) } as CSSProperties}
            >
              <a href={`/tinkering/${post.slug}`}>
                <span className="note-tile__index">
                  NOTE {String(index + 1).padStart(2, "0")}
                </span>
                <h2>{post.title}</h2>
                {post.excerpt && <p>{post.excerpt}</p>}
                <footer>
                  <time dateTime={post.date}>{post.date}</time>
                  <span aria-hidden="true">↗</span>
                </footer>
              </a>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
