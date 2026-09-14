---
title: OCaml 5 并发模型：Effects、Domains 与结构化并发
date: 2026-09-14
excerpt: 区分 OCaml 5 的 effect handler、Domain、系统线程、fiber 与异步 I/O，理解并行和并发为何不是同一层，并与 Kotlin coroutine 的挂起模型比较。
chapter: 状态与效果
chapterOrder: 8
---

OCaml 5 最重要的变化不是增加了一个新的 async 关键字，而是重建运行时，使两种能力进入主线：

- 通过 Domain 支持共享内存并行；
- 通过 effect handler 支持用户态并发、调度器和其他控制效果。

二者经常被一起提到，却解决完全不同的问题：

- **并行**关心多个 CPU 核是否同时执行；
- **并发**关心多个任务如何交错、等待与取消；
- **异步 I/O**关心等待 socket、文件或计时器时不阻塞执行资源；
- **结构化并发**关心子任务生命周期是否受父作用域约束。

Kotlin coroutine 把这些概念包装得较统一；OCaml 5 更像提供底层控制机制，再由 Eio、Lwt、Async、Domainslib 等库形成不同模型。

## 当前基线：OCaml 5.5

截至 2026 年 9 月，OCaml 5.5.0 是最新正式版本。OCaml 5.0 引入新的多核运行时、共享内存并行和 effect handler；之后版本持续补齐运行时、标准库和效果语法。

理解现代 OCaml 并发时，应先确认依赖是否支持 OCaml 5。仍停留在 4.14 的项目可以继续维护，但不能假设它拥有相同的 Domain 与 effect 能力。

## Domain：共享内存并行的执行单元

`Domain.spawn` 创建一个可以与当前 Domain 并行执行 OCaml 代码的执行单元：

```ocaml
let worker =
  Domain.spawn (fun () ->
    expensive_computation input)

let result =
  Domain.join worker
```

Domain 更接近运行时管理的并行执行上下文，而不是轻量协程。通常不应为每个小任务创建一个 Domain；创建数量应与 CPU 核和工作负载匹配，再在其上建立任务池。

### CPU 密集任务才直接受益

适合 Domain 的工作包括：

- 编译、解析和静态分析；
- 图像、压缩、密码学和数值计算；
- 大集合的可分区处理；
- 独立请求批次的 CPU 阶段。

单纯等待网络不会因为创建更多 Domain 自动更快。大量 I/O 连接更适合 fiber/event loop；少量 Domain 可以承载一个或多个调度器。

## Domain 不等于操作系统线程 API

OCaml 还提供 `Thread`、`Mutex` 和 `Condition` 等系统线程接口。现代运行时中，Domain 是获得 OCaml 代码并行执行能力的核心单位；一个 Domain 内仍可以有多个系统线程，但它们共享该 Domain 的运行时执行约束，不能替代多个 Domain 的 CPU 并行。

可以把层次简化为：

| 层次 | 典型数量 | 主要用途 |
|---|---:|---|
| Domain | 接近 CPU 核数 | 并行执行 OCaml 代码 |
| 系统线程 | 较少 | 阻塞式系统 API、兼容库 |
| Fiber | 大量 | 并发任务与异步 I/O |
| Promise/stream | 由库决定 | 结果与事件组合 |

真实映射由库实现决定，不能从“fiber”一词直接推断是否创建线程或 Domain。

## 共享内存意味着共享风险

Domain 可以访问同一堆中的数据。不可变值天然容易共享，可变值需要同步。

错误示例：

```ocaml
let counter =
  ref 0

let increment_many () =
  for _ = 1 to 100_000 do
    counter := !counter + 1
  done
```

两个 Domain 同时运行会数据竞争。普通 ref 的读改写不是原子事务。

可以使用 `Atomic`：

```ocaml
let counter =
  Atomic.make 0

let rec increment () =
  let current =
    Atomic.get counter
  in
  if not (
    Atomic.compare_and_set
      counter
      current
      (current + 1)
  ) then
    increment ()
```

或使用 `Mutex` 保护复合不变量：

```ocaml
let lock =
  Mutex.create ()

let with_lock mutex work =
  Mutex.lock mutex;
  Fun.protect
    ~finally:(fun () ->
      Mutex.unlock mutex)
    work
```

锁必须保护一个清楚的不变量，而不是“这附近的几行代码”。当共享结构复杂时，按 Domain 分区数据、最后合并结果，通常比细粒度共享写入更容易验证。

