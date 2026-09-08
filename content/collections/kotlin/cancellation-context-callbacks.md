---
title: Kotlin 结构化并发原语：上下文、取消与回调桥接
date: 2026-09-07
excerpt: withContext、cancelAndJoin、ensureActive、timeout、NonCancellable 与 suspendCancellableCoroutine 共同定义任务如何切换执行环境、响应取消并安全接入回调 API。
chapter: 并发进阶
chapterOrder: 5
---

`launch`、`async`、`coroutineScope` 和 `supervisorScope` 建立了任务树，但完整的结构化并发还需要回答一组更细的问题：

- 如何在不改变生命周期所有权的前提下切换执行环境？
- 取消请求何时真正停止任务？
- 如何等待子任务把 `finally` 清理完毕？
- 超时发生在结果返回边界时，资源归谁？
- 已取消协程如何执行必须挂起的清理？
- 回调 API 如何接入协程的取消链？

这些问题分别落在 `withContext`、`Job` 的取消操作、取消检查、超时作用域、`NonCancellable` 和 `suspendCancellableCoroutine` 上。

## withContext：切换上下文，但不逃离调用者

`withContext(context)` 把传入的上下文元素与当前协程上下文合并，在更新后的上下文中执行代码块，并在完成后返回结果：

```kotlin
suspend fun parseDocument(bytes: ByteArray): Document =
    withContext(Dispatchers.Default) {
        parser.parse(bytes)
    }
```

它与 `async(context) { ... }.await()` 表面相似，但意图不同：

- `withContext` 表达顺序执行中的上下文切换。
- `async` 表达可以与其他任务重叠执行的并发子任务。

下面的代码没有产生有意义的并发：

```kotlin
val document = async(Dispatchers.Default) {
    parser.parse(bytes)
}.await()
```

创建后立即等待，只是用 `async` 绕了一圈。没有其他任务与解析重叠时，`withContext` 更直接。

### withContext 也是结构化边界

`withContext` 不只是“换线程”。它创建一个词法范围内的子协程：代码块完成前调用者不会继续；代码块抛出的异常会从 `withContext` 调用点重新抛出；调用者取消时，代码块也会取消。

```kotlin
suspend fun render(): Bitmap = withContext(Dispatchers.Default) {
    coroutineScope {
        val background = async { renderBackground() }
        val foreground = async { renderForeground() }
        compose(background.await(), foreground.await())
    }
}
```

调度器改变了，任务仍属于原调用链。

### 不要给 withContext 传入普通 Job

协程上下文可以组合，但 `Job` 不是普通配置项：

```kotlin
// 错误：替换了原有父 Job，破坏调用者与代码块的生命周期关系
withContext(Dispatchers.IO + Job()) {
    blockingCall()
}
```

传入新的 `Job` 会覆盖原上下文中的父任务，使调用者取消时，代码块可能继续执行。正确做法通常只传调度器、名称等非 Job 元素：

```kotlin
withContext(ioDispatcher + CoroutineName("load-config")) {
    blockingCall()
}
```

`NonCancellable` 是为清理设计的特殊例外，不应把这个例外推广成任意替换 `Job`。

### 调度器切换存在两次派发

目标调度器与当前调度器不同时，进入代码块前要派发到目标调度器，结束后还要派发回原调度器。调用者可能在结果返回途中被取消，此时 `withContext` 会丢弃结果并抛出 `CancellationException`。

因此，不要在 `withContext` 内创建一个必须由调用者接管、但取消时无人关闭的资源：

```kotlin
// 调用者在返回派发期间取消时，connection 可能没有接收者
val connection = withContext(Dispatchers.IO) {
    openConnection()
}
```

资源所有权需要在创建点和返回点之间明确转移。更安全的方式通常是在同一作用域中完成使用与关闭：

```kotlin
val result = withContext(Dispatchers.IO) {
    openConnection().use { connection ->
        connection.query()
    }
}
```

## 取消是状态转换，不是强制终止线程

调用 `job.cancel()` 会把取消请求沿任务树向下传播，但不会像废弃的 `Thread.stop()` 那样在任意指令处强杀代码。协程在取消检查点观察到取消后，才以 `CancellationException` 退出。

常见挂起函数已经包含取消检查：

- `delay`
- `yield`
- `await`、`join`
- `Mutex.lock`、`Semaphore.acquire`
- `Channel.send`、`Channel.receive`

