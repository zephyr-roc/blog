---
title: Kotlin 高阶函数、Receiver 与 DSL：从函数值到类型安全构建器
date: 2026-09-07
excerpt: 函数类型描述可执行值，Receiver 改变名称解析的作用域，类型安全构建器再把两者组合成受编译器约束的小型语言。
chapter: 函数式抽象
chapterOrder: 9
---

Kotlin 中的函数不仅能声明和调用，也能作为值保存、传递和返回。集合操作、作用域函数、协程 builder、Compose 与 Gradle Kotlin DSL 都建立在同一组语言能力上：

1. 用函数类型描述一段可执行逻辑。
2. 用高阶函数决定何时、以什么数据调用它。
3. 用 Receiver 把某个对象变成 lambda 内的隐式作用域。
4. 用类型和作用域限制可写出的表达式，形成小型 DSL。

DSL 并不是特殊语法。`server { route("/users") { ... } }` 仍是普通函数调用；它之所以像一门语言，是因为尾随 lambda、省略括号、扩展函数和隐式接收者共同隐藏了机械性的对象传递。

## 函数是有类型的值

普通函数类型由参数列表、箭头和返回类型组成：

```kotlin
val parse: (String) -> Int? = { text -> text.toIntOrNull() }
val notify: (String, Int) -> Unit = { message, count ->
    println("$message: $count")
}
val now: () -> Long = System::currentTimeMillis
```

`Unit` 不能从函数类型中省略。`(String) -> Unit` 与 `(String) -> String` 是不同类型，即使调用者忽略后者的结果。

函数类型还可以带参数名。名字只用于说明含义，不参与类型相等判断：

```kotlin
val distance: (from: Point, to: Point) -> Double
```

可空函数值需要额外一层括号：

```kotlin
val fallback: ((Throwable) -> String)? = null

val message = fallback?.invoke(error) ?: "unknown error"
```

`(Throwable) -> String?` 表示函数一定存在，但返回值可以为空；`((Throwable) -> String)?` 表示函数值本身可以为空。

### 箭头向右结合

函数返回函数时，箭头按右结合解析：

```kotlin
(Int) -> (String) -> Boolean
```

它等价于：

```kotlin
(Int) -> ((String) -> Boolean)
```

而下面的类型表示“接收一个函数，再返回 Boolean”：

```kotlin
((Int) -> String) -> Boolean
```

括号位置改变了整个调用结构。

### suspend 函数类型是另一类类型

能调用挂起函数的函数值必须显式带有 `suspend`：

```kotlin
val load: suspend (UserId) -> User = { id ->
    repository.load(id)
}
```

`suspend (UserId) -> User` 不能当作普通 `(UserId) -> User` 使用。前者需要续体和协程调用上下文，类型系统不会因为实现中暂时没有挂起点就消除 `suspend`。

## 如何得到函数值

函数类型的实例不只有 lambda。

### Lambda

```kotlin
val square: (Int) -> Int = { value -> value * value }
```

lambda 的最后一个表达式是结果。只有一个参数且类型可推导时，可以使用隐式名称 `it`：

```kotlin
val positive: (Int) -> Boolean = { it > 0 }
```

当逻辑超过一两行，显式命名参数通常比嵌套多个 `it` 更容易读懂。

### 匿名函数

匿名函数可以显式声明返回类型，而且普通 `return` 只从匿名函数自身返回：

```kotlin
val parsePositive = fun(text: String): Int? {
    val value = text.toIntOrNull() ?: return null
    return value.takeIf { it > 0 }
}
```

这与 lambda 中通常使用的标签返回不同：

```kotlin
values.forEach { value ->
    if (value < 0) return@forEach
    consume(value)
}
```

### Callable reference

已有函数、属性和构造器可以通过 `::` 变成可调用值：

```kotlin
val parse: (String) -> Int? = String::toIntOrNull
val length: (String) -> Int = String::length
val newUser: (String, Int) -> User = ::User
```

未绑定引用把实例保留为参数。绑定引用捕获一个具体实例：

```kotlin
val log = Logger("billing")
val write: (String) -> Unit = log::info
```

`Logger::info` 需要在调用时提供 `Logger`；`log::info` 已经绑定到 `log`。

### 实现 invoke

类可以实现函数类型，或自行声明 `operator fun invoke`：

