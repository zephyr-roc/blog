---
title: Kotlin Flow 进阶：组合、背压与共享生命周期
date: 2026-09-07
excerpt: buffer、conflate、latest、combine、flatMapLatest、flowOn、catch、shareIn 与 stateIn 改变的不只是写法，还改变并发、丢弃、失败和生命周期边界。
chapter: 并发进阶
chapterOrder: 7
---

Flow 操作符看起来像集合操作，但数据不是已经存在于内存中的列表。上游可能正在读取数据库、网络或传感器；下游可能比生产者慢；collector 可能随时取消；一次转换还可能被新的输入替代。

理解 Flow 不能只记住操作符名称，而要追踪四件事：

1. 哪些阶段在同一个协程中顺序执行？
2. 哪里引入了缓冲、额外协程或取消边界？
3. 元素是等待、丢弃、合并还是替换？
4. 上游的生命周期和失败最终属于谁？

## 普通操作符是逐元素流水线

```kotlin
source
    .map(::decode)
    .filter(Message::isValid)
    .onEach(::audit)
    .collect(::persist)
```

没有 `buffer`、`flowOn`、`channelFlow` 等并发边界时，这些阶段在 collector 协程中顺序执行。`persist` 未完成前，上游不能处理下一个元素。

这提供了最简单的背压：慢消费者直接减慢生产者。只有确定需要吞吐、低延迟或丢弃策略时，才应改变默认执行模型。

## 转换操作符

### map、filter 与 transform

`map` 为每个输入产生一个输出，`filter` 决定是否保留输入。`transform` 可以产生零个、一个或多个输出：

```kotlin
events.transform { event ->
    when (event) {
        is Batch -> event.items.forEach { emit(it) }
        is Single -> emit(event.item)
        is Heartbeat -> Unit
    }
}
```

`transform` 的能力更强，但简单一对一转换仍应使用 `map`，让基数关系一眼可见。

### transformWhile 与 takeWhile

有限数据流可以由内容决定终止：

```kotlin
frames.takeWhile { frame -> frame !is EndFrame }
```

`takeWhile` 不包含触发终止的元素。需要先发出最后一个元素再结束时，可以使用 `transformWhile`：

```kotlin
frames.transformWhile { frame ->
    emit(frame)
    frame !is EndFrame
}
```

提前终止通常通过取消内部收集实现，自定义资源必须在 `finally` 或 `awaitClose` 中正确释放。

## 组合多个 Flow

### zip：按位置一一配对

```kotlin
names.zip(scores) { name, score ->
    Result(name, score)
}
```

第一个 name 与第一个 score 配对，第二个与第二个配对。任一上游完成且无法再形成下一对时，结果流结束。

`zip` 适合元素存在明确序号对应关系，不适合“任意一侧变化就重算界面”。

### combine：使用双方最新值

```kotlin
combine(query, users) { currentQuery, currentUsers ->
    currentUsers.filter { it.matches(currentQuery) }
}
```

两个上游都至少发出一次后，任意一侧再发新值都会与另一侧最新值组合。它适合 UI 状态、筛选条件、权限和数据集合等持续状态。

如果一侧从未产生值，`combine` 也无法产生首个结果。状态型输入通常使用有初始值的 `StateFlow`，避免启动阶段永久等待。

### merge：按到达顺序汇合

```kotlin
merge(localEvents, remoteEvents)
    .collect(::handle)
```

`merge` 并发收集多个上游，并按实际到达顺序发出。不同来源之间没有位置配对，也不保存“最新组合”。

它适合类型相同、来源不同且每个事件都需处理的流。多个上游的相对顺序通常不确定，不应把 merge 当成稳定排序。

## Flow<Flow<T>> 的三种展开语义

输入变化后启动另一个异步流是常见模式：

```kotlin
val results: Flow<Flow<SearchResult>> =
    query.map(repository::search)
```

需要选择内部 Flow 之间的关系。

### flatMapConcat：一个结束后再处理下一个

```kotlin
queries.flatMapConcat(repository::search)
```

内部流严格串行，前一个不结束，后一个不会开始。适合必须保持批次顺序的操作。

### flatMapMerge：有限并发执行

