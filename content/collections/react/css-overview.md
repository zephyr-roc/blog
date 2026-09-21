---
title: CSS 概要：从层叠、盒模型到现代布局
date: 2026-09-21
excerpt: 用一篇文章建立可工作的 CSS 心智模型：选择器、层叠与继承、盒模型、单位、Flexbox、Grid、响应式、变量和交互状态。
chapter: Web 平台基础
chapterOrder: 2
---

CSS 经常被误解成“给 HTML 加颜色”。它真正负责的是把一棵有语义的文档树映射成视觉布局：元素占多少空间、如何排列、文字怎样换行、视口变窄时如何重排、鼠标与键盘交互时如何反馈。

它也是一门声明式、带约束求解性质的语言。我们通常不为每个元素计算坐标，而是声明“这一行可以换行”“主栏至少要容纳正文”“卡片在空间足够时自动增加列数”，再让浏览器根据内容、字体、视口和用户设置计算结果。

React 不会替代 CSS。组件决定 DOM 结构与状态，CSS 决定这些结构和状态如何呈现。真正稳定的组件样式，通常来自对层叠、尺寸和布局规则的理解，而不是不断增加 `!important`。

## CSS 规则由什么组成

```css
.article-card {
  padding: 1rem;
  border: 1px solid color-mix(in srgb, currentColor 16%, transparent);
  border-radius: 1rem;
  background: Canvas;
}
```

`.article-card` 是选择器，花括号里是声明块。每条声明由属性和值组成。浏览器找到匹配选择器的元素，再结合层叠、继承和属性定义计算最终样式。

样式可以写在元素的 `style` 属性、页面内的 `<style>`，也可以通过 `<link rel="stylesheet">` 加载独立文件。应用项目通常使用独立样式表、CSS Modules、CSS-in-JS 或构建工具处理后的 CSS，但这些方案最终仍要遵守同一套浏览器规则。

## 先掌握真正高频的选择器

```css
/* 元素 */
button { }

/* class：组件样式最常用 */
.toolbar { }

/* 属性 */
input[type="search"] { }

/* 后代与直接子元素 */
.article-content a { }
.toolbar > button { }

/* 多条件 */
.button.primary { }

/* 状态伪类 */
.button:hover { }
.button:focus-visible { }
.field:disabled { }

/* 结构伪类 */
.list > :first-child { }
.list > :nth-child(odd) { }

/* 伪元素 */
.external-link::after { }
```

`class` 适合表达可复用的视觉角色，元素选择器适合基础排版或组件内部明确的结构，属性选择器适合状态和 HTML 能力。不要把 DOM 路径完整复制成很长的后代选择器；结构稍有调整，样式就会失效。

现代 CSS 还提供 `:is()`、`:where()`、`:not()` 和 `:has()`：

```css
:where(article, aside) :is(h2, h3) {
  text-wrap: balance;
}

.field:has(input:invalid) {
  --field-accent: #d92d20;
}
```

`:where()` 自身特异性始终为零，适合编写容易被覆盖的默认规则；`:has()` 可以根据后代或相邻元素状态选择当前元素，减少仅为样式而添加的 JavaScript 状态。

## 层叠：浏览器怎样解决冲突

当多条规则同时声明同一个属性时，浏览器不会简单选择“最后看到的 class”。它大致依次考虑：

1. 来源与重要性，例如用户样式、作者样式、`!important`；
2. 所属层叠层；
3. 选择器特异性；
4. 作用域接近程度；
5. 在前面条件仍相同时，源码中更靠后的声明胜出。

常见选择器的特异性可以粗略理解为：内联样式高于 `#id`，`#id` 高于 class、属性和伪类，后者又高于元素和伪元素。但不要靠不断堆 class 或 id 赢得“权重战争”。更健康的策略是控制样式边界，让默认值容易覆盖。

```css
@layer reset, base, components, utilities;

@layer base {
  a {
    color: currentColor;
  }
}

@layer components {
  .link {
    color: var(--color-link);
  }
}
```

`@layer` 允许显式规定样式层的优先顺序。低优先级层里再具体的选择器，也不会压过高优先级层中的普通规则。它对组织 reset、基础排版、组件与工具类尤其有用。

`!important` 并非绝对不能使用，但它更适合少数明确的覆盖边界或用户辅助样式，而不是日常处理组件冲突的工具。

## 继承与初始值

文字颜色、字体等属性通常会继承，尺寸、边框、内外边距通常不会：