```kotlin
class RetryPolicy(
    private val maxAttempts: Int,
) : (Throwable, Int) -> Boolean {

    override fun invoke(error: Throwable, attempt: Int): Boolean =
        attempt < maxAttempts && error is IOException
}

val shouldRetry: (Throwable, Int) -> Boolean = RetryPolicy(3)
```

有状态、需要明确身份或需要多个辅助方法时，可调用对象通常比捕获大量变量的 lambda 更清晰。

## 高阶函数控制调用策略

接收函数参数或返回函数的函数称为高阶函数。它抽取的不是一个值，而是一段由调用方提供的行为。

```kotlin
fun <T, R> Iterable<T>.mapInto(
    destination: MutableCollection<R>,
    transform: (T) -> R,
): MutableCollection<R> {
    for (element in this) {
        destination += transform(element)
    }
    return destination
}
```

`transform` 由调用方提供，但何时调用、调用多少次、如何保存结果由 `mapInto` 控制：

```kotlin
users.mapInto(mutableListOf()) { user -> user.name }
```

因此高阶函数的契约不只包含函数类型，还包含调用协议：

- 回调可能不调用、调用一次还是调用多次；
- 立即在当前调用栈执行，还是稍后保存后执行；
- 顺序执行、并行执行，还是在其他线程执行；
- 异常是否透传；
- 是否允许非局部返回；
- 回调能否逃离本次函数调用。

仅从 `(T) -> R` 无法读出这些时序语义，API 名称、文档与实现边界仍然重要。

### 返回函数与闭包

返回函数可以把配置固化在闭包中：

```kotlin
fun minimumLength(length: Int): (String) -> Boolean {
    require(length >= 0)
    return { value -> value.length >= length }
}

val validUsername = minimumLength(4)
```

lambda 捕获了 `length`。在 JVM 上，捕获 lambda 通常需要保存被捕获状态；是否分配对象、能否消除分配取决于编译方式与运行时优化，不应仅凭源码形状推断性能。

捕获可变变量还会把状态共享问题藏进闭包：

```kotlin
fun sequence(): () -> Int {
    var next = 0
    return { next++ }
}
```

返回值是有状态函数，不是纯函数；并发调用它也不是线程安全的。

## 函数类型也有型变

函数消费参数、生产结果。因此参数位置逆变，返回位置协变。直观地说，能处理任意对象的函数当然也能处理字符串；返回字符串的函数也满足“返回任意对象”的要求：

```kotlin
val acceptsAny: (Any) -> String = { it.toString() }

val stringToAny: (String) -> Any = acceptsAny
```

这一规则来自函数类型对应的 `FunctionN<in P, out R>` 方向。设计回调 API 时，如果输入类型过窄、输出类型过宽，就会无谓限制可复用性。

## inline 改变的不只是性能

高阶函数可以标记为 `inline`：

```kotlin
inline fun <T> measure(block: () -> T): T {
    val started = System.nanoTime()
    try {
        return block()
    } finally {
        println(System.nanoTime() - started)
    }
}
```

编译器可以把函数体和 lambda 调用展开到调用点，从而减少某些函数对象和调用开销。但 `inline` 还是控制流语义：传给内联参数的 lambda 可以执行非局部返回。

```kotlin
fun findAdmin(users: List<User>): User? {
    users.forEach { user ->
        if (user.isAdmin) return user
    }
    return null
}
```

标准库 `forEach` 是内联函数，所以这里的 `return` 从 `findAdmin` 返回，而不是只退出 lambda。

如果内联函数要把 lambda 保存起来或传给非内联位置，该参数必须标记为 `noinline`：

```kotlin
inline fun register(
    name: String,
    noinline handler: (Event) -> Unit,
) {
    registry[name] = handler
}
```

如果 lambda 仍会内联，但将在局部对象或另一执行位置中调用，需要使用 `crossinline`，它禁止非局部返回：

```kotlin
inline fun Executor.submit(crossinline task: () -> Unit) {
    execute { task() }
}
```

不能仅为了“可能更快”给所有高阶函数加 `inline`。展开会增加调用点字节码，公开 inline API 还会把实现细节带入调用方编译产物。

## fun interface：给函数协议一个领域名称

只有一个抽象方法的 `fun interface` 支持 SAM 转换：

