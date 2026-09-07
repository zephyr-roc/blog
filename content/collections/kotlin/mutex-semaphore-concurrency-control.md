---
title: Kotlin 并发控制：Mutex、Semaphore 与状态所有权
date: 2026-09-07
excerpt: Mutex 保护共享不变量，Semaphore 限制资源并发度，原子更新和 Channel 则从不同层级消除竞争；选错工具往往比漏加一把锁更危险。
chapter: 并发进阶
chapterOrder: 4
---

协程解决的是如何挂起和恢复任务，不会自动消除共享状态竞争。只要多个协程可能在不同线程上并行执行，普通多线程程序中的竞态、可见性、死锁和资源过载问题仍然存在。

```kotlin
var counter = 0

coroutineScope {
    repeat(100) {
        launch(Dispatchers.Default) {
            repeat(1_000) {
                counter++
            }
        }
    }
}

println(counter) // 不保证是 100_000
```

`counter++` 至少包含读取、加一和写回三个步骤。多个线程交错执行时，一个更新可能覆盖另一个更新。把函数标记为 `suspend`、把任务放进 `coroutineScope`，都不会让这三个步骤自动成为原子操作。

并发控制首先要区分四类问题：

| 问题 | 需要保证什么 | 典型工具 |
|---|---|---|
| 共享不变量 | 一段状态转换不能交错 | `Mutex` |
| 资源容量 | 同时占用资源的任务不超过 N 个 | `Semaphore` |
| 单值原子更新 | 一个简单读改写操作不可分割 | 原子类型、`MutableStateFlow.update` |
| 复合状态所有权 | 只有一个执行者可以修改状态 | `Channel` + 单消费者 |

这些工具并不是性能不同的同一种锁。它们表达的是不同的并发设计。

## volatile 只保证可见性，不保证复合操作原子性

在 JVM 上给字段添加 `@Volatile`，可以保证对该字段的读写具有相应的可见性和顺序语义，但不能把由多次读写组成的操作合并成一个原子步骤：

```kotlin
@Volatile
var counter = 0

counter++ // 仍然不是原子操作
```

`volatile` 解决“一个线程何时看见另一个线程的写入”，不解决“两个线程同时根据旧值计算新值”。只要正确性依赖读取后的判断、计算或多个字段的一致变化，就需要更高层的同步策略。

## Mutex：保护共享不变量

`kotlinx.coroutines.sync.Mutex` 是面向协程的互斥原语。它只有锁定和未锁定两种状态，同一时刻最多一个执行者进入临界区。

```kotlin
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

class Wallet(initialBalance: Long) {
    private val mutex = Mutex()
    private var balance = initialBalance

    suspend fun withdraw(amount: Long): Boolean = mutex.withLock {
        if (amount <= 0 || balance < amount) {
            false
        } else {
            balance -= amount
            true
        }
    }

    suspend fun balance(): Long = mutex.withLock {
        balance
    }
}
```

这里被保护的不是单独一次赋值，而是不变量：余额不足时不能扣款，余额充足时检查与扣减必须作为一个整体发生。

### withLock 优先于手动 lock 和 unlock

手动管理锁需要保证所有退出路径都释放锁：

```kotlin
mutex.lock()
try {
    updateState()
} finally {
    mutex.unlock()
}
```

`withLock` 把这套模式封装起来，即使代码抛出异常也会释放锁：

```kotlin
mutex.withLock {
    updateState()
}
```

除非需要组合 `tryLock`、所有者令牌或特殊控制流，否则应优先使用 `withLock`。

### 等待 Mutex 不会阻塞线程

锁已被占用时，`Mutex.lock()` 会挂起当前协程，而不是占住线程等待。线程可以执行其他协程，等待者在锁可用后再被恢复。

这不表示临界区本身可以无限变长。锁的竞争范围越大，等待队列越长；在锁内执行网络请求、数据库访问或长时间计算，会让所有需要同一锁的任务排队。

```kotlin
// 不合适：远程调用期间一直持有锁
mutex.withLock {
    val profile = api.loadProfile()
    cachedProfile = profile
}
```

如果远程调用不依赖锁内状态，应把 I/O 移出临界区：

```kotlin
val profile = api.loadProfile()

mutex.withLock {
    cachedProfile = profile
}
```

如果“读取旧状态 → 发起操作 → 写入新状态”必须作为一致事务，则简单地把 I/O 移出去也可能引入竞态。此时需要版本号、compare-and-set、数据库事务或重新设计状态所有权，而不是机械缩短锁范围。

### Mutex 没有线程亲和性