## 内存模型与 Atomic

跨 Domain 的非原子读写可能产生数据竞争。不要依赖单核时代的执行顺序、编译器恰好没有重排，或某次测试中数值正确。

`Atomic` 提供跨 Domain 的原子单元与内存顺序保证，适合状态标志、计数器和无锁算法基础。但多个 Atomic 组合起来不会自动形成事务；如果两个字段必须一起保持约束，Mutex 或更高层消息协议往往更合适。

与 Kotlin/JVM 相比：

- JVM 有 volatile、Atomic*、synchronized 与明确的 happens-before 规则；
- OCaml 5 有 Atomic、Mutex 和自己的内存模型；
- 两者都不会因为对象由 GC 管理就自动消除数据竞争；
- Rust 会用所有权与 `Send` / `Sync` 在类型层阻止更多误用，OCaml 不提供同等级静态证明。

## algebraic effect：把操作与处理分离

effect declaration 描述一种可执行操作：

```ocaml
type _ Effect.t +=
  | Read_line : string Effect.t
  | Write_line : string -> unit Effect.t
```

执行效果：

```ocaml
let ask_name () =
  Effect.perform
    (Write_line "Your name?");
  let name =
    Effect.perform Read_line
  in
  Effect.perform
    (Write_line ("Hello, " ^ name))
```

`ask_name` 没有接收 console 对象，也没有直接调用 stdin/stdout。它发出操作，由外围 handler 决定如何解释：

- 真实终端 handler 可以执行 I/O；
- 测试 handler 可以提供固定输入并收集输出；
- 浏览器或远程协议 handler 可以映射成其他实现。

这与依赖注入有相似目标，但机制不同。函数不是通过参数拿到能力对象，而是在动态 handler 作用域中 perform effect。

## handler 捕获受限 continuation

当 handler 遇到 `perform`，它获得：

- 被执行的 effect；
- 从 perform 位置到 handler 边界的 continuation；
- 继续、终止或改写后续计算的选择。

使用底层 `Effect.Deep` API 的调度器骨架大致如下：

```ocaml
open Effect
open Effect.Deep

type _ Effect.t +=
  | Yield : unit Effect.t

let yield () =
  perform Yield

let run main =
  match_with
    main
    ()
    {
      retc = Fun.id;
      exnc = raise;
      effc =
        fun (type result)
            (effect : result Effect.t) ->
          match effect with
          | Yield ->
              Some (
                fun
                  (continuation :
                    (result, _) continuation) ->
                  continue continuation ()
              )
          | _ ->
              None;
    }
```

这只是展示结构，不是完整调度器。真实实现必须维护 runnable queue、I/O 注册、取消、异常传播和资源作用域。

OCaml continuation 是 one-shot：捕获后只能恢复一次。调度器不能把同一个 continuation 当作可重复调用的普通函数。

## deep 与 shallow handler

Deep handler 恢复 continuation 后，后续再次 perform 的效果仍由同一 handler 处理，适合循环式解释与 fiber scheduler。

Shallow handler 恢复后不会自动重新安装自身，处理器必须显式决定下一步如何继续。它能提供更精确的控制与某些性能优势，但实现更容易出错。

应用开发者通常不应直接选择并实现 handler。除非在构建运行时、调度器、解析器或控制流库，否则使用成熟并发库更安全。

## effect 不等于已检查的 effect system

函数类型：

```text
unit -> string
```

不会显示函数内部是否 perform `Read_line`、抛异常或写日志。OCaml 5 的 algebraic effect handler 提供控制机制，但普通类型系统没有把所有 effect row 编入函数签名。

因此：

- 未处理 effect 可能在运行时失败；
- 阅读 API 仍需要文档与模块约定；
- effect 不能替代 capability 参数的全部说明力；
- 库应限制公开 effect 的作用域和处理责任。

这与 Kotlin `suspend` 不同：Kotlin 至少在函数类型上区分挂起函数与普通函数；但 `suspend` 同样不会列出网络、磁盘、异常或状态修改等全部效果。

## fiber：建立在 effects 上的轻量任务

Fiber 通常是用户态调度的轻量计算。它在等待 I/O、计时器或同步原语时让出控制，而不是阻塞整个 Domain。

OCaml 5 的 effects 让库可以用直接风格表达 fiber：

