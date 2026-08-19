---
title: 用 GitHub Actions 把博客自动部署到服务器
date: 2026-08-19
excerpt: 一次配置，永久受益。记录从手动 SSH 到推送即部署的完整过程。
---

## 起因

每次写完文章都要手动 SSH 进服务器、拉代码、重启 Docker，时间一长就懒得更新了。于是花了一下午把部署流程自动化。

## 方案

用 GitHub Actions + Docker + GHCR（GitHub Container Registry）：

1. 推送到 `main` 分支
2. GitHub Actions 构建 Docker 镜像并推送到 `ghcr.io`
3. SSH 进服务器，拉新镜像，重启容器

整个流程大约 3-5 分钟，不需要在服务器上装任何构建工具。

## 遇到的坑

**pnpm 构建脚本被拦截。** pnpm 11 引入了构建脚本安全策略，`esbuild`、`sharp`、`workerd` 的 install 脚本默认被禁止。解决方案是在 `pnpm-workspace.yaml` 里声明白名单：

```yaml
allowBuilds:
  esbuild: true
  sharp: true
  workerd: true
```

**Dockerfile 没复制 `pnpm-workspace.yaml`。** Docker 构建时只复制了 `package.json` 和 `pnpm-lock.yaml`，导致 pnpm 看不到白名单配置，安装失败。加一行就好：

```dockerfile
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
```

## 结果

现在写完文章 `git push` 就完事了，其余交给机器。
