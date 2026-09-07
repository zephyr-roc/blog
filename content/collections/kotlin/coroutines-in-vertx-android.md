---
title: Kotlin 协程实战：Vert.x 与 Android 生命周期
date: 2026-09-07
excerpt: Vert.x 把协程绑定到 verticle 与 event loop，Android 把协程绑定到 ViewModel、Lifecycle 和 Composition；框架不同，任务所有权的判断方法相同。
chapter: 工程实践
chapterOrder: 6
---

协程库提供 `CoroutineScope`、`Job` 和调度器，框架负责把它们绑定到真实生命周期。在 Vert.x 中，生命周期通常是 verticle、请求、Event Bus consumer；在 Android 中，生命周期可能是 ViewModel、Activity/Fragment、Navigation destination 或某次 Composition。

框架集成最重要的问题不是“在哪调用 `launch`”，而是：

> 这个任务的结果在什么时候失去价值，届时由谁取消它？

只要这个问题没有明确答案，代码即使完全非阻塞，也可能出现任务泄漏、过期状态写入或关闭后继续访问资源。

# Vert.x 中使用协程

Vert.x 的核心模型是少量 event loop 线程处理大量非阻塞事件。协程可以把 `Future` 和 handler 风格改写成顺序代码，但不会改变 event loop 的基本约束：event loop 上不能执行阻塞调用或长时间占用 CPU。

## 依赖与入口

Vert.x 的 Kotlin 协程集成由 `vertx-lang-kotlin-coroutines` 提供：

```kotlin
dependencies {
    implementation("io.vertx:vertx-core:$vertxVersion")
    implementation("io.vertx:vertx-lang-kotlin:$vertxVersion")
    implementation("io.vertx:vertx-lang-kotlin-coroutines:$vertxVersion")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:$coroutinesVersion")
}
```

应用级入口通常直接继承 `CoroutineVerticle`：

```kotlin
class ApiVerticle : CoroutineVerticle() {
    private lateinit var server: HttpServer

    override suspend fun start() {
        val router = Router.router(vertx)

        router.get("/health").handler { context ->
            context.response().end("ok")
        }

        server = vertx
            .createHttpServer()
            .requestHandler(router)
            .listen(8080)
            .coAwait()
    }

    override suspend fun stop() {
        server.close().coAwait()
    }
}
```

`CoroutineVerticle` 同时是 `CoroutineScope`。其上下文使用 Vert.x dispatcher，使协程恢复到对应 Vert.x context；verticle 卸载时，作用域任务会被取消。

这比在每个 handler 中创建 `CoroutineScope(vertx.dispatcher())` 更完整，因为后者每次都生成一个需要手动管理的新根任务：

```kotlin
// 不推荐：生命周期所有权不清晰
router.get("/users").handler {
    CoroutineScope(vertx.dispatcher()).launch {
        loadUsers()
    }
}
```

在 `CoroutineVerticle` 内直接使用自身作用域，或为明确的请求工作建立子作用域。

## coAwait：等待 Vert.x Future 而不阻塞线程

大多数现代 Vert.x API 返回 `io.vertx.core.Future<T>`。`coAwait()` 会挂起协程，Future 成功时返回值，失败时抛出对应异常：

```kotlin
suspend fun loadUser(id: Long): JsonObject {
    val rowSet = sqlClient
        .preparedQuery("select * from users where id = $1")
        .execute(Tuple.of(id))
        .coAwait()

    val row = rowSet.firstOrNull()
        ?: throw UserNotFoundException(id)

    return row.toJson()
}
```

`coAwait()` 不是 `Future.get()`。它不会阻塞 event loop 线程；Future 未完成时，协程让出线程，完成后由 dispatcher 恢复。

旧式 `Handler<AsyncResult<T>>` API 可以通过 `awaitResult` 适配，一次性事件可以通过 `awaitEvent` 等待。新代码优先使用原生返回 `Future` 的 API 和 `coAwait()`，减少自定义回调桥接。

## coAwait 不会把顺序代码变成串行阻塞

下面两个请求按顺序发起和等待：