协程可能在一个线程获得 `Mutex`，挂起后在另一个线程恢复并释放它。`Mutex` 保护的是协程之间的访问权，不依赖固定线程持有 JVM monitor。

在 JVM 上，一次 `unlock` happens-before 同一把 `Mutex` 之后成功的 `lock`，因此临界区内的写入对后续持锁者可见。失败的 `tryLock()` 不建立这种内存关系。

### Mutex 是不可重入的

`Mutex` 与 JVM 的 `synchronized`、`ReentrantLock` 有一个关键差异：它不可重入。已经持锁的协程再次请求同一把锁，仍然会挂起。

```kotlin
class Account {
    private val mutex = Mutex()
    private var balance = 0L

    suspend fun deposit(amount: Long) = mutex.withLock {
        applyDeposit(amount)
    }

    private suspend fun applyDeposit(amount: Long) = mutex.withLock {
        balance += amount
    }
}
```

`deposit` 已经持有锁，`applyDeposit` 再次请求同一把锁，最终自我等待。更合理的结构是把“要求已持锁”的内部函数设计成不加锁的普通私有函数：

```kotlin
suspend fun deposit(amount: Long) = mutex.withLock {
    applyDepositLocked(amount)
}

private fun applyDepositLocked(amount: Long) {
    balance += amount
}
```

命名中的 `Locked` 是调用约束，不是编译器证明。类应尽量让所有状态入口集中，避免外部绕过锁访问字段。

### 公平不等于完成顺序固定

`Mutex.lock()` 对已经挂起的等待者按 FIFO 顺序恢复。但获得锁后的协程仍可能被调度、取消或抛异常，整个业务操作的完成顺序并不因此完全确定。

等待锁的协程被取消时，会从等待中退出；如果它刚获得锁便收到及时取消，锁也会被归还。取消安全解决的是锁泄漏，不会自动回滚已经在临界区完成的外部副作用。

## tryLock：无法等待时才使用

`tryLock()` 不挂起：锁空闲时立即获得锁，否则返回 `false`。

```kotlin
if (!mutex.tryLock()) {
    return RefreshResult.AlreadyRunning
}

try {
    refresh()
} finally {
    mutex.unlock()
}
```

它适合“已有任务在做就直接跳过”的合并刷新、非关键后台维护等场景。不应该用循环不断调用 `tryLock()` 模拟等待，这会产生忙等并浪费 CPU；可以等待时直接使用 `withLock`。

`isLocked` 只能提供瞬时观察，不能作为先检查后操作的同步依据：

```kotlin
if (!mutex.isLocked) {
    // 到达这里时，另一协程可能已经获得锁
}
```

## 多把锁：固定顺序避免死锁

不可重入并不是唯一死锁来源。两个任务以相反顺序获取两把锁，也会形成循环等待：

```text
协程 A：持有账户 1 → 等待账户 2
协程 B：持有账户 2 → 等待账户 1
```

转账等多对象操作应建立全局锁顺序，例如始终按账户 ID 从小到大获取：

```kotlin
private class LockedAccount(
    val id: Long,
    var balance: Long,
) {
    val mutex = Mutex()
}

suspend fun transfer(from: LockedAccount, to: LockedAccount, amount: Long) {
    val (first, second) = listOf(from, to).sortedBy { it.id }

    first.mutex.withLock {
        second.mutex.withLock {
            require(amount > 0 && from.balance >= amount)
            from.balance -= amount
            to.balance += amount
        }
    }
}
```

真实设计中还要封装锁的可见性，避免任意调用者破坏顺序。若状态天然需要跨对象事务，一把聚合锁、单一状态所有者或数据库事务通常比暴露多把锁更容易证明正确。

## Semaphore：限制同时占用资源的任务数

`Semaphore` 维护一组许可。每个任务进入受限区域前获取一个许可，退出时归还。没有可用许可时，调用者挂起排队。

```kotlin
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit

class ImageLoader(
    private val client: ImageClient,
) {
    private val requests = Semaphore(permits = 8)

    suspend fun loadAll(urls: List<String>): List<Image> =
        coroutineScope {
            urls.map { url ->
                async {
                    requests.withPermit {
                        client.load(url)
                    }
                }
            }.awaitAll()
        }
}
```

即使创建了很多协程，同时执行 `client.load` 的最多只有 8 个。等待许可的协程不占用工作线程。

### withPermit 防止许可泄漏

手动调用 `acquire()` 后，必须在 `finally` 中 `release()`：

```kotlin
semaphore.acquire()
try {
    useResource()
} finally {
    semaphore.release()
}
```

