# 画廊管理部署

画廊照片存放在服务器 Docker 卷 `blog-data` 的 `/data/gallery` 下。公开页面按拍摄时间降序展示。管理页为 `/gallery/manage`，只允许 GitHub 用户 ID `94433344` 登录。OAuth 不申请仓库写权限，只请求 `read:user`。

## 上线前配置

1. 在 GitHub 账号的 **Settings → Developer settings → OAuth Apps** 新建 OAuth App。Homepage URL 为 `https://ready-jump.top`，Authorization callback URL **精确填写** `https://ready-jump.top/api/gallery/auth/callback`。
2. 在仓库 `zephyr-roc/blog` 的 **Settings → Secrets and variables → Actions** 添加 `GALLERY_GITHUB_CLIENT_ID` 和 `GALLERY_GITHUB_CLIENT_SECRET`。不要把 Client Secret 写进仓库或前端配置。
3. 两项 Secret 齐全后合并并部署；部署脚本在替换线上容器前检查其存在。打开 `/gallery`，使用 GitHub 登录，再进入 `/gallery/manage` 上传照片。

单张照片最多 40MB，支持 JPEG、PNG、WebP、GIF、AVIF；可多选顺序上传。可以修改标题、拍摄时间，或删除照片。原图、缩略图和 EXIF 详情都来自服务器持久卷。建议定期备份 `blog-data`；删除操作会删掉原图和缩略图。

此版本按“清空重传”方案切换。新画廊忽略旧 NAS manifest，首次成功部署后删除旧 NAS 缓存和旧 manifest，不复制现有照片。
