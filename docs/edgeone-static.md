# EdgeOne 静态构建

控制台框架预设使用 Vite，构建命令 `SHOW_ICP=1 pnpm build`，输出目录 `dist/client`，安装命令 `pnpm install --frozen-lockfile`。根目录 `edgeone.json` 固定构建命令和输出目录，避免控制台默认值指向 `dist`。

项目使用 Vinext 静态导出，不生成标准 Next.js `.next/required-server-files.json`。EdgeOne CLI 会独立检查根目录 `next.config.ts`、`next.config.js` 或 `next.config.mjs`，即使框架预设是 Vite，也可能自动加载 `@edgeone/opennextjs-pages`。该插件在构建完成后尝试读取 `.next` 服务端文件，导致 onBuild 失败。

配置现已移到 `vinext.config.ts`，由 `vite.config.ts` 通过 `vinext({ nextConfig })` 显式传入。静态导出、图片设置和缓存配置保持原样。不要添加假的 `.next` 清单，也不要重新创建根目录 `next.config.*`。

本变更只修复构建识别。EdgeOne 静态托管不运行 `worker/static.ts`，Cloudflare D1 点赞接口仍需单独接入；切换生产源站前还需验证文章直达路径、重定向、分享图片响应类型和点赞。

页脚备案信息在构建阶段决定：Cloudflare 静态构建默认不输出备案号和链接；EdgeOne 通过 `edgeone.json` 中的 `SHOW_ICP=1` 保留展示。无需按访问域名或 IP 在浏览器中判断。若控制台单独覆盖构建命令，也应使用 `SHOW_ICP=1 pnpm build`。


## SSR Node Function 128 MiB 误打包

如果出现 `Checking output: Cloud SSR Node functions package size exceeds 128MiB limit`，说明当前部署流程仍尝试上传 SSR Node Functions，而不是仅上传静态站点。**这种失败发生在发布之前**，所以线上仍是上一个成功部署版本。

本项目的 `pnpm build` 应生成 `dist/client` 静态 HTML、RSC、CSS、JS 和图片。构建后的 `scripts/prepare-cloudflare.mjs` 在生成全部静态文章、RSS、sitemap、分享图后，会移除只供构建时使用的 `dist/server` 与 `dist/standalone`。不要移除 `dist/cloudflare/post-keys.json`，Cloudflare 静态点赞 Worker 在部署时需要它。

在 EdgeOne 控制台的项目设置 → 构建部署配置，确认 **框架预设为 Vite / 静态网站，而不是 Next.js SSR**，构建命令 `SHOW_ICP=1 pnpm build`，输出目录 `dist/client`。如果仍显示 Cloud SSR Node Function 上传阶段，需要检查平台是否启用了自动框架 SSR Adapter；不要为了通过体积检查直接删掉客户端静态文件、图片或文章内容。

另外，静态构建不再强制给 `gallery.html` 注入 `viewport-fit=cover`。Safari 的地址栏/安全区交给浏览器和 Afilmory 本身处理。