```css
body {
  color: #172033;
  font-family: system-ui, sans-serif;
  line-height: 1.6;
}

button,
input,
select,
textarea {
  font: inherit;
}
```

表单控件的字体在不同浏览器中不一定自然继承，常用 `font: inherit` 让它们与页面一致。

几个显式控制值很实用：

- `inherit`：使用父元素的计算值；
- `initial`：使用 CSS 规范定义的初始值；
- `unset`：可继承属性按继承处理，否则回到初始值；
- `revert`：回退到较早来源或浏览器默认样式；
- `revert-layer`：回退当前层叠层造成的影响。

## 盒模型：为什么尺寸总是差一点

每个可见元素都可以理解为由四层组成：内容、内边距、边框、外边距。

默认的 `content-box` 中，`width` 只设置内容宽度，padding 和 border 会继续向外增加总尺寸。项目通常统一改为更直观的 `border-box`：

```css
*,
*::before,
*::after {
  box-sizing: border-box;
}
```

之后一个 `width: 320px` 的盒子，其 padding 与 border 会被包含在 320px 内。

```css
.panel {
  inline-size: min(100%, 42rem);
  padding: 1.25rem;
  border: 1px solid #d0d5dd;
  margin-inline: auto;
}
```

这里使用逻辑属性 `inline-size` 和 `margin-inline`，它们按文字书写方向描述“行内轴”，比固定写 `width`、`margin-left` 和 `margin-right` 更容易适配不同书写模式。

外边距还有一个容易困惑的行为：普通块布局中，相邻的垂直 margin 可能折叠。Flexbox 与 Grid 项目之间不会发生这种折叠；组件列表更推荐使用父容器的 `gap` 明确控制间距。

## 尺寸单位怎么选

没有一种单位适合所有属性：

| 单位 | 适合场景 |
|---|---|
| `px` | 细边框、阴影偏移、少量需要稳定设备无关像素的尺寸 |
| `rem` | 字号、间距、圆角等需要随根字号缩放的设计尺寸 |
| `em` | 相对当前元素字号的局部尺寸 |
| `%` | 相对包含块或相关属性基准的比例 |
| `vw` / `vh` | 与视口相关的尺寸；移动端高度应留意动态工具栏 |
| `dvh` / `svh` / `lvh` | 动态、小型、大型视口高度，适合移动端全屏布局 |
| `ch` | 近似按字符宽度约束正文行长 |
| `fr` | Grid 中分配剩余空间的比例单位 |

响应式尺寸可以用 `min()`、`max()` 与 `clamp()` 表达上下界：

```css
.article-title {
  font-size: clamp(2rem, 1.4rem + 3vw, 4.5rem);
}

.article-body {
  inline-size: min(100% - 2rem, 72ch);
  margin-inline: auto;
}
```

第一条让标题在一个范围内随视口平滑变化；第二条同时保留窄屏边距，并限制正文行长。

## `display` 决定元素怎样参与布局

常见的显示模式包括：

- `block`：通常独占一行，尺寸沿块方向排列；
- `inline`：参与文字行排版，宽高行为受行内格式化影响；
- `inline-block`：在行内排列，同时保留可设置盒尺寸的能力；
- `flex`：一维布局，擅长沿一个主轴分配与对齐项目；
- `grid`：二维布局，擅长同时定义行与列；
- `none`：元素不生成盒子，也通常不出现在可访问性树中。

`visibility: hidden` 会隐藏内容但保留布局空间。`opacity: 0` 只是变透明，元素仍可能被聚焦和点击。隐藏交互内容时，需要根据意图同时考虑视觉、布局、命中测试和可访问性，而不是只选择“看不见”的属性。

## Flexbox：处理一行或一列的关系

工具栏、导航、按钮组、头像与文字等一维关系通常适合 Flexbox：

```css
.toolbar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.toolbar__title {
  flex: 1 1 16rem;
  min-inline-size: 0;
}

.toolbar__actions {
  display: flex;
  gap: 0.5rem;
}
```

`flex-direction` 决定主轴方向；`justify-content` 沿主轴分配空间；`align-items` 沿交叉轴对齐；`gap` 控制项目间距。项目上的 `flex-grow`、`flex-shrink` 与 `flex-basis` 决定空间增加或不足时如何伸缩。