`withPermit` 封装了这一模式。异常和正常退出都会归还许可：

```kotlin
semaphore.withPermit {
    useResource()
}
```

多调用一次 `release()` 并不会让信号量无限扩容；当归还次数超过成功获取次数时，它会抛出 `IllegalStateException`。

### Semaphore 是并发限制器，不是速率限制器

`Semaphore(10)` 表示最多 10 个任务同时处于受限区域。它不保证每秒最多开始 10 个请求：如果每个请求 10 毫秒完成，一秒仍可能开始很多批。

限制“同时进行多少个”是 concurrency limiting；限制“单位时间允许多少个”是 rate limiting。后者需要令牌桶、漏桶、时间窗口或服务端配额算法，不能只靠 `Semaphore`。

### 公平性只覆盖许可队列

`Semaphore` 对挂起的 `acquire` 调用按 FIFO 顺序发放许可。这能避免后来的等待者持续插队，但不保证任务按请求顺序完成，因为每个任务拿到许可后的耗时不同。

等待许可时取消是安全的。若取消与许可发放同时发生，实现会确保许可不会因及时取消而丢失。已经进入 `withPermit` 的任务仍需遵守正常的协作式取消和资源清理规则。

### 一次创建百万个 async 仍然有成本

信号量限制的是受限代码区的并发度，不限制已创建协程和 `Deferred` 的数量：

```kotlin
millionUrls.map { url ->
    async {
        semaphore.withPermit { download(url) }
    }
}.awaitAll()
```

这段代码会先创建大量协程，其中绝大多数排在许可队列中。输入规模很大或持续产生时，应使用有界 `Channel` 加固定数量 worker，让队列容量同时形成背压：

```kotlin
suspend fun downloadAll(urls: Iterable<String>) = coroutineScope {
    val input = Channel<String>(capacity = 64)

    val producer = launch {
        try {
            for (url in urls) input.send(url)
        } finally {
            input.close()
        }
    }

    val workers = List(8) {
        launch {
            for (url in input) {
                download(url)
            }
        }
    }

    producer.join()
    workers.joinAll()
}
```

最多 8 个 worker 执行下载，Channel 中最多缓冲 64 个待处理元素；缓冲区满时生产者挂起，不会无限堆积任务。

## Mutex(1) 与 Semaphore(1) 语义接近但意图不同

只有一个许可的 `Semaphore` 在互斥效果上接近 `Mutex`，但代码表达的意图不同：

- `Mutex` 表达“这段状态转换必须独占”。
- `Semaphore` 表达“该资源允许 N 个并发使用者”，N 恰好可以是 1。

保护余额、缓存索引、状态机转移时使用 `Mutex`。限制连接、下载槽位、编码器实例时使用 `Semaphore`。正确的抽象能让未来把容量从 1 调到 N 时不破坏状态不变量。

## limitedParallelism：限制同时执行，不限制挂起任务数量

`CoroutineDispatcher.limitedParallelism(n)` 创建原调度器的受限视图，保证同时在该视图上执行的协程不超过 `n` 个：

```kotlin
val imageDispatcher = Dispatchers.Default.limitedParallelism(2)

withContext(imageDispatcher) {
    resizeAndEncode(image)
}
```

它适合限制 CPU 密集型工作同时占用的执行槽，或控制阻塞型任务对 `Dispatchers.IO` 的线程使用。

但它不是 `Mutex`，也不是对挂起任务整个生命周期的并发限制。协程一旦在 `delay`、网络 I/O 等位置挂起，调度器可以执行该视图中的另一协程：

```kotlin
val dispatcher = Dispatchers.Default.limitedParallelism(1)

repeat(3) { index ->
    launch(dispatcher) {
        println("$index enter")
        delay(100)
        println("$index leave")
    }
}
```

三个协程可以依次打印 `enter`，然后再打印 `leave`。`limitedParallelism(1)` 只保证任一时刻没有两段代码在多个线程上并行执行，不保证一个协程从进入到退出期间独占逻辑区域。

因此：

- 限制非阻塞 HTTP 请求的在途数量：使用 `Semaphore`。
- 保护跨挂起点仍需独占的状态协议：使用 `Mutex`，并谨慎控制临界区。
- 限制图像编码等 CPU 代码的执行并行度：使用 `limitedParallelism`。
- 限制阻塞 JDBC 调用占用的 IO 线程数：可使用 `Dispatchers.IO.limitedParallelism(n)`，同时还应服从连接池自身容量。

