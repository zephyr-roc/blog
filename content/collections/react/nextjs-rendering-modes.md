---
title: Next.js 渲染模式：SSR、SSG 与 ISR 不再是三选一
date: 2026-09-21
excerpt: 从按请求渲染、构建时预渲染到增量再生成，理解 Next.js 的缓存、再验证与流式边界；现代 App Router 可以让静态骨架、缓存数据与用户专属内容共存于同一页面。
chapter: Next.js 渲染与缓存
chapterOrder: 6
---

SSR、SSG 与 ISR 是 Next.js 最常被背成口诀的三个缩写：

- **SSR**：每次请求在服务端生成页面，适合个性化或必须实时的数据；
- **SSG**：构建阶段生成页面，配合 CDN 以极低成本响应；
- **ISR**：静态结果保留一段时间，再按时间或事件增量刷新，不必重建整个站点。

这个定义没有错，但在 App Router 中把它们理解成“每个页面只能选一个模式”的开关，已经不够用了。渲染时机、数据缓存、HTML / RSC Payload、CDN、客户端路由缓存与再验证是不同层次；一条路由可以同时拥有静态外壳、可缓存的公共内容和按请求流入的用户信息。

因此本篇的目标不是教你死记配置，而是先回答：**什么数据可以复用、它允许旧多久、谁的访问能看到它、写入后如何让它失效？** 这四个问题回答清楚，SSR / SSG / ISR 的选择会自然收敛。

## 先把传统三种模式放回正确位置

| 模式 | 生成时机 | 典型内容 | 优点 | 代价 |
|---|---|---|---|---|
| SSG | 构建时 | 文档、历史文章、版本页 | CDN 命中高、响应极快 | 内容更新通常需部署或再验证 |
| ISR | 构建后按时间/事件更新 | 博客首页、商品目录、公开资料 | 静态速度与更新成本兼得 | 必须设计可接受的陈旧窗口与失效策略 |
| SSR | 每个请求时 | 当前用户权限、结算、实时库存 | 数据与请求上下文最新 | 服务端计算和数据源压力更高 |

SEO 不是 SSR 的专利：三者都可以输出完整 HTML。对搜索引擎来说，稳定的静态文章通常比每次动态计算更合适；SSR 的价值在于请求相关数据，而不是“它更 SEO”。

也不要把 ISR 理解为“定时重新 `next build`”。它更新的是受影响的缓存条目或预渲染结果，部署时不需要把整个应用重新编译。

## App Router 的基础模型：先缓存什么，再决定何时渲染

在没有启用 Cache Components 的 App Router 模式下，`fetch` 默认不缓存；需要复用的请求应明确设置 `cache: "force-cache"`，需要每次读取最新结果则使用 `cache: "no-store"`。非 `fetch` 数据库读取可以用 `unstable_cache` 包装。不要依赖“我记得 Next 会自动缓存”的旧经验，先在数据访问点写清楚策略。[官方缓存指南](https://nextjs.org/docs/app/guides/caching-without-cache-components)

### SSG：公共且几乎不变的数据

```tsx
// app/docs/[slug]/page.tsx
export async function generateStaticParams() {
  const docs = await fetch("https://api.example.com/docs", {
    cache: "force-cache",
  }).then((response) => response.json());

  return docs.map((doc: { slug: string }) => ({ slug: doc.slug }));
}

export default async function DocPage({
  params,
}: PageProps<"/docs/[slug]">) {
  const { slug } = await params;
  const doc = await fetch(`https://api.example.com/docs/${slug}`, {
    cache: "force-cache",
  }).then((response) => response.json());

  return <article>{doc.title}</article>;
}
```

`generateStaticParams` 告诉 Next.js 哪些动态 URL 在构建时就能准备好。适合文档、已发布文章、版本说明等公共内容。它并不要求数据永远不可变；一旦内容有更新需求，就进入 ISR 或按事件再验证。

### SSR：请求相关或绝不能复用的数据

```tsx
// app/account/page.tsx
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const session = (await cookies()).get("session")?.value;
  const account = await fetch("https://api.example.com/me", {
    headers: { Cookie: `session=${session ?? ""}` },
    cache: "no-store",
  }).then((response) => response.json());

  return <AccountPanel account={account} />;
}
```

登录态、权限、购物车、风控结果和实时交易信息不能误进共享缓存。`cache: "no-store"` 让某次读取不复用缓存；`export const dynamic = "force-dynamic"` 则是路由级的明确兜底，表示每次请求动态渲染。不要为了追求“静态”把 cookie、authorization header 或用户数据塞进公共 cache key。

### ISR：允许短暂陈旧的公共数据

```tsx
// app/blog/page.tsx
export default async function BlogPage() {
  const posts = await fetch("https://api.example.com/posts", {
    next: { revalidate: 3600 },
  }).then((response) => response.json());

  return <PostList posts={posts} />;
}
```

这表示文章列表至多按小时重新验证一次。也可以在 `page.tsx` 或 `layout.tsx` 导出 `revalidate` 作为该路由的默认时间；同一路由中较短的再验证时间会决定更频繁的刷新。开发模式下页面按请求运行且不会像生产环境一样持久缓存，因此验证 ISR 必须看生产构建或预览环境。[时间再验证说明](https://nextjs.org/docs/app/guides/caching-without-cache-components#time-based-revalidation)

对 CMS、商品管理或发布系统，时间并非最佳信号。写入成功后按事件失效更准确：

```tsx
// app/admin/actions.ts
"use server";

import { revalidatePath, revalidateTag } from "next/cache";

