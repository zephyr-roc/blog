# EdgeOne Vinext Standalone 自动部署

保留 EdgeOne 原有 Git 集成、Vinext 框架和 **standalone 目录**，不使用手动上传。Vinext 官方 standalone 产物位于 `dist/standalone`。

## EdgeOne 构建设置

根目录 `./`，安装 `pnpm install --frozen-lockfile`，构建命令 `SHOW_ICP=1 pnpm build:edgeone`，输出目录 `dist/standalone`。配置在仓库 `edgeone.json`，与上述一致。Node.js 构建版本建议 24.x。

**两套构建相互独立：**

- EdgeOne：`pnpm build:edgeone` → Vinext `output: standalone` → 自动执行 `scripts/optimize-standalone.mjs`。
- Cloudflare：原本的 `pnpm build` 仍然静态导出 `dist/client`、194 篇文章和 388 张分享图，不修改 Cloudflare 部署流程。

## 155 MiB → 128 MiB 的产物优化

Vinext standalone 会复制客户端资源、`public`、服务端及其运行依赖。优化器在 **Vinext 构建和 standalone 拷贝结束之后**执行：

1. 删除 `dist/standalone/node_modules` 中的 source map、`.d.ts` 类型声明、测试目录、说明文档等非运行时内容。
2. 删除 standalone 服务端和根 `dist/server` 的 source map；**不删除实际 JS 服务端入口**。
3. 将 `dist/standalone/public` 与 `dist/standalone/dist/client` 相同路径、相同大小、SHA-256 相同的文件去重，仅删除重复的 `public` 副本。Vinext Node 服务从 `dist/client` 提供静态资源。
4. **保留**运行时 JS、JSON、WASM、原生 `.node`、字体以及不重复的图片和资源；不清理未知作用的依赖。

EdgeOne 日志会出现 `[standalone] 155.xx MiB -> ... MiB` 与最大的 15 个文件。这里是 standalone 目录大小，EdgeOne 最终 SSR Function 打包体积仍可能有所不同。

**限制：** 没有完整 EdgeOne 打包产物，因此目前不能保证一次降至 128 MiB。如果日志仍超过限制，应以优化器提供的文件排名判断下一轮精简点，而不是直接删除 `node_modules` 或禁用照片/分享图。

分享图预渲染对 Cloudflare 静态构建已完成；Standalone 的 `next/og` 路由是否可完全移出服务端依赖需要单独验证，不能只删除 `@vercel/og`，否则可能导致分享图返回 500。
