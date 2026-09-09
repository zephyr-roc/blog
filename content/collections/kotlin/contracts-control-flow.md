---
title: Kotlin 控制流分析：Contracts、Smart cast 与调用约束
date: 2026-09-09
excerpt: 从 returns、callsInPlace 与 InvocationKind 建立 Kotlin Contracts 的效果模型，再分析 smart cast 稳定性、extended contracts 与 Kotlin 2.4 的 returnsResultOf。
chapter: 函数式抽象
chapterOrder: 12
---

Kotlin 编译器只能根据声明可见的类型和控制流证明程序性质。一个函数即使总会检查参数、总会调用 lambda，调用点也不能仅凭函数体实现自动获得这些事实：实现可能位于另一个模块，也可能在不重新编译调用方的情况下被替换。

Contracts 为函数声明补充一小组**编译期效果**。它们不执行检查，也不改变运行时控制流，而是告诉编译器：当函数以某种方式返回时，哪些条件成立；传入的 lambda 是否只会在本次调用期间执行，以及可能执行多少次。

本章按四个问题展开：

1. `returns` 如何把返回事实传播到调用点？
2. `callsInPlace` 如何影响变量初始化和 lambda 捕获分析？
3. 为什么 contract 不能突破 smart cast 的稳定性边界？
4. Kotlin 2.2–2.4 新增的 extended contracts 解决了什么问题？

## Contracts：声明编译器可以依赖的效果

自定义 contract 使用 `kotlin.contracts` DSL：

```kotlin
import kotlin.contracts.ExperimentalContracts
import kotlin.contracts.contract

@OptIn(ExperimentalContracts::class)
fun requireName(value: String?) {
    contract {
        returns() implies (value != null)
    }

    require(value != null) { "name is required" }
}
```

调用点因此可以继续使用非空类型：

```kotlin
fun printName(name: String?) {
    requireName(name)
    println(name.length)
}
```

`contract { ... }` 必须位于函数体开头。声明自定义 contract 的 API 仍标记为 `ExperimentalContracts`，因此声明方需要显式 opt-in；调用已经声明 contract 的函数不需要重复 opt-in。

这里最重要的区别是：

| 层次 | 负责什么 | 是否在运行时执行 |
| --- | --- | --- |
| 函数实现 | 检查参数、调用 lambda、返回或抛错 | 是 |
| contract | 描述编译器可以采用的效果 | 否 |
| 调用点分析 | 根据效果执行 smart cast、确定赋值等分析 | 编译期 |

编译器不会证明 contract 与函数体一致。上例若删除 `require(value != null)`，声明仍可能被编译器信任，却不再描述真实实现。Contract 是实现者向编译器作出的承诺，不是自动生成的证明。

## 返回效果：把后置条件传播到调用点

返回效果描述函数**正常返回**后可以成立的事实。抛出异常、非局部退出或永不返回不属于正常返回。

### returns()：只关心是否正常返回

```kotlin
@OptIn(ExperimentalContracts::class)
fun requireUser(user: User?) {
    contract {
        returns() implies (user != null)
    }

    if (user == null) throw IllegalArgumentException("missing user")
}
```

`returns()` 不限制返回值，只表示“函数正常结束”。当它正常结束时，`user != null` 必须为真。

这类 contract 适合断言函数：

```kotlin
requireUser(candidate)
candidate.openDashboard()
```

它不适合会静默接受非法输入的函数。若 `requireUser(null)` 也能正常结束，那么 contract 就是错误的。

### returns(value)：返回特定值时推出条件

布尔谓词通常只在返回 `true` 时提供类型信息：

```kotlin
@OptIn(ExperimentalContracts::class)
fun Any?.isText(): Boolean {
    contract {
        returns(true) implies (this@isText is String)
    }

    return this is String
}
```

```kotlin
fun render(value: Any?) {
    if (value.isText()) {
        println(value.length)
    }
}
```

条件分支中的 `value` 被 smart cast 为 `String`。Contract 没有改变 `isText()` 的返回类型；它补充的是返回值与接收者类型之间的逻辑关系。

同样可以描述返回 `false` 或 `null` 时成立的条件，但应优先选择读者容易验证的单向关系。把复杂业务规则压进 contract 会让声明比实现更难审计。

### returnsNotNull()：非空结果推出输入事实

经典 `returnsNotNull()` 表达的方向是：**如果结果非空，那么某个条件成立**。

```kotlin
@OptIn(ExperimentalContracts::class)
fun <T> identityOrNull(value: T?): T? {
    contract {
        returnsNotNull() implies (value != null)
    }

    return value
}
```

```kotlin
if (identityOrNull(input) != null) {
    println(input.toString())
}
```

