/// <reference types="vite/client" />

import { marked } from "marked";

// Import Markdown at build time so it is available in the Cloudflare Worker.
// Runtime filesystem paths resolve inside the Worker bundle and cannot reach
// the repository's content directory.
const markdownModules = import.meta.glob("../../content/collections/**/*.md", {
  eager: true,
  import: "default",
  query: "?raw",
}) as Record<string, string>;

const collectionFiles = new Map<string, string>();

for (const [modulePath, raw] of Object.entries(markdownModules)) {
  const match = modulePath.match(/content\/collections\/(.+\.md)$/);
  if (match) collectionFiles.set(match[1], raw);
}

export type CollectionMeta = {
  slug: string;
  title: string;
  description: string;
  color: string;
  icon: string;
  postCount: number;
};

export type PostMeta = {
  slug: string;
  collectionSlug: string;
  title: string;
  date: string;
  excerpt: string;
  chapter: string;
  chapterOrder: number;
};

export type Post = PostMeta & {
  htmlContent: string;
};

// Minimal YAML frontmatter parser — handles string/number/quoted values only.
function parseFrontmatter(raw: string): { data: Record<string, string>; content: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { data: {}, content: raw };

  const data: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const val = line.slice(colon + 1).trim().replace(/^["']|["']$/g, "");
    if (key) data[key] = val;
  }
  return { data, content: match[2] };
}

function getCollectionSlugs(): string[] {
  return [...collectionFiles.keys()]
    .filter((file) => file.endsWith("/_meta.md"))
    .map((file) => file.slice(0, -"/_meta.md".length))
    .sort();
}

function getPostFiles(collectionSlug: string): string[] {
  const prefix = `${collectionSlug}/`;
  return [...collectionFiles.keys()]
    .filter(
      (file) =>
        file.startsWith(prefix) &&
        file.endsWith(".md") &&
        file !== `${prefix}_meta.md` &&
        !file.slice(prefix.length).includes("/"),
    )
    .map((file) => file.slice(prefix.length))
    .sort();
}

export async function getAllCollections(): Promise<CollectionMeta[]> {
  const collections = await Promise.all(getCollectionSlugs().map(getCollection));
  return collections.filter((collection): collection is CollectionMeta => collection !== null);
}

export async function getCollection(slug: string): Promise<CollectionMeta | null> {
  const raw = collectionFiles.get(`${slug}/_meta.md`);
  if (raw === undefined) return null;

  const { data } = parseFrontmatter(raw);

  return {
    slug,
    title: data.title ?? slug,
    description: data.description ?? "",
    color: data.color ?? "#7f52ff",
    icon: data.icon ?? slug,
    postCount: getPostFiles(slug).length,
  };
}

export async function getPostsInCollection(collectionSlug: string): Promise<PostMeta[]> {
  const posts = getPostFiles(collectionSlug).map((file) => {
    const raw = collectionFiles.get(`${collectionSlug}/${file}`)!;
    const { data } = parseFrontmatter(raw);
    const slug = file.replace(/\.md$/, "");

    return {
      slug,
      collectionSlug,
      title: data.title ?? slug,
      date: data.date ? String(data.date).slice(0, 10) : "",
      excerpt: data.excerpt ?? "",
      chapter: data.chapter ?? "文章",
      chapterOrder: Number(data.chapterOrder ?? 999),
    };
  });

  return posts.sort(
    (a, b) => a.chapterOrder - b.chapterOrder || b.date.localeCompare(a.date),
  );
}

export async function getPost(collectionSlug: string, postSlug: string): Promise<Post | null> {
  const raw = collectionFiles.get(`${collectionSlug}/${postSlug}.md`);
  if (raw === undefined) return null;

  const { data, content } = parseFrontmatter(raw);
  const htmlContent = await marked.parse(content);

  return {
    slug: postSlug,
    collectionSlug,
    title: data.title ?? postSlug,
    date: data.date ? String(data.date).slice(0, 10) : "",
    excerpt: data.excerpt ?? "",
    chapter: data.chapter ?? "文章",
    chapterOrder: Number(data.chapterOrder ?? 999),
    htmlContent,
  };
}

export async function getAllPostSlugs(): Promise<Array<{ collection: string; post: string }>> {
  return getCollectionSlugs().flatMap((collection) =>
    getPostFiles(collection).map((file) => ({
      collection,
      post: file.replace(/\.md$/, ""),
    })),
  );
}
