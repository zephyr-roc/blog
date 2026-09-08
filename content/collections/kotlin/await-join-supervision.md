---
title: Kotlin 结构化并发：Job、async 与监督
date: 2026-09-07
excerpt: await 与 join 不只是“有没有返回值”的区别；awaitAll、joinAll、coroutineScope 与 supervisorScope 共同决定等待方式、失败传播和兄弟协程的命运。
chapter: 并发进阶
chapterOrder: 3
---

结构化并发同时约束两件事：

1. **生命周期有边界**：父任务结束前必须等待其子任务结束；父任务取消时，子任务也会被取消。
2. **失败沿层级传播**：普通父子关系中，一个子任务的非取消异常会使父任务失败，进而取消其他子任务。

`await`、`join`、`awaitAll` 和 `joinAll` 负责观察任务的完成状态；`coroutineScope` 与 `supervisorScope` 决定任务之间的失败关系。只有把这两个维度分开，才能准确预测一段并发代码的行为。

## Job 树才是结构化并发的骨架

每个协程的上下文通常包含一个 `Job`。在作用域中调用 `launch` 或 `async` 时，新协程的 `Job` 会成为当前 `Job` 的子节点：

```kotlin
suspend fun loadPage(): Page = coroutineScope {
    val profile = async { loadProfile() }
    val messages = async { loadMessages() }

    Page(
        profile = profile.await(),
        messages = messages.await(),
    )
}
```

这里有三个任务：`coroutineScope` 创建的作用域任务，以及两个 `async` 子任务。即使代码没有显式调用 `await`，作用域也不能在子任务仍运行时成功返回。显式等待决定何时读取结果，父子关系决定谁必须等待谁。

普通 `Job` 的失败传播是双向的：

- **向下取消**：父任务被取消，所有子任务递归取消。
- **向上失败**：子任务抛出 `CancellationException` 以外的异常，父任务失败。
- **再次向下取消**：父任务失败后，其他仍在运行的子任务被取消。

所以“兄弟协程互相取消”只是表象。真正的路径是：

```text
子任务 A 失败 → 父任务失败 → 父任务取消子任务 B
```

等待函数不会创建或删除这条传播路径。它们只是从不同角度观察任务。

## 任务句柄与等待语义

### launch 返回 Job，async 返回 Deferred

`launch` 用于只关心完成与否的副作用任务，返回 `Job`：

```kotlin
val job: Job = launch {
    auditLog.write(event)
}
```

`async` 用于产生结果的任务，返回 `Deferred<T>`：

```kotlin
val user: Deferred<User> = async {
    userRepository.findById(id)
}
```

`Deferred<T>` 本身也是 `Job`，因此同一个 `Deferred` 既可以调用 `join()`，也可以调用 `await()`。区别不在于它们等待的是不是同一种协程，而在于调用者想观察什么：

| 操作 | 等待完成 | 返回结果 | 观察目标任务的失败 |
|---|---:|---:|---:|
| `job.join()` | 是 | 否 | 不重新抛出目标任务的异常 |
| `deferred.join()` | 是 | 否 | 不重新抛出目标任务的异常 |
| `deferred.await()` | 是 | 是 | 失败或取消时抛出对应异常 |

`launch` 和 `async` 默认立即启动。`join` 与 `await` 通常不是“启动并发”的动作，只是在稍后的某个位置等待已经运行的任务。只有使用 `CoroutineStart.LAZY` 时，第一次 `start`、`join` 或 `await` 才会启动任务。

### join：只等待终态

`join()` 挂起当前协程，直到目标 `Job` 进入完成状态。无论目标任务是成功、失败还是取消，`join()` 本身都不会为了报告目标任务的失败而重新抛出原始异常。

```kotlin
supervisorScope {
    val job = launch(
        CoroutineExceptionHandler { _, error ->
            logger.error("同步失败", error)
        },
    ) {
        error("database unavailable")
    }

    job.join()
    println("任务已经结束：${job.isCancelled}")
}
```

这里使用 `supervisorScope` 是为了隔离子任务失败。`join()` 正常恢复，只表示 `job` 已经结束，不表示它成功。

在普通 `coroutineScope` 中，失败的子任务会先取消父任务。父协程在 `join()` 处可能收到 `CancellationException`，但这不是 `join()` 重新抛出了子任务的原始异常，而是**调用 `join()` 的协程本身已经被取消**：

```kotlin
coroutineScope {
    val job = launch {
        error("failed")
    }

    job.join() // 父作用域已因子任务失败而进入取消流程
}
```