```kotlin
fun interface UserValidator {
    fun validate(user: User): ValidationResult
}

val validator = UserValidator { user ->
    if (user.name.isBlank()) ValidationResult.Invalid("name")
    else ValidationResult.Valid
}
```

直接使用 `(User) -> ValidationResult` 更轻量；`fun interface` 则能提供领域名称、父接口、默认方法和明确的 API 身份。不要仅为了把每个 lambda 包一层而创建接口，也不要在协议未来可能增长多个抽象操作时假设 SAM 永远合适。

# Receiver：谁成为隐式 this

Receiver 不是一种单独的对象。它描述的是调用或名称解析时，哪个值位于“接收操作”的位置。Kotlin 中至少要区分以下几种情况：

| 形式 | 示例 | Receiver 从哪里来 |
|---|---|---|
| 成员函数 | `user.save()` | `user` 是分发接收者 |
| 扩展函数 | `text.parse()` | `text` 是扩展接收者 |
| 带接收者函数类型 | `Config.() -> Unit` | 调用函数值时提供 |
| 嵌套作用域 | `outer { inner { ... } }` | 多个隐式接收者形成接收者栈 |
| context parameter | `context(log: Logger)` | 按类型从调用点上下文解析，但不是 Receiver |

最后一项很容易被旧术语混淆：当前的 context parameters 取代了实验性的 context receivers，但具名 context parameter 不会把自身成员直接注入为隐式 `this`。

## 分发接收者：普通成员所属的实例

```kotlin
class Repository {
    fun save(user: User) {
        validate(user)
        storage.write(user)
    }
}
```

调用 `repository.save(user)` 时，`repository` 是分发接收者。成员函数体中的 `this` 指向它；普通虚函数分派根据它的运行时类型选择实现。

## 扩展接收者：静态选择的外部能力

扩展函数把接收者写在函数名前：

```kotlin
fun String.toUserId(): UserId = UserId(trim())
```

扩展不会修改 `String`，也不会成为它的真实成员。它根据调用点可见性与接收者的静态类型解析：

```kotlin
open class Shape
class Circle : Shape()

fun Shape.label() = "shape"
fun Circle.label() = "circle"

val shape: Shape = Circle()
println(shape.label()) // shape
```

真实成员总是优先于同签名扩展。扩展也不能访问接收者的 `private` 或 `protected` 状态。

### 成员扩展同时拥有两个 Receiver

扩展可以声明在类内部：

```kotlin
class QueryRenderer(
    private val dialect: SqlDialect,
) {
    fun Column.render(): String = dialect.quote(name)

    fun renderAll(columns: List<Column>): String =
        columns.joinToString { it.render() }
}
```

`Column` 是扩展接收者，`QueryRenderer` 是分发接收者。发生名称冲突时，扩展接收者的成员优先；可以用限定 `this` 访问外层：

```kotlin
class QueryRenderer {
    fun Column.debug() {
        println(this.name)          // Column
        println(this@QueryRenderer) // QueryRenderer
    }
}
```

成员扩展的分发接收者可以虚分派，而扩展接收者仍按静态类型选择。这种双重规则适合把一组扩展限制在特定组件内，但过度使用会使可见性和解析来源难以追踪。

## 带接收者的函数类型

`A.(B) -> C` 表示调用时需要一个 `A` 作为 Receiver、一个普通参数 `B`，最终返回 `C`：

```kotlin
val appendLine: StringBuilder.(String) -> Unit = { line ->
    append(line)
    append('\n')
}

val output = StringBuilder().apply {
    appendLine("first")
    appendLine("second")
}
```

lambda 内部的 `this` 是调用时提供的 `StringBuilder`，所以可以省略 `this.` 调用成员。

带 Receiver 与不带 Receiver 的非字面函数值可以互换，Receiver 对应第一个参数：

```kotlin
val repeatValue: String.(Int) -> String = { count -> this.repeat(count) }
val ordinary: (String, Int) -> String = repeatValue

println(ordinary("ab", 3))
println("ab".repeatValue(3))
```

这种互换说明 Receiver 主要改变调用和作用域表达方式，不凭空增加运行时参数。

### 参数还是 Receiver

下面两种 API 携带的信息相近：

```kotlin
fun configure(block: (ServerConfig) -> Unit)
fun configure(block: ServerConfig.() -> Unit)
```

普通参数适合把对象传给其他函数、同时处理多个同类对象，来源也更明确：