```kotlin
ids.flatMapMerge(concurrency = 8) { id ->
    repository.observe(id)
}
```

最多同时收集指定数量的内部流，结果按到达顺序交错。它适合独立任务，但需要明确并发上限；默认值不应被当成业务容量保证。

### flatMapLatest：新输入取消旧工作

```kotlin
searchQuery
    .filter(String::isNotBlank)
    .distinctUntilChanged()
    .flatMapLatest(repository::search)
```

新 query 到来时，旧搜索流被取消，只保留最新输入对应的工作。它适合搜索、选中 ID、页面参数等“旧结果已失去价值”的场景。

取消旧协程不等于撤销已经提交到外部系统的副作用。数据库写入、支付和消息发送不应仅凭 `flatMapLatest` 获得事务语义。

部分 flatMap 操作符在所用 kotlinx.coroutines 版本中可能仍需要 `@ExperimentalCoroutinesApi`；升级依赖时应以对应版本 API 标记为准。

## 背压：慢的一端如何影响另一端

### 默认：生产者等待消费者

```kotlin
flow {
    repeat(3) {
        emit(it)
        println("emitted $it")
    }
}.collect { value ->
    delay(1.seconds)
    println("collected $value")
}
```

每次 `emit` 都要等 collector 处理当前值。没有元素丢失，内存不会因上下游速度差持续增长，但吞吐受最慢阶段限制。

### buffer：允许生产与消费重叠

```kotlin
source
    .buffer(capacity = 64)
    .collect(::persist)
```

`buffer` 在上下游之间引入 Channel，并让两侧运行在不同协程。生产者可以领先有限数量的元素，缓冲满后仍会挂起。

它适合上游和下游都包含可重叠等待的场景。若两端都是占满同一个线程的 CPU 计算，仅增加 buffer 不会自动获得有意义的并行加速。

容量是资源预算，不是越大越好。过大缓冲增加内存和取消后的陈旧工作；`Channel.UNLIMITED` 会把持续速度差转化成无界堆积。

### conflate：只保留最新的待处理值

```kotlin
sensorReadings
    .conflate()
    .collect(::renderGauge)
```

collector 忙碌时，中间值会被覆盖，只保留最新值。它适合进度、传感器仪表和可替代的界面快照。

订单、审计日志和增量命令不能使用 conflate，因为每个元素都承载不可替代的事实。

### collectLatest：取消旧的下游处理

```kotlin
selectedUser.collectLatest { userId ->
    renderProfile(repository.load(userId))
}
```

新值到来时，正在执行的 collector block 被取消并为新值重启。与 `conflate` 的区别是：

- `conflate` 不取消已经开始处理的当前值，只丢弃等待中的中间值。
- `collectLatest` 会取消当前处理块。

处理块必须是可取消的，并且不能假设取消会回滚外部副作用。

### mapLatest：转换本身可被替换

```kotlin
query
    .mapLatest(repository::searchOnce)
    .collect(::render)
```

新输入会取消旧的转换。它适合单次挂起计算；如果每个输入映射为持续 Flow，则使用 `flatMapLatest`。

## BufferOverflow 必须匹配业务语义

Channel、callbackFlow 和 MutableSharedFlow 可以配置缓冲溢出行为：

| 策略 | 缓冲满时 | 适用数据 |
|---|---|---|
| `SUSPEND` | 生产者挂起 | 不可丢任务、命令 |
| `DROP_OLDEST` | 丢弃最旧缓冲值 | 只关心近期数据 |
| `DROP_LATEST` | 丢弃新值 | 保留已排队批次 |

丢弃策略只有在存在缓冲时才有意义。选择前要回答“丢掉哪一个值不会破坏正确性”，而不是仅用它消除性能告警。

## flowOn：只移动上游

```kotlin
repository.rows()
    .map(::decode)
    .flowOn(Dispatchers.Default)
    .onEach(::render)
    .launchIn(viewModelScope)
```

`rows` 和 `map` 位于 `flowOn` 上方，运行在 Default；`onEach` 和最终收集仍处于 `viewModelScope` 的上下文。

多个 `flowOn` 可以形成多段流水线：

