---
title: OCaml 可变性与错误边界：ref、异常和资源管理
date: 2026-09-14
excerpt: 从 ref、mutable record、array 与循环进入 OCaml 的命令式一面，区分 option、result 和 exception，并用 Fun.protect 建立可靠的资源释放边界。
chapter: 状态与效果
chapterOrder: 7
---

函数式编程经常被误解为“不能修改变量，也不能抛异常”。OCaml 从未作出这种限制。它提供引用、可变字段、数组、哈希表、循环、异常和 I/O，甚至允许在一个函数中写出非常传统的命令式算法。

真正的取舍是：

> 默认使用值变换建立可推理的核心，只在具有身份、I/O 或性能需求的局部边界引入可变状态和异常。

这与 Kotlin 的方向不同。Kotlin 的 `val`、只读集合接口和 data class 鼓励不可变风格，但 JVM 生态的对象默认仍经常可变；OCaml 则让多数绑定和代数数据默认不可变，把可变位置显式标出来。

## let 绑定不能重新赋值

```ocaml
let count = 1
```

这里 `count` 是名字与值的绑定，不是一个可重复写入的变量槽。

可以 shadow 原名字：

```ocaml
let count = 1
let count = count + 1
```

第二个 `count` 是新的绑定，不是修改第一个值。在局部作用域中：

```ocaml
let total =
  let value = 10 in
  let value = value + 5 in
  value
```

shadowing 保持每个绑定自身不可变，却可能让调试时的名称追踪变难。短小、线性的转换可以使用；跨越大段代码时应改用有语义的新名字。

## ref：显式创建可变单元

`ref` 把值放进一个可变引用单元：

```ocaml
let count =
  ref 0
```

读取使用 `!`，写入使用 `:=`：

```ocaml
count := !count + 1
```

类型为：

```text
val count : int ref
```

可以把 `'a ref` 理解成只含一个 mutable `contents` 字段的容器。它拥有身份：两个 ref 即使当前内容相同，也可能是不同单元。

### 把状态限制在闭包内部

```ocaml
let make_counter () =
  let count = ref 0 in
  fun () ->
    count := !count + 1;
    !count
```

外部只能调用返回函数，不能直接访问 ref。可变性被封装在小范围内，公开接口仍然简单。

这种模式适合计数器、memoization 和局部缓存，但也可能隐藏效果。若状态需要持久化、监控、并发保护或跨模块共享，应显式建模，而不是藏进无法观察的闭包。

## mutable record：身份明确的数据

record 字段默认不可变：

```ocaml
type account = {
  id : int;
  balance : int;
}
```

显式标记后可原地修改：

```ocaml
type mutable_account = {
  id : int;
  mutable balance : int;
}

let deposit amount account =
  account.balance <-
    account.balance + amount
```

使用 mutable record 的合理场景包括：

- 大型结构频繁更新，持久化复制成本明显；
- 模拟具有稳定身份的实体；
- 状态被限定在一个模块内部；
- 命令式算法能显著简化实现。

不合理的场景是把所有领域状态都做成可写字段，再依赖调用顺序维持不变量。能用 variant 表示的互斥状态，不应退化为几个 mutable bool。

## array、bytes 与 Hashtbl

OCaml list 不可变、擅长从头部构造，不支持常数时间随机访问。array 是固定长度、元素可变的连续容器：

```ocaml
let values =
  [| 10; 20; 30 |]

let () =
  values.(1) <- 42
```

`string` 不可变，`bytes` 提供可变字节序列：

```ocaml
let buffer =
  Bytes.of_string "hello"

let () =
  Bytes.set buffer 0 'H'
```

哈希表同样是可变结构：

```ocaml
let index =
  Hashtbl.create 16

let () =
  Hashtbl.replace index "OCaml" 5
```

选择容器应考虑访问模式，而不是函数式纯度：

| 需求 | 常见选择 |
|---|---|
| 头部增删、递归遍历、持久共享 | list |
| 随机访问、原地更新、紧凑存储 | array |
| 可变字节缓冲 | bytes |
| 键值索引与频繁更新 | Hashtbl |
| 不可变有序映射/集合 | Map / Set |
| 惰性拉取序列 | Seq |

## for 与 while 真实存在

```ocaml
let sum_array values =
  let total = ref 0 in
  for index = 0
      to Array.length values - 1
  do
    total := !total + values.(index)
  done;
  !total
```

`while`：

```ocaml
let find_first_zero values =
  let index = ref 0 in
  while
    !index < Array.length values
    && values.(!index) <> 0
  do
    incr index
  done;
  if !index = Array.length values then
    None
  else
    Some !index
```

循环体类型必须是 `unit`，因为循环的目的就是重复效果。

递归并不总比循环更好。处理 list/tree 时结构递归自然；处理 array、数值算法或需要多个可变游标时，循环可能更直接，也更容易得到预期分配行为。

