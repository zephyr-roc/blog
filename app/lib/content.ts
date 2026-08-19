import fs from "fs";
import path from "path";
import { marked } from "marked";

const COLLECTIONS_DIR = path.join(process.cwd(), "content", "collections");

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
};

export type Post = PostMeta & {
  htmlContent: string;
};

// Minimal YAML frontmatter parser — handles string/number/quoted values only.
// Avoids gray-matter's eval() which breaks Rolldown/RSC bundling.
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

export async function getAllCollections(): Promise<CollectionMeta[]> {
  const entries = fs.readdirSync(COLLECTIONS_DIR, { withFileTypes: true });
  const collections: CollectionMeta[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const slug = entry.name;
    const metaPath = path.join(COLLECTIONS_DIR, slug, "_meta.md");
    if (!fs.existsSync(metaPath)) continue;

    const raw = fs.readFileSync(metaPath, "utf-8");
    const { data } = parseFrontmatter(raw);
    const postCount = getPostFiles(slug).length;

    collections.push({
      slug,
      title: data.title ?? slug,
      description: data.description ?? "",
      color: data.color ?? "#7f52ff",
      icon: data.icon ?? slug,
      postCount,
    });
  }

  return collections;
}

export async function getCollection(slug: string): Promise<CollectionMeta | null> {
  const metaPath = path.join(COLLECTIONS_DIR, slug, "_meta.md");
  if (!fs.existsSync(metaPath)) return null;

  const raw = fs.readFileSync(metaPath, "utf-8");
  const { data } = parseFrontmatter(raw);
  const postCount = getPostFiles(slug).length;

  return {
    slug,
    title: data.title ?? slug,
    description: data.description ?? "",
    color: data.color ?? "#7f52ff",
    icon: data.icon ?? slug,
    postCount,
  };
}

export async function getPostsInCollection(collectionSlug: string): Promise<PostMeta[]> {
  const files = getPostFiles(collectionSlug);
  const posts: PostMeta[] = [];

  for (const file of files) {
    const filePath = path.join(COLLECTIONS_DIR, collectionSlug, file);
    const raw = fs.readFileSync(filePath, "utf-8");
    const { data } = parseFrontmatter(raw);
    const slug = file.replace(/\.md$/, "");

    posts.push({
      slug,
      collectionSlug,
      title: data.title ?? slug,
      date: data.date ? String(data.date).slice(0, 10) : "",
      excerpt: data.excerpt ?? "",
    });
  }

  return posts.sort((a, b) => b.date.localeCompare(a.date));
}

export async function getPost(collectionSlug: string, postSlug: string): Promise<Post | null> {
  const filePath = path.join(COLLECTIONS_DIR, collectionSlug, `${postSlug}.md`);
  if (!fs.existsSync(filePath)) return null;

  const raw = fs.readFileSync(filePath, "utf-8");
  const { data, content } = parseFrontmatter(raw);
  const htmlContent = await marked.parse(content);

  return {
    slug: postSlug,
    collectionSlug,
    title: data.title ?? postSlug,
    date: data.date ? String(data.date).slice(0, 10) : "",
    excerpt: data.excerpt ?? "",
    htmlContent,
  };
}

export async function getAllPostSlugs(): Promise<Array<{ collection: string; post: string }>> {
  const entries = fs.readdirSync(COLLECTIONS_DIR, { withFileTypes: true });
  const result: Array<{ collection: string; post: string }> = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const files = getPostFiles(entry.name);
    for (const file of files) {
      result.push({ collection: entry.name, post: file.replace(/\.md$/, "") });
    }
  }

  return result;
}

function getPostFiles(collectionSlug: string): string[] {
  const dir = path.join(COLLECTIONS_DIR, collectionSlug);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== "_meta.md");
}