```kotlin
configure { config -> validate(config) }
```

Receiver 适合主要围绕一个对象读取属性、调用成员和配置状态：

```kotlin
configure {
    port = 8080
    validate()
}
```

Receiver 不是更高级的写法。若块内大部分代码都在把该对象作为参数传出，显式参数通常更清楚。

## 作用域函数只是 Receiver 与返回值的组合

五个常用作用域函数可以按两个维度理解：

| 函数 | 上下文对象 | 返回值 |
|---|---|---|
| `let` | 参数 `it` | lambda 结果 |
| `run` | Receiver `this` | lambda 结果 |
| `with` | Receiver `this` | lambda 结果 |
| `apply` | Receiver `this` | 原对象 |
| `also` | 参数 `it` | 原对象 |

`with` 不是扩展函数，其他四个是扩展函数。真正重要的不是记口诀，而是决定：块内以配置对象为中心，还是把对象作为数据传递；调用后需要计算结果，还是继续使用原对象。

嵌套作用域函数会快速积累多个 `this` 和 `it`：

```kotlin
request.run {
    user.apply {
        audit.also {
            // this 和 it 的来源已经不直观
        }
    }
}
```

此时拆成命名局部变量通常比继续压缩代码更可靠。

## 隐式 Receiver 栈与限定 this

带接收者 lambda 可以嵌套，形成隐式 Receiver 栈。未限定名称通常从最近的适用 Receiver 开始解析：

```kotlin
application app@ {
    name = "billing"

    server server@ {
        port = 8080

        println(this@server.port)
        println(this@app.name)
    }
}
```

显式标签不仅用于解决编译歧义，也能向读者标明状态来自哪个层级。若一个 DSL 经常需要 `this@outer` 才能完成正常操作，通常意味着嵌套层级或 Receiver 职责划分不理想。

## context：由调用环境补齐参数

Kotlin 2.4 将 context parameters 提升为稳定特性。它取代了早期实验性的 context receivers。两者最关键的区别是：context parameter 是一个由调用环境解析的具名参数，不会成为新的隐式 `this`。

普通参数要求每一层调用都显式转发依赖：

```kotlin
fun validate(user: User, logger: Logger) {
    logger.info("validate ${user.id}")
}

fun persist(user: User, repository: UserRepository, logger: Logger) {
    validate(user, logger)
    repository.save(user)
}
```

如果 `Logger` 是一组操作共享且很少变化的环境能力，可以把它声明为 context parameter：

```kotlin
interface Logger {
    fun info(message: String)
}

context(logger: Logger)
fun User.persist(repository: UserRepository) {
    logger.info("persist $id")
    repository.save(this)
}
```

`context(logger: Logger)` 是函数签名的一部分。函数体可以按名字使用 `logger`，但普通调用参数列表中不再重复出现它。

### context(value) 建立上下文作用域

调用点用 `context` 块提供匹配类型的值：

```kotlin
context(appLogger) {
    user.persist(repository)
}
```

`context(appLogger) { ... }` 不创建对象，也不执行依赖注入查找。它只是让 `appLogger` 在词法块内成为可用于 context parameter 解析的上下文值。离开该块后，依赖它的函数将再次无法直接调用。

上下文可以穿过多层调用传播：

```kotlin
context(logger: Logger)
fun importUsers(rows: List<Row>, repository: UserRepository) {
    for (row in rows) {
        row.toUser().persist(repository)
    }
}
```

`importUsers` 自己要求 `Logger`，所以调用 `persist` 时可以用当前 context parameter 满足后者的同类需求。这能减少机械转发，但依赖仍然写在每个需要它的声明签名上。

### 一个声明可以要求多个上下文能力

```kotlin
interface Transaction {
    fun commit()
}

context(logger: Logger, transaction: Transaction)
fun UserRepository.store(user: User) {
    save(user)
    logger.info("stored ${user.id}")
    transaction.commit()
}
```

调用点必须同时提供可匹配的值：

```kotlin
context(appLogger, databaseTransaction) {
    repository.store(user)
}
```

这表达的是一项操作成立所需的能力集合，而不是从全局容器中随时取任意服务。

### 解析依据是类型

编译器在调用点的当前作用域中按类型寻找上下文值，而不是按变量名匹配：