## 语句序列其实是 unit 约束

分号连接表达式：

```ocaml
log "start";
perform_work ();
log "done"
```

左侧表达式通常应返回 `unit`。若它返回有意义的值却被丢弃，编译器可能给出警告。

这能发现一类常见错误：

```ocaml
List.map transform values;
save ()
```

`List.map` 返回新列表，原列表不会被修改；丢弃结果通常表示误把它当成命令式更新。若只为副作用遍历，应使用 `List.iter`：

```ocaml
List.iter send values
```

## 结构相等与物理相等

`=` 比较结构内容：

```ocaml
[1; 2; 3] = [1; 2; 3]
```

`==` 比较物理身份：

```ocaml
let first = ref 1
let second = ref 1

let same_content =
  first = second

let same_cell =
  first == second
```

前者通常为 true，后者为 false。

物理相等受运行时表示和优化影响，不应被用来判断普通不可变值的业务等价。它主要用于确实关心对象身份、图节点共享或底层实现的场景。

函数值上的结构比较会引发异常，因此 `=` 也不是对所有类型都安全的完全多态操作。公共 API 若允许比较，通常应接收明确 comparator。

## option、result 与 exception 的职责

三种机制处理不同语义。

### option：没有值是正常结果

```ocaml
let find_user id users =
  List.find_opt
    (fun user -> user.id = id)
    users
```

“未找到”不需要错误细节，也不是异常环境，因此返回 `None`。

### result：失败属于公开契约

```ocaml
type transfer_error =
  | Invalid_amount
  | Insufficient_balance

let transfer amount account =
  if amount <= 0 then
    Error Invalid_amount
  else if amount > account.balance then
    Error Insufficient_balance
  else
    Ok { account with
      balance = account.balance - amount
    }
```

调用方应当恢复、展示或映射错误，所以错误进入类型。

### exception：无法在当前局部契约中正常返回

```ocaml
exception Corrupted_config of string

let parse_required_config raw =
  match parse raw with
  | Ok config -> config
  | Error message ->
      raise (Corrupted_config message)
```

异常适合：

- 编程错误或破坏内部不变量；
- 深层栈中无法逐层有意义处理的失败；
- 与异常式标准库 API 交互；
- 失败极少，正常路径不希望携带显式 result；
- 当前组件边界会统一捕获并转换。

“可预期”不是唯一标准。数据库断开是可预期的现实事件，但如果当前函数无法恢复，它仍可能以异常穿过若干内部层，再在请求边界转换为领域错误或日志。

## 定义、抛出与捕获异常

```ocaml
exception Invalid_token of string
```

抛出：

```ocaml
let require_token = function
  | Some token -> token
  | None ->
      raise (Invalid_token "missing")
```

捕获：

```ocaml
let load_token source =
  try
    Ok (require_token (read_token source))
  with
  | Invalid_token message ->
      Error message
  | Sys_error message ->
      Error message
```

模式匹配应尽量具体。无条件 `with _ -> ...` 会吞掉内存不足、取消信号、编程错误或本不属于该层的异常，使故障失去上下文。

若必须记录后重新抛出，可使用当前异常值和 raw backtrace，避免构造新异常导致原始栈丢失。

## backtrace 需要主动保留

程序可开启异常回溯记录：

```ocaml
let () =
  Printexc.record_backtrace true
```

捕获后可以取得回溯：

```ocaml
let run work =
  try
    work ()
  with error ->
    let backtrace =
      Printexc.get_raw_backtrace ()
    in
    log_exception error backtrace;
    Printexc.raise_with_backtrace
      error
      backtrace
```

生产构建、编译选项与运行环境会影响回溯可读性。异常日志至少应包含异常值和 backtrace，不能只记录 `Printexc.to_string error` 后丢失调用路径。

## 资源释放不能依赖 GC

文件、socket、锁和数据库连接需要确定性释放。GC 只负责托管内存，不保证外部资源在某个可预测时刻关闭。

最基本的模式是 `Fun.protect`：

```ocaml
let read_file path =
  let channel =
    open_in_bin path
  in
  Fun.protect
    ~finally:(fun () ->
      close_in_noerr channel)
    (fun () ->
      really_input_string
        channel
        (in_channel_length channel))
```

无论主函数正常返回还是抛异常，`finally` 都会执行。

Kotlin 的对应机制是 `try/finally` 与 `use`：

```kotlin
FileInputStream(path).use { input ->
    input.readAllBytes()
}
```

OCaml 没有普遍的 RAII 或 borrow checker。资源安全依赖明确的高阶封装和 API 纪律。最佳做法是让资源模块直接提供 scoped API：

```ocaml
val with_connection :
  pool ->
  (connection -> 'a) ->
  'a
```

调用方只在回调作用域中获得连接，模块统一负责归还或关闭。

