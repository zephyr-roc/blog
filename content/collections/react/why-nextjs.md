---
title: 为什么 React 之后要学 Next.js：把组件带到真实 Web 边界
date: 2026-09-21
excerpt: React 解决 UI 组合，Next.js 继续解决路由、服务端边界、数据读取、缓存、流式渲染、元数据与部署。理解 App Router，才能知道一个 React 应用怎样成为完整的 Web 应用。
chapter: React 全栈框架
chapterOrder: 5
---

React 本身是一套 UI 库。它非常擅长把 state 映射成界面，却刻意没有替你决定 URL 如何对应页面、数据在哪里读取、首屏是否输出 HTML、密钥能否留在服务端、缓存如何失效，以及文章页的 metadata 怎样生成。

小型 SPA 可以自行组合路由、请求库、打包器和部署策略；规模一旦上来，问题就不再是“能不能拼起来”，而是这些边界能否共享一套正确的约定。Next.js 的价值正在这里：它把 React 放进一个面向 Web 的运行时与工程模型中。

这不是说每个 React 项目都该迁移 Next.js。纯客户端后台、嵌入已有服务的局部组件、React Native，以及已有成熟 BFF 的 SPA，都可能有更轻的答案。但如果应用同时需要公开页面、SEO、登录态、数据读取、写入操作、图片优化和清晰的部署模型，Next.js 往往比手工拼装更完整。

## Next.js 给 React 补上的不是“SSR 开关”

把 Next.js 理解为“React 的服务端渲染框架”只说对了一部分。以 App Router 为中心的现代 Next.js 同时提供：

| 能力 | 它解决的问题 |
|---|---|
| 文件系统路由 | URL、页面、layout、loading、error 与 API 端点有可搜索的对应关系 |
| Server Components | 把数据读取、密钥和非交互 UI 留在服务端，减少浏览器 JavaScript |
| Client Components | 在需要 state、事件和浏览器 API 的小边界保留 React 交互 |
| 流式渲染与 Suspense | 不必等最慢的数据完成才发送整个页面 |
| 缓存与再验证 | 让静态、按时更新和按事件失效成为显式策略 |
| Route Handlers / Server Actions | 将 HTTP 接口与表单、写操作放到同一应用边界内 |
| Metadata、Image、Font、Link | 处理搜索、分享、资源加载与导航的 Web 细节 |

