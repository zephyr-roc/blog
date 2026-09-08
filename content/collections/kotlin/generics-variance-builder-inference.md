---
title: Kotlin 泛型、型变与 Builder inference：类型如何穿过高阶 API
date: 2026-09-08
excerpt: 泛型保存类型关系，型变控制关系能否安全传播，类型推导再把调用点、lambda 与 Receiver 中的约束合并起来；理解这三层，才能设计既简洁又不依赖强制转换的高阶 API。
chapter: 函数式抽象
chapterOrder: 10
---

泛型的价值不只是少写几个重载，而是让多个位置保持同一个类型关系：容器放入什么就取出什么，转换接收什么就返回什么，DSL 块添加什么，最终模型就包含什么。

```kotlin
fun <T, R> Iterable<T>.mapToList(
    transform: (T) -> R,
): List<R> {
    val result = ArrayList<R>()
    for (element in this) result += transform(element)
    return result
}
```

`T` 把集合元素与 lambda 参数连接起来，`R` 把 lambda 结果与返回集合连接起来。编译器不关心它们最终是 `User`、`String` 还是领域值对象，只关心这些位置必须满足哪些相等、子类型和上界约束。

当函数类型、Receiver 和泛型同时出现时，需要回答三类问题：

1. 一个具体类型能否替代另一个泛型实例？
2. 运行时还保留多少类型信息？
3. 调用点没有写类型参数时，编译器从哪里获得证据？

# 类型参数表达位置之间的关系

最简单的泛型函数把同一个类型参数放在输入和结果中：

```kotlin
fun <T> identity(value: T): T = value

val name: String = identity("Kotlin")
```

这里的 `T` 不是运行时变量。编译器根据实参得到 `String <: T`，根据期望返回类型得到 `T <: String`，最终把 `T` 解为 `String`。

若实现没有任何证据证明结果类型，泛型只会制造虚假的安全感：

```kotlin
@Suppress("UNCHECKED_CAST")
fun <T> decode(bytes: ByteArray): T =
    json.decode(bytes) as T
```

调用方可以任意写 `decode<User>()`，但函数没有 serializer、`KClass<T>` 或 schema 证明字节内容确实是 `User`。更诚实的设计把证据放进参数：

```kotlin
fun <T> decode(
    bytes: ByteArray,
    serializer: KSerializer<T>,
): T = json.decodeFromByteArray(serializer, bytes)
```

泛型安全来自可验证的关系，不来自尖括号本身。

## 上界决定函数体可以做什么

未声明上界的 `T` 隐含上界是 `Any?`。要求排序能力后，编译器才允许调用 `compareTo`：

```kotlin
fun <T : Comparable<T>> maxOfTwo(a: T, b: T): T =
    if (a >= b) a else b
```

多个约束使用 `where`：

```kotlin
fun <T> persist(value: T)
    where T : Entity,
          T : Serializable {
    storage.write(value.id, encode(value))
}
```

这不是运行时逐项检查。调用点的静态类型必须同时满足全部约束，函数体则可以把 `value` 同时视为 `Entity` 和 `Serializable`。

上界还影响 JVM 擦除后的表示。没有更具体上界时通常擦除到 `Object`；修改公开 API 的首个上界可能改变生成签名和桥接方法，不能只当作源码层面的重构。

# 为什么 MutableList 必须不变

假设 `MutableList<String>` 可以赋给 `MutableList<Any>`：

```kotlin
val strings: MutableList<String> = mutableListOf("a")
val values: MutableList<Any> = strings // 假设允许
values += 42

val text: String = strings[1]         // 类型安全被破坏
```

读取方向看似安全：`String` 确实也是 `Any`。写入方向却允许通过较宽的视图塞入 `Int`。因此普通类型参数默认不变：即使 `String <: Any`，也不能推出 `MutableList<String> <: MutableList<Any>`。

```kotlin
interface MutableBox<T> {
    fun get(): T
    fun set(value: T)
}
```

`T` 同时出现在输出和输入位置，任何单向的子类型传播都会破坏另一方向。

# 声明处型变：类型作者承诺方向

只生产 `T` 的抽象可以声明 `out`：

```kotlin
interface Source<out T> {
    fun next(): T
}

val strings: Source<String> = stringSource
val values: Source<Any> = strings
```