`flex: 1` 常被用来填满剩余空间，但文本子项仍可能因为默认 `min-width: auto` 拒绝缩小，造成溢出。此时给它设置 `min-inline-size: 0` 往往比强行隐藏整个容器的溢出更准确。

## Grid：把行与列作为一个整体设计

页面主栏、卡片网格和表单对齐更适合 Grid：

```css
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(18rem, 100%), 1fr));
  gap: 1rem;
}
```

这条规则表达的是：每列理想最小宽度为 18rem，容器放不下时允许降到 100%，空间足够时自动增加列数，并让各列平分剩余空间。很多过去需要 JavaScript 监听视口的卡片布局，现在可以只用这一条声明完成。

更明确的页面结构可以使用命名区域：

```css
.page {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(14rem, 20rem);
  grid-template-areas: "main aside";
  gap: 2rem;
}

.page__main { grid-area: main; }
.page__aside { grid-area: aside; }

@media (max-width: 52rem) {
  .page {
    grid-template-columns: 1fr;
    grid-template-areas:
      "main"
      "aside";
  }
}
```

当重点是“项目沿一条轴怎样排列”，先考虑 Flexbox；当重点是“内容怎样落入行列轨道”，先考虑 Grid。二者经常嵌套使用，并不是竞争关系。

## 定位与层叠上下文

`position` 常用值包括：

- `static`：默认值，按正常文档流布局；
- `relative`：保留原位置，同时可作为绝对定位后代的包含块；
- `absolute`：脱离普通文档流，相对最近的定位包含块放置；
- `fixed`：通常相对视口固定；
- `sticky`：在指定滚动容器与阈值内表现为粘性定位。

```css
.article-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 16rem;
  align-items: start;
}

.article-outline {
  position: sticky;
  inset-block-start: 1rem;
}
```

`z-index` 只在相关层叠上下文中比较。`transform`、`opacity`、`filter`、`isolation` 等属性都可能创建新的层叠上下文，因此“把 z-index 改成 999999”仍可能无法盖住另一个上下文。调试遮挡问题时，先找层叠上下文边界，而不是继续增大数字。

## 响应式设计不是维护三套固定页面

响应式布局的核心是让内容在一段尺寸范围内保持可用。优先使用可换行的 Flexbox、自动适配的 Grid、`min()` / `max()` / `clamp()` 和合理的最小尺寸，再用媒体查询处理真正的布局断点。

```css
.shell {
  padding-inline: clamp(1rem, 4vw, 4rem);
}

@media (width >= 64rem) {
  .shell {
    display: grid;
    grid-template-columns: 16rem minmax(0, 1fr);
    gap: 2rem;
  }
}
```

断点应该来自内容何时拥挤或失衡，而不是机械对应某个手机型号。

组件如果主要受自身容器而非整个视口影响，可以使用容器查询：

```css
.card-region {
  container-type: inline-size;
}

.profile-card {
  display: grid;
  gap: 1rem;
}

@container (width >= 32rem) {
  .profile-card {
    grid-template-columns: 8rem minmax(0, 1fr);
    align-items: center;
  }
}
```

同一个组件放在主栏和侧栏时，可以根据实际获得的空间选择布局，不必让父页面传入 `compact` 之类只服务于样式的参数。

## 颜色、字体与可读性

```css
:root {
  color-scheme: light dark;
  --color-text: light-dark(#182230, #f2f4f7);
  --color-muted: light-dark(#667085, #98a2b3);
  --color-surface: light-dark(#ffffff, #101828);
  --color-accent: #087ea4;
}

body {
  color: var(--color-text);
  background: var(--color-surface);
  font-family: Inter, "Noto Sans SC", system-ui, sans-serif;
  line-height: 1.65;
}
```

自定义属性不仅能减少重复，还能表达设计含义。组件使用 `--color-surface` 比直接散落十几个十六进制颜色更容易维护。自定义属性参与层叠并默认继承，因此父容器可以为一整棵子树切换主题或局部参数。

正文不要只追求“能放下更多字”。合适的行高、有限的行长、明确的标题层级和足够的前景—背景对比度，通常比复杂装饰更影响阅读体验。不要禁止用户缩放，也不要用固定高度承载可能换行的文字。

## 交互状态与焦点

```css
.button {
  border: 0;
  border-radius: 0.75rem;
  padding: 0.65rem 1rem;
  color: white;
  background: #087ea4;
  cursor: pointer;
}

.button:hover {
  background: #066b8a;
}

.button:focus-visible {
  outline: 3px solid color-mix(in srgb, #087ea4 45%, transparent);
  outline-offset: 3px;
}

.button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
```

