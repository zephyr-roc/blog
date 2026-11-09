# EdgeOne 自动构建：Vinext 静态导出

本项目仍由 EdgeOne Git 集成自动构建和部署，不使用“直接上传”项目，也不需要手动下载 GitHub Actions 构建包。

## 构建配置

仓库根目录 `edgeone.json`：

```json
{
  "buildCommand": "SHOW_ICP=1 pnpm build",
  "outputDirectory": "dist/client"
}
```

安装命令为 `pnpm install --frozen-lockfile`，包管理器 pnpm 11。Node.js 最好选 24.x；若日志仍提示 Node 22 的 engine warning，只要后续构建成功，它不是当前的阻塞点。

项目仍使用 Vinext（Vite 8 + React 19），静态页面采用 `output: "export"`，CSS/JS、HTML、RSC、RSS、站点地图、分享图等由 `dist/client` 提供。备案号在 EdgeOne 构建中由 `SHOW_ICP=1` 启用。不要添加伪造的 `next.config.*` 或 `.next` 清单。

## SSR 产物与 128 MiB 限制

在 2026 年 11 月的构建日志中：

- `Prerendered 209 routes`
- `194 article keys`
- `388 social images`

分享卡片已经在 `scripts/prepare-cloudflare.mjs` **构建阶段生成到 `dist/client`**，并不需要在用户请求时运行 `next/og` SSR。RSS、sitemap、robots 同样在构建时导出。

然而 EdgeOne 的构建后检测仍要求同时存在 `dist/client` 与 `dist/server`，所以不能删除 `dist/server`；这样做会报：

```text
[StaticAssetsBuilder][✘] Vinext build did not emit dist/client and dist/server
```

当前构建脚本完成分享图导出后：

1. **保留真实的 `dist/server`** 和所有运行时 JS 依赖，不用空文件假装 SSR 入口；
2. 移除可选的 `*.map` 服务端 source map；
3. 删除重复的 `dist/standalone` Node 发行包；
4. 输出 `Retained dist/server: ... MiB` 及 12 个最大的服务器端文件，供下一轮体积优化定位。

**注意：** Vinext 的 SSR Node Function 在 EdgeOne 最终打包时可能还会被追踪 `node_modules` 等依赖，因此 `dist/server` 的目录大小**不等于**平台最终检测的函数包大小。此前平台曾提示 155 MiB > 128 MiB，本轮的安全清理不能保证最终降到 128 MiB 以下。如果还有体积错误，应该根据新的 Top 12 文件和打包日志针对性剔除构建期依赖，而非破坏服务器依赖图。

EdgeOne 静态托管不运行 `worker/static.ts`（这个文件只用于 Cloudflare D1 点赞 API）；迁移域名时还需确认点赞的 API 回源、文章直达路径、分享图 MIME、重定向与画廊。

## 排查与验证

保留构建命令 `SHOW_ICP=1 pnpm build`、输出 `dist/client`，并在 EdgeOne Git 部署日志中核对：

```text
Cloudflare static build ready: ...
Retained dist/server: ... MiB
All social cards are pre-rendered in dist/client
```

若依旧有 `Cloud SSR Node functions package size exceeds 128MiB limit`，继续排查服务器依赖尺寸；若仍有 `Vinext build did not emit dist/client and dist/server`，则检查构建是否真的使用到本次更新的 commit。

Safari 画廊不会再被构建脚本强制注入 `viewport-fit=cover`；这和 SSR 包体积是独立问题。