```kotlin
val job = launch {
    while (true) {
        val event = channel.receive()
        process(event)
    }
}

job.cancel()
```

如果任务正挂起在 `receive()`，取消会立即使其退出。

## CPU 循环必须主动检查取消

没有挂起点的计算循环不会自动观察取消：

```kotlin
val job = launch(Dispatchers.Default) {
    while (true) {
        calculateNextChunk()
    }
}
```

可以使用 `ensureActive()`：

```kotlin
while (true) {
    currentCoroutineContext().ensureActive()
    calculateNextChunk()
}
```

或读取 `isActive`：

```kotlin
while (currentCoroutineContext().isActive) {
    calculateNextChunk()
}
```

两者语义不同：

- `ensureActive()` 在已取消时抛出带有取消原因的 `CancellationException`，适合让现有 `try/finally` 路径正常展开。
- `isActive` 返回布尔值，适合循环条件，但退出后仍要确保方法不会误报成功。

`yield()` 同时提供取消检查和让出执行机会：

```kotlin
while (currentCoroutineContext().isActive) {
    calculateSmallChunk()
    yield()
}
```

不要在每条极小指令后检查取消。检查频率应在响应速度与计算开销之间取平衡，通常放在批次、迭代或可恢复边界。

## CancellationException 表示正常取消协议

协程使用 `CancellationException` 传递取消。协程体因它结束时，父任务把它视为正常取消，而不是需要向上升级的失败。

宽泛捕获异常时必须让取消继续传播：

```kotlin
try {
    sync()
} catch (cancelled: CancellationException) {
    throw cancelled
} catch (error: IOException) {
    retryLater(error)
}
```

下面的代码会破坏协议：

```kotlin
try {
    sync()
} catch (error: Exception) {
    logger.warn("ignored", error)
}
```

如果 `sync()` 因父任务取消而退出，`catch` 会吞掉取消。后续代码可能继续执行，造成界面离开后仍更新状态、服务关闭后仍访问资源等问题。

## cancel、join 与 cancelAndJoin

`cancel()` 只发出取消请求，不等待任务结束：

```kotlin
job.cancel()
closeSharedResource() // job 的 finally 可能仍在使用它
```

`join()` 等待任务进入最终完成状态。需要停止任务并等待它完成清理时，使用 `cancelAndJoin()`：

```kotlin
job.cancelAndJoin()
closeSharedResource()
```

这在替换后台任务时尤其重要：

```kotlin
private var refreshJob: Job? = null

suspend fun restartRefresh() {
    refreshJob?.cancelAndJoin()
    refreshJob = scope.launch {
        refreshLoop()
    }
}
```

只有旧任务真正结束后才创建新任务，避免两个循环在取消过渡期同时访问资源。

调用 `cancelAndJoin()` 的协程本身也可取消。如果必须在父任务已取消后等待子任务完成有界清理，可以在 `finally` 中谨慎使用 `withContext(NonCancellable)`。

## finally 是资源清理的基本边界

取消以异常方式展开调用栈，因此普通 `try/finally` 会执行：

```kotlin
val job = launch {
    val subscription = subscribe()

    try {
        consume(subscription)
    } finally {
        subscription.close()
    }
}
```

同步、快速的关闭操作直接放在 `finally` 中即可。不要为了形式统一给所有清理都套 `NonCancellable`。

如果 `finally` 中调用挂起函数，当前协程已经取消，挂起函数通常会立即再次抛出 `CancellationException`：

```kotlin
finally {
    connection.flushAndClose() // suspend，可能无法完成
}
```

这才是 `NonCancellable` 的主要用途。

## NonCancellable：只保护必要且有界的挂起清理

```kotlin
try {
    runSession()
} finally {
    withContext(NonCancellable) {
        withTimeout(2.seconds) {
            session.flushAndClose()
        }
    }
}
```

`NonCancellable` 让清理块在父协程已取消时仍能挂起执行。它不等于创建后台任务，也不应该覆盖正常业务流程。

```kotlin
// 错误：上层无法取消整个上传流程
withContext(NonCancellable) {
    uploadLargeFile()
}
```

清理仍应有时间上限。永久挂起的不可取消清理会阻止父任务最终完成。

不要使用 `launch(NonCancellable)` 或 `async(NonCancellable)`。这会切断新协程与父任务的父子关系，破坏结构化并发。`NonCancellable` 的预期形式是已取消协程 `finally` 中的 `withContext(NonCancellable)`。

