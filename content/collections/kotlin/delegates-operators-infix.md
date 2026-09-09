---
title: Kotlin 声明式 API：委托属性、操作符与中缀调用
date: 2026-09-08
excerpt: by、方括号、运算符和中缀调用不是独立运行时机制，而是编译器对约定函数的静态展开；理解展开规则，才能设计既自然又不隐藏副作用的声明式 API。
chapter: 函数式抽象
chapterOrder: 11
---

Kotlin DSL 不只依赖 Receiver lambda。`val value by source`、`table[key]`、`rule and other`、`factory()` 等写法都能把普通函数调用隐藏在接近语言原生的表达式之后。

这种能力来自约定：编译器看到特定语法后，按静态类型寻找具有规定名称和签名的函数，再把表达式展开成调用。它不会改变对象模型，也不会自动赋予事务、缓存或并发安全。

本章沿同一条判断线理解这些机制：

1. 源码会展开成哪个函数调用？
2. 函数在绑定时、读取时还是写入时执行？
3. 语法是否仍准确表达成本、失败和副作用？

## 委托属性：把访问协议交给对象

普通属性由字段或自定义访问器保存逻辑：

```kotlin
class UserSettings {
    private var rawTheme: String = "system"

    var theme: String
        get() = rawTheme
        set(value) {
            require(value in setOf("light", "dark", "system"))
            rawTheme = value
        }
}
```

多个属性需要相同的校验、存储、观察或延迟初始化协议时，可以把访问器行为抽成 delegate：

```kotlin
class UserSettings {
    var theme: String by preference("theme", "system")
    var pageSize: Int by preference("page-size", 20)
}
```

`by` 右侧不是属性值，而是负责处理访问的对象。

### getValue 与 setValue 的展开

只读属性：

```kotlin
val token: String by tokenDelegate
```

可以近似理解为：

```kotlin
private val token$delegate = tokenDelegate

val token: String
    get() = token$delegate.getValue(this, ::token)
```

可变属性还会把写入展开为 `setValue`：

```kotlin
var token: String
    get() = token$delegate.getValue(this, ::token)
    set(value) = token$delegate.setValue(this, ::token, value)
```

delegate 需要提供匹配的 `operator` 函数：

```kotlin
class Preference<T>(
    private val store: KeyValueStore,
    private val key: String,
    private val default: T,
) : ReadWriteProperty<Any?, T> {

    override fun getValue(
        thisRef: Any?,
        property: KProperty<*>,
    ): T = store.read(key) ?: default

    override fun setValue(
        thisRef: Any?,
        property: KProperty<*>,
        value: T,
    ) {
        store.write(key, value)
    }
}
```

标准库的 `ReadOnlyProperty<R, T>` 与 `ReadWriteProperty<R, T>` 不是使用 `by` 的硬性要求，但能把签名意图写清楚。

`thisRef` 是属性拥有者。顶层或局部属性通常不需要拥有者，可声明为 `Any?`；只允许某类对象使用时，应收窄为具体类型：

```kotlin
class RouteValue<T> : ReadOnlyProperty<RouteContext, T> {
    override fun getValue(
        thisRef: RouteContext,
        property: KProperty<*>,
    ): T = thisRef.attributes[property.name] as T
}
```

`KProperty<*>` 提供名称等属性元数据。它不是存储位置本身，也不应被误认为每次访问都会执行完整反射扫描。

### 属性类型由 getValue 结果约束

若声明省略类型，编译器会根据 delegate 的 `getValue` 推导：

```kotlin
val retries by constant(3) // 推导为 Int
```

显式属性类型则反过来约束 delegate：

```kotlin
val retries: Number by constant(3)
```

泛型 delegate 设计不当时，错误可能出现在 `by` 处而不是 `getValue` 实现处。公开 API 应尽量让 `R`、`T` 与 property 类型之间的关系直接出现在签名中。

### 局部委托属性没有实例 Receiver

