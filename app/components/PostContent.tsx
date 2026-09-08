import { PostOutline, type OutlineItem } from "./PostOutline";
import { CodeCopyEnhancer } from "./CodeCopyEnhancer";

function plainText(value: string) {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function headingId(value: string, fallback: string) {
  const id = plainText(value)
    .toLocaleLowerCase("zh-CN")
    .replace(/[^\p{Letter}\p{Number}_-]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return id || fallback;
}

function withOutline(html: string) {
  const items: OutlineItem[] = [];
  const usedIds = new Map<string, number>();

  const content = html.replace(
    /<h([234])([^>]*)>([\s\S]*?)<\/h\1>/gi,
    (heading, rawLevel: string, attributes: string, inner: string) => {
      const level = Number(rawLevel) as 2 | 3 | 4;
      const existingId = attributes.match(/\sid=(?:"([^"]+)"|'([^']+)')/i)?.[1]
        ?? attributes.match(/\sid=(?:"([^"]+)"|'([^']+)')/i)?.[2];
      const baseId = existingId || headingId(inner, `section-${items.length + 1}`);
      const duplicate = usedIds.get(baseId) ?? 0;
      const id = duplicate === 0 ? baseId : `${baseId}-${duplicate + 1}`;
      usedIds.set(baseId, duplicate + 1);

      if (level === 2 || level === 3) {
        items.push({ id, level, text: plainText(inner) });
      }
      if (existingId) return heading.replace(existingId, id);
      return `<h${level}${attributes} id="${id}">${inner}</h${level}>`;
    },
  );

  return { content, items };
}

export function PostContent({ html }: { html: string }) {
  const { content, items } = withOutline(html);

  return (
    <div className={`post-reading-layout${items.length === 0 ? " post-reading-layout--plain" : ""}`}>
      {items.length > 0 && <PostOutline items={items} />}
      <div
        className="post-content"
        dangerouslySetInnerHTML={{ __html: content }}
      />
      <CodeCopyEnhancer />
    </div>
  );
}