## withTimeout：时间预算也是作用域

`withTimeout` 创建带时间限制的子作用域：

```kotlin
val response = withTimeout(800.milliseconds) {
    client.request()
}
```

超时后，代码块以 `TimeoutCancellationException` 取消。它是 `CancellationException` 的子类，因此在代码块内部通常应沿取消协议退出；在超时边界外可以将其转换成领域结果：

```kotlin
val response = try {
    withTimeout(800.milliseconds) {
        client.request()
    }
} catch (timeout: TimeoutCancellationException) {
    Response.Timeout
}
```

`withTimeoutOrNull` 适合 `null` 本来就能清晰表示超时的场景：

```kotlin
val cached = withTimeoutOrNull(100.milliseconds) {
    cache.load(key)
}
```

如果业务结果本身允许 `null`，这种写法会把“成功返回 null”和“超时”混在一起，应改用异常或显式结果类型。

### 超时可能与成功返回并发发生

超时是异步事件，可能在代码块完成之后、结果恢复给调用者之前到达。代码块直接返回新资源时，调用者可能因为超时拿不到资源引用：

```kotlin
val resource = withTimeout(100) {
    acquireResource()
}

try {
    use(resource)
} finally {
    resource.close()
}
```

更安全的方式是在超时块内部完成资源释放：

```kotlin
withTimeout(100) {
    acquireResource().use { resource ->
        use(resource)
    }
}
```

时间限制不等于事务回滚。底层阻塞调用、远端请求或已经提交的数据库操作若不支持取消，超时后仍可能完成。幂等性和状态确认仍属于业务协议。

## CoroutineStart：只控制第一次执行之前

`launch` 与 `async` 的 `start` 参数决定协程体第一次开始执行的方式：

| 模式 | 初始行为 | 适用边界 |
|---|---|---|
| `DEFAULT` | 立即按上下文调度 | 默认选择 |
| `LAZY` | 到 `start`、`join` 或 `await` 时才启动 | 条件性计算，但要保证最终启动 |
| `UNDISPATCHED` | 在当前线程立刻运行到首个挂起点 | 极少数需要立即注册或避免首次派发的代码 |
| `ATOMIC` | 保证协程体至少开始执行 | 精细基础设施；属于 delicate API |

启动模式只影响协程体开始执行之前。越过第一次执行后，后续调度和取消仍由上下文与挂起函数决定。

### LAZY 容易与结构化等待形成停滞

```kotlin
coroutineScope {
    launch(start = CoroutineStart.LAZY) {
        work()
    }
}
```

作用域返回前必须等待 lazy 子任务完成，但代码没有保存 `Job` 并启动它，结果可能一直等待。使用 lazy 启动时必须明确谁调用 `start`、`join` 或 `await`。

```kotlin
coroutineScope {
    val job = launch(start = CoroutineStart.LAZY) {
        work()
    }

    if (shouldRun()) {
        job.start()
    } else {
        job.cancel()
    }
}
```

`UNDISPATCHED` 也不表示协程永远留在当前线程。第一次挂起后，它会按自身上下文恢复。依赖“首段同步执行”的代码通常更难推理，应只在确有时序需求时使用。

## invokeOnCompletion：观察结束，不执行挂起清理

`Job.invokeOnCompletion` 注册完成回调：

```kotlin
job.invokeOnCompletion { cause ->
    when (cause) {
        null -> metrics.success()
        is CancellationException -> metrics.cancelled()
        else -> metrics.failed(cause)
    }
}
```

它适合更新计数、释放非挂起句柄或记录最终状态。完成回调不能挂起，也不应承担复杂恢复逻辑。

若回调执行时任务已经完成，它可能立即被调用。回调还可能运行在任意线程，因此内部状态也必须线程安全。任务本体需要保证的清理仍应放在 `finally` 中。

## suspendCancellableCoroutine：把一次性回调接入取消链

传统异步 API 常通过回调返回一次结果：

```kotlin
interface Call<T> {
    fun enqueue(callback: Callback<T>)
    fun cancel()
}
```

可以用 `suspendCancellableCoroutine` 包装为挂起函数：

```kotlin
suspend fun <T> Call<T>.await(): T =
    suspendCancellableCoroutine { continuation ->
        continuation.invokeOnCancellation {
            cancel()
        }

        enqueue(
            object : Callback<T> {
                override fun onSuccess(value: T) {
                    continuation.resume(value)
                }

                override fun onFailure(error: Throwable) {
                    continuation.resumeWithException(error)
                }
            },
        )
    }
```

