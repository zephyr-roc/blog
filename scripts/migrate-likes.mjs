import { mkdir, readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const databasePath = process.env.LIKES_DB_PATH ?? join(process.cwd(), ".data", "blog.db");
const migrationsDirectory = fileURLToPath(new URL("../db/migrations/", import.meta.url));

await mkdir(dirname(databasePath), { recursive: true });

const database = new DatabaseSync(databasePath);
database.exec("PRAGMA journal_mode = WAL");
database.exec("PRAGMA busy_timeout = 5000");
database.exec(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);

const applied = database.prepare(
  "SELECT 1 FROM schema_migrations WHERE version = ?",
);
const record = database.prepare(
  "INSERT INTO schema_migrations (version) VALUES (?)",
);

const migrationFiles = (await readdir(migrationsDirectory))
  .filter((file) => /^\d+.*\.sql$/.test(file))
  .sort();

for (const file of migrationFiles) {
  if (applied.get(file)) continue;

  const sql = await readFile(join(migrationsDirectory, file), "utf8");
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(sql);
    record.run(file);
    database.exec("COMMIT");
    console.log(`Applied migration: ${file}`);
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

database.close();
console.log(`SQLite migrations complete: ${databasePath}`);