局部变量也可以委托：

```kotlin
fun render(): String {
    val template by lazy(::loadTemplate)
    return template.render(model)
}
```

局部属性的 `thisRef` 为 `null`。delegate 的生命周期等同于该局部变量，而不是自动提升到对象或应用级缓存。

## 标准委托：先辨认真实语义

### lazy：第一次读取时初始化

```kotlin
val client: ApiClient by lazy {
    createClient()
}
```

`lazy` 把初始化延迟到第一次读取，并缓存成功结果。初始化抛异常时不会缓存失败，下一次读取还会重试。

默认模式提供同步保护。`LazyThreadSafetyMode.PUBLICATION` 允许初始化函数并发执行多次，但最终只发布一个结果；`NONE` 不提供线程安全，只适合明确单线程访问的对象。

“只发布一个值”不等于“副作用只执行一次”。初始化函数若注册资源、写数据库或发送请求，`PUBLICATION` 的重复执行可能不可接受。

### observable 与 vetoable：观察或拒绝写入

```kotlin
var name: String by Delegates.observable("") { property, old, new ->
    logger.info("${property.name}: $old -> $new")
}

var port: Int by Delegates.vetoable(8080) { _, _, new ->
    new in 1..65535
}
```

`observable` 在值已经改变后调用回调，不能靠抛异常可靠回滚外部副作用。`vetoable` 在提交前询问是否接受新值，但它仍不是多属性事务。

这些 delegate 不会自动序列化多线程写入。并发状态仍需要 `Mutex`、原子更新或单一所有者模型。

### Map 委托：属性名成为键

```kotlin
class UserView(private val values: Map<String, Any?>) {
    val name: String by values
    val age: Int by values
}
```

Map delegate 适合键名已经稳定、来源受控的动态数据。缺键、类型错误和重命名都可能在运行时暴露；它不能替代不可信 JSON 的 schema 校验。

## provideDelegate：在绑定阶段检查声明

`getValue` 在每次读取时执行，`provideDelegate` 则在属性与 delegate 建立绑定时执行：

```kotlin
class ConfigKey<T>(
    private val allowedNames: Set<String>,
    private val default: T,
) {
    operator fun provideDelegate(
        thisRef: Config,
        property: KProperty<*>,
    ): ReadOnlyProperty<Config, T> {
        require(property.name in allowedNames) {
            "unknown config key: ${property.name}"
        }

        return ReadOnlyProperty { owner, _ ->
            owner.read(property.name, default)
        }
    }
}
```

```kotlin
class AppConfig : Config() {
    val host by ConfigKey(setOf("host", "port"), "localhost")
}
```

近似展开顺序是：

```kotlin
private val host$delegate =
    ConfigKey(...).provideDelegate(this, ::host)

val host: String
    get() = host$delegate.getValue(this, ::host)
```

因此 `provideDelegate` 适合：

- 在对象初始化时校验属性名或注解；
- 根据属性元数据选择真正的 delegate；
- 注册属性描述，但不立刻读取实际值；
- 把错误从第一次访问提前到对象构造阶段。

它也可能在构造过程中产生副作用。若注册失败，需确保不会留下半完成的全局状态；对象构造期间还不应泄漏未完全初始化的 `this`。

扩展属性有一个容易忽略的边界：建立 delegate 时没有具体扩展 Receiver 实例，所以 `provideDelegate` 获得的 `thisRef` 为 `null`；实际 `getValue` / `setValue` 才会收到访问时的扩展 Receiver。

## 类委托与属性委托不是同一机制

接口实现也使用 `by`：

```kotlin
class LoggingRepository(
    private val delegate: UserRepository,
    private val logger: Logger,
) : UserRepository by delegate {

    override suspend fun save(user: User) {
        logger.info("save ${user.id}")
        delegate.save(user)
    }
}
```

类委托让编译器为接口成员生成转发；属性委托则通过 `getValue`、`setValue` 和可选的 `provideDelegate` 改写属性访问。二者共享 `by` 语法，但没有共同的 delegate 接口。

