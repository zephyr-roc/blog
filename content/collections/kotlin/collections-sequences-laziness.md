---
title: Kotlin 数据管道：集合、Sequence 与惰性求值
date: 2026-09-09
excerpt: 从逐阶段计算与逐元素拉取理解 Collection 和 Sequence，分析短路、状态型操作、中间分配、sequence builder、资源生命周期及 Flow 边界。
chapter: 函数式抽象
chapterOrder: 13
---

高阶函数让数据处理可以写成一条声明式管道：

```kotlin
val names = users
    .filter(User::enabled)
    .map(User::displayName)
    .take(20)
```

但源码形状相同，不代表执行模型相同。接收者是 `Iterable`、`Sequence` 还是 `Flow`，决定了操作何时执行、是否产生中间容器、能否短路、能否挂起，以及取消和资源由谁负责。

本章不把标准库操作符重新列成词典，而是建立五个判断维度：

1. 数据是已经存在的值，还是按需产生的过程？
2. 管道按阶段处理整批数据，还是让单个元素逐步穿过所有操作？
3. 操作是无状态、少量状态，还是必须保存全部输入？
4. 终止消费时，上游能否完成清理？
5. 处理过程是否需要挂起、取消和异步背压？

## Iterable 管道：每一步产生一个完整结果

对 `List`、`Set` 等 `Iterable` 调用标准转换时，操作通常立即执行，并为下一步产生新的集合：

```kotlin
val result = words
    .filter { it.length >= 4 }
    .map(String::uppercase)
    .take(3)
```

近似执行过程是：

```kotlin
val filtered = ArrayList<String>()
for (word in words) {
    if (word.length >= 4) filtered += word
}

val mapped = ArrayList<String>(filtered.size)
for (word in filtered) {
    mapped += word.uppercase()
}

val result = mapped.take(3)
```

先遍历全部输入完成 `filter`，再遍历过滤结果完成 `map`，最后才截取前三个。好处是每一步都是普通、可重复读取的值；代价是多阶段管道可能创建中间容器，并做超过最终结果所需的工作。

### 返回新集合不等于元素不可变

非 `To` 版本的转换通常不会修改原集合：

```kotlin
val sorted = users.sortedBy(User::name)
```

但这只说明容器结果是新的，不说明其中的 `User` 被复制，也不保证元素不可变。若元素本身是可变对象，原集合和结果集合仍可能引用同一批实例。

`List<T>` 也只是只读接口，不是深度不可变集合。函数式管道减少显式容器修改，却不会自动建立持久化数据结构或并发安全。

### mapNotNull：同时表达转换与基数变化

```kotlin
val ids: List<Long> = rawIds.mapNotNull(String::toLongOrNull)
```

它比 `map { ... }.filterNotNull()` 更直接地表达“每个输入产生零个或一个输出”，也少一个中间结果。类似地：

- `map`：一个输入对应一个输出；
- `mapNotNull`：一个输入对应零个或一个输出；
- `flatMap`：一个输入对应零个或多个输出；
- `filter`：保持元素类型，只改变是否保留。

先明确基数关系，再选择操作符，通常比把所有转换都写成 `map` 后补清理步骤更易读。

### associateBy：重复键会覆盖旧值

```kotlin
val usersById = users.associateBy(User::id)
```

当多个元素产生相同键时，后面的值会覆盖前面的值。若重复键是业务错误，`associateBy` 会静默丢失信息，应显式校验：

```kotlin
val usersById = users.associateBy(User::id)
require(usersById.size == users.size) { "duplicate user id" }
```

若一个键本来就对应多个元素，使用 `groupBy`；若要对每组直接聚合而不保存完整分组，使用 `groupingBy` 配合 `eachCount`、`fold` 或 `aggregate`。

### fold：把多元素关系收束为一个状态

```kotlin
data class Summary(
    val count: Int = 0,
    val total: Long = 0,
)

val summary = orders.fold(Summary()) { acc, order ->
    Summary(
        count = acc.count + 1,
        total = acc.total + order.amount,
    )
}
```

`fold` 有显式初始值，空集合也能产生结果。`reduce` 使用首个元素作为初始累加器，因此空集合会失败，并且累加器类型受元素类型限制。工程代码中只要存在自然单位元，`fold` 通常更清楚。

