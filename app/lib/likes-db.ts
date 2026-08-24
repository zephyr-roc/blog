import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const databasePath = process.env.LIKES_DB_PATH ?? join(process.cwd(), ".data", "blog.db");

const globalDatabase = globalThis as typeof globalThis & {
  blogLikesDatabase?: DatabaseSync;
};

function getDatabase(): DatabaseSync {
  if (!globalDatabase.blogLikesDatabase) {
    const database = new DatabaseSync(databasePath);
    database.exec("PRAGMA journal_mode = WAL");
    database.exec("PRAGMA busy_timeout = 5000");
    globalDatabase.blogLikesDatabase = database;
  }
  return globalDatabase.blogLikesDatabase;
}

export function getLikeCount(postKey: string): number {
  const row = getDatabase()
    .prepare("SELECT count FROM post_likes WHERE post_key = ?")
    .get(postKey) as { count: number } | undefined;

  return row?.count ?? 0;
}

export function incrementLikeCount(postKey: string): number {
  const row = getDatabase()
    .prepare(`
      INSERT INTO post_likes (post_key, count)
      VALUES (?, 1)
      ON CONFLICT(post_key) DO UPDATE SET
        count = post_likes.count + 1,
        updated_at = CURRENT_TIMESTAMP
      RETURNING count
    `)
    .get(postKey) as { count: number };

  return row.count;
}