`Source<String>` 能满足 `Source<Any>`，因为取出的 `String` 总能作为 `Any`。`out T` 同时限制公开成员不能把 `T` 放进普通输入位置。

只消费 `T` 的抽象使用 `in`：

```kotlin
fun interface Sink<in T> {
    fun accept(value: T)
}

val anySink: Sink<Any> = Sink(::println)
val stringSink: Sink<String> = anySink
```

能处理所有 `Any` 的消费者当然能处理 `String`，所以替代方向与类型继承方向相反。

## 函数类型已经内置型变

函数消费参数、生产结果，因此 `(P) -> R` 的参数逆变、结果协变：

```kotlin
val renderAny: (Any) -> String = Any::toString
val renderString: (String) -> CharSequence = renderAny
```

`renderAny` 能接收任何 `String`，返回的 `String` 又可以作为 `CharSequence`。带 Receiver 的函数类型遵守同一规则；`A.(B) -> C` 在类型关系上仍把 Receiver 和普通参数都视为输入位置。

# 使用处投影：在边界借用受限视图

类型本身可能必须保持不变，但某个函数只需要一个方向：

```kotlin
fun <T> copy(
    from: Array<out T>,
    to: Array<in T>,
) {
    for (index in from.indices) {
        to[index] = from[index]
    }
}
```

`Array<out T>` 可以安全读取为 `T`，却不能写入任意 `T`，因为真实对象可能是更具体的数组。`Array<in T>` 可以写入 `T`，读取时则只能得到足够宽的 `Any?`。

投影不会复制或冻结对象，只限制当前引用可执行的操作。其他持有可变引用的代码仍然能够修改底层对象。

可以用“生产者 `out`、消费者 `in`”辅助判断，但最终应查看真实操作：若参数既要读又要写同一种精确类型，就应保持不变。

# 星投影表达类型参数未知

`List<*>` 不是 `List<Any?>` 的别名。它表示存在某个具体元素类型，但当前代码不知道它是什么：

```kotlin
fun sizeOf(value: Any): Int? =
    if (value is List<*>) value.size else null
```

从 `List<*>` 读取只能安全得到 `Any?`。对于 `MutableList<*>`，不能写入任意非空值，因为真实对象可能是 `MutableList<String>`、`MutableList<Int>` 或其他类型。

星投影会结合声明处型变形成安全视图：

- `Producer<out T : Upper>` 的星投影可安全生产 `Upper`；
- `Consumer<in T>` 的真实 `T` 未知，因此不能安全传入具体值；
- 不变 `Box<T>` 的读写能力分别向安全方向收缩。

当业务确实不知道实参时使用 `*`；若调用者本应保留类型关系，应增加类型参数，不要在内部不断强制转换。

# Nothing 位于类型层级底部

`Nothing` 没有实例，表示正常控制流不会返回：

```kotlin
fun fail(message: String): Nothing =
    throw IllegalStateException(message)

val user: User = cache[id] ?: fail("missing user: $id")
```

由于 `Nothing` 是所有非空类型的子类型，抛异常分支能出现在任何期望类型的位置。空只读列表也可以从 `List<Nothing>` 协变为任意元素类型的 `List`：

```kotlin
val empty = emptyList<Nothing>()
val names: List<String> = empty
```

这一结论不能套到可变容器。`MutableList<Nothing>` 不能安全替代 `MutableList<String>`，因为不变性仍然存在。

# 类型擦除：编译期关系不会完整进入运行时

在 JVM 上，`List<String>` 与 `List<Int>` 运行时通常都只保留为 `List`，因此不能执行下面的完整检查：

```kotlin
fun isStringList(value: Any): Boolean =
    value is List<String> // 编译错误
```

可以检查 `value is List<*>`，但这只证明它是某种 List。`value as List<String>` 是 unchecked cast，错误可能直到很久以后读取元素时才变成 `ClassCastException`。

更可靠的边界会逐项验证并建立新集合：

```kotlin
fun Any?.toStringListOrNull(): List<String>? {
    val values = this as? List<*> ?: return null
    if (values.any { it !is String }) return null
    return values.map { it as String }
}
```