因此，不能用“`join` 是否抛异常”判断任务是否成功。需要结果时使用 `async` 与 `await`；只需要检查终态时，可以在 `join` 后读取 `isCompleted`、`isCancelled`，或在适合的抽象层收集完成原因。

### await：读取 Deferred 的结果

`await()` 同样会挂起等待，但它会解包 `Deferred<T>` 的完成结果：

```kotlin
val deferred = async {
    loadUser(id)
}

val user: User = deferred.await()
```

- 成功时返回 `T`。
- 异常完成时抛出该异常。
- 被取消时抛出 `CancellationException`。

`async` 会把异常记录在 `Deferred` 中，但这不等于它在普通结构化并发中能隔离失败。只要它还是普通父任务的子节点，其失败仍会使父任务失败：

```kotlin
try {
    coroutineScope {
        val deferred = async {
            error("failed")
        }

        delay(1_000)
        deferred.await()
    }
} catch (error: IllegalStateException) {
    // 可以在 coroutineScope 边界之外恢复
}
```

异常可能在执行到 `await()` 之前就已经使 `coroutineScope` 失败。把 `try/catch` 只包在 `deferred.await()` 外面，通常无法让已经失败的父作用域重新变为活动状态。

```kotlin
coroutineScope {
    val deferred = async { error("failed") }

    try {
        deferred.await()
    } catch (error: IllegalStateException) {
        // 捕获了 await 的异常，但当前作用域仍可能已被子任务失败取消
    }
}
```

如果业务允许单个结果失败，必须先改变失败传播关系，或在子任务内部把失败转换为普通值，而不是只改变 `await` 周围的语法。

### joinAll：等待所有 Job 结束

`joinAll()` 等价于逐个调用 `join()`：

```kotlin
jobs.joinAll()

// 语义等价于
jobs.forEach { it.join() }
```

它有三个重要性质：

1. 不返回每个任务的业务结果。
2. 不因为某个目标任务失败而重新抛出它的原始异常。
3. 当前协程被取消时，等待会立即以 `CancellationException` 结束。

`joinAll` 的“all”只表示正常情况下会等到所有目标任务完成，不表示收集所有异常，也不表示忽略当前作用域的取消。

```kotlin
supervisorScope {
    val handler = CoroutineExceptionHandler { _, error ->
        logger.error("后台刷新失败", error)
    }

    val jobs = cacheKeys.map { key ->
        launch(handler) { refresh(key) }
    }

    jobs.joinAll()
}
```

这类写法适合彼此独立、没有返回值，并且每个任务都有明确异常处理策略的工作。

### awaitAll：任一失败时立即抛出

`awaitAll()` 接收多个 `Deferred<T>`，全部成功时按输入顺序返回 `List<T>`：

```kotlin
val users: List<User> = ids
    .map { id -> async { loadUser(id) } }
    .awaitAll()
```

只要任意一个 `Deferred` 异常完成，`awaitAll()` 就会立即以观察到的异常结束。它并不等价于：

```kotlin
deferreds.map { it.await() }
```

逐个 `await()` 只有执行到失败的那个元素时才观察到它的异常。假设第一个任务很慢，第二个任务很快失败：

```kotlin
supervisorScope {
    val slow = async {
        delay(10_000)
        "slow"
    }
    val failed = async<String> {
        delay(100)
        error("failed")
    }

    listOf(slow, failed).map { it.await() }
}
```

由于监督作用域不会让 `failed` 自动取消 `slow`，代码会先等待 `slow`，大约十秒后才执行到 `failed.await()`。换成：

```kotlin
listOf(slow, failed).awaitAll()
```

则会在 `failed` 异常完成后立即抛出。

在普通 `coroutineScope` 中，这个差异经常被父子失败传播遮住：第二个任务失败时，父作用域已经取消第一个任务和当前等待者。此时快速失败主要来自 `Job` 层级，而不只是 `awaitAll` 的实现。

`awaitAll` 的失败也不意味着它自动取消了所有传入的 `Deferred`。是否取消其他任务，取决于这些任务所属的作用域及调用者接下来如何处理异常。结构化并发中的兄弟取消，通常来自普通父 `Job` 的失败传播。

## 失败传播与监督

### coroutineScope：所有子任务共同决定成败

`coroutineScope` 适合把一个逻辑任务拆成多个缺一不可的并发子任务：

```kotlin
suspend fun buildDashboard(): Dashboard = coroutineScope {
    val account = async { loadAccount() }
    val orders = async { loadOrders() }
    val recommendations = async { loadRecommendations() }

    Dashboard(
        account = account.await(),
        orders = orders.await(),
        recommendations = recommendations.await(),
    )
}
```

