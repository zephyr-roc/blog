---
title: HTML 概要：先把页面写成一份有意义的文档
date: 2026-09-21
excerpt: React 最终仍然生成 HTML。用一篇文章掌握文档骨架、语义元素、链接、图片、表单、表格与可访问性，避免把页面写成 div 的集合。
chapter: Web 平台基础
chapterOrder: 1
---

学习 React 很容易从组件、状态和 Hooks 开始，却忽略组件最终要生成什么。浏览器收到的不是 `UserCard`、`Layout` 或 `FormField`，而是一棵由 HTML 元素组成的 DOM 树。CSS、事件、表单提交、键盘操作、搜索引擎与无障碍技术，全部建立在这棵树的语义之上。

HTML 的任务不是“把内容画出来”，而是描述内容是什么。标题应该是标题，导航应该是导航，按钮应该是按钮。选对元素之后，浏览器会免费提供键盘行为、表单语义、历史记录、可访问性树和大量经过多年兼容性验证的默认能力。

这篇不会罗列所有标签，而是整理日常开发最常用、也最容易在 React 项目里被组件抽象掩盖的部分。

## 一份最小而完整的文档

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>订单详情｜积雨云</title>
    <meta
      name="description"
      content="查看订单商品、配送进度与支付信息。"
    />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`<!doctype html>` 让浏览器使用标准模式解析页面；`lang` 告诉浏览器与读屏软件正文主要使用什么语言；`charset` 应尽早声明字符编码；`viewport` 让移动设备按照真实视口宽度排版。

React 单页应用常常只在 `body` 中留下一个挂载节点，但 `head` 仍然属于页面内容的一部分。标题和描述不只是 SEO 配置，也决定浏览器标签、收藏夹、历史记录以及链接预览如何识别页面。使用服务端渲染或路由框架时，每个页面都应该生成与自身内容对应的元数据。

## 元素、属性与 DOM

HTML 源码会被解析成 DOM。元素表达节点的类型，属性补充节点的配置和关系：

```html
<a class="order-link" href="/orders/20260921" data-order-id="20260921">
  查看订单
</a>
```

这里的 `a` 表示链接，`href` 给出导航目标，`class` 提供样式与脚本选择入口，`data-order-id` 保存应用自定义数据。

常见的全局属性包括：

- `id`：文档内唯一标识，可作为锚点以及标签与控件之间的引用目标；
- `class`：把元素加入一个或多个样式类别；
- `title`：补充提示信息，但不能代替可见文本或表单标签；
- `hidden`：从页面展示与可访问性树中隐藏内容；
- `data-*`：保存供脚本读取的自定义数据；
- `lang`：覆盖局部内容的语言；
- `tabindex`：控制元素能否及如何进入焦点顺序，应谨慎使用正数值。

在 JSX 中，元素和属性会变成 JavaScript 表达式的一部分，因此有几处写法不同：

```tsx
export function Avatar() {
  return (
    <img
      className="avatar"
      src="/images/zephyr.webp"
      alt="Zephyr 的头像"
      width={96}
      height={96}
    />
  );
}
```

`class` 写成 `className`，事件使用 `onClick` 之类的驼峰属性，JavaScript 值放进 `{}`。但 JSX 不是另一套页面语义：`<button>` 仍是按钮，`<img>` 仍需要正确的替代文本。

## 用语义元素组织页面

下面是一份常见的文章页面骨架：

```html
<body>
  <header>
    <a href="/">积雨云的空间站</a>
    <nav aria-label="主导航">
      <a href="/collections">合集</a>
      <a href="/tinkering">折腾</a>
      <a href="/about">关于</a>
    </nav>
  </header>

  <main>
    <article>
      <header>
        <h1>HTML 概要</h1>
        <p><time datetime="2026-09-21">2026 年 9 月 21 日</time></p>
      </header>

      <section aria-labelledby="semantic-html">
        <h2 id="semantic-html">为什么需要语义 HTML</h2>
        <p>……</p>
      </section>
    </article>

    <aside aria-label="相关阅读">……</aside>
  </main>

  <footer>© Zephyr</footer>
</body>
```

这些元素不规定页面必须长什么样，它们描述页面各部分的职责：

| 元素 | 常见用途 |
|---|---|
| `header` | 页面或某个章节的头部，不只限于全站页头 |
| `nav` | 主要导航区域；同页多个导航应提供可区分的名称 |
| `main` | 页面独有的主要内容，通常只有一个可见实例 |
| `article` | 可以独立分发、复用或订阅的内容 |
| `section` | 有主题的一组内容，通常应拥有标题 |
| `aside` | 与主内容相关但可以独立理解的补充内容 |
| `footer` | 页面或章节的尾部信息 |
| `div` | 没有更准确语义时使用的通用块级容器 |
| `span` | 没有更准确语义时使用的通用行内容器 |