最后一次转换由前面的逐项检查支撑。序列化边界则应让 serializer 或 schema 承担同样的运行时证据职责。

# reified 只恢复当前参数可检查的部分

普通泛型函数体不能写 `value is T`，因为 `T` 已擦除。内联函数可以把实际类型参数带到调用点：

```kotlin
inline fun <reified T> Any?.castOrNull(): T? =
    this as? T

val user = payload.castOrNull<User>()
```

`reified` 适合 `is T`、`as T`、`T::class`，以及调用需要 `Class<T>` 或 `KClass<T>` 的平台 API。但它不会恢复嵌套参数：

```kotlin
inline fun <reified T> Any.matches(): Boolean = this is T

val result = listOf(1, 2).matches<List<String>>()
```

对 JVM 来说通常只能验证对象是 `List`，不能证明内部元素是 `String`。`T` 可运行时检查，不代表 `T` 内部所有泛型实参都保留了信息。

公开 inline API 还会把实现复制进调用方。常见做法是只用小型 reified 包装器取得类型令牌，把主要逻辑留在普通函数中：

```kotlin
inline fun <reified T : Any> Registry.resolve(): T =
    resolve(T::class)

fun <T : Any> Registry.resolve(type: KClass<T>): T {
    TODO("non-inline implementation")
}
```

# T & Any：绝对非空的泛型位置

与 Java 泛型互操作时，类型参数可能来自平台类型。覆盖带 `@NotNull` 的泛型签名时，可以用 definitely non-nullable type：

```kotlin
interface Game<T> {
    fun load(value: T & Any): T & Any
}
```

`T & Any` 表示值同时属于 `T` 且确定非空。若整个 API 都只允许非空实参，普通上界更清楚：

```kotlin
fun <T : Any> requireValue(value: T): T = value
```

只有 `T` 本身仍允许可空实例化、某个特定位置却必须非空时，交类型才表达额外信息。

# 类型推导是约束求解

编译器从实参、Receiver、期望返回类型和 lambda 收集约束：

```kotlin
fun <T, R> convert(value: T, block: (T) -> R): R =
    block(value)

val length: Number = convert("Kotlin") { text ->
    text.length
}
```

这里至少有四条信息：`String <: T`，lambda 参数是 `T`，`Int <: R`，赋值目标又要求 `R <: Number`。推导是在编译期求解这些关系，不是在运行时动态决定类型。

## 期望类型可以向内传播

```kotlin
fun <T> produce(): T = TODO()

val id: UserId = produce()
```

左侧 `UserId` 为调用提供期望类型。删除左侧类型后，编译器就无法凭空决定 `T`：

```kotlin
val id = produce() // 无法推断 T
```

此时应显式写 `produce<UserId>()`，或重新设计 API，让类型证据来自参数，而不是用强制转换掩盖缺失约束。

## 下划线与星投影不是一回事

已知部分类型实参时，可以用 `_` 让编译器只推导剩余部分：

```kotlin
val result = parse<JsonFormat, _>(payload)
```

`_` 出现在泛型调用处，表示“求解一个具体类型”；`*` 出现在类型使用处，表示当前视图不知道某个已存在实例的类型实参。

# Builder inference：从 Receiver lambda 内部反推类型

普通推导通常先从函数调用外部确定类型，再检查 lambda。泛型 builder 的关键信息却经常只存在于 Receiver lambda 内部：

```kotlin
val messages = buildList {
    add("started")
    add("finished")
}
```

参数表和返回位置都没有显式 `String`。Builder inference 会暂缓确定元素类型，把它当作 postponed type variable。分析 lambda 时，`add("started")` 提供 `String <: E`；处理完整个块后，再求解 `E` 为 `String`。

## 自定义 builder 的结构要求

待推导参数必须出现在 Receiver 类型的类型实参中，Receiver 还要提供能贡献约束的成员：

```kotlin
class PipelineBuilder<I, O> {
    private val steps = mutableListOf<(I) -> O>()

    fun step(transform: (I) -> O) {
        steps += transform
    }

    fun build(): Pipeline<I, O> = Pipeline(steps.toList())
}

fun <I, O> pipeline(
    block: PipelineBuilder<I, O>.() -> Unit,
): Pipeline<I, O> =
    PipelineBuilder<I, O>().apply(block).build()
```