若每一步的累计结果都需要保留，使用 `runningFold`；它会产生包含初始值在内的中间状态序列，不应在只需要最终值时使用。

### destination 操作减少受控场景的中间容器

标准库提供 `mapTo`、`filterTo`、`associateTo` 等操作，将结果追加到调用者提供的目标容器：

```kotlin
val names = users
    .filterTo(ArrayList()) { it.enabled }
    .mapTo(ArrayList()) { it.displayName }
```

更常见的用途是直接选择结果容器类型：

```kotlin
val uniqueLengths = words.mapTo(HashSet(), String::length)
```

目标容器版本仍然急切执行，也不会自动融合多个阶段。它适合确实需要特定容器或向既有结果追加的边界；为了微小分配收益到处暴露可变容器，通常会降低可读性。

## Sequence 管道：每个元素穿过整条链

`Sequence<T>` 不保存一组已完成的数据，而是描述如何在迭代时逐个产生元素：

```kotlin
val result = words
    .asSequence()
    .filter { it.length >= 4 }
    .map(String::uppercase)
    .take(3)
    .toList()
```

构建管道时，`filter`、`map` 和 `take` 不会立即遍历。`toList()` 请求第一个结果后，第一个输入依次经过过滤、转换和截取，再处理下一个输入。得到三个结果后，消费停止，剩余输入不会执行。

### 中间操作与终止操作

Sequence 操作可以先按是否触发计算分类：

| 类型 | 作用 | 示例 |
| --- | --- | --- |
| 中间操作 | 返回另一条 Sequence，通常保持惰性 | `map`、`filter`、`take` |
| 终止操作 | 实际迭代并产生值或副作用 | `toList`、`first`、`count`、`sum` |

下面只创建了计算描述：

```kotlin
val normalized = records
    .asSequence()
    .map(::normalize)
    .filter(::isValid)
```

直到调用终止操作，`normalize` 与 `isValid` 才执行。若从未消费，管道中的日志、计数和副作用也不会发生。

### 短路决定惰性的实际收益

```kotlin
val firstMatch = records
    .asSequence()
    .map(::parse)
    .filterNotNull()
    .firstOrNull(Event::important)
```

找到第一个重要事件后，上游停止。这里 Sequence 同时减少中间列表和不必要的解析。

如果最后仍要对全部元素执行 `toList()`，且管道只有一次轻量 `map`，惰性可能没有减少任何元素计算，反而增加包装对象和逐元素调用开销。因此“使用 Sequence”不是默认优化；**长管道、大输入、昂贵转换和早期短路**越明显，收益才越可能超过开销。

### 操作顺序决定工作量

```kotlin
val result = files
    .asSequence()
    .filter(File::isFile)
    .map { it.readText() }
    .take(10)
    .toList()
```

先执行便宜且选择性强的 `filter`，可以避免读取目录或无关文件。若先 `map(File::readText)` 再过滤，惰性仍然存在，却无法挽回已经发生的昂贵 I/O。

操作符顺序不是纯样式问题。应优先：

1. 提前放置便宜、选择性强的过滤；
2. 在语义允许时尽早短路；
3. 推迟昂贵转换；
4. 避免在会扩大数据量的 `flatMap` 之后才过滤。

## 无状态与有状态操作：惰性不等于常量内存

Sequence 文档将操作按状态需求区分：

- 无状态操作可独立处理每个元素，例如 `map`、`filter`；
- 少量状态操作只记录有限信息，例如 `take(n)`；
- 有状态操作需要保存与输入规模相关的数据。

### distinct 必须记住已经出现的值

```kotlin
events
    .asSequence()
    .distinctBy(Event::id)
    .take(100)
```

为了判断后续元素是否重复，`distinctBy` 必须维护已见键集合。它仍可逐个输出首次出现的值，也能在 `take(100)` 后停止，但内存会随已见不同键数量增长。

### sorted 必须先看到全部输入

```kotlin
events
    .asSequence()
    .sortedBy(Event::timestamp)
    .take(100)
```

一般排序必须先读取全部输入，保存并排序后才能产生第一个值。`take(100)` 写在 `sortedBy` 后面不会让它只读取 100 个元素。