任意子任务失败时：

1. 子任务以异常完成。
2. 父作用域被取消。
3. 仍在运行的兄弟任务被取消。
4. 作用域等待所有子任务结束清理。
5. `coroutineScope` 向调用者抛出失败。

这是一种 **fail-fast** 语义：只有全部子任务成功，组合结果才有意义。

作用域仍然提供异常恢复边界。`coroutineScope` 自身失败不会直接把调用它的协程永久取消；调用者可以在作用域外捕获异常：

```kotlin
val dashboard = try {
    buildDashboard()
} catch (error: IOException) {
    Dashboard.offline()
}
```

### supervisorScope：失败隔离，不是取消隔离

用户界面中的多个组件、批量抓取中的多个数据源、服务端互不依赖的多个附加信息，常常允许局部失败。此时可以使用 `supervisorScope`：

```kotlin
suspend fun loadWidgets(): List<Result<Widget>> = supervisorScope {
    widgetIds
        .map { id ->
            async {
                resultOf { loadWidget(id) }
            }
        }
        .awaitAll()
}
```

`supervisorScope` 内部使用监督型父任务。它改变的是**子失败向上的传播**：

- 子任务失败，不会使监督作用域失败。
- 子任务失败，不会自动取消其他子任务。
- 调用者取消监督作用域时，所有子任务仍会被取消。
- `supervisorScope` 的代码块自身抛异常时，作用域及其所有子任务仍会取消。
- 作用域仍会等待所有子任务完成后才返回。

因此它仍然是结构化并发。监督不是让子任务脱离父节点，而是把“父取消子”保留下来，同时切断“子失败父”的路径。

#### supervisorScope 不会吞掉 await 的异常

下面的代码仍然会失败：

```kotlin
supervisorScope {
    val primary = async { loadPrimary() }
    val optional = async { loadOptional() }

    Page(
        primary = primary.await(),
        optional = optional.await(), // 失败仍从这里抛出
    )
}
```

监督作用域保证 `optional` 的失败不会自动取消 `primary`，但 `optional.await()` 仍按契约抛出异常。如果异常逃出 `supervisorScope` 的代码块，失败的是代码块本身，于是作用域会取消仍在运行的子任务。

正确的隔离必须同时包含两层：

1. 用 `supervisorScope` 隔离任务层级中的失败传播。
2. 在业务边界把允许发生的失败转换成显式结果。

### 把局部失败建模为 Result

当一批任务允许部分成功时，最清晰的返回类型通常是 `List<Result<T>>`，而不是依赖日志或任务状态猜测结果。

需要注意，标准库的 `runCatching` 会捕获所有 `Throwable`，其中包括 `CancellationException`。协程取消应继续传播，否则上层已经取消时，子任务可能错误地把取消包装成普通失败。

可以定义一个保留取消语义的辅助函数：

```kotlin
import kotlinx.coroutines.CancellationException

suspend fun <T> resultOf(block: suspend () -> T): Result<T> =
    try {
        Result.success(block())
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (error: Throwable) {
        Result.failure(error)
    }
```

然后在每个 `async` 内完成错误值转换：

```kotlin
suspend fun fetchAll(ids: List<Long>): List<Result<Item>> =
    supervisorScope {
        ids.map { id ->
            async {
                resultOf { repository.fetch(id) }
            }
        }.awaitAll()
    }
```

此时 `Deferred` 本身会正常完成，其值是 `Result<Item>`。单个业务异常不会触发 `awaitAll` 的失败分支；真正的父级取消仍通过 `CancellationException` 向下、向上传播。

如果只允许某些可预期异常降级，应进一步收窄捕获类型：

```kotlin
suspend fun loadAvatar(): Avatar? =
    try {
        avatarService.load()
    } catch (error: NotFoundException) {
        null
    }
```

不要为了获得“部分成功”而把程序错误、资源耗尽或取消全部转换成空值。

### launch 在监督作用域中独立处理异常

`async` 把失败保存在 `Deferred` 中，直到 `await` 观察它；`launch` 没有结果容器。在 `supervisorScope` 中，`launch` 的异常既不会交给父任务处理，也不会通过 `join()` 重新抛出，因此必须为它提供明确的异常处理方式：

```kotlin
supervisorScope {
    val handler = CoroutineExceptionHandler { context, error ->
        logger.error("刷新任务失败：${context[CoroutineName]}", error)
    }

    launch(handler + CoroutineName("profile")) {
        refreshProfile()
    }

    launch(handler + CoroutineName("messages")) {
        refreshMessages()
    }
}
```