语义元素不是要求“彻底消灭 `div`”。布局包装层没有独立含义时，`div` 正是正确选择；问题在于把导航、文章、按钮和表单控件也全部伪装成 `div`。

## 标题、段落与文本

标题从 `h1` 到 `h6` 表示内容层级，而不是字号。字号应该交给 CSS：

```html
<article>
  <h1>浏览器渲染基础</h1>

  <section>
    <h2>解析 HTML</h2>
    <p>浏览器将标记解析为 DOM。</p>

    <h3>解析错误恢复</h3>
    <p>浏览器会修复一部分不合法结构，但结果未必符合预期。</p>
  </section>
</article>
```

不要因为想要较小的字就从 `h1` 跳到 `h4`。一个页面通常有一个代表主标题的 `h1`，后续标题按内容嵌套自然递进。

正文最常用的是 `p`。需要强调语义时，`strong` 表示重要，`em` 表示语气强调；它们不等同于单纯的粗体和斜体。`code` 表示代码片段，`pre` 保留空白和换行，二者常组合展示代码块。引用可使用 `blockquote`，时间与日期可使用机器可读的 `time`。

无序列表 `ul` 表达没有先后关系的项目，有序列表 `ol` 表达步骤或排名，描述列表 `dl` 适合术语—解释、键—值之类的配对内容。不要为了获得项目符号而使用列表，也不要把真正的列表写成一串带破折号的段落。

## 链接不是按钮，按钮也不是链接

这是组件库中最常见的语义错误之一：

- 导航到另一个 URL，使用 `a`；
- 在当前页面触发操作，使用 `button`。

```html
<a href="/orders/42">查看订单详情</a>

<button type="button">重新计算价格</button>
```

链接天然支持在新标签页打开、复制地址、浏览器历史记录和搜索引擎发现。按钮天然支持键盘激活、禁用状态和表单行为。用 `div` 加点击事件模仿它们，意味着还要自己重建焦点、键盘、角色和状态语义，而且通常会漏掉一部分。

位于表单内的 `button` 默认类型是 `submit`。不负责提交的按钮应明确写 `type="button"`，避免点击后意外提交表单。

链接文字应能独立说明去向。连续出现多个“点击这里”时，读屏用户和搜索引擎都很难判断它们分别指向什么。

## 图片与媒体

最常用的图片写法至少应包含来源、替代文本和固有尺寸：

```html
<img
  src="/images/dashboard-1280.webp"
  srcset="
    /images/dashboard-640.webp 640w,
    /images/dashboard-1280.webp 1280w
  "
  sizes="(max-width: 720px) 100vw, 720px"
  alt="订单看板按状态展示今日订单数量"
  width="1280"
  height="720"
  loading="lazy"
/>
```

`width` 与 `height` 让浏览器在图片下载前就能计算长宽比，减少布局跳动。`srcset` 和 `sizes` 允许浏览器根据视口和设备像素密度选择合适资源。首屏关键图片不要盲目懒加载，非首屏图片则可以使用 `loading="lazy"`。

`alt` 描述图片在当前上下文中的作用，而不是机械复述文件名。承载信息的图片需要简洁准确的替代文本；纯装饰图片使用 `alt=""`，让读屏软件忽略它。带标题和说明的独立内容可以使用 `figure` 与 `figcaption`。

## 表单：优先使用浏览器已有的能力

```html
<form action="/search" method="get">
  <div>
    <label for="keyword">关键词</label>
    <input
      id="keyword"
      name="q"
      type="search"
      autocomplete="off"
      required
    />
  </div>

  <div>
    <label for="category">分类</label>
    <select id="category" name="category">
      <option value="">全部</option>
      <option value="react">React</option>
      <option value="kotlin">Kotlin</option>
    </select>
  </div>

  <button type="submit">搜索</button>
</form>
```

`label` 通过 `for` 与控件的 `id` 关联，点击文字也能聚焦或切换控件。`name` 决定提交时的字段名；没有 `name` 的控件不会进入原生表单数据。`required`、`min`、`max`、`minlength`、`maxlength`、`pattern` 和正确的 `type` 可以提供基础约束与更合适的移动端键盘。

常用控件包括：

- `input`：单行输入；根据数据选择 `email`、`number`、`date`、`checkbox`、`radio` 等类型；
- `textarea`：多行文本；
- `select` 与 `option`：从固定候选项中选择；
- `button`：提交、重置或普通操作；
- `fieldset` 与 `legend`：为一组相关控件提供可感知的分组名称；
- `output`：展示由用户输入计算出的结果。

