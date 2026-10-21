import vinext from "vinext";
import { defineConfig } from "vite";
import nextConfig from "./vinext.config";

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const isNodeDeploy = process.env.NODE_DEPLOY === "1";

export default defineConfig(async () => {
  const plugins = [vinext({ nextConfig })];

  if (!isNodeDeploy) {
    process.env.WRANGLER_WRITE_LOGS ??= "false";
    process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
    process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

    const { cloudflare } = await import("@cloudflare/vite-plugin");
    plugins.push(
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: {
          main: "./worker/index.ts",
          compatibility_flags: ["nodejs_compat"],
        },
      })
    );
  }

  return {
    define: {
      "process.env.NEXT_PUBLIC_SHOW_ICP": JSON.stringify(process.env.SHOW_ICP ?? (process.env.CLOUDFLARE_STATIC === "1" ? "0" : "1")),
      "process.env.NEXT_PUBLIC_STATIC_EXPORT": JSON.stringify(process.env.CLOUDFLARE_STATIC === "1" ? "1" : "0"),
    },
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins,
  };
});