`:hover` 不能作为唯一反馈，因为触摸设备和键盘没有相同的悬浮模型。`:focus-visible` 让键盘焦点保持清晰，同时避免每次指针点击都显示同样的焦点环。不要用 `outline: none` 删除焦点提示，除非提供了同样明显的替代方案。

表单还常用 `:checked`、`:disabled`、`:required`、`:valid`、`:invalid` 和 `:user-invalid`。样式可以表现状态，但错误原因仍应由 HTML 文本表达。

## 过渡与动画要尊重用户偏好

```css
.card {
  transition:
    transform 180ms ease,
    box-shadow 180ms ease;
}

@media (hover: hover) {
  .card:hover {
    transform: translateY(-2px);
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
```

动画应该帮助用户理解状态变化，而不是让界面持续晃动。位移和透明度通常比反复改变布局尺寸更流畅，但也不能据此无节制地给整页创建合成层。对于可能引发不适的运动，应通过 `prefers-reduced-motion` 提供减少动画的路径。

## 现代 CSS 嵌套

原生 CSS 已支持嵌套规则：

```css
.article-card {
  padding: 1rem;

  & > h2 {
    margin-block: 0 0.5rem;
  }

  &:hover {
    border-color: var(--color-accent);
  }
}
```

嵌套能把组件的状态与子结构放在一起，但不应制造过深的选择器链。两三层之后如果仍需不断依赖父级结构，通常说明组件边界或 class 命名需要重新整理。

## React 中如何划分样式职责

一种清晰的分工是：

- HTML / JSX 表达结构和语义；
- CSS 处理布局、视觉状态和由媒体环境决定的变化；
- React state 处理真正的业务状态与交互状态；
- class 或 `data-*` 属性把应用状态暴露给 CSS。

```tsx
export function Notice({ tone, children }: NoticeProps) {
  return (
    <aside className="notice" data-tone={tone}>
      {children}
    </aside>
  );
}
```

```css
.notice {
  --notice-color: #175cd3;
  border-inline-start: 0.25rem solid var(--notice-color);
}

.notice[data-tone="danger"] {
  --notice-color: #d92d20;
}
```

如果变化只取决于宽度、输入方式、深浅主题、系统动效偏好或焦点状态，CSS 通常已经能直接表达，不需要在组件里监听 `window.innerWidth` 或复制浏览器状态。JavaScript 应负责 CSS 无法知道的应用语义。

## 一组够用的基础样式

```css
*,
*::before,
*::after {
  box-sizing: border-box;
}

html {
  color-scheme: light dark;
}

body {
  margin: 0;
  font-family: system-ui, sans-serif;
  line-height: 1.6;
}

img,
svg,
video {
  display: block;
  max-inline-size: 100%;
}

button,
input,
select,
textarea {
  font: inherit;
}

:focus-visible {
  outline: 3px solid Highlight;
  outline-offset: 3px;
}
```

这不是完整 reset，而是一组低侵入的默认规则：统一盒模型、移除 `body` 默认外边距、避免媒体溢出、让表单字体一致，并保留清晰的键盘焦点。浏览器默认样式并非敌人；在没有更好设计时，保留可靠的默认行为往往胜过粗暴清零。

## 常见错误

- 不了解层叠，只靠提高特异性和添加 `!important` 修补；
- 用固定宽高装入动态文本，稍微换行就溢出；
- 用绝对定位完成本应属于 Flexbox 或 Grid 的整体布局；
- 为每个设备型号编写一个断点，而不是围绕内容变化；
- 在 React 中监听视口宽度，只为了完成 CSS 媒体查询能做的事情；
- 删除 `outline`，让键盘用户看不到焦点；
- 只设计 `hover`，忽略触摸、焦点、禁用与加载状态；
- 使用 `100vh` 做移动端全屏，却忽略动态浏览器工具栏；
- 给所有元素添加 `transition: all`，导致不必要且难以预测的动画；
- 让组件选择器依赖很深的页面 DOM 结构，稍一重构就失效。

## 继续学习

掌握本文之后，可以继续系统学习层叠与特异性、继承、Flexbox、Grid、逻辑属性、容器查询和自定义属性。web.dev 的 [Learn CSS](https://web.dev/learn/css) 既是一套循序课程，也适合作为日常查阅的现代 CSS 索引。
