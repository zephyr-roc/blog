---
title: Kotlin Flow 模型：冷流、热流、状态与队列
date: 2026-09-07
excerpt: Flow、SharedFlow、StateFlow 与 Channel 都能传递多个值，但分别表达按需计算、广播、当前状态和竞争消费；选择错误会直接改变数据交付语义。
chapter: 并发进阶
chapterOrder: 6
---

挂起函数返回一个结果，异步数据流则需要在一段时间内返回零个、一个或多个结果。数据库观察、传感器读数、搜索输入、消息消费和界面状态都属于数据流，但它们并不共享同一种交付语义。

Kotlin 协程生态提供四个经常放在一起讨论的抽象：

| 抽象 | 核心语义 | 新订阅者看到什么 |
|---|---|---|
| `Flow<T>` | 每次收集独立执行的冷数据流 | 从头启动一次上游 |
| `SharedFlow<T>` | 向所有当前订阅者广播的热数据流 | replay 缓存中的值，再接收新值 |
| `StateFlow<T>` | 始终持有一个当前值的热状态流 | 立即获得当前状态 |
| `Channel<T>` | 发送者与接收者之间的队列 | 与其他接收者竞争队列元素 |

它们不是容量和性能不同的同一种 Stream。`Flow` 描述一段可重复执行的异步计算；`SharedFlow` 描述广播；`StateFlow` 描述状态；`Channel` 描述元素所有权的转移。

## 冷流：由收集者启动与拥有

### Flow 是挂起式 pull 数据流

`Flow<T>` 只提供一个核心操作：在收集期间把元素依次交给 `FlowCollector<T>`。最常见的创建方式是 `flow` builder：

```kotlin
fun temperatures(sensor: Sensor): Flow<Double> = flow {
    while (currentCoroutineContext().isActive) {
        emit(sensor.read())
        delay(1.seconds)
    }
}
```

调用 `temperatures(sensor)` 只创建一份流描述，不会执行 `sensor.read()`。真正调用 `collect` 时，上游代码才开始运行：

```kotlin
temperatures(sensor).collect { value ->
    println("temperature=$value")
}
```

`emit` 是挂起函数。下游尚未处理完当前元素时，上游默认不能继续发出下一个元素，因此普通 Flow 天然形成逐元素的背压链路。

### 冷流意味着每次 collect 都重新执行

```kotlin
fun users(): Flow<User> = flow {
    println("query database")
    emitAll(repository.queryAll())
}

users().collect(::renderFirstScreen)
users().collect(::renderSecondScreen)
```

这里会执行两次数据库查询。两个 collector 各自拥有一条独立的上游执行链，它们不会自动共享结果。

冷流适合：

- 每个调用者都应得到独立计算；
- 查询应在订阅时执行；
- 取消某个 collector 只应停止它自己的工作；
- 数据源可以被安全地重新订阅。

如果上游是昂贵的网络连接或唯一硬件监听器，多次收集可能不是所需语义，应在明确的作用域中用 `shareIn` 或 `stateIn` 转换成热流。

### 默认按顺序执行

`flow`、中间操作符和 `collect` 默认在同一协程中顺序执行：

```kotlin
flowOf(1, 2, 3)
    .map { value -> value * 2 }
    .filter { value -> value > 2 }
    .collect { value -> println(value) }
```

执行次序是：产生 1 → map 1 → filter 2，再产生 2。它不会先产生所有值、再整体 map、最后整体 filter。

这种逐元素流水线有两个结果：

1. 默认没有隐藏的后台任务或线程切换。
2. 下游变慢会直接让上游 `emit` 变慢。

需要让生产与消费重叠执行时，必须显式加入 `buffer`；需要丢弃过时值时，使用 `conflate` 或 latest 系列操作符。执行策略会在下一篇展开。

### 常见 Flow builder

#### flowOf 与 asFlow

已有内存数据可以直接转成 Flow：

```kotlin
val fixed: Flow<Int> = flowOf(1, 2, 3)
val fromRange: Flow<Int> = (1..100).asFlow()
val fromSequence: Flow<Record> = records.asFlow()
```

这些流仍是冷流。每次收集都会重新遍历数据源。若原始 `Sequence` 自身只能遍历一次，包装成 Flow 不会让它自动获得可重放能力。

#### flow

`flow` 适合把顺序挂起代码组织为数据流：

```kotlin
fun pages(client: ApiClient): Flow<Item> = flow {
    var cursor: String? = null

    do {
        val page = client.loadPage(cursor)
        for (item in page.items) emit(item)
        cursor = page.nextCursor
    } while (cursor != null)
}
```

collector 取消时，挂起 API 和 `emit` 会沿同一任务链收到取消。

#### callbackFlow

多次回调的数据源应使用 `callbackFlow`，并在 `awaitClose` 中注销监听器：

```kotlin
fun LocationClient.locations(): Flow<Location> = callbackFlow {
    val listener = LocationListener { location ->
        trySend(location)
    }

    register(listener)

    awaitClose {
        unregister(listener)
    }
}
```