不要把逻辑方向读反。传统写法不能表达“只要输入非空，结果就一定非空”；它表达的是观察到非空结果之后，可以反推出输入条件。

### implies 不是任意逻辑语言

Contract 条件 DSL 只允许编译器能够表示和传播的有限条件，例如：

- 参数或接收者是否为 `null`；
- 参数或接收者是否属于某个可检查类型；
- 布尔参数及有限的逻辑组合。

它不能调用任意函数、读取会变化的对象图，或把数据库约束、权限状态和时间条件变成 smart cast 事实。Contracts 描述的是局部控制流关系，不是通用形式化验证系统。

## callsInPlace：描述 lambda 的调用范围与次数

高阶函数的实现者知道 lambda 如何被调用，但调用点默认不知道。`callsInPlace` 提供两类信息：

1. lambda 只会在当前函数调用尚未结束时执行，不会被保存到调用结束之后；
2. `InvocationKind` 可以进一步描述调用次数。

```kotlin
@OptIn(ExperimentalContracts::class)
inline fun <T> exactly(block: () -> T): T {
    contract {
        callsInPlace(block, InvocationKind.EXACTLY_ONCE)
    }

    return block()
}
```

### InvocationKind：次数是控制流事实

| InvocationKind | 次数保证 | 典型结构 |
| --- | --- | --- |
| `EXACTLY_ONCE` | 恰好一次 | 无条件直接调用 |
| `AT_LEAST_ONCE` | 一次或多次 | 至少执行一次的循环 |
| `AT_MOST_ONCE` | 零次或一次 | 条件分支 |
| `UNKNOWN` | 次数未知，但不会逃出本次调用 | 普通循环或复杂分支 |

`EXACTLY_ONCE` 允许编译器完成确定赋值分析：

```kotlin
val token: String

exactly {
    token = readToken()
}

println(token.length)
```

若实际实现可能不调用 `block`，这段程序就会依赖一个虚假的初始化承诺。因此 invocation kind 必须从所有控制流路径推导，而不是根据“通常会调用几次”填写。

### AT_MOST_ONCE：允许不执行

```kotlin
@OptIn(ExperimentalContracts::class)
inline fun runIf(
    condition: Boolean,
    block: () -> Unit,
) {
    contract {
        callsInPlace(block, InvocationKind.AT_MOST_ONCE)
    }

    if (condition) block()
}
```

编译器知道 lambda 不会在函数返回后再次运行，但不能假定它完成了赋值：

```kotlin
val result: String

runIf(enabled) {
    result = "ready"
}

// println(result) // result 可能尚未初始化
```

`AT_MOST_ONCE` 适合表达可选执行，不等价于“执行一次”。

### AT_LEAST_ONCE：保证发生，但次数不固定

```kotlin
@OptIn(ExperimentalContracts::class)
inline fun repeatAtLeastOnce(
    count: Int,
    block: () -> Unit,
) {
    contract {
        callsInPlace(block, InvocationKind.AT_LEAST_ONCE)
    }

    require(count > 0)
    repeat(count) { block() }
}
```

这里 `require(count > 0)` 是 contract 成立所需的运行时保证。若接受 `count == 0` 并正常返回，就只能声明 `UNKNOWN` 或不提供次数效果。

### in-place 不等于同线程、无挂起或无并发

`callsInPlace` 只约束 lambda 不会在拥有者函数结束后继续执行。它不自动保证：

- 在调用者线程执行；
- 与其他工作串行执行；
- 不进入其他调度器；
- 不抛异常；
- 调用前后的共享状态不存在竞争。

运行位置由具体实现、调度器和并发原语决定。Contract 参与控制流分析，不提供线程安全语义。

## inline 与 Contracts：相关但不是同一机制

`inline` 让函数体和部分 lambda 在调用点展开，并允许编译器对内联 lambda 做更强的控制流分析。编译器通常可以推断简单 inline lambda 不会逃逸，但 `callsInPlace` 还能明确调用次数。

两者负责不同问题：

| 机制 | 主要作用 |
| --- | --- |
| `inline` | 改变编译方式，支持非局部返回、reified 参数并减少部分函数对象开销 |
| `callsInPlace` | 声明 lambda 的生存范围与调用次数 |
| `crossinline` | 禁止 lambda 使用非局部 `return` |
| `noinline` | 不内联该参数，允许把函数值保存或传递 |

Contract 不会让普通函数突然支持非局部返回，也不会把 `noinline` lambda 变成可内联参数。反过来，声明 `inline` 也不意味着可以随意承诺 `EXACTLY_ONCE`：

```kotlin
inline fun maybe(block: () -> Unit) {
    if (System.nanoTime() % 2L == 0L) block()
}
```

这个函数至多调用一次，只能对应 `AT_MOST_ONCE`，与是否 inline 无关。