`placeholder` 只是示例或短提示，输入后会消失，不能替代 `label`。错误信息也不能只靠红色边框表达；应该提供文字，并用 `aria-describedby` 等关系让辅助技术能找到它。

React 可以使用受控组件同步表单状态，也可以借助 `FormData` 和原生提交行为读取数据。无论状态放在哪里，都不要轻易丢掉 HTML 本身的字段类型、自动填充和约束验证能力。

## 表格只用于真正的二维数据

```html
<table>
  <caption>2026 年 9 月请求统计</caption>
  <thead>
    <tr>
      <th scope="col">接口</th>
      <th scope="col">请求数</th>
      <th scope="col">P95</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <th scope="row">创建订单</th>
      <td>12,480</td>
      <td>86 ms</td>
    </tr>
  </tbody>
</table>
```

`caption` 说明整张表的主题，`th` 表示表头，`scope` 明确表头作用于列还是行。`thead`、`tbody` 和 `tfoot` 划分逻辑区域。表格适合需要沿行列交叉读取的数据，不应该拿来做普通页面布局。

## 原生交互元素往往比自制组件可靠

浏览器已经提供了一批可交互元素：

```html
<details>
  <summary>查看构建信息</summary>
  <p>Commit: 8f61c2a</p>
</details>

<dialog id="delete-dialog">
  <form method="dialog">
    <p>确定删除这篇草稿吗？</p>
    <button value="cancel">取消</button>
    <button value="confirm">删除</button>
  </form>
</dialog>
```

`details` / `summary` 适合可展开内容；`dialog` 配合 `showModal()` 能获得模态层、焦点管理和 Escape 关闭等基础行为。它们未必能覆盖每种产品需求，但在自行实现复杂交互之前，应该先检查平台是否已经有合适的语义原语。

## 可访问性从正确的 HTML 开始

ARIA 可以补充元素的名称、状态和关系，但不能自动修复错误的交互模型。首要原则是：**能用原生 HTML 表达时，优先使用原生 HTML。**

```html
<!-- 推荐：浏览器已经知道它是按钮 -->
<button type="button" aria-pressed="false">收藏</button>

<!-- 不推荐：角色、焦点与键盘行为都要自行补齐 -->
<div role="button" tabindex="0">收藏</div>
```

页面至少要经得住几项简单检查：

1. 不使用鼠标，只按 Tab、Shift + Tab、Enter、Space 和方向键能否完成主要操作；
2. 焦点是否清晰可见，顺序是否符合视觉和阅读顺序；
3. 放大文字或缩窄视口后，内容是否仍能阅读和操作；
4. 表单控件是否都有名称，错误是否能通过文字理解；
5. 图片关闭或加载失败后，剩余信息是否仍然合理。

不要随意添加正数 `tabindex` 来“修复”顺序。更好的方法通常是让 DOM 顺序本身正确，再用 CSS 完成视觉布局。

## React 组件不应该抹掉语义

组件抽象容易制造一个错觉：既然组件名已经说明用途，底层元素就不重要。实际上，`<PrimaryAction>` 对浏览器没有任何意义，只有它最终返回的 `<button>` 才有。

```tsx
type ActionProps = React.ComponentPropsWithoutRef<"button">;

export function PrimaryAction({ children, ...props }: ActionProps) {
  return (
    <button type="button" className="primary-action" {...props}>
      {children}
    </button>
  );
}
```

好的基础组件会保留原生元素的属性和行为，而不是只暴露一个 `onClick`。如果同一组件有时导航、有时执行操作，与其用一个布尔参数在 `div` 上模拟两种行为，不如明确拆成链接和按钮，或者让多态组件最终输出正确的原生元素。

## 常见错误

- 为了点击效果使用 `div` 或 `span`，却没有键盘与焦点行为；
- 用多个 `<br>` 制造间距，而不是用段落结构与 CSS；
- 用标题元素控制字号，导致文档层级混乱；
- 把 `placeholder` 当作表单标签；
- 图片不写尺寸，加载时推动整页内容跳动；
- 装饰图片写冗长 `alt`，信息图片却留空；
- 在按钮里嵌套链接，或在链接里放按钮；
- 把视觉顺序与 DOM 顺序做成完全相反；
- 遇到语义问题就添加 ARIA，而不先选择正确的 HTML 元素。

## 继续学习

掌握常用元素之后，最值得继续深入的是文档结构、语义 HTML、表单、焦点管理，以及 `details`、`dialog` 等原生交互能力。web.dev 的 [Learn HTML](https://web.dev/learn/html) 按这些主题提供了一套完整课程，可以作为本文之后的系统学习入口。