类委托适合组合默认实现，同时显式覆盖需要装饰的成员。需要注意：delegate 对象内部调用自身成员时，不会动态绕回外层类的 override；它持有的仍是自己的 `this`。

## 操作符约定：符号只是函数调用入口

Kotlin 不允许定义任意新操作符。语言只把固定语法映射到规定名称，例如：

| 表达式 | 近似展开 |
|---|---|
| `a + b` | `a.plus(b)` |
| `-a` | `a.unaryMinus()` |
| `a[i]` | `a.get(i)` |
| `a[i] = v` | `a.set(i, v)` |
| `x in a` | `a.contains(x)` |
| `a()` | `a.invoke()` |
| `a < b` | `a.compareTo(b) < 0` |
| `for (x in a)` | 通过 `iterator/hasNext/next` 约定 |

函数需要使用 `operator` 标记，且签名必须符合对应约定。

### 算术操作应返回领域上合理的结果

```kotlin
@JvmInline
value class Money(val cents: Long) {
    operator fun plus(other: Money): Money =
        Money(Math.addExact(cents, other.cents))
}
```

`moneyA + moneyB` 清晰，因为加法封闭在同一领域，且不会让人误判副作用。若 `plus` 实际发起网络请求、修改数据库或改变 Receiver，符号会隐藏关键成本。

操作符函数仍是普通静态分派或虚分派调用。它不会获得数学结合律、交换律，也不会自动处理溢出；这些性质必须由领域实现保证。

### plus 与 plusAssign 表达不同更新模型

`a += b` 可能解析为 `a.plusAssign(b)`，也可能计算 `a.plus(b)` 后重新赋给 `a`。如果两条路径同时适用并产生歧义，编译器会拒绝。

```kotlin
operator fun Basket.plus(item: Item): Basket =
    copy(items = items + item)

operator fun MutableBasket.plusAssign(item: Item) {
    items += item
}
```

前者产生新值，后者原地修改。不要让同一种领域类型的 `+` 有时复制、有时偷偷修改；调用者会依赖符号表达的更新语义。

### get、set 与 contains 适合容器语义

```kotlin
class Headers(
    private val values: MutableMap<String, String>,
) {
    operator fun get(name: String): String? = values[name.lowercase()]

    operator fun set(name: String, value: String) {
        values[name.lowercase()] = value
    }

    operator fun contains(name: String): Boolean =
        name.lowercase() in values
}
```

调用侧自然得到 `headers["content-type"]` 与 `"etag" in headers`。如果索引访问背后可能阻塞网络，普通挂起函数 `load(key)` 更诚实；方括号会隐藏远程 I/O 的成本、延迟与失败边界。

### invoke 让对象表现为函数

```kotlin
class RetryPolicy(private val maxAttempts: Int) {
    operator fun invoke(error: Throwable, attempt: Int): Boolean =
        attempt < maxAttempts && error is IOException
}

if (retryPolicy(error, attempt)) retry()
```

`invoke` 适合对象的核心身份就是一项可执行策略，同时对象又需要配置、状态或辅助方法。若类主要代表数据，额外加入 `invoke` 往往会让调用含义难以搜索。

### equals 有额外限制

`==` 展开为安全的 equals 调用，但 Kotlin 只认可来自 `Any` 的 `equals(other: Any?)` 覆盖。声明一个不同参数类型的 `operator fun equals` 不能改变 `==` 语义。

相等性还必须与 `hashCode` 一致。DSL 的语法便利不能削弱集合键和缓存所依赖的对象契约。

## 中缀调用：减少标点，不改变优先级规则

成员函数或扩展函数满足以下条件时可以标记 `infix`：只有一个参数、参数不是 `vararg`、也没有默认值。

```kotlin
sealed interface Predicate {
    infix fun and(other: Predicate): Predicate = And(this, other)
}

val activeAdults = active and adult
```