```kotlin
val profile = profileClient.get(id).coAwait()
val orders = orderClient.list(id).coAwait()
```

第二个请求只能在第一个完成后开始。如果二者互不依赖，应显式建立并发子任务：

```kotlin
suspend fun loadDashboard(id: Long): Dashboard = coroutineScope {
    val profile = async {
        profileClient.get(id).coAwait()
    }
    val orders = async {
        orderClient.list(id).coAwait()
    }

    Dashboard(
        profile = profile.await(),
        orders = orders.await(),
    )
}
```

任一任务失败会取消作用域和兄弟协程。需要部分成功时，使用上一章的 `supervisorScope` 与显式结果建模。

协程取消只保证停止等待和后续处理，不一定能取消已经交给 Vert.x 客户端或远端服务的操作。很多 `Future` 本身没有通用取消能力。涉及昂贵查询、流或连接时，还要使用具体 API 提供的 close、unregister 或超时机制。

## HTTP handler：每个请求都要有明确的异常出口

Vert.x handler 不是挂起函数。可以从 verticle 作用域启动请求协程，但必须把异常转换为 HTTP 响应或 `RoutingContext.fail`：

```kotlin
class UserVerticle(
    private val service: UserService,
) : CoroutineVerticle() {

    override suspend fun start() {
        val router = Router.router(vertx)

        router.get("/users/:id").handler { context ->
            launch {
                try {
                    val id = context.pathParam("id").toLong()
                    val user = service.find(id)

                    context.response()
                        .putHeader("content-type", "application/json")
                        .end(user.encode())
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (error: Throwable) {
                    context.fail(error)
                }
            }
        }

        vertx.createHttpServer()
            .requestHandler(router)
            .listen(8080)
            .coAwait()
    }
}
```

`CoroutineVerticle` 的作用域使用监督语义，单个子协程失败不会为了一个请求杀掉整个 verticle，但这也意味着请求协程必须自己处理未捕获异常。只调用 `launch { service.find(id) }` 而没有错误出口，会留下无响应请求和未处理异常。

请求断开连接是否应取消业务协程，取决于操作语义：纯查询通常可以取消；已经提交的支付、发券或消息写入则需要幂等与状态确认，不能把 TCP 断开直接等价为业务撤销。

## 不要在 event loop 上使用 runBlocking

```kotlin
router.get("/report").handler { context ->
    val report = runBlocking {
        buildReport()
    }
    context.response().end(report)
}
```

`runBlocking` 会占住当前 event loop 线程等待内部协程完成。如果内部操作还要回到同一 Vert.x context，就可能形成停滞；即使没有死锁，也会阻塞该 event loop 上的其他连接。

Vert.x handler 内应该启动协程或使用 Future 链，应用最外层的测试/命令行边界才可能使用 `runBlocking`。

## suspend 不代表非阻塞

把阻塞 JDBC、文件读取或旧 HTTP 客户端放进 `suspend fun`，不会自动释放 event loop：

```kotlin
suspend fun loadReport(): Report {
    return legacyClient.blockingLoad() // 仍阻塞调用线程
}
```

Vert.x 协程集成提供 `awaitBlocking`，也可以使用 Vert.x `executeBlocking` 后 `coAwait()`：

```kotlin
suspend fun loadReport(): Report = awaitBlocking {
    legacyClient.blockingLoad()
}
```

阻塞工作会转移到 worker 线程，event loop 得以继续处理事件。worker 池仍是有限资源：调用量过大时需要连接池、`Semaphore`、队列背压和超时，不能把 `awaitBlocking` 当成无限扩容器。

CPU 密集型计算同样不能长期占用 event loop。短小转换可以留在 context 上，大块压缩、加密或图像处理应转移到合适的 worker/dispatcher，并限制并行度。

## Event Bus consumer 与结构化处理

Vert.x 当前协程扩展可以通过 `coConsumer` 在 Event Bus 消费者中调用挂起函数：

