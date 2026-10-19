# Cloudflare 静态迁移

生产 Worker：`blog`，预览地址 https://blog.zhourongjun1234.workers.dev/ 。Cloudflare 已连接 GitHub 自动部署，原腾讯云 Docker workflow 已移除，不再运行重复部署。

## 构建设置

- 根目录：仓库根目录
- 构建命令：`pnpm build`
- 部署命令：`pnpm exec wrangler deploy`
- Node.js：24
- Wrangler 配置：根目录 `wrangler.static.jsonc`；构建生成标准 `.wrangler/deploy/config.json`，默认部署命令会自动找到它，也可显式指定 `--config wrangler.static.jsonc`。

所有文章、页面、CSS、JS、RSS、robots、sitemap、分享卡片和文章图片由 Workers Static Assets 提供。只有 `/api/*` 运行 `worker/static.ts`。静态模式使用普通文档跳转，不依赖运行时 RSC 接口；文章灯箱、目录、底部导航等交互仍会水合。

画廊内嵌 https://nas.afilmory.ready-jump.top/ ，照片管理在 Afilmory 完成。博客不再上传、保存或转换画廊照片，也不再使用 GitHub OAuth。原服务器的照片数据不受源码删除影响。

## 尽量保持零费用

保持 Workers Free，不开通 Workers Paid、R2、Images、KV 或其他付费产品。静态资源请求免费；点赞 API 和 D1 受免费额度限制。点赞接近文章底部才加载，GET 使用浏览器及边缘缓存。额度耗尽时点赞可能暂时不可用，文章静态资源仍可访问。Afilmory 的额度与账单独立计算。

官方定价：https://developers.cloudflare.com/workers/platform/pricing/ 与 https://developers.cloudflare.com/d1/platform/pricing/ 。

`DB` 绑定省略账户专属 ID，Wrangler 自动创建或复用已绑定的 D1 数据库，不需要把密钥写进仓库。Worker 首次使用数据库时执行幂等的建表语句；后续请求复用初始化结果。没有绑定或数据库异常时返回 503，前端不会把失败记成成功点赞。绑定说明：https://developers.cloudflare.com/changelog/post/2025-10-24-automatic-resource-provisioning/ 。

## 点赞数据及域名切换

保留旧服务器和 Docker 数据卷、完整 SQLite 备份。workers.dev 验证通过之后再切换自定义域名。

1. 检查主页、合集、全部文章、手机导航、代码/公式/Mermaid、画廊内嵌及独立打开、RSS、sitemap、分享卡片、404 和点赞。
2. 暂停旧源点赞写入，并备份 SQLite（含必要 WAL 状态）。导出期间旧源必须暂停写入，新源尚未开放写入。
3. 旧源 GET 接口仍可访问时，执行 `node scripts/export-likes-cloudflare.mjs https://www.ready-jump.top work/likes-cloudflare.sql`。任何接口错误都会终止导出，不会当成零。
4. 从 Cloudflare 获取实际 D1 database ID，执行 `pnpm exec wrangler d1 execute <实际数据库名或ID> --remote --file work/likes-cloudflare.sql`。重复导入取较大值，不重复相加。数据文件不提交公开仓库。
5. 绑定 `ready-jump.top` 和 `www.ready-jump.top` 到 `blog`，确认 HTTPS、正文、重定向、点赞与画廊后，关闭旧源写入入口。切换期间避免两个独立数据库同时接受写入。
6. 验证后再另行下线旧服务器；本变更只移除旧部署流水线，不删除远端容器、数据库或照片。

回退时先停止新源点赞写入、导出 D1 新计数并同步回旧 SQLite，再将域名恢复原服务器，避免丢失切换后的计数。

## 本地验证

```sh
pnpm install --frozen-lockfile
pnpm build
node --test tests/cloudflare-worker.test.mjs tests/rendered-html.test.mjs
pnpm preview:cloudflare
pnpm exec wrangler deploy --dry-run
```

`worker/index.ts` 是保留的框架开发入口，生产部署只上传 `dist/client` 与小型点赞 Worker。需要旧 Node 构建时用 `pnpm build:node`。
