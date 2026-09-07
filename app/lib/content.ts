/// <reference types="vite/client" />

import { marked } from "marked";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import gradle from "highlight.js/lib/languages/gradle";
import groovy from "highlight.js/lib/languages/groovy";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import markdown from "highlight.js/lib/languages/markdown";
import ocaml from "highlight.js/lib/languages/ocaml";
import properties from "highlight.js/lib/languages/properties";
import protobuf from "highlight.js/lib/languages/protobuf";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import wasm from "highlight.js/lib/languages/wasm";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

const languages = {
  bash,
  c,
  cpp,
  csharp,
  dockerfile,
  go,
  gradle,
  groovy,
  ini,
  java,
  javascript,
  json,
  kotlin,
  markdown,
  ocaml,
  properties,
  protobuf,
  python,
  rust,
  sql,
  swift,
  typescript,
  wasm,
  xml,
  yaml,
};

for (const [name, grammar] of Object.entries(languages)) {
  hljs.registerLanguage(name, grammar);
}

const languageAliases: Record<string, string> = {
  cxx: "cpp",
  cs: "csharp",
  "c#": "csharp",
  gradle: "gradle",
  html: "xml",
  js: "javascript",
  jsx: "javascript",
  kt: "kotlin",
  kts: "kotlin",
  md: "markdown",
  py: "python",
  rs: "rust",
  sh: "bash",
  shell: "bash",
  ts: "typescript",
  tsx: "typescript",
  yml: "yaml",
};

const languageLabels: Record<string, string> = {
  bash: "Shell",
  c: "C",
  cpp: "C++",
  csharp: "C#",
  dockerfile: "Dockerfile",
  go: "Go",
  gradle: "Gradle",
  groovy: "Groovy",
  ini: "INI",
  java: "Java",
  javascript: "JavaScript",
  json: "JSON",
  kotlin: "Kotlin",
  markdown: "Markdown",
  ocaml: "OCaml",
  properties: "Properties",
  protobuf: "Protocol Buffers",
  python: "Python",
  rust: "Rust",
  sql: "SQL",
  swift: "Swift",
  typescript: "TypeScript",
  wasm: "WebAssembly",
  xml: "HTML / XML",
  yaml: "YAML",
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

marked.use({
  renderer: {
    code({ text, lang }) {
      const declared = lang?.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? "";
      const safeDeclared = /^[a-z0-9_+#.-]+$/.test(declared) ? declared : "";
      const language = languageAliases[safeDeclared] ?? safeDeclared;
      const supported = language !== "" && Boolean(hljs.getLanguage(language));
      const highlighted = supported
        ? hljs.highlight(text, { language, ignoreIllegals: true }).value
        : escapeHtml(text);
      const label = languageLabels[language]
        ?? (safeDeclared ? safeDeclared.toUpperCase() : "");
      const languageClass = supported ? ` hljs language-${language}` : "";
      const languageBadge = label
        ? `<span class="code-block__language">${escapeHtml(label)}</span>`
        : "";
      const copyLabel = label ? `复制 ${label} 代码` : "复制代码";

      return `<div class="code-block"><div class="code-block__toolbar">${languageBadge}<button class="code-block__copy" type="button" aria-label="${escapeHtml(copyLabel)}" hidden>复制</button></div><pre><code class="${languageClass.trim()}">${highlighted}</code></pre></div>\n`;
    },
  },
});

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
  latestDate: string;
};

export type PostMeta = {
  slug: string;
  collectionSlug: string;
  title: string;
  date: string;
  excerpt: string;
  cover: string;
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
  const postFiles = getPostFiles(slug);
  const latestDate = postFiles
    .map((file) => {
      const postRaw = collectionFiles.get(`${slug}/${file}`);
      if (postRaw === undefined) return "";
      return parseFrontmatter(postRaw).data.date?.slice(0, 10) ?? "";
    })
    .filter(Boolean)
    .sort()
    .reverse()[0] ?? "";

  return {
    slug,
    title: data.title ?? slug,
    description: data.description ?? "",
    color: data.color ?? "#7f52ff",
    icon: data.icon ?? slug,
    postCount: postFiles.length,
    latestDate,
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
      cover: data.cover ?? "",
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
    cover: data.cover ?? "",
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