```kotlin
val auditLogger: Logger = FileLogger("audit.log")

context(auditLogger) {
    user.persist(repository)
}
```

函数声明里的名字是 `logger`，调用点的值叫 `auditLogger`，仍然可以匹配，因为类型都是 `Logger`。

同一层级中有多个兼容候选时，编译器不会猜测：

```kotlin
val applicationLog: Logger = ConsoleLogger()
val auditLog: Logger = FileLogger("audit.log")

context(applicationLog, auditLog) {
    user.persist(repository) // 编译错误：Logger 候选不唯一
}
```

这种歧义是有意的安全边界。若“业务日志”和“审计日志”语义不同，应优先建模为不同接口或 newtype，而不是让两个同类型值依赖变量名区分。

### 显式 context arguments

Kotlin 2.4 可以在调用点显式指定 context argument，解决同类型候选或仅由上下文区分的重载：

```kotlin
context(logger: Logger)
fun publish(message: Message) {
    logger.info("publish ${message.id}")
}

context(applicationLog, auditLog) {
    publish(message, logger = auditLog)
}
```

参数名来自声明中的 context parameter 名称。显式传递适合局部消歧；如果绝大多数调用都必须这样写，说明类型建模或上下文作用域过宽。

### 匿名 context parameter 与 contextOf

某些函数不直接使用上下文值，只负责把能力继续提供给下游。可以用 `_` 省略参数名：

```kotlin
context(_: Logger)
fun saveBatch(users: List<User>, repository: UserRepository) {
    users.forEach { it.persist(repository) }
}
```

匿名参数仍能满足下游函数的 `Logger` 要求。如果偶尔必须取得该值，可以通过类型访问：

```kotlin
context(_: Logger)
fun reportReady() {
    contextOf<Logger>().info("ready")
}
```

具名参数通常更直观；`_` 适合真正只传播能力、不读取对象的中间层。

### context parameter 可以与 Receiver 同时存在

在前面的 `persist` 中同时存在两种角色：

- `user` 是 `persist` 的扩展接收者，可通过 `this` 访问。
- `logger` 是具名上下文参数，必须通过名字访问。

Receiver 表示“操作作用于谁”，context parameter 表示“完成操作还需要什么环境能力”。例如用户是主要业务对象，日志器只是环境依赖，把两者分别建模比叠加多个隐式 `this` 更清楚。

成员、扩展 Receiver 和 context declaration 出现同名操作时，可能发生遮蔽或诊断。不要依赖读者记忆复杂的名称解析优先级；用 `this`、context parameter 名称或 `contextOf<T>()` 显式说明来源。

### context 与依赖注入的边界

context parameter 能传递依赖，但不是完整的依赖注入框架：

- 它不负责创建对象和管理单例。
- 它不决定组件生命周期。
- 它不自动处理依赖图、配置或循环依赖。
- 它只在编译期要求调用环境提供匹配类型的值。

构造器注入仍适合对象长期持有的核心依赖；普通参数适合每次调用都可能变化的数据；context parameter 适合在受控词法范围内共享的环境能力。

| 依赖形态 | 更合适的表达 |
|---|---|
| Repository 始终依赖数据库客户端 | 构造器参数 |
| 每次保存的 User 不同 | 普通函数参数或 Receiver |
| 整个请求共享 trace/logger | context parameter |
| 可选且只影响一次调用的策略 | 普通默认参数 |
| 大量无关服务的集合 | 不要传 Service Locator 作为 context |

### context 与 DSL

Receiver DSL 负责表达正在构建的节点，context parameter 可以提供不属于节点模型的外部能力：

```kotlin
interface RouteDefaults {
    val method: HttpMethod
}

context(defaults: RouteDefaults)
fun ServerBuilder.standardRoute(
    path: String,
    handler: suspend (Request) -> Response,
) {
    route(path) {
        method = defaults.method
        this.handler = handler
    }
}
```

`ServerBuilder` 是扩展 Receiver，决定 `standardRoute` 正在配置哪个服务器；`RouteDefaults` 是上下文能力，提供这一组路由共享的默认值。

不要用 context parameter 取代 DSL 的结构 Receiver。若 `ApplicationBuilder`、`ServerBuilder`、`RouteBuilder` 全部变成上下文值，合法嵌套关系会重新变得模糊，`@DslMarker` 的作用域保护也难以发挥作用。

