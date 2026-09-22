import { spawn } from "node:child_process";
import process from "node:process";

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env: process.env });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${args.join(" ")} exited with ${signal || code}`));
    });
  });
}

await run(process.execPath, ["scripts/migrate-likes.mjs"]);

const server = spawn(process.execPath, ["server.js"], {
  stdio: "inherit",
  env: process.env,
});

async function startGallerySynchronization() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:3000/api/gallery/bootstrap", {
        method: "POST",
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) {
        console.log("[gallery] Runtime synchronization scheduled.");
        return;
      }
    } catch {
      // The application is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  console.error("[gallery] Unable to start runtime synchronization during startup.");
}

void startGallerySynchronization();

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.kill(signal));
}

server.once("error", (error) => {
  console.error(error);
  process.exit(1);
});
server.once("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
