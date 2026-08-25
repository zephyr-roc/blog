import type { MetadataRoute } from "next";
import { getAllCollections, getPostsInCollection } from "./lib/content";
import { SITE_URL } from "./lib/seo";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const collections = await getAllCollections();
  const postsByCollection = await Promise.all(
    collections.map(async (collection) => ({
      collection,
      posts: await getPostsInCollection(collection.slug),
    })),
  );

  const latestDate = collections
    .map((collection) => collection.latestDate)
    .filter(Boolean)
    .sort()
    .at(-1);
  const tinkering = collections.find((collection) => collection.slug === "tinkering");
  const radar = collections.find((collection) => collection.slug === "deep-radar");

  const staticPages: MetadataRoute.Sitemap = [
    {
      url: `${SITE_URL}/`,
      lastModified: latestDate,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${SITE_URL}/about`,
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: `${SITE_URL}/tinkering`,
      lastModified: tinkering?.latestDate || undefined,
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/radar`,
      lastModified: radar?.latestDate || undefined,
      changeFrequency: "daily",
      priority: 0.9,
    },
  ];

  const collectionPages: MetadataRoute.Sitemap = collections
    .filter(
      (collection) =>
        collection.slug !== "tinkering" && collection.slug !== "deep-radar",
    )
    .map((collection) => ({
      url: `${SITE_URL}/collections/${collection.slug}`,
      lastModified: collection.latestDate || undefined,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    }));

  const postPages: MetadataRoute.Sitemap = postsByCollection.flatMap(
    ({ collection, posts }) =>
      posts.map((post) => ({
        url:
          collection.slug === "tinkering"
            ? `${SITE_URL}/tinkering/${post.slug}`
            : collection.slug === "deep-radar"
              ? `${SITE_URL}/radar/${post.slug}`
              : `${SITE_URL}/collections/${collection.slug}/${post.slug}`,
        lastModified: post.date || undefined,
        changeFrequency: "monthly" as const,
        priority: 0.6,
      })),
  );

  return [...staticPages, ...collectionPages, ...postPages];
}