context parameter 适合表达横跨一组调用且由外层环境保证的能力，例如事务、日志或请求上下文。不要用它隐藏每个业务函数真正不同的核心输入，也不要把整个依赖注入容器作为单个上下文值传遍应用。

# 从 Receiver 到简单 DSL

类型安全 DSL 的核心模式很小：

```kotlin
fun <T> build(value: T, block: T.() -> Unit): T {
    value.block()
    return value
}
```

创建对象、以它为 Receiver 执行配置块、返回结果。真正的 DSL 还需要领域模型、合法嵌套关系、校验和作用域控制。

## 第一步：定义不可混淆的领域模型

下面构建一个简单的 HTTP 应用配置：

```kotlin
enum class HttpMethod { GET, POST, PUT, DELETE }

data class Route(
    val method: HttpMethod,
    val path: String,
    val handler: suspend (Request) -> Response,
)

data class Server(
    val host: String,
    val port: Int,
    val routes: List<Route>,
)

data class Application(
    val name: String,
    val servers: List<Server>,
)
```

最终模型使用不可变值。DSL 中的 builder 负责暂存可变配置，构建完成后冻结结果。

## 第二步：为每一层建立 Builder

```kotlin
@HttpDsl
class RouteBuilder(
    private val path: String,
) {
    var method: HttpMethod = HttpMethod.GET
    lateinit var handler: suspend (Request) -> Response

    fun build(): Route {
        require(path.startsWith('/')) { "route path must start with /" }
        check(::handler.isInitialized) { "handler is required for $path" }
        return Route(method, path, handler)
    }
}

@HttpDsl
class ServerBuilder {
    var host: String = "0.0.0.0"
    var port: Int = 8080
    private val routes = mutableListOf<Route>()

    fun route(path: String, block: RouteBuilder.() -> Unit) {
        routes += RouteBuilder(path).apply(block).build()
    }

    fun build(): Server {
        require(port in 1..65535) { "invalid port: $port" }
        require(routes.map(Route::path).distinct().size == routes.size) {
            "route paths must be unique"
        }
        return Server(host, port, routes.toList())
    }
}

@HttpDsl
class ApplicationBuilder {
    var name: String = "application"
    private val servers = mutableListOf<Server>()

    fun server(block: ServerBuilder.() -> Unit) {
        servers += ServerBuilder().apply(block).build()
    }

    fun build(): Application {
        require(servers.isNotEmpty()) { "at least one server is required" }
        return Application(name, servers.toList())
    }
}
```

Builder 只暴露当前层允许的操作。`route` 只能出现在 `ServerBuilder` 上，handler 只能配置在 `RouteBuilder` 中。结构约束因此进入静态作用域，而端口范围、路径格式等值约束在 `build()` 时检查。

## 第三步：提供 DSL 入口

```kotlin
fun application(block: ApplicationBuilder.() -> Unit): Application =
    ApplicationBuilder().apply(block).build()
```

调用侧已经接近声明式结构：

```kotlin
val app = application {
    name = "users"

    server {
        host = "127.0.0.1"
        port = 8080

        route("/users") {
            method = HttpMethod.GET
            handler = { request -> listUsers(request) }
        }

        route("/users/create") {
            method = HttpMethod.POST
            handler = ::createUser
        }
    }
}
```

这些大括号全部是函数参数：

- `application` 接收 `ApplicationBuilder.() -> Unit`。
- `server` 接收 `ServerBuilder.() -> Unit`。
- `route` 接收 `RouteBuilder.() -> Unit`。
- `handler` 保存 `suspend (Request) -> Response`。

外观像配置语言，编译结果仍是普通 Kotlin 对象与函数值。

## @DslMarker 限制外层 Receiver 泄漏

嵌套 DSL 默认能访问所有可见的隐式 Receiver。这可能允许在路由内部意外再声明服务器：

```kotlin
application {
    server {
        route("/users") {
            server { } // 实际来自外层 ApplicationBuilder
        }
    }
}
```

为同一 DSL 的接收者添加共同 marker：

```kotlin
@DslMarker
@Target(AnnotationTarget.CLASS, AnnotationTarget.TYPE)
annotation class HttpDsl
```

前面的 Builder 类都标记了 `@HttpDsl`。编译器在嵌套块中只允许隐式访问最近的同类 DSL Receiver，错误的 `server {}` 因此无法解析。