如果真正需要的是 Top N，可使用固定大小堆或领域专用算法，不能仅靠把集合换成 Sequence 获得流式 Top N。

### groupBy 会物化整个分组结果

`groupBy` 的结果是 `Map<K, List<V>>`，无论上游是不是 Sequence，都需要保存所有分组元素。惰性只存在于到达 `groupBy` 之前；终止操作一旦要求完整结果，就必须物化。

判断内存复杂度时，应查看最强状态操作，而不是只看管道开头是否调用了 `asSequence()`。

## 构造 Sequence：值、递推与协作式生成

### sequenceOf 与 asSequence

```kotlin
val fixed = sequenceOf(1, 2, 3)
val view = users.asSequence()
```

`asSequence()` 通常只是为现有 `Iterable` 建立惰性视图，不会复制元素。真正迭代发生在终止操作，因此底层可变集合在构建管道后发生的变化，可能被之后的消费观察到。

若调用方需要稳定快照，应先复制为不可变语义的列表，而不是把延迟读取误认为隔离：

```kotlin
val snapshot = mutableUsers.toList()
val sequence = snapshot.asSequence()
```

### generateSequence：由前一个值计算下一个值

```kotlin
val powersOfTwo = generateSequence(1L) { previous ->
    previous.takeIf { it <= Long.MAX_VALUE / 2 }?.times(2)
}
```

生成函数返回 `null` 时结束。若永远不返回 `null`，Sequence 是无限的，消费端必须使用 `take`、`first`、`takeWhile` 等短路操作：

```kotlin
val firstTen = generateSequence(0) { it + 1 }
    .take(10)
    .toList()
```

对无限 Sequence 调用 `toList()`、`count()` 或无界排序不会完成。

### sequence builder：yield 暂停生成器，不是异步 I/O

```kotlin
fun ancestors(start: Node): Sequence<Node> = sequence {
    var current: Node? = start

    while (current != null) {
        yield(current)
        current = current.parent
    }
}
```

`sequence {}` 的 block 类型是 `suspend SequenceScope<T>.() -> Unit`。`yield` 将一个值交给消费者，并把生成器暂停到消费者请求下一个值。

这里出现 `suspend`，但 Sequence 不是协程并发或异步数据流：

- 生成器由消费者同步推进；
- 没有 `CoroutineScope`、`Job` 或调度器；
- 受限挂起只用于 `yield`/`yieldAll` 这一类 SequenceScope 操作；
- 不能把网络请求、定时器或任意挂起函数塞进 Sequence builder。

需要等待异步数据时应使用 `Flow`，而不是试图让 `sequence {}` 承担协程生命周期。

### yieldAll：拼接一批值

```kotlin
val values = sequence {
    yield(0)
    yieldAll(1..3)
    yieldAll(generateSequence(4) { it + 1 })
}
```

如果传给 `yieldAll` 的 Sequence 是无限的，它必须是最后一个生成步骤；后面的代码永远没有机会执行。

## 提前停止与资源清理

`sequence {}` 有一个不直观但重要的边界：如果消费者在生成器完成前停止迭代，暂停点之后的代码可能永远不会恢复，`finally` 也可能不执行。

```kotlin
val values = sequence {
    val resource = openResource()

    try {
        yield(resource.read())
    } finally {
        resource.close()
    }
}

values.first()
```

`first()` 得到一个值后不再请求下一个元素，生成器停在 `yield`，不能依赖上面的 `finally` 完成关闭。

因此不要让普通 `Sequence` 隐式拥有必须确定关闭的文件、游标、连接或锁。更安全的设计是让资源作用域包围完整消费：

```kotlin
fun <R> File.useRows(block: (Sequence<String>) -> R): R =
    bufferedReader().use { reader ->
        block(reader.lineSequence())
    }
```

```kotlin
val firstError = file.useRows { rows ->
    rows.mapNotNull(::parseRow)
        .firstOrNull(Row::isError)
}
```

Sequence 只能在 `use` block 内消费，资源关闭由外层词法作用域保证。若资源生命周期需要跟随异步收集和取消，则使用 `Flow` 的 `try/finally`、`callbackFlow`/`awaitClose` 或框架提供的资源 API。