```ocaml
let handle_connection flow =
  let request =
    read_request flow
  in
  let response =
    route request
  in
  write_response flow response
```

表面上像同步代码，底层 I/O 操作可以 perform effect，调度器捕获 continuation，等描述符就绪后再恢复。

这与 Kotlin suspend function 的使用体验接近，但实现路径不同：

- Kotlin 编译器把 suspend 函数变换为 continuation 状态机；
- OCaml 5 运行时支持捕获 delimited continuation，库通过 handler 调度；
- 两者都允许直接风格异步代码；
- 任务层级、取消与调度策略仍由具体库定义。

## Eio：OCaml 5 的直接风格 I/O

Eio 是围绕 OCaml 5 effects 构建的直接风格 I/O 与并发库。其核心思想包括：

- fiber 作为轻量并发任务；
- switch 管理一组资源与子 fiber；
- capability-style resource 表达文件、网络、时钟等环境能力；
- 取消和资源释放沿结构化作用域传播。

典型结构：

```ocaml
Eio_main.run @@ fun env ->
Eio.Switch.run @@ fun switch ->
  Eio.Fiber.both
    (fun () ->
      first_task env switch)
    (fun () ->
      second_task env switch)
```

这里的重点不是具体 API，而是作用域：离开 `Switch.run` 前，其管理的子任务和资源必须完成、取消或释放。

Eio 不是 OCaml 标准库的一部分。版本、后端与生态兼容性需要按项目验证，不能把“OCaml 5 支持 effects”直接等同于“所有 I/O 库都使用 Eio”。

## Lwt 与 Async：仍然重要的既有生态

Lwt 使用 promise 与 `let*` 风格组织异步计算，拥有长期积累的网络库适配。

```ocaml
let open Lwt.Syntax in
let* response =
  fetch uri
in
process response
```

Jane Street Async 提供 scheduler、Deferred、Pipe 等完整并发生态，通常与 Base/Core 体系一起使用。

选择时应看依赖图而不是语法偏好：

- 需要的数据库、HTTP、TLS 库支持哪个运行时；
- 团队现有代码属于哪个生态；
- 是否需要 OCaml 4.14 兼容；
- 是否依赖直接风格；
- 取消和资源作用域语义是否符合系统要求。

不要在同一业务路径随意混用多个 scheduler。桥接库可能存在，但取消、异常和资源生命周期仍需统一设计。

## structured concurrency 不是自动获得的

创建一个 fiber 并不等于结构化并发。结构化并发至少需要回答：

- 父任务结束时子任务怎么办；
- 一个子任务失败时兄弟任务是否取消；
- 取消如何到达阻塞操作；
- 清理代码是否一定执行；
- 是否允许任务逃逸其创建作用域；
- 多个异常如何聚合与报告。

Kotlin 的 `coroutineScope`、`supervisorScope`、Job tree 把这些约定系统化。Eio 的 switch/fiber scope 提供相近方向。自己使用 Effect 写 scheduler 时，这些规则全部是实现者的责任。

## 取消是一种跨层协议

取消不能只是设置布尔值。一个可靠模型需要：

1. 任务能感知取消；
2. 阻塞 I/O 能被唤醒；
3. `Fun.protect` / finally 清理仍执行；
4. 锁和资源不会因中断遗留；
5. 不可取消区间足够短；
6. 父子任务有明确传播方向。

Effect handler 可以在控制流层实现取消，但外部 C 调用、不可中断系统调用和长时间不让出控制的 CPU 计算仍可能延迟响应。

Kotlin coroutine 也有协作式取消：不检查或不进入挂起点的计算不会凭空停止。两边都需要在 CPU 循环和 FFI 边界主动设计取消点。

## 并行任务池

直接为每个元素 `Domain.spawn` 会产生过多执行单元。更合理的结构是固定数量 Domain 加任务队列。

Domainslib 等库提供 task pool 和 parallel_for/async-await 风格的并行构件。概念上：

```ocaml
let pool =
  Task.setup_pool
    ~num_domains:(recommended - 1)
    ()

let result =
  Task.run pool (fun () ->
    parallel_computation input)

let () =
  Task.teardown_pool pool
```

具体 API 随库版本而定，应以安装版本文档为准。设计层面要关注：

- 任务粒度是否足够大；
- 工作是否可分割；
- 合并结果是否成为串行瓶颈；
- 分配与 GC 是否抵消并行收益；
- 阻塞 I/O 是否占住 Domain；
- 测量的是吞吐还是尾延迟。