`callbackFlow` 内部通过 Channel 连接回调生产者与 Flow collector，所以需要决定缓冲和发送失败策略。`trySend` 返回结果，不能假设元素一定成功入队。

一次性回调应使用 `suspendCancellableCoroutine`；持续回调才适合 Flow。

### 上下文由收集者提供

Flow 遵循上下文保存：下游在哪个协程收集，普通上游代码就在哪个上下文执行。

```kotlin
withContext(Dispatchers.Main) {
    repository.observeUsers()
        .map(::toUiModel)
        .collect(::render)
}
```

如果 `observeUsers` 没有使用 `flowOn` 改变上游上下文，`map` 和 `collect` 都会在当前 Main 上下文运行。`suspend` 不代表后台线程，Flow 也不会自动把工作移到 IO。

不能在 `flow {}` 内直接用 `withContext` 改变发射上下文：

```kotlin
fun broken(): Flow<Data> = flow {
    withContext(Dispatchers.IO) {
        emit(loadData()) // 违反 Flow 上下文保存
    }
}
```

需要切换上游执行上下文时，使用 `flowOn`：

```kotlin
fun data(): Flow<Data> = flow {
    emit(loadDataBlocking())
}.flowOn(Dispatchers.IO)
```

`flowOn` 只影响它上方的操作符，不改变下游 collector 的上下文。它通常会在边界引入另一个协程和 Channel，因而也影响缓冲、取消竞争与调用栈。

### 取消由 collector 拥有

冷 Flow 的生命周期属于执行 `collect` 的协程：

```kotlin
val job = scope.launch {
    events.collect(::handle)
}

job.cancelAndJoin()
```

取消 collector 会停止上游执行。Flow builder 和大多数挂起操作符会自然检查取消；纯 CPU 循环仍需主动调用 `ensureActive` 或使用可取消挂起点。

不要在 repository 内部偷偷创建新作用域来收集 Flow，否则调用者既无法决定何时开始，也无法可靠停止它：

```kotlin
// 不推荐：产生脱离调用者的隐藏订阅
fun startObserving(flow: Flow<Event>) {
    CoroutineScope(Dispatchers.IO).launch {
        flow.collect(::persist)
    }
}
```

库层通常返回 Flow，最终所有者在自己的 `CoroutineScope` 中收集或共享。

### 终止操作才会启动冷流

`map`、`filter`、`take` 等中间操作符返回新的 Flow 描述，不立即执行：

```kotlin
val names = users
    .filter(User::active)
    .map(User::name)
```

以下终止操作会触发收集：

- `collect`、`collectLatest`
- `first`、`single`
- `toList`、`toSet`
- `reduce`、`fold`
- `launchIn`

```kotlin
val firstAdmin = users.first { it.isAdmin }
```

`first` 得到结果后会通过取消上游收集来结束这条流水线。自定义 Flow 必须遵守协作式取消，才能及时释放资源。

`launchIn(scope)` 等价于在给定作用域中启动 `collect`，它把生命周期选择放到调用点：

```kotlin
events
    .onEach(::handle)
    .launchIn(viewModelScope)
```

返回的 `Job` 仍应在需要局部停止时被保存和取消。

## 热流：生产者独立于单个 collector

热流的生产或状态存在不依赖某一个 collector。订阅者离开时，热对象本身可能继续存在；它何时停止取决于拥有它的作用域或显式关闭协议。

### Channel：每个元素交给一个接收者

`Channel<T>` 具有发送端和接收端：

```kotlin
val tasks = Channel<Task>(capacity = 64)

val workers = List(4) {
    launch {
        for (task in tasks) {
            execute(task)
        }
    }
}
```

四个 worker 竞争消费任务。一个任务只会被其中一个 receiver 取得，这正是工作队列语义。

Channel 可以关闭：关闭后不再接受新元素，接收者仍可消费已有缓冲，随后循环结束。发送和接收还可能挂起，因此容量决定了生产者何时感受到背压。

它适合：

- worker pool；
- actor-style 单一状态所有者；
- 点对点消息传递；
- 明确需要 close 的有限数据源。

它不适合直接表示“所有观察者都应看到的当前界面状态”。多个 collector 从同一 Channel 接收时会分走元素，不会各得一份。

### SharedFlow：向所有当前订阅者广播

`SharedFlow<T>` 是热广播流。通过 `MutableSharedFlow` 发出的值会交给所有符合条件的当前订阅者：

```kotlin
class EventHub {
    private val _events = MutableSharedFlow<DomainEvent>()
    val events: SharedFlow<DomainEvent> = _events.asSharedFlow()

    suspend fun publish(event: DomainEvent) {
        _events.emit(event)
    }
}
```

与 Channel 不同，两个 collector 都能看到同一次广播。与普通 Flow 不同，collector 不会为自己重新启动生产者。

`SharedFlow` 没有完成语义。它本身不会通过 close 结束；需要有限收集时用 `take`、`takeWhile` 或取消 collector。

#### replay 决定新订阅者能看到多少历史