包装的关键不只是把回调改成顺序语法，而是建立双向协议：

- 底层成功或失败时恢复 continuation。
- 上层协程取消时调用底层 `cancel()`。

如果漏掉 `invokeOnCancellation`，协程虽然结束，网络请求、监听器或定时器仍可能继续运行。

### 回调和取消存在竞争

回调可能与取消同时发生。`suspendCancellableCoroutine` 提供及时取消保证：即使 continuation 已收到成功结果，只要协程在真正恢复执行前被取消，调用者仍会收到 `CancellationException`。

若成功结果携带必须关闭的资源，需要为“已恢复但调用者因取消拿不到结果”提供释放逻辑。相应 `resume` 重载允许注册取消时的资源回收处理；具体签名应以使用的 kotlinx.coroutines 版本为准。

底层 API 还必须允许注册、取消和回调并发发生。如果 `cancel()` 与 `enqueue()` 不是线程安全的，包装层需要额外同步，不能假设协程原语会修复底层竞态。

### 多次回调不要使用 suspendCancellableCoroutine

`suspendCancellableCoroutine` 只表示一次成功或失败。定位更新、传感器事件、WebSocket 消息等多次回调应使用 `callbackFlow`：

```kotlin
fun locationUpdates(): Flow<Location> = callbackFlow {
    val listener = LocationListener { location ->
        trySend(location)
    }

    provider.register(listener)

    awaitClose {
        provider.unregister(listener)
    }
}
```

`awaitClose` 把监听器注销绑定到收集结束或取消。还要根据业务选择缓冲区、溢出策略，并检查 `trySend` 失败，不能把无限事件流当成没有背压的回调转发器。

## runInterruptible：让可中断阻塞调用响应取消

并非所有旧 API 都是回调式。一些 JVM API 会阻塞线程，但支持 `Thread.interrupt()`。可以使用 `runInterruptible`：

```kotlin
suspend fun readLegacy(stream: InputStream): ByteArray =
    runInterruptible(Dispatchers.IO) {
        stream.readAllBytes()
    }
```

调用者取消时，`runInterruptible` 会尝试中断执行阻塞代码的线程。它只对正确响应线程中断的 API 有效；忽略中断的驱动或本地调用仍无法被协程强制停止。

普通 CPU 计算不应为了取消而放进 `runInterruptible`，而应分块并使用 `ensureActive`。

## 原语选择

| 需求 | 原语 |
|---|---|
| 在另一个调度器顺序执行并返回结果 | `withContext` |
| 请求停止任务 | `cancel` |
| 停止任务并等待清理完成 | `cancelAndJoin` |
| CPU 循环响应取消 | `ensureActive` / `isActive` / `yield` |
| 给一段结构化工作设置时间预算 | `withTimeout` |
| 超时自然映射为无值 | `withTimeoutOrNull` |
| 已取消后执行有界挂起清理 | `withContext(NonCancellable)` |
| 观察任务最终状态 | `invokeOnCompletion` |
| 包装一次性可取消回调 | `suspendCancellableCoroutine` |
| 包装多次回调事件流 | `callbackFlow` + `awaitClose` |
| 包装支持线程中断的阻塞 API | `runInterruptible` |

结构化并发的边界最终体现在所有权上：`withContext` 保留调用者对任务的所有权；取消沿任务树传播；`finally` 完成本地清理；桥接层把取消继续传给外部 API。任何忽略其中一段的封装，都可能留下仍在运行但已经无人负责的工作。

## 参考资料

- [withContext API](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/with-context.html)
- [Cancellation and timeouts](https://kotlinlang.org/docs/cancellation-and-timeouts.html)
- [cancelAndJoin API](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/cancel-and-join.html)
- [withTimeout API](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/with-timeout.html)
- [NonCancellable API](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/-non-cancellable/)
- [CoroutineStart API](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/-coroutine-start/)
- [suspendCancellableCoroutine API](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/suspend-cancellable-coroutine.html)
- [runInterruptible API](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/run-interruptible.html)

## 下一章

结构化任务还需要传递随时间产生的多个值。下一章将建立 [Flow、Channel、SharedFlow 与 StateFlow](/collections/kotlin/flow-stream-models) 的统一数据模型，区分冷流、广播、状态与队列语义。