## Smart cast：Contract 仍受稳定性约束

Smart cast 本质上是编译器证明“从检查到使用之间，值没有被改成别的类型”。Contract 可以提供检查结果，却不能让不稳定表达式变稳定。

### 局部 val 是最清晰的分析对象

```kotlin
val value: Any? = loadValue()

if (value.isText()) {
    println(value.length)
}
```

局部只读变量不会在检查后被重新赋值，因此返回效果可以安全传播类型事实。

### 可变属性可能在检查后变化

```kotlin
class ScreenState {
    var payload: Any? = null
}

if (state.payload.isText()) {
    // state.payload 不能稳定地 smart cast 为 String
}
```

属性可能被其他代码写入，getter 也可能每次返回不同值。正确做法是先取得局部快照：

```kotlin
val payload = state.payload

if (payload.isText()) {
    println(payload.length)
}
```

### open 属性与自定义 getter 不是稳定值

```kotlin
open class Source {
    open val value: Any?
        get() = fetchAgain()
}
```

两次读取 `value` 不一定得到同一对象。Contract 描述函数调用与参数之间的关系，不能证明未来再次调用 getter 时仍满足旧条件。

### 捕获的 var 取决于 lambda 是否逃逸

如果 lambda 可能被保存并在以后执行，捕获的可变局部变量就可能在检查与使用之间改变。`callsInPlace` 能帮助编译器确认 lambda 不逃出本次调用，但它仍不会证明跨线程写入安全，也不会替代同步。

这也是 Contracts 与并发控制的边界：前者证明局部控制流，后者维护运行时共享状态的不变量。

## Extended contracts：表达条件在 lambda 内成立

Kotlin 2.2.20 扩展了 contract 可表达的方向。这些能力仍是实验特性，除 `ExperimentalContracts` 外还需要 `ExperimentalExtendedContracts` 和对应编译器选项。

### holdsIn：把条件带进 lambda

`holdsIn` 表示某个条件在指定 lambda 的执行期间成立：

```kotlin
import kotlin.contracts.ExperimentalExtendedContracts

@OptIn(
    ExperimentalContracts::class,
    ExperimentalExtendedContracts::class,
)
inline fun <T> T.alsoIf(
    condition: Boolean,
    block: (T) -> Unit,
): T {
    contract {
        callsInPlace(block, InvocationKind.AT_MOST_ONCE)
        condition holdsIn block
    }

    if (condition) block(this)
    return this
}
```

```kotlin
value.alsoIf(value is String) {
    println(value.length)
}
```

传统返回效果只在函数返回后产生事实；`holdsIn` 则让事实在 lambda 内部可用。它适合条件 DSL，但必须启用：

```kotlin
kotlin {
    compilerOptions {
        freeCompilerArgs.add("-Xallow-holdsin-contract")
    }
}
```

### 条件推出 returnsNotNull：表达相反方向

传统写法：

```kotlin
returnsNotNull() implies (input != null)
```

表示“结果非空 → 输入非空”。Extended contracts 还允许：

```kotlin
(input != null) implies (returnsNotNull())
```

表示“输入非空 → 结果保证非空”。这需要 `-Xallow-condition-implies-returns-contracts`。两个方向可以同时成立，但必须分别声明，不能因为业务上看起来对称就省略其中一个。

### 更多声明位置与泛型断言

Kotlin 2.2.20 还实验性支持在属性访问器和一组特定 operator 函数中声明 contract，并增强了泛型类型断言。相关功能需要 `-Xallow-contracts-on-more-functions`。

这些能力可以连接上一章的 operator 与本章的控制流分析，例如 `invoke` 在执行 lambda 后帮助完成确定赋值。但它们扩大了 API 的隐式语义，库作者应同时提供测试和版本要求，避免调用方只看到简短符号却不知道编译器依赖了什么承诺。

## Kotlin 2.4：returnsResultOf 与未使用结果分析

Kotlin 2.4 新增实验性的 `returnsResultOf()`，用于告诉未使用返回值检查器：高阶函数返回的就是 lambda 的结果。

```kotlin
@OptIn(ExperimentalContracts::class)
inline fun <T, R> T.customLet(block: (T) -> R): R {
    contract {
        returnsResultOf(block)
    }

    return block(this)
}
```

当未使用结果检查器开启时，它可以区分 lambda 产生的是可忽略结果，还是一个本应被消费的值。这个效果面向诊断，不负责 smart cast 或调用次数。

启用它需要：

```kotlin
kotlin {
    compilerOptions {
        freeCompilerArgs.add("-Xallow-returns-result-of")
    }
}
```

该选项会生成旧版编译器无法读取的预发布二进制。应用内部代码可以按编译器版本统一试用；公共库不应在没有版本策略的情况下把它加入已发布 API。