```kotlin
val events = MutableSharedFlow<Event>(replay = 2)
```

新订阅者先收到 replay cache 中最近两个值，再接收新广播。`replay = 0` 时，没有订阅者期间发出的普通事件默认不会为未来订阅者保存。

额外缓冲由 `extraBufferCapacity` 和 `onBufferOverflow` 控制：

```kotlin
val telemetry = MutableSharedFlow<Sample>(
    replay = 0,
    extraBufferCapacity = 64,
    onBufferOverflow = BufferOverflow.DROP_OLDEST,
)
```

丢弃旧值适合只关心近期趋势的遥测，不适合支付、订单等不可丢业务事件。

`tryEmit` 不挂起并返回是否成功，调用者必须处理 `false`；它不是“尽力发送后一定成功”。

### StateFlow：当前状态，而不是事件日志

`StateFlow<T>` 是始终持有一个当前值的热流：

```kotlin
class CartStore {
    private val _state = MutableStateFlow(CartState())
    val state: StateFlow<CartState> = _state.asStateFlow()

    fun add(product: Product) {
        _state.update { current ->
            current.copy(items = current.items + product)
        }
    }
}
```

它有以下固定语义：

- 创建时必须提供初始值；
- `value` 可同步读取当前状态；
- 新 collector 会立即收到当前值；
- 更新使用基于 `Any.equals` 的强相等性合并；
- 它不会 close，也不会用完成或失败表示状态终止。

连续赋入相等值通常不会再次通知 collector。状态类的 `equals` 必须符合约定；可变对象原地修改后重新赋回同一个实例，很可能不会形成可观察更新：

```kotlin
// 不推荐：原地修改破坏快照语义
_state.value.items += product

// 推荐：创建新的不可变状态
_state.update { it.copy(items = it.items + product) }
```

`StateFlow` 适合可随时回答“现在是什么”的状态，不适合表达每次都必须消费的事件。相同的两次 `SaveCompleted` 若被视为相等状态，第二次可能被合并；而导航和审计事件通常要求独立身份或确认协议。

### 暴露只读视图

状态和广播的写权限应留在所有者内部：

```kotlin
private val _state = MutableStateFlow(UiState.Loading)
val state: StateFlow<UiState> = _state.asStateFlow()

private val _events = MutableSharedFlow<Effect>()
val events: SharedFlow<Effect> = _events.asSharedFlow()
```

外部持有 `StateFlow` 或 `SharedFlow` 后只能收集，不能任意改写状态或伪造事件。只读类型不会让内部更新自动线程安全；复合更新仍应使用 `update`、`Mutex` 或单一状态所有者。

### 从冷流转成热流

`shareIn` 把一个冷 Flow 放进指定作用域共享，返回 `SharedFlow`；`stateIn` 额外维护当前值，返回 `StateFlow`：

```kotlin
val messages: SharedFlow<Message> = repository.messages()
    .shareIn(
        scope = applicationScope,
        started = SharingStarted.WhileSubscribed(),
        replay = 0,
    )

val uiState: StateFlow<UiState> = repository.observeUser(id)
    .map<User, UiState>(UiState::Content)
    .stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5.seconds),
        initialValue = UiState.Loading,
    )
```

转换的关键不是调用哪个操作符，而是 `scope` 和 `started`：它们决定共享上游属于谁、何时启动、没有订阅者时是否继续运行。下一篇会完整分析这些策略。

## 选择数据模型

| 需求 | 首选抽象 | 原因 |
|---|---|---|
| 每次订阅独立执行数据库查询 | `Flow` | collector 拥有上游执行 |
| 多个 worker 分担任务 | `Channel` | 每个元素只交给一个接收者 |
| 所有在线观察者接收广播 | `SharedFlow` | 一次发射广播给多个订阅者 |
| 任意时刻读取当前 UI 状态 | `StateFlow` | 有初始值和同步 `value` |
| 回调产生连续事件 | `callbackFlow` | 把注册/注销绑定到收集生命周期 |
| 冷流需要在一个作用域中共享 | `shareIn` / `stateIn` | 明确共享生命周期和重放语义 |

判断时先回答三个问题：

1. 每个订阅者应独立执行，还是共享一个生产者？
2. 一个元素应交给一个消费者，还是广播给所有消费者？
3. 新订阅者需要当前状态、部分历史，还是只接收未来事件？

只要这三个问题明确，Flow、Channel、SharedFlow 与 StateFlow 的选择通常不会依赖个人风格。

## 参考资料

- [Flows](https://kotlinlang.org/docs/coroutines-flow.html)
- [Flow API](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.flow/-flow/)
- [Channel API](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.channels/-channel/)
- [SharedFlow API](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.flow/-shared-flow/)
- [StateFlow API](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.flow/-state-flow/)
- [callbackFlow API](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.flow/callback-flow.html)

## 下一章

数据模型确定后，还需要决定元素如何组合、并发和丢弃。下一章将深入 [Flow 的组合、背压与共享生命周期](/collections/kotlin/flow-composition-backpressure)，建立操作符背后的执行模型。