```kotlin
class OrderVerticle : CoroutineVerticle(), CoroutineEventBusSupport {
    override suspend fun start() {
        vertx.eventBus().coConsumer<JsonObject>("orders.create") { message ->
            try {
                val order = createOrder(message.body())
                message.reply(order.toJson())
            } catch (error: ValidationException) {
                message.fail(400, error.message)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Throwable) {
                message.fail(500, "internal error")
            }
        }
    }
}
```

需要区分消息级失败和 consumer 级失败。业务校验应回复明确失败；不可恢复的基础设施异常是否重启 verticle，应由部署和监督策略决定。

同时处理多少条消息还会影响下游容量。即使 event loop 不阻塞，无限制启动协程也可能压垮数据库。使用 `Semaphore`、固定 worker Channel，或让消息系统本身的流控参与背压。

## ReadStream、Channel 与背压

Vert.x `ReadStream<T>` 可以适配为 `ReceiveChannel<T>`，`WriteStream<T>` 可以适配为 `SendChannel<T>`。适配器负责连接暂停/恢复与 Channel 的挂起语义：

```kotlin
suspend fun consume(stream: ReadStream<Buffer>) {
    val channel = stream.toReceiveChannel(vertx)

    for (buffer in channel) {
        parse(buffer)
    }
}
```

Channel 满时发送方挂起、空时接收方挂起，但缓冲容量和消费速度仍需要设计。把无界网络流收集成列表，会绕开背压并转化成内存问题。

如果业务层已经统一使用 Flow，可以在边界适配，但不应在 Stream → Channel → Flow 之间反复转换只为追求某种语法。每次适配都要重新检查关闭、异常和取消如何传播。

## Vert.x 中的作用域层级

| 工作 | 推荐所有者 | 结束条件 |
|---|---|---|
| 启动服务器、注册 consumer | `CoroutineVerticle` | verticle undeploy |
| 单个请求的并发子任务 | 请求处理协程中的 `coroutineScope` | 响应完成、失败或取消 |
| 单条消息的处理 | consumer 调用建立的任务 | 回复、失败或取消 |
| 与进程同寿命的基础设施任务 | 应用级显式 scope | 应用关闭 |
| 阻塞调用 | Vert.x worker / `awaitBlocking` | 调用完成或可用的取消机制触发 |

不要用 `GlobalScope` 解决生命周期选择困难。真正与应用同寿命的任务也应由启动器持有一个可在关闭时取消并等待的作用域。

# Android 中使用协程

Android 的难点不在 event loop 阻塞，而在多个重叠生命周期：Composition 可以销毁重建，Fragment View 的生命周期短于 Fragment，ViewModel 跨配置变更保留，进程又可能随时被系统回收。

## viewModelScope：屏幕业务状态的所有者

`viewModelScope` 在 ViewModel 清除时自动取消，适合生产屏幕状态和响应用户业务事件：

```kotlin
sealed interface UserUiState {
    data object Loading : UserUiState
    data class Content(val user: User) : UserUiState
    data class Error(val message: String) : UserUiState
}

class UserViewModel(
    private val repository: UserRepository,
) : ViewModel() {
    private val _uiState = MutableStateFlow<UserUiState>(
        UserUiState.Loading,
    )
    val uiState: StateFlow<UserUiState> = _uiState.asStateFlow()

    fun load(id: Long) {
        viewModelScope.launch {
            _uiState.value = try {
                UserUiState.Content(repository.load(id))
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: IOException) {
                UserUiState.Error(error.message ?: "network error")
            }
        }
    }
}
```

ViewModel 跨 Activity/Fragment 的配置重建保留，因此旋转屏幕不会自动重启同一业务加载。它不跨进程死亡；需要恢复时，应保存最小参数或 ID，并从持久数据层重新生产完整状态。

`viewModelScope` 使用主调度器作为入口并不意味着网络或数据库工作都在主线程阻塞。Retrofit 挂起接口、Room 挂起 DAO 等库会在自身边界处理线程；自写阻塞代码的 repository 则必须保证 main-safe。

## 数据层暴露 suspend 与 Flow，不接管短生命周期

数据层的一次操作暴露挂起函数，持续变化暴露 Flow：