## Contract 设计：从实现路径反推最弱承诺

设计 contract 时，应从所有可能路径反推，而不是先选择最强效果再修改实现迎合它。

### 第一步：列出正常返回路径

对每条正常返回路径检查：

- `returns()` 后声明的条件是否始终成立？
- `returns(true)` 与 `returns(false)` 是否覆盖了真实分支？
- 非空返回是否真的能推出声明的输入条件？

异常路径不触发“正常返回”效果，但不能用吞异常或默认值意外制造新的正常路径。

### 第二步：计算 lambda 调用次数区间

将次数看作区间更容易选择 `InvocationKind`：

| 所有路径上的次数区间 | 可声明效果 |
| --- | --- |
| `[1, 1]` | `EXACTLY_ONCE` |
| `[0, 1]` | `AT_MOST_ONCE` |
| `[1, ∞)` | `AT_LEAST_ONCE` |
| `[0, ∞)` | `UNKNOWN` |

只要存在 `return`、异常被捕获后继续、条件分支或零次循环，就要重新计算区间。

### 第三步：检查 lambda 是否被保存

下面的函数不能声明 `callsInPlace`：

```kotlin
private val callbacks = mutableListOf<() -> Unit>()

fun later(block: () -> Unit) {
    callbacks += block
}
```

即使某些情况下 `later` 会立刻调用 `block`，只要它还可能在函数返回后再次调用，就不满足 in-place 约束。

### 第四步：选择最弱但足够的效果

Contract 越强，调用点能通过的代码越多，实现可调整的空间也越小。若调用方只需要知道 lambda 不逃逸，就不应为了“更精确”虚构 `EXACTLY_ONCE`。

## 测试 Contracts：运行时测试不够

普通单元测试只能验证函数当前运行行为，不能证明调用方获得了预期的编译器分析。Contracts 至少需要两类测试：

1. **运行时测试**：检查每条路径的返回条件和 lambda 次数；
2. **编译测试**：准备应当编译与应当拒绝的调用点，验证 smart cast、确定赋值和诊断。

例如，`EXACTLY_ONCE` 的测试不能只断言计数器等于 1，还要验证 lambda 内赋值的 `val` 在调用后可读取；`AT_MOST_ONCE` 则应验证同样的读取无法通过编译。

公共库升级编译器时还应重新运行编译测试。Contracts 由调用方编译器消费，K2 的数据流分析增强和实验效果变化都可能改变源码是否通过。

## 工程边界：Contracts 不替代什么

| Contracts 可以表达 | Contracts 不能替代 |
| --- | --- |
| 返回值与 null/type 条件的关系 | 运行时参数校验 |
| lambda 是否在本次调用内执行 | 结构化并发的 Job 所有权 |
| lambda 调用次数区间 | Mutex、原子操作或线程安全 |
| 条件在 lambda 内成立 | 数据库事务与业务不变量 |
| 高阶函数返回 lambda 结果 | 资源关闭和异常恢复协议 |

最终检查表：

1. Contract 是否描述所有正常返回路径，而不是常见路径？
2. 错误声明会不会让未初始化值或错误 smart cast 通过编译？
3. 调用方真正需要的是返回效果、调用次数还是条件作用域？
4. 是否把 `inline`、非局部返回与 `callsInPlace` 混成了一个概念？
5. Smart cast 的目标是否为稳定值？
6. 实验选项和最低 Kotlin 版本是否写进构建与发布说明？
7. 是否同时存在运行时测试和编译测试？

Contracts 的价值不在于让编译器“更聪明”，而在于把库作者已经保证的局部控制流事实变成类型检查的一部分。最好的 contract 很短、方向明确，并且读者能直接从函数体逐条验证。

## 参考资料

- [Kotlin contracts API](https://kotlinlang.org/api/core/kotlin-stdlib/kotlin.contracts/)
- [callsInPlace](https://kotlinlang.org/api/core/kotlin-stdlib/kotlin.contracts/-contract-builder/calls-in-place.html)
- [InvocationKind](https://kotlinlang.org/api/core/kotlin-stdlib/kotlin.contracts/-invocation-kind/)
- [Kotlin 2.2.20: improved contracts](https://kotlinlang.org/docs/whatsnew2220.html#improved-kotlin-contracts)
- [Kotlin 2.4.0: returnsResultOf](https://kotlinlang.org/docs/whatsnew24.html#improved-unused-result-checks-for-higher-order-functions)
- [Smart casts](https://kotlinlang.org/docs/typecasts.html#smart-casts)

## 下一章

Contracts 描述现有值在控制流中的事实，下一章将转向值本身的建模：`sealed` hierarchy、`enum`、`data object` 与 value class 如何表示封闭状态、身份和值域，并让非法状态更难进入业务代码。