export async function publishPost(id: string) {
  await publishInDatabase(id);

  revalidateTag("posts", "max");
  revalidatePath("/blog");
  revalidatePath(`/blog/${id}`);
}
```

读取时给数据打上 tag：

```tsx
await fetch("https://api.example.com/posts", {
  next: { tags: ["posts"], revalidate: 3600 },
});
```

`revalidateTag` 面向同一领域数据，`revalidatePath` 面向具体路由。二者应根据你的数据模型使用，而不是每次写入都粗暴清空整站缓存。[按需再验证参考](https://nextjs.org/docs/app/guides/caching-without-cache-components#on-demand-revalidation)

## “无缝切换”的真实含义：一页可以有三种时间尺度

现代 Next.js 中最有价值的不是在 SSR / SSG / ISR 之间反复改路由配置，而是让页面不同部分各自拥有合适的时效。

例如博客首页可以是：

- 顶部导航、品牌和页面骨架：构建时静态；
- 最新文章列表：缓存一小时，发布后通过 tag 主动失效；
- 右上角用户名、主题和未读数：用户请求时读取；
- 最慢的推荐区域：用 Suspense 先显示 fallback，数据准备好后再流入。

Next.js 16 的 **Cache Components** 正是把这个思路推到组件级：启用 `cacheComponents: true` 后，用 `"use cache"` 缓存函数或组件，用 `cacheLife` 声明生命周期，用 `<Suspense>` 包住不能缓存、必须在请求时读取的区域。

```tsx
// next.config.ts
const nextConfig = {
  cacheComponents: true,
};

export default nextConfig;
```

```tsx
// app/page.tsx
import { Suspense } from "react";
import { cacheLife, cacheTag } from "next/cache";
import { cookies } from "next/headers";

async function LatestPosts() {
  "use cache";
  cacheLife("hours");
  cacheTag("posts");

  return <PostList posts={await getPosts()} />;
}

async function UserGreeting() {
  const name = (await cookies()).get("name")?.value;
  return <p>你好，{name ?? "访客"}</p>;
}

export default function HomePage() {
  return (
    <>
      <header>静态导航与品牌</header>
      <LatestPosts />
      <Suspense fallback={<p>正在读取偏好…</p>}>
        <UserGreeting />
      </Suspense>
    </>
  );
}
```

在这套模型里，公共文章列表进入可缓存的静态 shell；读取 cookie 的问候语在请求时流入。读取 cookie 不再必须把整条路由降级为动态渲染，边界由 Suspense 局部化。官方缓存文档把这种组合称为「static, cached, and streaming」。[完整示例](https://nextjs.org/docs/app/getting-started/caching#static-cached-and-streaming)

注意 Cache Components 需要显式开启；没有启用它的项目应遵循前文的传统 App Router 缓存模型。不要把两套配置混搭后期待“自动正确”，升级或新建项目时先确认自己采用的是哪一套模型。

## 缓存不只有一层

当页面“明明更新了，用户却还看到旧数据”时，先区分缓存层：

| 层 | 保存什么 | 常见误解 |
|---|---|---|
| 数据缓存 | `fetch` 或缓存函数的结果 | 只刷新 HTML，却没有让数据重新读取 |
| 路由 / 预渲染结果 | HTML 与 RSC Payload | 数据更新了，但静态页面仍未再生成 |
| CDN | 靠近用户的响应副本 | 应用已更新，边缘节点仍在 TTL 内 |
| 客户端路由缓存 | 预取的 RSC Payload 与导航结果 | 直接刷新正确，客户端跳转仍暂时看到旧内容 |
| 浏览器 HTTP 缓存 | 资源与响应 | 误把浏览器缓存当成 Next.js 数据缓存 |

这也是为什么“部署后应该都刷新”不是通用保证。不同平台的持久缓存和 CDN 语义并不相同；自托管还要明确共享缓存、多个实例和滚动发布期间的失效策略。缓存正确性首先是产品语义，其次才是性能优化。

## 常见误区

- **“SSR 更快。”** 首字节可能更慢；它换来的是请求时数据与个性化。公共内容通常更适合静态或 ISR。
- **“ISR 是每隔 N 秒一定重新生成。”** 更准确地说，它规定重新验证的窗口；具体重建与并发请求行为依赖缓存和部署平台。
- **“用了 `revalidate`，所以所有数据都更新。”** 它只影响对应缓存策略，数据库查询、第三方 API 与客户端查询缓存仍可能各有生命周期。
- **“`force-dynamic` 是解决一切缓存问题的办法。”** 它会牺牲公共内容的复用，还可能掩盖错误的 cache key 或缺失的失效事件。
- **“Suspense 就等于 SSR。”** Suspense 是等待边界；它能配合流式渲染，但不单独决定数据是否缓存、路由是否动态。
- **“Pages Router 的 `getServerSideProps` / `getStaticProps` 就是 App Router 的唯一写法。”** 它们属于旧路由模型；理解映射有帮助，新项目应优先按 App Router 的数据与缓存语义设计。

## 选择策略：从数据而不是页面名称开始

1. 数据是否包含用户身份、权限或一次性令牌？是，就按请求读取，不进入共享缓存。
2. 数据是否对所有用户相同，且可接受几分钟到几小时旧？是，使用 ISR / 数据缓存并设计失效 tag。
3. 数据是否只在发布或部署时变化？是，静态预渲染足够。
4. 页面里是否同时有公共内容和用户局部？不要二选一；把动态区域下沉到 Suspense 边界，让其余部分保持可缓存。
5. 写入发生后，谁负责失效？在 Server Action 或 Route Handler 中明确调用 `revalidateTag` / `revalidatePath`，并让它与领域事件对应。

SSR、SSG 和 ISR 并没有消失；它们变成了同一套“渲染 + 缓存 + 再验证”模型上的常用落点。掌握这套模型后，你不需要在项目初期把所有页面永久定性，而可以随着数据时效、访问规模与产品需求改变，让渲染策略在正确的边界上演进。