```kotlin
flow { emit(loadBlocking()) }
    .flowOn(Dispatchers.IO)
    .map(::parse)
    .flowOn(Dispatchers.Default)
    .collect(::render)
```

每个边界都可能引入协程、Channel 和调度切换。不要为了给每个操作符标注线程而切得过碎；真正执行阻塞调用的最低层函数也应保持 main-safe。

### 取消可能发生在跨上下文交付边界

`flowOn` 使上游和下游分属不同协程。下游取消时，已经由上游产生但尚未交付的缓冲元素可能被丢弃。不可丢副作用必须在事务或消息确认协议中定义，不能依赖 Flow 恰好把每个内存值送达。

## 异常透明：谁的失败能被谁处理

### catch 只处理它上方的异常

```kotlin
repository.users()
    .map(::toUiModel)
    .catch { error -> emit(UiState.Error(error.message)) }
    .collect(::render)
```

`catch` 能观察 `repository.users()` 和 `map` 的上游异常，但不能捕获位于它下方的 `render` 失败：

```kotlin
flow
    .catch { /* 捕获不到 collect block 的异常 */ }
    .collect { error("render failed") }
```

这保持了异常透明：上游不能假装下游失败是自己的数据错误。

不要吞掉 `CancellationException`。使用 Flow 操作符的标准取消会被正确区分；手写宽泛 `catch (Throwable)` 时仍要重新抛出取消。

### onCompletion 观察结束但不自动处理失败

```kotlin
flow.onCompletion { cause ->
    metrics.recordCompletion(cause)
}.collect()
```

`cause == null` 表示正常完成；非空可能是失败或取消。`onCompletion` 类似声明式 `finally`，只观察不吞掉异常。需要恢复上游失败时使用 `catch`。

### retryWhen 重新订阅冷上游

```kotlin
repository.remoteUpdates()
    .retryWhen { cause, attempt ->
        if (cause !is IOException || attempt >= 3) return@retryWhen false
        delay((attempt + 1).seconds)
        true
    }
```

重试意味着重新执行上游 Flow。它可能重复已经发生的读取或副作用，因此上游操作必须满足相应幂等性。不要重试业务校验错误或永久认证失败。

## shareIn：共享一个上游实例

```kotlin
val messages: SharedFlow<Message> = client.messages()
    .retryWhen(::retryNetwork)
    .shareIn(
        scope = applicationScope,
        started = SharingStarted.WhileSubscribed(
            stopTimeout = 5.seconds,
            replayExpiration = Duration.ZERO,
        ),
        replay = 0,
    )
```

`shareIn` 在指定作用域中启动共享协程。多个 collector 订阅同一个上游，而不是各自连接一次网络。

三个启动策略表达不同生命周期：

| 策略 | 上游何时运行 |
|---|---|
| `Eagerly` | 创建共享流后立即启动 |
| `Lazily` | 第一个订阅者出现时启动，之后保持运行 |
| `WhileSubscribed` | 有订阅者时运行，无订阅者后按策略停止 |

`WhileSubscribed(stopTimeout)` 可以跨越短暂的配置重建或界面切换，避免立刻断开再重连。超时时间应来自真实生命周期和资源成本，不应机械复制某个示例的 5 秒。

共享上游正常完成不会让 SharedFlow 自身完成；共享协程仍可按启动策略存在。上游失败会终止共享协程，并由传入 scope 的异常处理规则处理，所以应在 `shareIn` 前使用 `retry`、`catch` 或显式终止事件定义策略。

## stateIn：把计算结果提升为状态

```kotlin
val uiState: StateFlow<UiState> = combine(
    repository.observeUsers(),
    selectedFilter,
) { users, filter ->
    UiState.Content(users.filter(filter::matches))
}.catch { error ->
    emit(UiState.Error(error.message ?: "unknown"))
}.stateIn(
    scope = viewModelScope,
    started = SharingStarted.WhileSubscribed(5.seconds),
    initialValue = UiState.Loading,
)
```

`stateIn` 同时完成三件事：

1. 在 scope 中共享冷上游。
2. 保存最后一个值。
3. 为新 collector 立即提供当前状态。

初始值必须是领域上合法的状态。不要用空列表同时表示“尚未加载”和“加载完成但没有数据”，否则 UI 无法区分加载与空结果。