```kotlin
interface UserRepository {
    suspend fun refresh(id: Long)
    fun observe(id: Long): Flow<User>
}
```

调用者决定任务何时开始、何时取消。Repository 不应为了方便在每次调用中创建无主 `CoroutineScope`：

```kotlin
// 不推荐：调用者无法等待或取消
fun refresh(id: Long) {
    CoroutineScope(Dispatchers.IO).launch {
        api.refresh(id)
    }
}
```

如果工作确实应超过当前屏幕寿命，例如用户离开页面后仍要完成本地书签写入，可以注入由 Application 或导航图等更长生命周期持有的 external scope，并显式 `join` 或返回任务状态。需要跨进程保证执行的工作应交给 WorkManager，而不是依赖内存中的 application scope。

## suspend 函数应当 main-safe

调用者不应猜测某个 repository 方法需要哪个 dispatcher。执行阻塞或 CPU 密集工作的类负责切换上下文：

```kotlin
class FileRepository(
    private val ioDispatcher: CoroutineDispatcher,
) {
    suspend fun read(path: Path): ByteArray =
        withContext(ioDispatcher) {
            Files.readAllBytes(path)
        }
}
```

Dispatcher 应可注入，测试时替换成 `TestDispatcher`。对 Retrofit、Room 等已经提供 main-safe 挂起 API 的库，不要再机械包一层 `withContext(Dispatchers.IO)`；额外切换通常没有收益，还模糊真正的阻塞边界。

CPU 密集转换使用 `Dispatchers.Default`，传统阻塞 I/O 使用 `Dispatchers.IO`。选择依据是工作性质，不是函数位于 repository、use case 还是 ViewModel。

## lifecycleScope：只属于当前 UI 生命周期的工作

`lifecycleScope` 会在对应 Lifecycle 销毁时取消。它适合 UI 行为，例如等待动画、访问 View、显示 Snackbar：

```kotlin
viewLifecycleOwner.lifecycleScope.launch {
    snackbarHostState.showSnackbar("保存成功")
}
```

Fragment 中访问 View 时要使用 `viewLifecycleOwner.lifecycleScope`，而不是 Fragment 自身的 `lifecycleScope`。Fragment 可能仍存在，但它的 View 已在 `onDestroyView` 中销毁；绑定到 Fragment 生命周期会让协程继续持有旧 View。

不应把需要跨配置变更保留的业务加载放进 Activity/Fragment 的 `lifecycleScope`，否则重建 UI 时任务也被取消并重启。这类工作属于 ViewModel。

## repeatOnLifecycle：可见时收集，离开时取消

对于 Views，推荐在 lifecycleScope 中使用 `repeatOnLifecycle`：

```kotlin
viewLifecycleOwner.lifecycleScope.launch {
    viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
        launch {
            viewModel.uiState.collect { state ->
                render(state)
            }
        }

        launch {
            viewModel.effects.collect { effect ->
                handleEffect(effect)
            }
        }
    }
}
```

Lifecycle 进入 `STARTED` 时创建内部收集任务，离开时取消它们，再次进入时重新创建。外层协程一直存在到 View 销毁。

收集多个 Flow 时必须分别 `launch`。`collect` 通常直到 Flow 结束才返回，连续写两个 `collect` 会让第二个永远无法开始：

```kotlin
repeatOnLifecycle(Lifecycle.State.STARTED) {
    viewModel.uiState.collect(::render)
    viewModel.effects.collect(::handleEffect) // 通常不可达
}
```

`repeatOnLifecycle` 的重启语义还意味着，上游冷 Flow 可能重复执行。需要跨订阅共享昂贵上游时，在 ViewModel 中用 `stateIn` / `shareIn` 明确共享策略。

## Compose：collectAsStateWithLifecycle

Compose 中收集 UI 状态时使用生命周期感知的 `collectAsStateWithLifecycle()`：

```kotlin
@Composable
fun UserRoute(
    viewModel: UserViewModel = viewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    UserScreen(
        state = state,
        onRetry = viewModel::retry,
    )
}
```

