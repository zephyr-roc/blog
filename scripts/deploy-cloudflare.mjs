import { spawnSync } from "node:child_process";

// Wrangler provisions/reuses the DB binding automatically. The Worker creates
// its small additive schema once per isolate, including dashboard deployments.
for (const args of [
  ["exec", "wrangler", "deploy", "--config", "wrangler.static.jsonc"],
]) {
  const result = spawnSync("pnpm", args, { stdio: "inherit", env: process.env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
