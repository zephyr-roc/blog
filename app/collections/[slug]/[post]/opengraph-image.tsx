import { getCollection, getPostsInCollection } from "../../../lib/content";
import {
  createPostSocialImage,
  postSocialImageAlt,
  postSocialImageContentType,
  postSocialImageSize,
} from "../../../lib/post-social-image";

export const alt = postSocialImageAlt;
export const size = postSocialImageSize;
export const contentType = postSocialImageContentType;

type Props = { params: Promise<{ slug: string; post: string }> };

export default async function OpenGraphImage({ params }: Props) {
  const { slug, post: postSlug } = await params;
  const [collection, posts] = await Promise.all([
    getCollection(slug),
    getPostsInCollection(slug),
  ]);
  const post = posts.find((candidate) => candidate.slug === postSlug);

  if (!collection || !post) {
    return new Response("Not found", { status: 404 });
  }

  return createPostSocialImage(post, collection);
}
