---
title: React 进阶：从并发渲染到全栈边界的学习地图
date: 2026-09-21
excerpt: React 进阶不是多背几个 Hook，而是能解释一次更新为何发生、如何保持交互流畅、状态应归谁管理，以及 Client、Server 与缓存该在哪里分界。
chapter: React 进阶
chapterOrder: 4
---

完成官方入门后，React 最容易落入两个极端：要么把所有问题都塞进 `useEffect` 和 Context，要么在还没测量之前就给每个组件套上 `memo`、`useCallback` 与 `useMemo`。

真正超过初中级的标志不是 API 数量，而是能回答四个问题：**这次更新为什么发生？哪些工作必须立刻完成？状态的唯一事实来源在哪里？这段代码应该运行在浏览器、服务端，还是查询缓存里？**

下面的路线按依赖关系排列。并发、RSC、虚拟列表都很重要，但它们建立在对渲染、状态与数据流的基本判断之上。

| 阶段 | 需要掌握的能力 | 典型问题 |
|---|---|---|
| 渲染与状态模型 | state、props、派生值、组件身份与 `key` | 为什么 state 看起来“丢了”，或列表重排后内容错位？ |
| 组件架构 | 自定义 Hook、复合组件、受控/非受控边界 | 怎样复用行为而不把业务塞进一个万能组件？ |
| 性能控制 | Profiler、memoization、Context 边界、虚拟化 | 为什么输入框卡顿？为什么一次 Context 更新带动半棵树重渲染？ |
| 并发渲染 | Transition、deferred value、Suspense、Fiber 心智模型 | 怎样让昂贵视图让出输入和点击？ |
| 数据与全栈边界 | 客户端状态、服务端状态、RSC、Actions | 数据缓存、表单提交和乐观更新分别应该归谁负责？ |

## 先把渲染看成一次可被放弃的计算

React 组件函数的执行是 **render**：根据当前 props 与 state 计算下一版 UI 描述；真正修改 DOM 是之后的 **commit**。因此“组件重新渲染”不等于“浏览器一定重绘了整块界面”，更不等于它天然是性能问题。

React 内部用 Fiber 保存可恢复的工作：当前已经提交到屏幕的树通常称为 `current`，正在计算的下一版树是 work-in-progress。后者可以被更紧急的更新打断、丢弃或重新开始，最终只有准备好的结果才进入 commit。理解这一点比记住 lane 位掩码或调度器源码更有价值：**render 必须保持纯粹、可重复执行，副作用不能藏在 render 里。**

`key` 也属于这套模型。它不是消除控制台警告的装饰，而是列表同级组件的身份。稳定的业务 ID 才能让 React 正确保留局部 state；位置会变化的列表不应把数组下标当作 key。

## 并发不是“Concurrent Mode”开关

现代 React 的并发能力由 `createRoot`、框架路由和具体 API 逐步使用；它不是应用级的独立模式，也不是多线程地同时执行组件。它的核心是：**允许低优先级的渲染工作被更紧急的交互打断。**

### `useTransition`：把“切换结果”标记为可等待的工作

```tsx
function SearchPage() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleChange(nextQuery: string) {
    setQuery(nextQuery); // 控制输入框：必须同步更新
    startTransition(() => {
      setFilter(nextQuery); // 昂贵结果可以稍后追上
    });
  }

  return (
    <>
      <input value={query} onChange={(event) => handleChange(event.target.value)} />
      {isPending && <Spinner />}
      <SearchResults query={filter} />
    </>
  );
}
```

