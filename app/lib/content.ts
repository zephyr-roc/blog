import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { marked } from "marked";

const COLLECTIONS_DIR = path.join(process.cwd(), "content", "collections");

export type CollectionMeta = {
  slug: string;
  title: string;
  description: string;
  color: string;
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

export async function getAllCollections(): Promise<CollectionMeta[]> {
  const entries = fs.readdirSync(COLLECTIONS_DIR, { withFileTypes: true });
  const collections: CollectionMeta[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const slug = entry.name;
    const metaPath = path.join(COLLECTIONS_DIR, slug, "_meta.md");
    if (!fs.existsSync(metaPath)) continue;

    const raw = fs.readFileSync(metaPath, "utf-8");
    const { data } = matter(raw);
    const postCount = getPostFiles(slug).length;

    collections.push({
      slug,
      title: data.title ?? slug,
      description: data.description ?? "",
      color: data.color ?? "#7f52ff",
      postCount,
    });
  }

  return collections;
}

export async function getCollection(slug: string): Promise<CollectionMeta | null> {
  const metaPath = path.join(COLLECTIONS_DIR, slug, "_meta.md");
  if (!fs.existsSync(metaPath)) return null;

  const raw = fs.readFileSync(metaPath, "utf-8");
  const { data } = matter(raw);
  const postCount = getPostFiles(slug).length;

  return {
    slug,
    title: data.title ?? slug,
    description: data.description ?? "",
    color: data.color ?? "#7f52ff",
    postCount,
  };
}

export async function getPostsInCollection(collectionSlug: string): Promise<PostMeta[]> {
  const files = getPostFiles(collectionSlug);
  const posts: PostMeta[] = [];

  for (const file of files) {
    const filePath = path.join(COLLECTIONS_DIR, collectionSlug, file);
    const raw = fs.readFileSync(filePath, "utf-8");
    const { data } = matter(raw);
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
  const { data, content } = matter(raw);
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