`CoroutineExceptionHandler` 是未捕获异常的最后处理器，不是恢复机制。回调执行时，对应协程已经失败。需要重试、降级或返回备用值时，应在任务体内使用 `try/catch`，并明确取消是否继续传播。

### SupervisorJob 与 supervisorScope

两者提供相同方向的失败隔离，但生命周期用途不同：

| API | 生命周期 | 典型用途 |
|---|---|---|
| `supervisorScope { ... }` | 词法作用域，函数返回前等待全部子任务 | 一个挂起函数内部的并发分解 |
| `SupervisorJob()` | 手动持有和取消 | 与 UI 组件、服务对象等长期对象绑定的作用域 |

短生命周期并发优先使用 `supervisorScope`：

```kotlin
suspend fun refreshScreen() = supervisorScope {
    // 函数边界就是并发边界
}
```

对象拥有长期作用域时才显式创建 `SupervisorJob`，并在对象生命周期结束时取消：

```kotlin
class Presenter(
    dispatcher: CoroutineDispatcher,
) : AutoCloseable {
    private val scope = CoroutineScope(
        SupervisorJob() + dispatcher,
    )

    fun refresh() {
        scope.launch { refreshContent() }
    }

    override fun close() {
        scope.cancel()
    }
}
```

仅仅写 `CoroutineScope(SupervisorJob() + Dispatchers.Default)` 而不定义谁负责取消，会把生命周期问题从代码表面藏起来。

## 常见误区

### “调用 await 才会开始并发”

默认的 `async` 创建后立即调度执行。先创建多个 `Deferred`，再 `await`，任务仍然并发：

```kotlin
val first = async { loadFirst() }
val second = async { loadSecond() }

first.await()
second.await()
```

如果写成：

```kotlin
val first = async { loadFirst() }.await()
val second = async { loadSecond() }.await()
```

第二个任务只能在第一个完成后创建，实际变成串行。

### “join 会把 launch 的异常抛给调用者”

`join` 只等待目标完成。普通作用域中看到的 `CancellationException`，通常来自调用者已被失败子任务取消。监督作用域中，`launch` 的未捕获异常应交给任务自己的异常处理器。

### “supervisorScope 内部不会取消”

它只阻止单个子任务失败自动取消父任务和兄弟任务。父任务取消、作用域代码块抛异常、显式调用 `cancel()` 时，向下取消仍然有效。

### “awaitAll 会等待并收集所有异常”

`awaitAll` 遇到第一个异常完成的 `Deferred` 就异常恢复，不提供异常聚合结果。需要逐项成功或失败信息时，应让每个任务返回 `Result<T>` 或领域结果类型。

### “catch Exception 可以安全实现降级”

`CancellationException` 也是 `Exception`。宽泛捕获后不重新抛出取消，会破坏协作式取消。降级逻辑应只捕获预期异常，或者显式让 `CancellationException` 继续传播。

## 如何选择

| 需求 | 作用域 | 启动方式 | 等待方式 |
|---|---|---|---|
| 多个结果缺一不可 | `coroutineScope` | `async` | `await` / `awaitAll` |
| 多个结果允许部分失败 | `supervisorScope` | `async`，任务内返回 `Result<T>` | `awaitAll` |
| 多个独立副作用任务 | `supervisorScope` | `launch`，各自处理异常 | `joinAll` 或依赖作用域自动等待 |
| 单个无返回值任务完成后继续 | 现有结构化作用域 | `launch` | `join` |
| 单个有返回值任务 | 现有结构化作用域 | `async` | `await` |

选择顺序应该是：

1. 先判断子任务是否共同决定父任务成败。
2. 再判断任务是否产生结果。
3. 最后选择单个等待还是批量等待。

`await` 与 `join` 解决“如何观察完成”；`coroutineScope` 与 `supervisorScope` 解决“失败如何影响任务树”。把这两个问题混在一起，是结构化并发代码最常见的误判来源。

## 参考资料

- [CoroutineScope API](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/-coroutine-scope/)
- [Deferred.await API](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/-deferred/await.html)
- [Job.join API](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/-job/join.html)
- [awaitAll API](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/await-all.html)
- [joinAll API](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/join-all.html)
- [supervisorScope API](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/supervisor-scope.html)
- [Coroutine exceptions handling](https://kotlinlang.org/docs/exception-handling.html)

## 下一章

任务的失败边界确定之后，还需要处理共享状态和资源容量。下一章将深入 [互斥、限流与状态所有权](/collections/kotlin/mutex-semaphore-concurrency-control)：互斥、并发度限制和状态串行化解决的是三类不同问题。
