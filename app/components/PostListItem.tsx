import type { PostMeta } from "../lib/content";

export function PostListItem({
  post,
  href,
}: {
  post: PostMeta;
  href?: string;
}) {
  const dateLabel = post.date
    ? new Date(post.date).toLocaleDateString("zh-CN", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "";

  return (
    <li className="post-list__item">
      <a
        href={href ?? `/collections/${post.collectionSlug}/${post.slug}`}
        className="post-list__link"
      >
        <div className="post-list__meta">
          <time className="post-list__date" dateTime={post.date}>
            {dateLabel}
          </time>
        </div>
        <h2 className="post-list__title">{post.title}</h2>
        {post.excerpt && (
          <p className="post-list__excerpt">{post.excerpt}</p>
        )}
        <span className="post-list__arrow" aria-hidden="true">→</span>
      </a>
    </li>
  );
}