`limitedParallelism(1)` 会让各个挂起点之间的代码段顺序执行，并在这些代码段间建立 happens-before 关系，但协程仍可在挂起点交错，所以不能把它当成可跨挂起点的锁。

## 原子变量：简单状态的最小工具

在 JVM 上，简单计数器可以使用 `AtomicInteger`：

```kotlin
import java.util.concurrent.atomic.AtomicInteger

private val counter = AtomicInteger()

fun increment(): Int = counter.incrementAndGet()
```

原子类型适合单个值上的读取、写入、递增和 compare-and-set。它们通常比用 `Mutex` 包住一个整数更直接，但不会自动维护多个独立变量之间的不变量：

```kotlin
val available = AtomicInteger(10)
val reserved = AtomicInteger(0)
```

即使两个字段分别原子，`available + reserved == 10` 这样的跨字段约束仍可能在中间状态被观察到。可以把完整状态合并为一个不可变值并整体 CAS，或者使用 `Mutex`、单一所有者来保护复合转换。

## MutableStateFlow.update：发布状态的原子读改写

`MutableStateFlow.update` 可以基于当前值执行原子更新：

```kotlin
data class UiState(
    val count: Int = 0,
    val selectedIds: Set<Long> = emptySet(),
)

private val state = MutableStateFlow(UiState())

fun select(id: Long) {
    state.update { current ->
        current.copy(
            selectedIds = current.selectedIds + id,
        )
    }
}
```

并发更新冲突时，`update` 的 lambda 可能执行多次，因此它必须是纯计算，不能在里面发送消息、写数据库或累加外部计数器：

```kotlin
state.update { current ->
    auditLog.write("updating") // 错误：可能执行多次
    current.copy(count = current.count + 1)
}
```

应先原子更新状态，再根据最终结果安排副作用；如果状态变更与副作用必须形成严格协议，使用 `Mutex` 或单一状态所有者统一编排。

`StateFlow` 的价值还包括向观察者发布最新状态，但它不是通用事务容器。不要仅仅因为项目已经使用 Flow，就把所有并发控制都改写成 `_state.value = ...`。

## Channel + 单消费者：让状态只有一个写入者

锁通过排斥并发访问保护状态；另一种思路是根本不共享写权限。所有命令进入 `Channel`，只有一个消费者持有并修改状态：

```kotlin
sealed interface CounterCommand {
    data class Add(
        val amount: Int,
        val reply: CompletableDeferred<Int>,
    ) : CounterCommand

    data class Get(
        val reply: CompletableDeferred<Int>,
    ) : CounterCommand
}

class CounterStore(
    scope: CoroutineScope,
) {
    private val commands = Channel<CounterCommand>(
        capacity = Channel.BUFFERED,
    )

    private val worker = scope.launch {
        var value = 0

        for (command in commands) {
            when (command) {
                is CounterCommand.Add -> {
                    value += command.amount
                    command.reply.complete(value)
                }

                is CounterCommand.Get -> {
                    command.reply.complete(value)
                }
            }
        }
    }

    suspend fun add(amount: Int): Int {
        val reply = CompletableDeferred<Int>()
        commands.send(CounterCommand.Add(amount, reply))
        return reply.await()
    }

    suspend fun get(): Int {
        val reply = CompletableDeferred<Int>()
        commands.send(CounterCommand.Get(reply))
        return reply.await()
    }

    suspend fun close() {
        commands.close()
        worker.join()
    }
}
```

`value` 只存在于 worker 协程中，其他协程无法直接访问。每条命令执行到下一条命令前不会发生另一条状态修改，因此复合状态机比散布多把锁更容易推理。

这种 actor-style 设计仍需要明确：

- worker 属于哪个生命周期作用域；
- Channel 关闭后新命令如何失败；
- 调用者取消时，已经入队的命令是否仍应执行；
- 命令处理抛异常时，是停止整个状态机、回复失败，还是记录后继续；
- 缓冲容量如何形成背压。

单消费者消除了并发写竞争，但没有自动回答这些业务语义。

## synchronized 和 ReentrantLock 仍有适用范围

JVM 的 `synchronized` 与 `ReentrantLock` 会阻塞等待它们的线程。对于极短、完全不挂起，并且还会被普通线程代码访问的临界区，它们仍然有效：

```kotlin
private val lock = ReentrantLock()

fun snapshot(): Snapshot = lock.withLock {
    state.toSnapshot()
}
```

不要让 JVM monitor 或线程锁跨越挂起点。协程挂起后可能在其他线程恢复，而线程锁的持有语义、线程占用和协程调度模型并不匹配。

选择标准不是“代码是不是写在协程里”，而是：

