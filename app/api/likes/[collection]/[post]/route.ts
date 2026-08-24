import { dirname } from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";

type RouteContext = {
  params: Promise<{ collection: string; post: string }>;
};

type LikeCounts = Record<string, number>;

const dataFile = process.env.LIKES_DATA_FILE ?? "/tmp/blog-likes.json";
const validSegment = /^[a-z0-9][a-z0-9-]*$/i;
let mutationQueue: Promise<void> = Promise.resolve();

function getKey(collection: string, post: string): string | null {
  if (!validSegment.test(collection) || !validSegment.test(post)) return null;
  return `${collection}/${post}`;
}

async function readCounts(): Promise<LikeCounts> {
  try {
    const raw = await readFile(dataFile, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([key, value]) =>
          typeof key === "string"
          && typeof value === "number"
          && Number.isSafeInteger(value)
          && value >= 0,
      ),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

async function writeCounts(counts: LikeCounts): Promise<void> {
  await mkdir(dirname(dataFile), { recursive: true });
  const temporaryFile = `${dataFile}.${process.pid}.tmp`;
  await writeFile(temporaryFile, JSON.stringify(counts), "utf8");
  await rename(temporaryFile, dataFile);
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

  const counts = await readCounts();
  return json(counts[key] ?? 0);
}

export async function POST(_request: Request, { params }: RouteContext) {
  const { collection, post } = await params;
  const key = getKey(collection, post);
  if (!key) return json(0, 400);

  let nextCount = 0;
  const mutation = mutationQueue.then(async () => {
    const counts = await readCounts();
    nextCount = (counts[key] ?? 0) + 1;
    counts[key] = nextCount;
    await writeCounts(counts);
  });
  mutationQueue = mutation.catch(() => undefined);
  await mutation;

  return json(nextCount);
}
