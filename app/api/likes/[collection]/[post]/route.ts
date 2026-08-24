import { getLikeCount, incrementLikeCount } from "../../../../lib/likes-db";

type RouteContext = {
  params: Promise<{ collection: string; post: string }>;
};

const validSegment = /^[a-z0-9][a-z0-9-]*$/i;

function getKey(collection: string, post: string): string | null {
  if (!validSegment.test(collection) || !validSegment.test(post)) return null;
  return `${collection}/${post}`;
}

function json(count: number, status = 200): Response {
  return Response.json(
    { count },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

export async function GET(_request: Request, { params }: RouteContext) {
  const { collection, post } = await params;
  const key = getKey(collection, post);
  if (!key) return json(0, 400);

  return json(getLikeCount(key));
}

export async function POST(_request: Request, { params }: RouteContext) {
  const { collection, post } = await params;
  const key = getKey(collection, post);
  if (!key) return json(0, 400);

  return json(incrementLikeCount(key));
}