它把 Flow 转换为 Compose `State`，并默认只在 Lifecycle 至少为 `STARTED` 时收集。屏幕 Composable 只消费不可变状态和发送事件，不直接暴露 `MutableStateFlow`。

`collectAsState()` 只跟随 Composition，不感知 Android Lifecycle。在后台仍保留 Composition 的情况下，它可能继续收集。Android 平台上的 UI 状态优先使用 `collectAsStateWithLifecycle`。

## LaunchedEffect：Composition 拥有的挂起副作用

`LaunchedEffect(keys...)` 创建与当前 Composition 节点绑定的协程：

```kotlin
LaunchedEffect(userId) {
    listState.scrollToItem(0)
}
```

- 进入 Composition 时启动。
- key 改变时取消旧任务并启动新任务。
- 离开 Composition 时取消。

key 是任务身份的一部分，不是随便填的占位符。任务依赖 `userId` 且应随其变化重启，就把它作为 key；只需在当前节点生命周期运行一次时才使用稳定 key。

`LaunchedEffect` 属于 Composition，不等于屏幕可见生命周期。Pager 可能预先组合相邻页面，某些 effect 会在页面尚未真正可见时启动。依赖可见、前台或 RESUMED 状态的工作应使用 Lifecycle 感知机制。

业务加载通常由 ViewModel 响应事件，而不是让 Composable 在每次进入 Composition 时自行决定是否请求：

```kotlin
// 更稳定：状态所有者决定是否需要加载
class UserViewModel(...) : ViewModel() {
    fun onScreenOpened(id: Long) {
        // 去重并更新状态
    }
}
```

## rememberCoroutineScope：事件处理中的 UI 协程

Composable 的普通回调不是挂起函数。需要在点击后调用 Snackbar、动画或滚动等 UI 挂起 API 时，可以使用 `rememberCoroutineScope()`：

```kotlin
@Composable
fun SaveButton(
    snackbarHostState: SnackbarHostState,
    onSave: () -> Unit,
) {
    val scope = rememberCoroutineScope()

    Button(
        onClick = {
            onSave()
            scope.launch {
                snackbarHostState.showSnackbar("正在保存")
            }
        },
    ) {
        Text("保存")
    }
}
```

该 scope 在调用它的 Composable 离开 Composition 时取消。业务写入不应只放在这个 scope 中，否则 UI 节点消失时写入也会被取消；应把业务事件交给 ViewModel，再用 Composition scope 执行纯 UI 效果。

## 一次性事件与持久状态要分开

旋转屏幕后仍应显示的内容属于状态，例如加载结果、表单值、错误页面。只应消费一次的导航、Snackbar、权限请求属于 effect。

不能简单把所有 effect 放进 `StateFlow<Event?>`，否则新订阅者可能重新收到旧事件；也不能假设无缓冲 `SharedFlow` 在没有收集者时会保存事件。具体使用 Channel、SharedFlow 还是把事件建模进可确认状态，取决于是否允许丢失、是否需要重放以及谁负责确认消费。

关键不是选出全局唯一的“事件最佳实践”，而是把交付语义写清楚：

- UI 不可见时事件可以丢失吗？
- 配置变更后需要继续吗？
- 导航执行后如何确认？
- 发送者取消时，已发送事件归谁？

## 配置变更、进程死亡与持久任务

| 生命周期事件 | Composition scope | View lifecycleScope | viewModelScope | WorkManager |
|---|---:|---:|---:|---:|
| Composable 离开 | 取消 | 取决于 View | 保留 | 保留 |
| Fragment View 销毁 | 取消相关节点 | 取消 | 通常保留 | 保留 |
| 配置变更 | 重建 | 取消并重建 | 保留 | 保留 |
| ViewModel 清除 | 已离开 | 通常已销毁 | 取消 | 保留 |
| 进程死亡 | 终止 | 终止 | 终止 | 可由系统恢复调度 |

协程 scope 只能管理当前进程中的任务。要求在应用退出或进程死亡后仍保证执行的同步、上传、备份，应该使用 WorkManager 等持久调度设施，并让任务本身具备幂等性。