中缀语法省略点和括号，但调用仍等价于 `active.and(adult)`。

### 优先级低于算术、类型转换和区间

```kotlin
1 shl 2 + 3
```

解析为：

```kotlin
1 shl (2 + 3)
```

中缀调用的优先级又高于 `&&`、`||`、`is` 检查和 Elvis。连续混用不同中缀函数时，读者很容易错误分组；领域表达式一旦需要查优先级表，就应加括号或退回普通调用。

官方编码约定建议只在两个对象扮演相近角色时使用中缀形式，例如 `and`、`or`、`zip`、`to`。`repository save user` 既隐藏动作方向又修改 Receiver，不如 `repository.save(user)` 明确。

## 组合成声明式 API

委托属性可以定义配置入口，操作符可以表达领域组合，Receiver DSL 可以限制嵌套位置：

```kotlin
@RulesDsl
class RuleSetBuilder {
    private val rules = mutableListOf<Predicate>()

    operator fun Predicate.unaryPlus() {
        rules += this
    }

    fun build(): RuleSet = RuleSet(rules.toList())
}

fun rules(block: RuleSetBuilder.() -> Unit): RuleSet =
    RuleSetBuilder().apply(block).build()
```

```kotlin
val accessRules = rules {
    +(isAuthenticated and hasSubscription)
    +isAdministrator
}
```

这里每层语法仍能还原：

- `and` 构造组合谓词；
- 一元 `+` 调用 `RuleSetBuilder` 作用域内的扩展并登记规则；
- `rules` 执行 Receiver lambda，最后冻结不可变模型。

这种写法只有在领域中反复出现、且符号含义稳定时才值得采用。如果 `+rule` 既可能注册又可能立即执行，API 已经隐藏了重要阶段差异。

## 声明式语法的工程边界

| 机制 | 适合表达 | 不应隐藏 |
|---|---|---|
| 属性 delegate | 缓存、存储、观察和访问策略 | 阻塞 I/O、无界重试 |
| `provideDelegate` | 绑定阶段校验与注册 | 构造期间不可回滚的全局副作用 |
| 类委托 | 接口转发与局部装饰 | delegate 内部调用的分派差异 |
| 操作符 | 数学、容器和组合语义 | 网络、数据库和模糊的原地修改 |
| `invoke` | 可执行策略对象 | 普通数据对象上的隐秘动作 |
| infix | 对称或近似对称的领域关系 | 复杂优先级与方向不明的命令 |

设计时还应检查：

1. IDE 跳转能否快速找到真实实现？
2. 一次看似读取的表达式可能执行多少次？
3. 异常是在绑定、访问还是执行阶段发生？
4. 是否需要挂起，而语法却无法表达 `suspend` 边界？
5. Java 与其他平台调用者是否有普通函数入口？
6. 日志和性能分析能否定位展开后的真实调用？

声明式 API 的目标不是最大限度消除标点，而是让源码结构贴近领域结构。只有当简写保留了成本、所有权和副作用方向，它才比普通函数调用更清晰。

## 参考资料

- [Delegated properties](https://kotlinlang.org/docs/delegated-properties.html)
- [Delegation](https://kotlinlang.org/docs/delegation.html)
- [Operator overloading](https://kotlinlang.org/docs/operator-overloading.html)
- [Infix notation](https://kotlinlang.org/docs/functions.html#infix-notation)
- [Kotlin coding conventions](https://kotlinlang.org/docs/coding-conventions.html#infix-functions)
- [Delegated property specification](https://kotlinlang.org/spec/declarations.html#delegated-property-declaration)

## 下一章

约定函数改变源码表达形式，contracts 则把函数行为的一部分告诉编译器。下一章进入 [Kotlin 控制流分析：Contracts、Smart cast 与调用约束](/collections/kotlin/contracts-control-flow)，解释高阶函数何时能安全影响调用点的数据流分析。