Next.js 16 的 App Router 默认让 `page` 和 `layout` 成为 Server Components；只有需要交互、state、生命周期或浏览器 API 的模块才标记为 Client Components。[官方的 Server / Client Components 指南](https://nextjs.org/docs/app/getting-started/server-and-client-components)把这个边界描述得很清楚。

## 从目录开始理解 App Router

```text
app/
  layout.tsx            # 根布局：html、body、全站 Provider
  page.tsx              # /
  posts/
    page.tsx            # /posts
    [slug]/
      page.tsx          # /posts/:slug
      loading.tsx       # 此路由段的 Suspense fallback
      error.tsx         # 此路由段的错误边界
  api/
    revalidate/
      route.ts          # /api/revalidate
```

`page.tsx` 定义可访问页面，`layout.tsx` 定义跨子路由保留的骨架；`loading.tsx`、`error.tsx`、`not-found.tsx` 等约定文件把等待与失败变成路由结构的一部分。路由不是一个全局表，而是随目录就近组织，这对复杂应用的可维护性很重要。

最小页面可以只是一个异步 Server Component：

```tsx
// app/posts/[slug]/page.tsx
import { notFound } from "next/navigation";
import LikeButton from "./like-button";
import { getPost } from "@/lib/posts";

export default async function PostPage({
  params,
}: PageProps<"/posts/[slug]">) {
  const { slug } = await params;
  const post = await getPost(slug);

  if (!post) notFound();

  return (
    <article>
      <h1>{post.title}</h1>
      <div dangerouslySetInnerHTML={{ __html: post.html }} />
      <LikeButton postId={post.id} initialLikes={post.likes} />
    </article>
  );
}
```

这个文件可以在服务端直接调用数据库或内部服务，而不需要先绕一层浏览器 API；密钥不会被送到客户端 bundle。页面中真正要响应点击的区域，再收缩为一个 Client Component：

```tsx
// app/posts/[slug]/like-button.tsx
"use client";

import { useState } from "react";

export default function LikeButton({
  postId,
  initialLikes,
}: {
  postId: string;
  initialLikes: number;
}) {
  const [likes, setLikes] = useState(initialLikes);

  return (
    <button onClick={() => setLikes((count) => count + 1)}>
      {likes} 人喜欢
    </button>
  );
}
```

`"use client"` 不是“这段代码只会在浏览器执行一次”的标记，而是 Server 与 Client **模块图**的边界。一个文件标记后，它直接导入的模块会进入客户端 bundle。因此边界应尽量靠近交互叶子，而不是写在根 layout 或整个页面顶部。Next.js 官方也专门建议只把交互小部件标记为 Client Component，以控制传给浏览器的 JavaScript。[参考](https://nextjs.org/docs/app/getting-started/server-and-client-components#reducing-js-bundle-size)

## RSC、SSR 与 hydration 不是同一个概念

它们经常一起出现，含义却不同：

- **Server Components（RSC）** 是组件能运行在哪个环境、其代码是否需要发送给浏览器的模型；
- **SSR / 预渲染** 是服务端何时生成 HTML 的问题；
- **hydration** 是浏览器把事件处理器接回已存在 HTML、使 Client Components 可交互的过程；
- **streaming** 是服务端分段发送已准备好的内容，而不是等整页完成。

首次访问时，Next.js 会先发送 HTML，让用户尽快看到非交互预览；随后利用 RSC Payload 对齐组件树，并加载 Client Components 的 JavaScript 以完成 hydration。后续客户端导航主要复用与请求 RSC Payload，而不是每次完整文档跳转。[渲染流程说明](https://nextjs.org/docs/app/getting-started/server-and-client-components#how-do-server-and-client-components-work-in-nextjs)

所以“用了 Server Component 就没有客户端 JavaScript”并不准确。正确说法是：没有交互需求的部分可以不进入客户端组件图；交互岛仍然需要 JavaScript。把整个页面都标记为 `"use client"`，就会把 Next.js 最重要的优化边界抹掉。

## 数据读取、写入与 HTTP 的三个入口

### 在 Server Component 中读取

读取页面专属数据时，最直接的方式就是在 `async` Server Component 中调用数据层。它避免了“首屏先输出空壳，浏览器再 `useEffect` 请求一次”的瀑布，也让访问数据库与读取服务端环境变量保持在安全边界内。

但 Server Component 不是万能后端：它主要服务于渲染，不应把与页面无关的业务流程塞进组件。数据访问仍应收敛到 `lib/` 或领域模块中，便于复用、测试和授权控制。

### 用 Server Actions 承接同应用内的写入

表单提交、点赞、编辑资料等“从组件发起、写入后刷新相关 UI”的操作，适合 Server Actions：

```tsx
// app/posts/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { createComment } from "@/lib/comments";

export async function submitComment(formData: FormData) {
  await createComment({
    postId: String(formData.get("postId")),
    body: String(formData.get("body")),
  });

  revalidatePath("/posts");
}
```

Action 是公开的服务器入口，不能因为调用来自自己的组件就跳过鉴权、参数校验、速率限制或权限检查。它减少的是样板，而不是安全责任。

### 用 Route Handler 提供明确的 HTTP 契约

第三方 webhook、移动端、公开 API、文件下载、跨域调用或需要 HTTP 方法与响应头精确控制时，使用 `route.ts`。它是 Next.js 应用里的 HTTP handler，不等同于 React 组件，也不应为了页面内部读取数据而额外绕一圈请求自己的 API。

## Metadata、图片与字体属于产品，而不是收尾工作

公开页面的 title、description、canonical、Open Graph、结构化数据与 sitemap 决定了搜索和分享系统如何理解页面。Next.js 的 metadata API 与 `generateMetadata` 把它们放在路由层；`next/image`、`next/font` 与 `<Link>` 则分别处理图片尺寸/优化、字体加载和客户端导航。

这些能力并不神秘，但它们是“从 React 组件到 Web 页面”的必要部分。尤其是文章、商品、文档和落地页，应该从第一版就让数据模型提供标题、摘要、发布日期和分享图需要的信息，而不是渲染完成后再补 SEO。

## 什么时候不应该为了 Next.js 而 Next.js

Next.js 引入了 Server / Client 边界、部署适配、缓存语义和框架约定。它带来能力，也意味着需要理解更多运行时行为。下面几种情况要谨慎：

- 一个完全登录后的内部工具，首屏 SEO 没有价值，已有稳定的后端与 SPA 基建；
- 必须深度控制客户端运行时或需要非 Node / Edge 的长期连接模型；
- 团队尚未准备好处理缓存失效、请求边界和 Server Action 安全；
- 项目需要的只是一个可嵌入既有服务的 React 小部件。

反过来，只要你正在做内容站、公开产品页、电商、带登录的 SaaS 或 BFF 型应用，Next.js 的约定通常会让边界更清楚，而不是更重。

## 接下来的学习顺序

先从 App Router 的 `page`、`layout`、动态路由、`Link` 与 `metadata` 开始；随后练习 Server / Client Components 的最小边界，再学习 `loading.tsx`、`error.tsx`、Route Handlers 和 Server Actions。最后才进入缓存与渲染模式。

下一篇会专门解释 SSR、SSG、ISR，以及它们在 App Router 中为何可以同时出现在一条路由里。完整 API 以 [Next.js App Router 文档](https://nextjs.org/docs/app)为准；截至本文更新时，官方 latest 文档对应 Next.js 16.3。
