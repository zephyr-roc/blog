# EdgeOne 静态构建

控制台框架预设必须选择 **Other（其他框架/纯静态）**，构建命令 `SHOW_ICP=1 pnpm build`，输出目录 `dist/client`，安装命令 `pnpm install --frozen-lockfile`。根目录 `edgeone.json` 固定构建命令和输出目录，避免控制台默认值指向 `dist`。

项目使用 Vinext 静态导出，不生成标准 Next.js `.next/required-server-files.json`。EdgeOne CLI 会独立检查根目录 `next.config.ts`、`next.config.js` 或 `next.config.mjs`，即使框架预设是 Vite，也可能自动加载 `@edgeone/opennextjs-pages`。该插件在构建完成后尝试读取 `.next` 服务端文件，导致 onBuild 失败。

配置现已移到 `vinext.config.ts`，由 `vite.config.ts` 通过 `vinext({ nextConfig })` 显式传入。静态导出、图片设置和缓存配置保持原样。不要添加假的 `.next` 清单，也不要重新创建根目录 `next.config.*`。

本变更只修复构建识别。EdgeOne 静态托管不运行 `worker/static.ts`，Cloudflare D1 点赞接口仍需单独接入；切换生产源站前还需验证文章直达路径、重定向、分享图片响应类型和点赞。

页脚备案信息在构建阶段决定：Cloudflare 静态构建默认不输出备案号和链接；EdgeOne 通过 `edgeone.json` 中的 `SHOW_ICP=1` 保留展示。无需按访问域名或 IP 在浏览器中判断。若控制台单独覆盖构建命令，也应使用 `SHOW_ICP=1 pnpm build`。


## SSR Node Function 128 MiB 误打包

如果出现 `Checking output: Cloud SSR Node functions package size exceeds 128MiB limit`，说明当前部署流程仍尝试上传 SSR Node Functions，而不是仅上传静态站点。**这种失败发生在发布之前**，所以线上仍是上一个成功部署版本。

本项目的 `pnpm build` 应生成 `dist/client` 静态 HTML、RSC、CSS、JS 和图片。构建后的 `scripts/prepare-cloudflare.mjs` 在生成全部静态文章、RSS、sitemap、分享图后，会移除只供构建时使用的 `dist/server` 与 `dist/standalone`。不要移除 `dist/cloudflare/post-keys.json`，Cloudflare 静态点赞 Worker 在部署时需要它。

在 EdgeOne 控制台的项目设置 → 构建部署配置，确认 **框架预设为 Other / 其他框架（纯静态），而不是 Vinext / Next.js SSR**，构建命令 `SHOW_ICP=1 pnpm build`，输出目录 `dist/client`。如果仍显示 Cloud SSR Node Function 上传阶段，需要检查平台是否启用了自动框架 SSR Adapter；不要为了通过体积检查直接删掉客户端静态文件、图片或文章内容。

另外，静态构建不再强制给 `gallery.html` 注入 `viewport-fit=cover`。Safari 的地址栏/安全区交给浏览器和 Afilmory 本身处理。

## 2026-11：静态导出被误识别为 Vinext SSR

若构建日志先出现 `Cloudflare static build ready` 和 `Pruned build-only SSR output`，紧接着报：

```text
[StaticAssetsBuilder][✘] Vinext build did not emit dist/client and dist/server
```

说明 HTML、图片和客户端资源已完成生成，**失败发生于 EdgeOne 对框架产物的二次识别**。`dist/server` 是用于**构建时**预渲染动态页面、RSS 和分享卡片的服务端产物，清理它是有意的：因为此前保留时触发了 `Cloud SSR Node functions package size exceeds 128MiB limit (155MiB)`。

EdgeOne 应按 **Other / 其他框架（纯静态网站）** 部署本项目，而不是 Vinext/SSR。**注意：`edgeone.json` 官方配置项只支持覆盖构建命令、输出目录等，并不包含顶层 `framework` 预设覆盖字段。** 因此，提交 `"framework": "other"` 并不会改变 EdgeOne 当前项目的框架识别；必须在控制台的 **项目设置 → 构建部署配置 → 框架预设** 选择 Other / 其他框架，或者使用官方 SDK 的 `projects.update({projectId, framework: "other"})` 更新项目级设置。`edgeone.json` 仅保留 `buildCommand` 和 `outputDirectory`。

如果平台仍显示 `Vinext build did not emit dist/client and dist/server`，说明构建任务仍沿用 Vinext 适配器。到 **项目设置 → 构建部署配置**，将框架预设改为 **Other / 其他框架（静态）**，保留构建命令 `SHOW_ICP=1 pnpm build` 与输出目录 `dist/client`，然后重新部署。若明确切换后仍被识别为 Vinext，使用部署日志中的任务编号向 EdgeOne 技术支持反馈自动识别异常；不要恢复打包 `dist/server` 或编造服务端入口作为绕过方式，否则可能重新遇到 128 MiB 限制。

`Unsupported engine wanted node >=24` 是独立警告，本次 209 个路由及 194 篇文章均已完成静态导出，不是导致此错误的直接原因。当前编译环境使用 Node 22；如平台支持，可另行升级构建 Node 版本，但不要把版本警告和 SSR 产物识别错误混为一谈。

## 当 EdgeOne 误走 Vinext 检查器：使用预编译静态包

如果你的 EdgeOne 项目已经把框架预设改成 Other（静态），但构建后仍然出现：

```text
[StaticAssetsBuilder][✘] Vinext build did not emit dist/client and dist/server
```

那么已经不是博客构建失败，而是平台在发布阶段仍将 Vinext 静态导出误判为 SSR 构建。不要继续让 `dist/server` 复活或添加假的 SSR 入口——此前会打出超过 128 MiB 的 Node 云函数。

仓库新增**仅手动触发**的 GitHub Actions 工作流 `Build EdgeOne static artifact`：

1. 打开 [GitHub Actions](https://github.com/zephyr-roc/blog/actions/workflows/build-edgeone-static.yml)，点击 **Run workflow**，选择 `main`。
2. 构建完成后，下载名为 **edgeone-static-site** 的构建 Artifact。它是一个 ZIP，内部根目录应有 `index.html`、`gallery.html` 等静态文件。
3. EdgeOne 官方 **直接上传**方式不会重新运行构建，因此能绕开 Vinext SSR 产物检查。创建新的 **Direct Upload / 直接上传** 类型项目，上传该 ZIP，先用预览域名验证主页、画廊、文章和分享图，再考虑迁移自定义域名。

**重要限制**：官方文档说明直接上传项目不能切换成 Git 集成项目；CLI 关联现有项目时也要求其属于直接上传类型。所以这属于单独的静态托管项目，不会自动替换原 Git 集成项目，**不要在确认一切正常前迁移现有域名**。

此外，当前 EdgeOne 静态托管不会自动运行 Cloudflare D1 点赞 Worker；如需点赞功能，继续使用 Cloudflare 部署或单独部署点赞 API。直接上传解决的是页面/资源交付问题，不等价于迁移动态 API。

资料：[EdgeOne 直接上传](https://pages.edgeone.ai/document/direct-upload) · [EdgeOne CLI](https://pages.edgeone.ai/document/edgeone-cli)