- 等待锁时能否接受阻塞线程；
- 临界区是否可能挂起；
- 同一份状态是否也被非协程代码访问；
- 是否依赖可重入、条件变量等 JVM 锁特性。

把现有 `synchronized` 机械替换成 `Mutex` 也可能因不可重入而产生死锁。迁移前必须重新检查调用图和锁边界。

## 锁的粒度：先保证正确，再减少竞争

一把全局锁容易证明正确，但会串行化互不相关的操作；每个对象一把锁可以增加并发度，却增加死锁、生命周期和内存管理成本。

按 key 创建 `Mutex` 时还要处理锁表增长：

```kotlin
val locks = ConcurrentHashMap<String, Mutex>()

fun lockFor(key: String): Mutex =
    locks.computeIfAbsent(key) { Mutex() }
```

如果 key 无界，锁对象也会一直累积。移除锁时又必须证明没有等待者仍持有旧引用。常见替代方案包括：

- 固定数量的条带锁，按 key 哈希到某一把锁；
- 让缓存库负责 key 生命周期；
- 用数据库唯一约束或事务解决跨进程竞争；
- 按业务实体划分单一状态所有者。

进程内 `Mutex` 只能协调同一进程中的协程。服务部署多个实例后，它不能替代数据库锁、唯一索引、幂等键或分布式协调协议。

## 超时与取消不是事务回滚

可以限制等待时间；如果临界区内的代码会经过挂起点或主动检查取消，也可以限制其协作式执行时间：

```kotlin
val result = withTimeout(500) {
    mutex.withLock {
        updateState()
    }
}
```

超时会取消协程，并保证等待锁时不会泄漏锁。它不能抢占一段没有取消检查的纯计算或阻塞调用；如果临界区已经调用了不可取消的外部系统，超时也不代表外部操作没有发生。数据库写入、支付请求、消息发送等仍需要事务、幂等键或状态确认。

不要用 `withContext(NonCancellable)` 包住整个临界区来“保证完成”。`NonCancellable` 应只用于必要且有界的清理；扩大它的范围会让上层取消失去作用。

## 选择策略

| 场景 | 首选方案 | 原因 |
|---|---|---|
| 单个 JVM 计数器 | `AtomicInteger` | 原子操作已经完整表达需求 |
| 不可变 UI 状态的纯函数更新 | `MutableStateFlow.update` | 原子发布并适合观察 |
| 多字段业务不变量 | `Mutex.withLock` | 把检查与更新放入同一临界区 |
| 最多 N 个在途请求 | `Semaphore.withPermit` | 许可覆盖整个挂起任务生命周期 |
| CPU 密集任务限制执行并行度 | `limitedParallelism(n)` | 限制调度器执行槽 |
| 海量或持续输入的固定 worker | 有界 `Channel` | 限制 worker 数并提供背压 |
| 复杂状态机、命令有严格顺序 | `Channel` + 单消费者 | 收回共享写权限 |
| 跨进程数据一致性 | 数据库事务、唯一约束或协调协议 | 进程内同步原语不可见于其他实例 |

判断顺序可以固定为：

1. 是否真的存在共享可变状态；能否改成不可变快照或单一所有者。
2. 需要保护的是状态不变量，还是限制资源容量。
3. 临界区是否可能挂起，是否会执行不可控 I/O。
4. 正确性是否跨进程、跨数据库事务或跨消息系统。
5. 最后才考虑锁粒度和吞吐优化。

并发控制的目标不是让所有代码都加锁，而是让代码结构直接表达约束：`Mutex` 表达独占状态转换，`Semaphore` 表达有限容量，原子操作表达不可分割的单值更新，Channel 表达状态所有权。工具与约束一致时，正确性才有清晰的证明边界。

## 参考资料

- [Shared mutable state and concurrency](https://kotlinlang.org/docs/shared-mutable-state-and-concurrency.html)
- [Mutex API](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.sync/-mutex/)
- [Mutex.lock API](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.sync/-mutex/lock.html)
- [Semaphore API](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.sync/-semaphore/)
- [Semaphore.acquire API](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.sync/-semaphore/acquire.html)
- [CoroutineDispatcher.limitedParallelism API](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/-coroutine-dispatcher/limited-parallelism.html)
- [MutableStateFlow.update API](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.flow/update.html)

## 下一章

共享状态安全之后，还需要完整控制任务从启动到结束的过程。下一章将深入 [`withContext`、取消、超时与回调桥接](/collections/kotlin/cancellation-context-callbacks)，补齐结构化并发的生命周期原语。