调用点可从 `step` 和期望类型共同贡献约束：

```kotlin
val parse: Pipeline<String, Int> = pipeline {
    step { text: String -> text.toInt() }
}
```

直接写 `fun <T> build(block: T.() -> Unit)` 不满足当前 builder inference 的结构要求。Receiver 应是 `Builder<T>` 这种使用类型参数的具体泛型类型，并暴露 `add(T)`、`get(): T` 等成员。

## 读取也会贡献约束

```kotlin
val values = buildList {
    val first: CharSequence = get(0)
    add("Kotlin")
}
```

`get(0)` 暂时返回 postponed type variable。赋给 `CharSequence` 形成上界，`add("Kotlin")` 形成下界；求解器选择同时满足它们的结果。它不是按最后一条语句猜类型，而是合并整个块的约束，无法合并时报告编译错误。

## 多个 builder lambda 需要显式标记

简单的单 Receiver lambda 通常不需要注解。若同一次调用中有多个相互依赖、都需要 builder inference 的 lambda，则需要 `@BuilderInference`，并按当前编译器要求 opt-in：

```kotlin
@OptIn(ExperimentalTypeInference::class)
fun <K, V> buildIndex(
    @BuilderInference keys: MutableList<K>.() -> Unit,
    @BuilderInference values: MutableList<V>.() -> Unit,
): Pair<List<K>, List<V>> =
    buildList(keys) to buildList(values)
```

`@BuilderInference` 不是加强所有泛型推导的开关。只有函数形状确实依赖从 Receiver lambda 内收集约束时才应使用，并以项目 Kotlin 版本的 API 标记为准。

# 推导成功不等于 API 清楚

编译器可以解出多层泛型，不代表读者能轻易定位每个 `it`、Receiver 和结果的类型。DSL 设计仍应控制：

- 同时待推导的类型参数数量；
- Receiver 嵌套深度；
- 是否必须依赖不可见的期望类型才能编译；
- 错误能否指向真正冲突的位置；
- Java 或其他语言调用者是否有明确入口。

关键公共变量、跨模块返回值和复杂 builder 入口适当写出类型，往往比追求零尖括号更稳定。

## 设计检查表

| 需求 | 优先表达 |
|---|---|
| 只生产 `T` | 声明处 `out T` |
| 只消费 `T` | 声明处 `in T` |
| 同时读写 `T` | 保持不变 |
| 仅某个调用边界单向使用 | 使用处投影 |
| 真实类型参数未知 | 星投影 `*` |
| 运行时需要类型证据 | `KClass` / serializer，或小型 `reified` 包装器 |
| 整个类型参数必须非空 | `<T : Any>` |
| Java 泛型的特定位置非空 | `T & Any` |
| 类型信息只在 Receiver lambda 内 | 设计符合要求的 Builder inference |
| 推导结果需要读者猜测 | 在公共边界显式写类型 |

泛型保存关系，型变决定关系沿子类型方向如何传播，推导只从现有证据求解具体类型。擦除后的信息不会自动恢复，投影不会冻结可变对象，Builder inference 也不会凭空创造领域类型。

好的高阶 API 不追求让所有类型消失，而是只让调用者省略能由上下文可靠推出的部分，并让错误在最接近约束冲突的位置发生。

## 参考资料

- [Generics: in, out, where](https://kotlinlang.org/docs/generics.html)
- [Using builders with builder type inference](https://kotlinlang.org/docs/using-builders-with-builder-inference.html)
- [Inline functions and reified type parameters](https://kotlinlang.org/docs/inline-functions.html#reified-type-parameters)
- [Definitely non-nullable types](https://kotlinlang.org/docs/java-to-kotlin-nullability-guide.html#support-for-definitely-non-nullable-types)
- [Kotlin type inference specification](https://kotlinlang.org/spec/type-inference.html)

## 下一章

泛型让 DSL 的静态结构成立，但许多 Kotlin API 还会把读写、运算和属性访问映射到约定函数。下一章将继续讲委托属性、`getValue` / `setValue`、`provideDelegate`、操作符重载与中缀调用，分析它们如何组成更强的声明式 API，以及何时会过度隐藏真实控制流。