`stateIn(scope)` 还有一个挂起重载，它等待首个值后返回，没有显式 initialValue。若上游永远不发值，调用者也会一直挂起；应用状态通常更适合带初始值的非挂起重载。

## StateFlow 的去重位置

StateFlow 按 `equals` 合并相等状态。对 StateFlow 再调用 `distinctUntilChanged()` 通常没有作用，因为相同语义已经内置。

更重要的是控制状态模型：

```kotlin
data class UiState(
    val items: List<Item>,
    val loading: Boolean,
    val error: String?,
)
```

使用不可变快照和稳定相等性，能让状态合并、Compose 重组和测试断言具有一致语义。

## 测试冷流

有限冷流可以直接收集成列表：

```kotlin
@Test
fun mapsUsers() = runTest {
    val result = repository.users()
        .map(User::name)
        .toList()

    assertEquals(listOf("A", "B"), result)
}
```

无限流使用 `first`、`take(n)` 或显式启动 collector，避免测试永久等待：

```kotlin
val firstContent = viewModel.uiState
    .filterIsInstance<UiState.Content>()
    .first()
```

## 测试 SharedFlow 与 stateIn

共享流的启动取决于 collector。使用 `SharingStarted.WhileSubscribed` 时，测试中必须真的建立订阅：

```kotlin
@Test
fun exposesLatestState() = runTest {
    val values = mutableListOf<UiState>()

    val collector = backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
        viewModel.uiState.toList(values)
    }

    repository.emit(listOf(user))
    advanceUntilIdle()

    assertEquals(UiState.Content(listOf(user)), values.last())
    collector.cancel()
}
```

`backgroundScope` 会在测试结束时取消长期任务，适合不会自行完成的热流。调度器与 scope 应可注入，使生产代码的 `stateIn` 生命周期在测试中可控。

测试还应覆盖：

- 没有订阅者时 `WhileSubscribed` 是否停止上游；
- stop timeout 内重新订阅是否复用连接；
- `flatMapLatest` 是否取消旧查询；
- buffer 满时是挂起还是丢弃；
- 上游失败经过 `catch`、`retry` 后形成什么状态；
- collector 取消后资源是否释放。

## 操作符选择表

| 需求 | 操作符 |
|---|---|
| 按位置配对 | `zip` |
| 任意状态变化后用最新值重算 | `combine` |
| 多个同类事件源汇合 | `merge` |
| 内部流严格顺序 | `flatMapConcat` |
| 内部流有限并发 | `flatMapMerge` |
| 新输入替换旧工作 | `flatMapLatest` / `mapLatest` |
| 生产与消费有限重叠 | `buffer` |
| 只保留最新待处理快照 | `conflate` |
| 取消旧的下游处理 | `collectLatest` |
| 移动上游上下文 | `flowOn` |
| 恢复上游异常 | `catch` |
| 观察完成、失败或取消 | `onCompletion` |
| 在作用域中共享冷流 | `shareIn` / `stateIn` |

Flow 操作符不是纯粹的数据变换词汇。`buffer` 引入协程和队列，latest 系列引入取消，`flowOn` 引入上下文边界，`shareIn` 和 `stateIn` 引入独立生命周期。每次使用它们，都应能说清哪些值可能等待、丢失、重放或被取消。

## 参考资料

- [Flow operators](https://kotlinlang.org/docs/coroutines-flow-operators.html)
- [Flow context](https://kotlinlang.org/docs/coroutines-flow.html#flow-context)
- [buffer API](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.flow/buffer.html)
- [combine API](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.flow/combine.html)
- [flatMapLatest API](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.flow/flat-map-latest.html)
- [shareIn API](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.flow/share-in.html)
- [stateIn API](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.flow/state-in.html)
- [Testing Kotlin coroutines](https://developer.android.com/kotlin/coroutines/test)

## 下一章

数据流的执行模型最终要绑定到框架生命周期。下一章将在 [Vert.x 与 Android 协程实战](/collections/kotlin/coroutines-in-vertx-android) 中把 ReadStream、Flow、ViewModel 和 UI collector 连接成完整链路。