`useTransition` 返回 `isPending` 和 `startTransition`。它适合标签切换、路由跳转、昂贵视图刷新等“可以稍后完成但不能卡住操作”的更新。它**不能**驱动受控文本输入本身；输入值必须同步更新，否则会与用户键入脱节。官方文档也明确指出，Transition 是可中断的，后到的紧急更新会优先处理。[`useTransition` 参考](https://react.dev/reference/react/useTransition)

### `useDeferredValue`：让派生视图滞后，而不是让事实滞后

当你拿不到某个 state 的 setter，或只想让下游重渲染延后时，使用 `useDeferredValue`：

```tsx
function SearchPage({ query }: { query: string }) {
  const deferredQuery = useDeferredValue(query);
  return <SearchResults query={deferredQuery} />;
}
```

它不是 debounce，也不会减少网络请求；它让一个昂贵的视图以较低优先级追赶真实值。网络频率控制仍然需要缓存、取消、请求去重或业务级 debounce。[`useDeferredValue` 参考](https://react.dev/reference/react/useDeferredValue)

Suspense 则负责描述“这一段 UI 暂时无法准备好时展示什么”。Transition 与 Suspense 组合后，可以避免一有新数据就把已经显示的整块内容粗暴替换成 loading。要把它们用好，先设计边界和可感知的 pending 状态，而不是到处包一层 `<Suspense>`。

## 高阶组件设计：复用行为，不复制状态

### 自定义 Hook 是默认选择

自定义 Hook 用来抽取状态、订阅、请求、快捷键等行为，同时让调用组件决定渲染：

```tsx
function useDisclosure(initialOpen = false) {
  const [isOpen, setIsOpen] = useState(initialOpen);
  return {
    isOpen,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
    toggle: () => setIsOpen((value) => !value),
  };
}
```

它不是“把任何 `useState` 包一层”。好的 Hook 有清楚的输入、输出与所有权，不偷偷创建全局单例，也不把 UI 结构锁死。

### 复合组件适合共享局部状态与灵活结构

`<Select><Select.Option /></Select>`、菜单、Tabs 和 Accordion 常适合复合组件。父组件持有局部状态，通过 Context 向子组件提供必要信息；子组件仍能以声明式方式排列。关键是 Context 范围要小，并让键盘导航、焦点和 ARIA 语义成为组件契约的一部分。

### Render Props 与 HOC：理解其历史位置

Render Props 和 HOC 曾是逻辑复用主力，今天仍会出现在成熟代码库与横切能力中：鉴权注入、埋点、兼容层、与旧框架交接。它们的问题是包装层、命名冲突与 props 来源变得难以追踪。新代码通常优先使用自定义 Hook；只有当调用者不方便直接使用 Hook，或确实需要包装组件边界时再选 Render Props / HOC。HOC 也不应该在 render 中临时创建，否则组件身份会持续变化。

## 性能优化先测量，再缩小更新面

React DevTools Profiler 能告诉你一次提交花在哪里、哪些组件为何重渲染。没有测量时，性能优化往往只是把复杂度转移到依赖数组和引用稳定性上。

### `memo`、`useCallback`、`useMemo` 不是默认语法

- `React.memo` 只在父组件重渲染时、子组件收到相同 props 才可能跳过 render；Context 变化与子组件自己的 state 仍会触发它。
- `useCallback` 缓存函数**引用**，不是缓存函数执行结果。它常用于把回调传给已 memo 的子组件，或作为其他 Hook 的稳定依赖。
- `useMemo` 缓存**计算结果**，适合已确认昂贵的计算或需要稳定对象引用的场景；它不应承载业务正确性。

它们共同的前提是依赖准确。为了“保持稳定”而漏写依赖，会得到陈旧闭包；每次都创建新对象、数组或函数，又会让浅比较立刻失效。优先选择更直接的办法：下沉状态、把昂贵区域拆分为独立组件、避免在 render 中创建不必要的大对象，再考虑 memoization。

### Context 传递能力，不承担所有状态

Context 很适合主题、当前用户、语言、路由或局部复合组件协议。但 Provider 的 `value` 改变会让消费该 Context 的组件重新渲染；把不断变化的大型业务对象放进一个“全局 AppContext”，会扩大更新面。

可行的处理顺序是：

1. 按变化频率与领域拆分 Context；
2. 让 Provider 的 value 保持必要的引用稳定；
3. 让读取状态的组件靠近真正使用处；
4. 当状态跨很多区域且需要按切片订阅，再选择带 selector 的外部 store。

### 虚拟列表解决 DOM 规模，而不是业务计算

万级列表的瓶颈通常是 DOM 节点数量、布局和绘制，而不是 `map()` 本身。窗口化只保留视口附近项目，例如 [react-window](https://github.com/bvaughn/react-window)。它也会带来动态高度、滚动定位、可访问性、键盘导航和测量策略等新问题；先用 Profiler 和浏览器性能面板确认瓶颈，再引入。

## 状态管理：先区分状态种类

“全局状态”往往把不同东西混在一起。更合理的划分如下：

| 状态 | 例子 | 优先方案 |
|---|---|---|
| 局部 UI 状态 | 弹窗开关、输入框、选中项 | 组件 state 或 `useReducer` |
| 跨组件客户端状态 | 编辑器草稿、布局偏好、长流程状态 | Context、小型外部 store 或原子状态 |
| URL 状态 | 过滤条件、页码、可分享查询 | 路由参数 / search params |
| 服务端状态 | 订单、权限、列表、分页结果 | 查询缓存，而不是手写 `useEffect` 缓存 |

Zustand 一类 store 常通过 selector 让组件只订阅需要的切片；Jotai 用原子状态把读写依赖细化。它们都不是 `useState` 的默认替代品，而是在 Context 难以控制更新范围或跨区域协调成本明显上升时的工具。[Jotai 文档](https://jotai.org/docs) 对原子化模型有清楚的说明。

服务端状态则拥有自己的生命周期：请求中、成功、失败、过期、重试、失效、后台刷新和多个观察者共享。把这些规则分散到组件 `useEffect` 中，迟早会遇到竞态、重复请求和陈旧数据。TanStack Query 将查询键、缓存、失效、mutation 与乐观更新作为一套模型管理，适合需要这些能力的客户端应用。[TanStack Query](https://tanstack.com/query/latest)

## RSC 与 React 19：先理解运行环境，再学新 Hook

React Server Components（RSC）是运行在服务端、能直接读取服务端资源、且不会把组件实现发送到浏览器的一类组件。Client Components 则负责 state、事件、浏览器 API 和交互。这里的 “Client” 并不等于“只在浏览器渲染过一次”，而是指这段组件代码需要进入客户端 bundle 并支持交互。

RSC 需要框架或 bundler 的完整支持；它不是在一个 `createRoot` 项目里加一行 import 就能开启的功能。学习时应从框架的 Server / Client 边界、数据获取、缓存与路由约定出发，而不是把 RSC 当成另一种 SSR。官方的 [Server Components 参考](https://react.dev/reference/rsc/server-components) 是最可靠的边界说明。

React 19 相关能力可以按“表单和异步状态”这一条主线学习：

- [`use`](https://react.dev/reference/react/use) 可以读取 Promise 或 Context；遇到尚未完成的 Promise 会与 Suspense 配合，但资源创建与缓存仍需要由框架或数据层负责。
- `useActionState` 把 Action 的结果与 pending / error 状态纳入组件状态，适合表单或提交型交互。
- [`useFormStatus`](https://react.dev/reference/react-dom/hooks/useFormStatus) 读取父 `<form>` 最近一次提交状态，适合提交按钮等表单子树。
- [`useOptimistic`](https://react.dev/reference/react/useOptimistic) 先展示用户期待的结果，再等待真实写入；它必须设计失败回滚、请求排序与最终服务端事实的合并方式。

这些 API 的价值不在于“少写 loading”，而在于把异步更新的 pending、成功、失败、乐观结果和最终事实放回一条可追踪的数据流中。

## 建议的实践顺序

1. 用一个搜索页练习：同步输入、`useDeferredValue` 的昂贵结果、明确的 loading 与错误状态。
2. 用一个可组合的 Tabs 或 Select 练习自定义 Hook、复合组件、键盘交互和受控/非受控 API。
3. 用 Profiler 找到一个真实慢点，再只针对那个点使用组件拆分、memoization 或虚拟化。
4. 用 TanStack Query 做一个列表 + 详情 + mutation，处理失效、乐观更新和失败回滚。
5. 最后再在支持 RSC 的框架中做一条读写链路：Server Component 读取、Client Component 交互、Action 提交、重新验证数据。

按这个顺序走，性能、状态管理和 RSC 就不再是彼此孤立的“高级特性”，而会成为同一个问题的不同层次：**让 UI 在正确的地方保存事实，以正确的优先级完成工作，并把不该送进浏览器的东西留在服务端。**