也可以直接标记函数类型：

```kotlin
typealias ServerBlock = @HttpDsl ServerBuilder.() -> Unit
```

`@DslMarker` 只限制隐式 Receiver，不是安全沙箱。调用者仍可以通过显式标签访问外层对象；它解决的是误用与名称污染，不阻止有意绕过。

## DSL 中的控制流仍是 Kotlin 控制流

DSL 块可以使用条件、循环、局部变量和函数调用：

```kotlin
application {
    name = environment.serviceName

    server {
        port = environment.port

        for (module in modules) {
            module.registerRoutes(this)
        }

        if (environment.debug) {
            route("/debug") {
                handler = ::debugInfo
            }
        }
    }
}
```

这是 Kotlin DSL 的优势，也意味着构建结果可能依赖运行时分支和副作用。若配置需要稳定 diff、跨语言编辑、严格 schema 验证或不可信输入，JSON、YAML 或专用声明格式可能更合适。

## Builder 应返回模型，不应直接执行世界

更容易测试和推理的 DSL 通常把“描述”与“执行”分开：

```kotlin
val definition: Application = application { ... }
runtime.start(definition)
```

如果 `server {}` 在配置阶段立刻监听端口，构建失败可能留下半启动资源，测试也必须真的占用网络。先产生不可变模型，再由执行器统一获取和释放资源，失败边界会更清楚。

同理，DSL 内的 `handler` 是被保存的函数值。构建配置不会执行它，实际请求到达时才调用。高阶函数的时序契约仍然存在，漂亮语法不会替代生命周期设计。

## DSL API 的工程边界

一个可维护的 DSL 应检查以下问题：

| 问题 | 设计手段 |
|---|---|
| 哪些节点可以嵌套 | 只在对应 Builder 暴露子节点函数 |
| 外层成员是否意外泄漏 | 共同的 `@DslMarker` |
| 必填值是否存在 | 构造参数、状态类型或 `build()` 校验 |
| 构建后能否被外部修改 | 转换为不可变模型并复制集合 |
| 配置何时产生副作用 | 描述与执行分离 |
| Receiver 来源是否清晰 | 控制嵌套深度，必要时使用标签 |
| 错误何时报告 | 能编译期约束的不要拖到运行期 |

简单 DSL 不需要复杂语法技巧。优先让领域对象和合法层级清晰，再考虑中缀函数、操作符重载、委托属性或 context parameters。过度隐藏参数会让 IDE 补全看似流畅，却使数据来源和执行时机更难判断。

## 选择函数抽象的顺序

遇到一段可配置行为时，可以按以下顺序判断：

1. 只是传递一次行为：使用普通函数参数 `(T) -> R`。
2. 行为主要围绕一个对象操作：考虑 `T.() -> R`。
3. 回调拥有明确领域身份或默认行为：考虑 `fun interface`。
4. 多层对象存在合法嵌套关系：使用类型安全 builder。
5. 多个隐式 Receiver 开始互相污染：引入 `@DslMarker`，同时重新检查层级是否过深。
6. 依赖由外层环境统一提供：谨慎考虑 context parameter，而不是继续叠加 Receiver。

高阶函数负责抽象行为，Receiver 负责调整行为书写时的作用域，DSL 则把这些能力用于表达领域结构。它们越接近语言表面，API 设计者就越需要明确真实的类型、调用次数、生命周期和副作用边界。

## 参考资料

- [Higher-order functions and lambdas](https://kotlinlang.org/docs/lambdas.html)
- [Extensions](https://kotlinlang.org/docs/extensions.html)
- [Scope functions](https://kotlinlang.org/docs/scope-functions.html)
- [Inline functions](https://kotlinlang.org/docs/inline-functions.html)
- [SAM conversions](https://kotlinlang.org/docs/fun-interfaces.html)
- [Type-safe builders](https://kotlinlang.org/docs/type-safe-builders.html)
- [Context parameters](https://kotlinlang.org/docs/context-parameters.html)

## 下一章

函数和 Receiver 进入泛型 API 后，调用点能否保持简洁取决于类型约束如何传播。下一章将深入 [泛型、型变与 Builder inference](/collections/kotlin/generics-variance-builder-inference)，解释 `in`、`out`、投影、类型擦除、`reified`，以及编译器如何从 DSL 块内部反推出类型参数。