## Domain-local storage

有些状态需要“每个 Domain 一份”，例如随机数生成器、统计缓冲或非线程安全缓存。Domain-local storage 比全局表加锁更适合。

但“每个 Domain”不等于“每个 fiber”。多个 fiber 可能运行在同一个 Domain，共享其 local storage。请求上下文若需要随 fiber 传播，应使用并发库提供的 fiber-local/context 机制，不能误用 Domain-local storage。

这与 Kotlin 的 ThreadLocal 和 coroutine context 很相似：协程可能换线程，线程局部值并不天然等于协程局部值。

## 选择模型

| 工作负载 | 主要工具 |
|---|---|
| 单个纯 CPU 任务 | 普通函数 |
| 可拆分 CPU 密集计算 | Domain/task pool |
| 少量阻塞式兼容 API | Thread 或专用阻塞池 |
| 大量网络连接 | Eio/Lwt/Async 等 fiber/event loop |
| 同时有 I/O 与 CPU 重活 | fiber 调度 + 有界 Domain pool |
| 构建控制流库 | Effect handler |
| 普通业务应用 | 使用成熟库，不手写 scheduler |

## 与 Kotlin coroutine 的核心差异

| 维度 | Kotlin | OCaml 5 |
|---|---|---|
| 挂起标记 | `suspend` 进入函数类型 | 普通函数类型不列 effect |
| 实现基础 | 编译器状态机 + Continuation | 运行时 delimited continuation + handler |
| 结构化并发 | kotlinx.coroutines 核心约定 | 由 Eio 等库提供 |
| CPU 并行 | Dispatcher/thread pool | Domain/task pool |
| I/O | coroutine adapter/event loop | Eio/Lwt/Async 后端 |
| 上下文 | CoroutineContext | 具体库 context/fiber-local |
| 取消 | Job tree、协作式 | 具体库协议、协作式 |
| 静态线程安全 | JVM/Kotlin 不普遍证明 | OCaml 同样不普遍证明 |

Kotlin 把应用开发体验统一得更成熟；OCaml 5 暴露的控制机制更通用，能构造异步之外的 effect abstraction。通用性也意味着更多语义由库而不是语言表面决定。

## 一套并发设计顺序

1. 先判断问题需要并发还是并行；
2. I/O 等待使用成熟 fiber runtime；
3. CPU 计算使用有界 Domain pool；
4. 不为每个请求或元素直接创建 Domain；
5. 优先共享不可变值，分区可变数据；
6. 对共享写入使用 Atomic、Mutex 或消息传递；
7. 明确父子任务、失败和取消传播；
8. 用 scoped API 管理任务与资源；
9. 隔离阻塞 FFI 和不可中断调用；
10. 通过真实负载测量调度、分配与尾延迟。

## 结论：OCaml 5 给的是构件，不是唯一答案

OCaml 5 把并行与控制效果带入主线：

- Domain 让 OCaml 代码利用多个 CPU 核；
- Atomic 与 Mutex 管理共享内存；
- effect handler 捕获并恢复受限 continuation；
- fiber runtime 可以在其上实现直接风格并发；
- Eio、Lwt、Async 和 Domainslib 提供不同工程选择；
- 结构化并发、取消和资源安全仍必须由库与应用共同保证。

如果从 Kotlin coroutine 迁移，最需要放弃的假设是“一个官方异步模型覆盖所有层”。OCaml 更明确地把 CPU parallelism、I/O concurrency 和 effect handling 分开。选择正确的层，比选择最时髦的库更重要。

## 下一章

下一章进入 OCaml 运行时与性能：值表示、立即数与堆块、闭包分配、minor/major heap、多 Domain GC、tail call、Flambda、profiling，以及函数式抽象的真实成本。

## 延伸阅读

- [OCaml Releases](https://ocaml.org/releases)
- [OCaml 5.5 Stdlib：Domain](https://ocaml.org/manual/5.5/api/Domain.html)
- [OCaml 5.5 Stdlib：Atomic](https://ocaml.org/manual/5.5/api/Atomic.html)
- [OCaml Manual：Effect Handlers](https://ocaml.org/manual/5.5/effects.html)
- [Eio Documentation](https://ocaml-multicore.github.io/eio/)
- [Domainslib](https://github.com/ocaml-multicore/domainslib)