## 重复迭代：Sequence 不自动缓存结果

多数 Sequence 可以重复迭代，但每个终止操作都会重新执行整条管道：

```kotlin
val parsed = lines
    .asSequence()
    .map(::expensiveParse)

val count = parsed.count()
val items = parsed.toList()
```

`expensiveParse` 执行了两轮。Sequence 的惰性不是 memoization；若结果会重复使用，应一次物化：

```kotlin
val items = parsed.toList()
val count = items.size
```

### 某些 Sequence 只能消费一次

基于迭代器、流式解析器或外部游标的实现可能天然是一次性的。`constrainOnce()` 可以把这一约束显式化：

```kotlin
val tokens = parser.iterator()
    .asSequence()
    .constrainOnce()
```

第二次迭代会抛出 `IllegalStateException`。这比静默返回空结果更容易发现生命周期错误，但也说明返回 `Sequence` 的 API 必须文档化可重复性。

### Side effect 会随消费次数重复

```kotlin
val traced = source
    .asSequence()
    .onEach(logger::record)
```

`onEach` 仍是中间操作。没有终止操作时日志不会发生；消费两次就会记录两次。用于调试尚可，用于扣库存、确认消息或发送通知会把业务副作用绑在不明显的迭代次数上。

数据管道中的 lambda 应尽量保持纯函数。不可重复副作用应放在显式的终止边界，并建立幂等、事务或消息确认协议。

## 性能模型：减少分配不等于一定更快

Collection 与 Sequence 的取舍不能只看中间列表数量。

### Collection 的优势

- 数据已经完整存在，执行和异常位置直接；
- 常见高阶函数为 inline，实现通常是紧凑循环；
- 小集合、短管道的包装与间接调用更少；
- 结果天然可重复读取，调试容易。

### Sequence 的优势

- 多阶段转换可避免若干中间集合；
- 单个元素可以穿过整条链，提高短路机会；
- 能表达有限或无限的按需生成过程；
- 对昂贵映射、强过滤和只取少量结果尤其有价值。

### Sequence 自身也有成本

每个中间操作通常创建一层 Sequence 包装，迭代时经历更多函数调用与状态机判断。对十几个元素做一次 `map`，直接 Collection 操作很可能更简单也更快。

合理的优化顺序是：

1. 先选择符合 API 语义的数据模型；
2. 识别中间结果、短路比例和状态型操作；
3. 用真实数据规模做 JMH 或平台基准；
4. 再决定是否引入 Sequence、目标容器或手写融合循环。

不要用微型 `measureTimeMillis` 单次运行推断结论；JIT 预热、逃逸分析、GC 和输入分布都会显著影响结果。

## Collection、Sequence 与 Flow 的边界

三者都支持 `map`、`filter`、`take`，但抽象的不是同一件事：

| 模型 | 元素来源 | 处理函数能否挂起 | 生命周期与取消 | 典型用途 |
| --- | --- | --- | --- | --- |
| `Collection`/`Iterable` | 已在内存中的一组值 | 否 | 普通调用栈 | 小中型数据、需要稳定结果 |
| `Sequence` | 消费者同步拉取 | 否 | Iterator 调用过程 | CPU 惰性管道、短路、无限生成 |
| `Flow` | 可挂起地逐个 emit | 是 | CoroutineContext 与 Job | 异步数据、延迟、取消、背压 |

### Sequence 不是轻量 Flow

```kotlin
fun users(): Sequence<User>
```

这个签名适合在调用线程同步产生用户。如果每个用户来自数据库异步游标、网络分页或定时更新，应该暴露：

```kotlin
fun users(): Flow<User>
```

Flow 的价值不只是“也很懒”，而是挂起、取消、上下文与异常透明。把阻塞 I/O 包在 Sequence 中会隐藏线程占用，也无法正确表达取消协议。

### Flow 也不替代内存集合

若数据已经完整存在，并且调用者需要随机访问、大小和重复遍历，返回 `List<T>` 比 `flowOf(...)` 更诚实。引入 Flow 会额外引入协程生命周期，却没有获得异步生产价值。

### 在边界物化，而不是来回转换

常见的清晰结构是：

