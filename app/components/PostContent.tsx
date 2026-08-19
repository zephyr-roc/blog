export function PostContent({ html }: { html: string }) {
  return (
    <div
      className="post-content"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