## finalizer 不是 finally

`Gc.finalise` 可以在值被回收前后安排回调，但执行时机不确定，也可能因程序退出、可达性和运行时条件而不发生。

它适合作为防漏的最后保险或管理纯内存关联结构，不应作为关闭文件、提交事务或释放锁的主要机制。

确定性资源必须使用：

- `Fun.protect`；
- 明确的 `close`；
- scoped callback；
- 或库提供的 bracket/with-style API。

## 事务边界

```ocaml
let with_transaction database work =
  begin_transaction database;
  match work database with
  | value ->
      commit database;
      value
  | exception error ->
      let backtrace =
        Printexc.get_raw_backtrace ()
      in
      rollback_noerr database;
      Printexc.raise_with_backtrace
        error
        backtrace
```

`match ... with | exception` 可以只捕获被匹配表达式求值时的异常。这里必须仔细决定 commit 自己失败时如何处理，rollback 是否允许覆盖原异常，以及取消是否应该传播。

真实项目应优先使用数据库库已经测试过的 transaction helper，而不是每个业务模块重复实现资源协议。

## 可变状态与并发

单线程中正确的 mutable code，在多个 Domain 共享时不自动安全：

```ocaml
let counter =
  ref 0
```

两个 Domain 同时执行递增会产生数据竞争。OCaml 5 提供 `Atomic`、`Mutex` 等工具，但类型系统不会像 Rust 的 `Send` / `Sync` 那样阻止普通可变值跨 Domain 共享。

因此，准备并行化前应重新审计：

- 哪些 ref、array、Hashtbl 被共享；
- 哪些缓存依赖“只有一个执行线程”的假设；
- C stub 是否线程安全；
- 锁保护的具体不变量是什么；
- 是否可以通过分区数据和消息传递消除共享写入。

## 与 Kotlin 的状态模型对照

| 维度 | Kotlin | OCaml |
|---|---|---|
| 绑定不可变 | `val` 固定引用 | `let` 绑定不可赋值 |
| 可变局部 | `var` | `ref` 或 mutable field |
| 集合 | 只读接口与 mutable 实现并存 | list 不可变；array/Hashtbl 可变 |
| 错误 | exception、nullable、sealed result | exception、option、result |
| 资源 | `use`、`try/finally` | `Fun.protect`、with-style API |
| 并发可见性 | JVM memory model、volatile/atomic/lock | OCaml memory model、Atomic/Mutex |
| 类型追踪效果 | 普通函数类型不追踪 | 普通函数类型同样不追踪 |

两门语言都允许把副作用藏进一个看似普通的函数。结构化并发、Result 或不可变集合可以改善纪律，但不会自动把整个程序变成纯函数。

## 一套副作用边界

1. 先用纯函数表达领域规则；
2. option 表达正常缺失，result 表达需要处理的失败；
3. 只在无法局部恢复或内部不变量破坏时使用异常；
4. 在 I/O 边界捕获具体异常并补充上下文；
5. 使用 `Fun.protect` 或库提供的 with-style API 管理资源；
6. 不依赖 finalizer 完成关键释放；
7. 把 mutable state 缩进一个模块，公开最小操作；
8. 多 Domain 前重新审计所有共享可变状态；
9. 对异常开启并保留 backtrace；
10. 不用 `with _` 静默吞掉未知失败。

## 结论：函数式核心需要诚实的命令式外壳

OCaml 的不可变默认减少了意外状态，但现实程序仍要读取文件、更新缓存、维护连接和处理失败。

成熟的 OCaml 设计不是假装效果不存在，而是让它们有清晰形状：

- ref 与 mutable 明确指出可写位置；
- array、bytes 与 Hashtbl 服务适合原地更新的算法；
- `unit` 显示调用以效果为主；
- option、result 与 exception 分担不同失败语义；
- backtrace 保留故障上下文；
- `Fun.protect` 保证资源释放；
- 模块边界阻止可变实现泄漏到整个系统。

纯核心让规则容易推理，命令式外壳让程序与真实世界交互。两者的边界比“是否使用了一个 ref”更重要。

## 下一章

下一章进入 OCaml 5 的核心变化：effect handler、Domain、并行与并发，区分操作系统线程、共享内存并行、fiber 和异步 I/O，并与 Kotlin coroutine 的挂起与结构化并发模型比较。

## 延伸阅读

- [OCaml 官方教程：Mutability and Imperative Control Flow](https://ocaml.org/docs/mutability-imperative-control-flow)
- [OCaml Manual：Exceptions](https://ocaml.org/manual/5.5/coreexamples.html#s%3Aexceptions)
- [OCaml Stdlib：Fun.protect](https://ocaml.org/manual/5.5/api/Fun.html)
- [OCaml Stdlib：Printexc](https://ocaml.org/manual/5.5/api/Printexc.html)