```kotlin
val result: ViewData = repository.events()
    .map(::toViewData)
    .first()
```

或：

```kotlin
val result: List<ViewData> = source
    .asSequence()
    .filter(::isVisible)
    .map(::toViewData)
    .toList()
```

惰性模型负责管道内部，明确的 `toList()`、`first()` 或持久化动作负责边界。频繁在 List、Sequence、Flow 之间往返通常说明 API 所有权和生命周期尚未确定。

## API 设计：返回值也在声明执行语义

### 返回 List：承诺已经完成的稳定结果

```kotlin
fun availableRules(): List<Rule>
```

调用者自然预期：函数返回时计算已经完成，可以重复遍历，异常已经在调用期间发生。若内部使用 Sequence 优化，仍可在出口物化为 List，不必泄漏实现策略。

### 返回 Sequence：承诺按需同步计算

```kotlin
fun walkParents(node: Node): Sequence<Node>
```

调用者应知道：实际工作在迭代时发生，异常也可能延迟到终止操作，重复迭代可能重复计算。若 Sequence 只能消费一次或依赖外部对象仍然存活，必须写进 API 契约。

### 接受 Sequence 往往过度约束调用者

```kotlin
fun index(values: Sequence<Value>): Index
```

如果函数只是遍历一次，接受 `Iterable<Value>` 通常覆盖更多调用者；Sequence 仍可通过适配或重载进入。只有函数确实依赖潜在无限输入或惰性语义时，才应把 Sequence 写入参数类型。

API 类型应该表达调用者需要知道的语义，而不是内部恰好使用的优化工具。

## 测试惰性管道

测试结果相等还不够；惰性行为通常涉及执行次数与终止位置。

### 验证构建时不执行

```kotlin
var calls = 0

val sequence = listOf(1, 2, 3)
    .asSequence()
    .map {
        calls++
        it * 2
    }

check(calls == 0)
check(sequence.first() == 2)
check(calls == 1)
```

### 验证短路而不是只验结果

```kotlin
var visited = 0

val result = generateSequence(1) { it + 1 }
    .onEach { visited++ }
    .first { it == 5 }

check(result == 5)
check(visited == 5)
```

### 验证重复消费语义

对可重复 Sequence，测试两次消费是否重新计算且结果一致；对一次性 Sequence，测试第二次消费明确失败。资源型 API 还要验证短路、异常和正常完成三条路径都能关闭资源。

## CHAPTER 03 小结

本章从函数值出发，最终得到一套完整的 Kotlin 抽象工具链：

1. **高阶函数与函数类型**描述可执行行为；
2. **Receiver 与 context parameters**组织隐式作用域和环境能力；
3. **类型安全 DSL**用作用域限制领域结构；
4. **泛型、型变与 Builder inference**传播类型关系；
5. **委托、operator 与 infix**定义受约束的声明形式；
6. **Contracts**把函数保证交给控制流分析；
7. **Collection 与 Sequence**决定函数组合后的执行策略。

这些能力并不是彼此独立的语法糖。DSL 的 Receiver 需要泛型推导保持类型信息，inline 高阶函数与 Contracts 共同影响调用点分析，操作符和委托决定源码如何展开，Collection、Sequence 与 Flow 则决定这些函数何时真正执行。

CHAPTER 03 的核心结论是：Kotlin 的表达力来自**让普通函数同时携带类型关系、调用作用域和执行约束**，而不是尽可能隐藏所有实现细节。

## 参考资料

- [Kotlin collection operations](https://kotlinlang.org/docs/collection-operations.html)
- [Kotlin sequences](https://kotlinlang.org/docs/sequences.html)
- [sequence builder](https://kotlinlang.org/api/core/kotlin-stdlib/kotlin.sequences/sequence.html)
- [constrainOnce](https://kotlinlang.org/api/core/kotlin-stdlib/kotlin.sequences/constrain-once.html)
- [Collection transformations](https://kotlinlang.org/docs/collection-transformations.html)
- [Aggregate operations](https://kotlinlang.org/docs/collection-aggregate.html)

## 下一章

CHAPTER 04 将进入类型建模：`sealed` hierarchy、`enum`、`data object` 与 value class 如何表示封闭状态、身份和值域，并让非法状态更难进入业务代码。
