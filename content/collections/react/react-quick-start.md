---
title: React 入门：官方教程已经足够好的起点
date: 2026-09-21
excerpt: 不再重复写一套组件、JSX 与 useState 的入门课。先完整走完 React 官方 Quick Start，再回到本系列讨论真正值得深挖的状态模型、并发渲染与工程边界。
chapter: React 入门
chapterOrder: 3
---

React 的入门资料并不稀缺，但真正值得反复回看的，仍然是官方的 [Quick Start](https://react.dev/learn)。它用可运行的小例子覆盖了日常开发中最常见的一组概念：组件与嵌套、JSX 与样式、展示数据、条件与列表渲染、事件、状态，以及组件之间共享数据。官方给出的定位也很准确：这一页覆盖了日常会反复遇到的大部分 React 概念。

因此这个合集不准备再写一套“从 `useState` 计数器开始”的平行教程。先花一两个晚上完整走完 Quick Start，把每个示例亲手改一遍，比在二手文章之间拼凑概念更有效。

## 建议的学习顺序

1. 先完成 [Quick Start](https://react.dev/learn)，不要只阅读代码；至少自己改动组件、列表和状态示例。
2. 再按官方 Learn 的脉络阅读「[Describing the UI](https://react.dev/learn/describing-the-ui)」「[Adding Interactivity](https://react.dev/learn/adding-interactivity)」与「[Managing State](https://react.dev/learn/managing-state)」。这三部分分别建立 UI 描述、交互更新和状态归属的基本判断。
3. 遇到副作用、外部系统或性能问题时，再进入「[Escape Hatches](https://react.dev/learn/escape-hatches)」，而不是一开始就把 `useEffect` 当成万能入口。

前两篇 HTML、CSS 概要不是 React 的前置杂项。JSX 最终生成 HTML，组件的可访问性、表单与原生交互仍取决于 HTML；响应式布局、主题和焦点状态也应尽量由 CSS 负责。React 处理的是随数据和交互变化的 UI，而不是取代 Web 平台。

## 本系列接下来写什么

完成官方入门后，最容易真正踩坑的已经不是 JSX 语法，而是下面几件事：

- 状态到底应该放在哪里，哪些值根本不该进入 state；
- 一次更新为何会触发重渲染，渲染与提交 DOM 分别发生什么；
- `key`、组件身份与 state 保留之间的关系；
- 受控表单、异步请求、缓存和外部状态怎样划清边界；
- 并发渲染、Suspense、Server Components 与框架路由到底解决了什么。

这些才是后续文章的重心。官方教程把基础地基铺得很扎实；我们从它结束的地方继续。
