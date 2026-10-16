# EdgeOne 静态构建

控制台框架预设使用 Vite，构建命令 `pnpm build`，输出目录 `dist/client`，安装命令 `pnpm install --frozen-lockfile`。根目录 `edgeone.json` 固定构建命令和输出目录，避免控制台默认值指向 `dist`。

项目使用 Vinext 静态导出，不生成标准 Next.js `.next/required-server-files.json`。EdgeOne CLI 会独立检查根目录 `next.config.ts`、`next.config.js` 或 `next.config.mjs`，即使框架预设是 Vite，也可能自动加载 `@edgeone/opennextjs-pages`。该插件在构建完成后尝试读取 `.next` 服务端文件，导致 onBuild 失败。

配置现已移到 `vinext.config.ts`，由 `vite.config.ts` 通过 `vinext({ nextConfig })` 显式传入。静态导出、图片设置和缓存配置保持原样。不要添加假的 `.next` 清单，也不要重新创建根目录 `next.config.*`。

本变更只修复构建识别。EdgeOne 静态托管不运行 `worker/static.ts`，Cloudflare D1 点赞接口仍需单独接入；切换生产源站前还需验证文章直达路径、重定向、分享图片响应类型和点赞。