`SavedStateHandle` 用于保存恢复 UI 所需的少量键、筛选条件或编辑状态，不适合保存大型领域对象，也不会让被杀死的协程从原指令继续执行。

## Android 中的错误边界

`viewModelScope` 通常具有监督语义，一个子任务失败不会自动取消 ViewModel 的全部其他任务。这不等于异常会自动变成 UI 状态：

```kotlin
viewModelScope.launch {
    repository.refresh() // 未捕获异常仍需要处理
}
```

可恢复业务失败应在适当层转换成结果或状态；不可恢复异常交给应用统一记录。`CoroutineExceptionHandler` 只能观察未捕获异常，不能让已经失败的协程继续运行。

取消不应显示为普通错误。用户离开页面导致的 `CancellationException` 若被捕获成 `UiState.Error`，新页面可能收到一条虚假的失败状态。

## 测试：控制调度器和虚拟时间

业务类不要硬编码 dispatcher：

```kotlin
class Parser(
    private val dispatcher: CoroutineDispatcher,
) {
    suspend fun parse(bytes: ByteArray): Model =
        withContext(dispatcher) {
            decode(bytes)
        }
}
```

测试中注入共享 `TestCoroutineScheduler` 对应的 `StandardTestDispatcher`，用 `runTest`、`runCurrent`、`advanceTimeBy` 和 `advanceUntilIdle` 控制执行。

`viewModelScope` 使用 `Dispatchers.Main`，本地单元测试需要用 `Dispatchers.setMain(testDispatcher)` 替换，并在结束后 `resetMain()`；或者使用当前 Lifecycle API 支持的可注入 ViewModel scope。

测试不应只断言最终值，还要覆盖：

- 取消后不再发布状态；
- key 改变时旧请求被取消；
- Lifecycle 停止时停止收集、恢复时重新订阅；
- 一个监督子任务失败不影响无关任务；
- timeout 使用虚拟时间而非真实等待。

# 两个框架的共同模型

Vert.x 与 Android 表面差异很大，但作用域设计可以用同一张表理解：

| 问题 | Vert.x | Android |
|---|---|---|
| 长生命周期组件 | `CoroutineVerticle` | `ViewModel` |
| 短生命周期交互 | 请求/消息处理子任务 | Lifecycle / Composition scope |
| 非阻塞异步等待 | `Future.coAwait()` | 挂起 API、Flow collect |
| 阻塞工作隔离 | `awaitBlocking` / worker | main-safe repository + IO dispatcher |
| 持续流与背压 | ReadStream ↔ Channel | Flow / StateFlow |
| 组件结束 | undeploy 时取消 | clear、destroy 或离开 Composition 时取消 |
| 超过组件寿命的任务 | 应用级受管 scope / 外部系统 | external scope / WorkManager |

两端都应遵循同样的判断顺序：

1. 由最短但足够长的组件拥有任务。
2. 库层暴露 `suspend` 或 Flow，把启动权交给所有者。
3. 框架线程只负责它适合的工作，阻塞边界在实现层隔离。
4. 取消沿结构传播，但外部副作用仍需要幂等和事务协议。
5. 组件结束时不仅发出取消，还要在必要时等待资源清理完成。

协程与框架结合的价值，不只是把回调变成顺序代码，而是把请求、界面、组件和进程的生命周期转换成可执行的任务所有权。

## 参考资料

- [Vert.x Kotlin coroutines](https://vertx.io/docs/vertx-lang-kotlin-coroutines/kotlin/)
- [CoroutineVerticle source](https://github.com/vert-x3/vertx-lang-kotlin/blob/master/vertx-lang-kotlin-coroutines/src/main/java/io/vertx/kotlin/coroutines/CoroutineVerticle.kt)
- [Android lifecycle-aware coroutines](https://developer.android.com/topic/libraries/architecture/coroutines)
- [Android coroutines best practices](https://developer.android.com/kotlin/coroutines/coroutines-best-practices)
- [State and Jetpack Compose](https://developer.android.com/develop/ui/compose/state)
- [Where to hoist state](https://developer.android.com/develop/ui/compose/state-hoisting)
- [kotlinx-coroutines-test](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-test/)
