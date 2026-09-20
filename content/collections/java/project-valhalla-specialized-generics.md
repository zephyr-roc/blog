---
title: Project Valhalla：从装箱到泛型特化
date: 2026-09-20
excerpt: 从 Java 泛型擦除与 primitive boxing 的成本出发，拆解通用泛型、特化代码、共享实现、类文件表示、迁移兼容性，以及 Valhalla 与 Kotlin、C#、Rust 泛型模型的差异。
chapter: 数据布局与值语义
chapterOrder: 8
---

即使 Value Object 能被 JVM 紧凑表示，只要放进今天的泛型容器，性能仍可能退回对象世界。

```java
List<Integer> numbers = ...;
```

`List<int>` 不合法，`Integer` 又要承担装箱。数组、Stream 和函数接口因而不断产生 primitive special case：

- `int[]`、`long[]`、`double[]`；
- `IntStream`、`LongStream`、`DoubleStream`；
- `IntFunction`、`LongConsumer`、`DoublePredicate`；
- `OptionalInt`、`OptionalLong`、`OptionalDouble`。

这不是几个 API 名称难看而已，而是 Java 泛型模型无法把 primitive 与 reference 当成同一种类型参数处理。

Project Valhalla 的长期目标是让泛型同时覆盖引用、primitive 和 value object，并在性能关键位置生成或选择合适的特化表示。JDK 28 的 JEP 401/539 只是这条路线的基础；增强装箱与泛型特化的具体语法、JEP 范围和交付版本仍应视为后续工作。

## Java 泛型今天如何工作

Java 5 选择了 homogeneous translation，也就是擦除：

```java
class Box<T> {
    T value;
    T get() { return value; }
}
```

编译后的核心表示近似：

```java
class Box {
    Object value;
    Object get() { return value; }
}
```

`Box<String>` 与 `Box<User>` 共享一份 class 和机器码，编译器在边界插入 cast。好处非常重要：

- 旧 JVM 可以运行较早泛型设计生成的代码；
- 不会为每组类型参数复制 class；
- class loading、反射和动态链接模型较简单；
- `List<String>` 与 raw `List` 能渐进迁移。

但 `Object` 只能保存引用，primitive 不是 `Object`。于是：

```java
Box<Integer> box = new Box<>(42);
```

概念上发生：

```text
int 42 -> Integer object/reference -> Object slot
```

JIT 有时可以消除短命 wrapper，却无法保证跨集合、接口、模块和堆存储都成功。

## 装箱的成本不只是一份对象

boxing/unboxing 会带来：

- wrapper allocation 或缓存查找；
- 对象头、引用和对齐空间；
- GC 压力；
- pointer chasing；
- null 与 primitive 无法表示状态的语义差异；
- `Integer == Integer` 等身份陷阱；
- 泛型数组和批量计算缺乏连续布局。

例如 `ArrayList<Integer>` 的 backing array 是 `Object[]`。即使小整数命中缓存而没有新分配，数组里仍是一组引用，CPU 仍要追到 `Integer` 对象读取 `int`。

真正想要的布局是：

```text
List<int> data -> [1|2|3|4|...]
```

而不是：

```text
Object[] -> [ref|ref|ref|ref] -> Integer objects
```

## “通用泛型”包含两层问题

经常把 Valhalla 的目标简称为 Universal Generics，但要区分：

1. **类型系统通用化**：允许泛型参数接收 primitive/value 类型；
2. **表示特化**：容器和方法针对具体参数采用无装箱布局与调用约定。

只有第一层，`List<int>` 可能语法成立，却仍内部装箱；只有第二层，没有统一 API，标准库仍需维护 `IntStream` 等平行家族。

Valhalla 要同时处理语义与表示，而且不能破坏现有 `List<T>` 的二进制生态。

## 特化不是简单复制模板

C++ template 或 Rust monomorphization 可以为每个具体类型生成一份代码：

```text
Vector<i32>
Vector<f64>
Vector<Point>
```

各自拥有独立布局和机器码。这能产生高质量静态代码，也会增加：

- 编译时间；
- binary/code cache 体积；
- instruction cache 压力；
- 动态类加载与反射复杂度；
- 每种参数组合的元数据数量。

Java 生态有数百万个已经擦除的泛型 class，运行时还会动态加载未知实现。Valhalla 更可能采用“尽量共享、必要时特化”的混合策略，而不是为所有实例化无条件克隆整个类。

## 表示多态：同一算法面对不同 carrier

一个通用方法：

```java
static <T> T first(List<T> list) {
    return list.get(0);
}
```

在不同实例化中，`T` 可能由不同 carrier 表示：

- 普通对象引用；
- 一个 `int`；
- 两个寄存器中的 `Point(x, y)`；
- 指向较大临时值的间接指针；
- nullable boxed value。

VM 需要让一份逻辑算法在多种布局上工作。可能的实现手段包括：

- 为常见表示生成 specialized species；
- 共享 reference-shaped 代码；
- 通过隐藏参数传入布局、大小和操作；
- 在调用点用 adapter 做 boxing/unboxing；
- JIT 根据实际实例化进一步内联。

设计目标不是“永不共享代码”，也不是“永不生成副本”，而是在数据紧凑性、调用性能和 code size 之间选择。

## 为什么 primitive wrapper 是迁移桥梁

Java 早已有 `Integer`、`Long`、`Double` 等 wrapper，并且大量 API 写成 `List<Integer>`。如果新泛型体系另造完全不同的 `int` 实例化世界，迁移会产生两套不兼容库。

Valhalla 的增强装箱方向试图让 primitive 与 wrapper 的关系更一致，使现有参数化代码能逐步获得 primitive-like 表示，而不是要求整个生态改名。

难点包括：

- `Integer` 今天可以为 `null`；`int` 不可以；
- wrapper 历史上有对象身份行为和缓存现象；
- 反射看到的 `List<Integer>` 已有既定含义；
- overload resolution、method descriptor 和桥接方法必须兼容；
- 序列化、JNI 与动态语言依赖旧表示。

因此 Value Object 先从 wrapper 中移除不必要身份，是后续统一 primitive/reference 泛型的重要地基。

## Nullability 决定是否需要 box

即使 `T` 可以专门化为 `int`，`T?` 仍需要表达 null。对 primitive-like value，有几种物理策略：

- 额外 tag/null bit；
- `(present, value)` 两字段表示；
- 保留 sentinel；
- 退回 wrapper/reference。

不同策略适合不同位置。局部寄存器中的 nullable int 可以用 flag + int；泛型对象字段可能需要稳定布局；与旧 `Object` API 交互时可能必须装箱。

所以“支持 `List<int>`”不等于“所有路径零装箱”。准确目标是让装箱成为边界适配，而不再是泛型存储的必然基础。

## List 的布局为什么比方法更难

特化方法可以由 JIT 根据热点参数形状编译多个版本；集合对象则必须把布局长期保存在堆中。

一个 `ArrayList<T>` 需要知道：

- 元素大小和对齐；
- 元素是否含 GC reference；
- 元素是否 nullable；
- 拷贝、比较和清零如何执行；
- 扩容时按字节还是引用搬迁；
- `toArray`、subList、iterator 和 spliterator 如何适配；
- raw type 与旧字节码如何观察它。

若仍统一使用 `Object[]`，无法得到核心收益；若每种 `T` 都使用不同数组种类，class library 与 VM 要共同管理 species、反射和兼容桥。

这就是 parametric VM 设计比语言允许一个新类型参数更困难的原因。

## 擦除不会简单消失

Valhalla 不是把 Java 泛型整体改成 reified generics。现有擦除语义、raw type 和 class file descriptor 已深度嵌入生态。

更现实的方向是保留现有名义类型与共享模型，同时向 class file 增加足够的参数化信息，让 VM 在需要时选择特化表示。

这可能形成两种并存视图：

- 源代码与反射仍认知 `List<T>`；
- VM 内部为某些 T 维护布局或代码 species。

用户不应依赖内部 species 名称或认为 `List<int>` 必然对应一个可直接加载的独立 class 文件。那是实现机制，不是公共类型身份。

## 桥接边界与装箱位置

假设新代码能高效处理 primitive-specialized list，但旧库只接受 `List<?>` 或 `Object`。运行时可能需要：

- 在元素读取时 box；
- 创建适配 view；
- 调用桥接 method；
- 或选择兼容的 reference-shaped 存储。

性能工程要关注 boxing 移到了哪里，而不是只看 API 签名。最危险的情况是热点循环内部反复跨越 erased boundary：

```java
for (int value : specializedList) {
    legacyConsumer.accept(value); // 可能每次 box
}
```

更好的迁移是把边界提升到批量层：一次复制/转换整块数据，内部循环保持一致表示。

## 与 Kotlin/JVM 泛型的关系

Kotlin/JVM 泛型同样建立在 Java 擦除模型上。`List<Int>` 通常对应 `List<Integer>`，`IntArray` 才是 primitive array；Kotlin 还维护 `IntArray`、`LongArray` 等专用数组家族。

`inline` + `reified` type parameter 只是在内联调用点保留类型操作能力，不会自动让 `List<Int>` 变成无装箱容器：

```kotlin
inline fun <reified T> typeName() = T::class
```

它解决“运行时知道 T 是谁”的一部分问题，不解决堆中元素布局。

Valhalla 若提供 JVM 原生特化，Kotlin 编译器与标准库可以逐步映射，但必须维持：

- Kotlin `Int` 的装箱/非装箱语义；
- nullable `Int?`；
- Java collection 互操作；
- inline value class 的 ABI；
- 现有 metadata 与已编译库兼容。

因此不会仅通过升级 JDK 就让全部 Kotlin collection 自动无装箱。

## 与 C# 泛型的差异

.NET 泛型从设计之初就能以 value type 作为类型参数。CLR 通常为 reference type 共享代码，为不同 value type 生成或实例化适合布局的代码。

```csharp
List<int>
List<MyStruct>
```

可以直接保存值，避免每元素装箱。但 C# 仍会在转换为 `object`、接口或某些约束边界时 boxing；大 struct 复制和 code bloat 也需要控制。

Java 的难度更高，不是因为 JVM 做不到，而是必须为已经存在二十多年的擦除泛型提供渐进兼容。

## 与 Rust monomorphization 的差异

Rust 为泛型实例生成具体代码，编译器拥有 closed compilation unit 中丰富布局信息：

```rust
Vec<i32>
Vec<Point>
```

`Option<NonNull<T>>` 等类型还能利用 niche optimization，把“无值”编码进未使用位模式。

Java 必须保留动态类加载、独立编译、反射、GC 和 bytecode verification，无法假设构建时看见完整世界。Valhalla 的特化更多是 VM 在加载与 JIT 阶段协作，而不是完全交给 ahead-of-time monomorphization。

## API 设计会发生什么变化

如果通用泛型最终成熟，标准库不必立刻删除所有 primitive specialization。已有 API 的兼容价值很高，专用类型有时还能表达额外数值操作。

更可能发生的是：

- 新通用 API 不再为每个 primitive 复制一套接口；
- collection、optional、stream 的核心实现逐步共享语义；
- 旧 `IntStream` 等继续存在并桥接；
- value class 可以作为高效泛型元素；
- 框架不再把“使用领域类型”与“接受装箱成本”绑定。

例如 `Optional<Point>` 的理想实现可以是存在位加平坦字段，而不是 `Optional` 对象引用另一个 `Point` 对象。是否真正采用该布局仍由 nullability、逃逸和 VM 策略决定。

## 反射和类型 token

开发者可能期待特化后：

```java
list.getClass()
```

能直接告诉元素是 `int`。这未必成立。Java 的对象运行时 class 与泛型参数反射长期分离；内部 species 也未必成为公共 `Class` 身份。

库若需要 schema，仍应使用显式类型描述：

```java
TypeToken<List<Point>>
```

或框架自己的 layout/schema 对象，而不是根据某个预览 VM 的内部 class name 猜测。Valhalla 改善表示，不会自动解决所有 type erasure 反射问题。

## Code size 与性能的平衡

无条件为所有 `T` 生成完整特化可能导致组合爆炸：

```text
Map<Point, Money>
Map<Point, Timestamp>
Map<UserId, Money>
...
```

VM 可以按形状共享。例如多个单引用类型共享 reference species，多个相同字段布局的值共享调用 stub，再由 JIT 对真正热点实例化深度优化。

评估时要同时看：

- allocation 与 GC 是否下降；
- data cache 是否改善；
- code cache 是否膨胀；
- class loading 和元数据是否增加；
- JIT compile time 是否上升；
- 冷启动是否因 species 生成变慢；
- AOT/Leyden cache 能否复用部分特化工作。

Valhalla 与 Leyden 在这里会产生交集：更丰富的运行时形状可能增加启动工作，而 AOT cache 可以把稳定的链接和 profile 前移。

## 迁移策略

在泛型特化正式交付前，工程上可以先做这些准备：

- 不把 wrapper identity 当作业务语义；
- 避免 `Integer == Integer` 与 identity-based cache；
- 用领域 value object 代替无意义 primitive soup，但先基准装箱成本；
- 将性能关键批处理边界显式化，减少逐元素跨 erased API；
- 隔离 `Int*` 专用 API，避免业务层到处复制；
- 不依赖 JDK 内部 class name、字段布局和实验性 descriptor；
- 对预览 build 单独建基准，不把原型结果写进 SLA。

库作者还应保持泛型签名完整，避免不必要 raw type；raw boundary 会丢失参数信息，让未来特化更难选择正确表示。

## 常见误解

### “有了 value class，`List<Point>` 就一定平坦”

不一定。JEP 401 提供无身份语义，泛型容器的元素布局还依赖特化与 null restriction。

### “泛型特化等于取消擦除”

不准确。Java 很可能保留大量擦除与代码共享，同时为特定形状增加 VM 级特化。

### “reified 就会自动无装箱”

运行时知道类型参数和采用紧凑存储是两个问题。Kotlin `reified` 就是最直观例子。

### “特化总比共享代码快”

数据访问可能更快，但 code bloat、JIT 时间和 instruction cache 也可能恶化。大值复制还可能比引用访问更贵。

### “所有旧库会自动获得全部收益”

旧二进制必须继续工作，但跨 erased/legacy 边界可能需要装箱适配。收益取决于热点路径能否停留在特化世界。

## 结论：Valhalla 要消除的是抽象税，而不是抽象

Java 泛型让一套算法服务多种引用类型，却把 primitive 排除在外。开发者只能在两种代价之间选择：

- 使用 `List<Integer>`，接受装箱、引用和 GC；
- 使用 `int[]` 或专用容器，牺牲统一抽象和生态接口。

Valhalla 的长期价值是取消这道二选一：Value Object 提供无身份的领域类型，null restriction 提供紧凑存储前提，泛型特化让容器和算法理解这些表示。

这不是简单照搬 C# struct 或 Rust monomorphization。Java 要在独立编译、动态加载、反射、擦除兼容和共享代码的约束下渐进演化。最终成功的标准不是出现一个漂亮的 `List<int>` 语法，而是领域抽象进入泛型后，不再必然退化为对象头、指针追逐和 wrapper allocation。

## 延伸阅读

- [Project Valhalla](https://openjdk.org/projects/valhalla/)
- [State of Valhalla：Background](https://openjdk.org/projects/valhalla/design-notes/state-of-valhalla/01-background)
- [In Defense of Erasure](https://openjdk.org/projects/valhalla/design-notes/in-defense-of-erasure)
- [Parametric VM：Terms, Goals, Requirements](https://openjdk.org/projects/valhalla/design-notes/parametric-vm/parametric-vm)
- [Kotlin：Generics](https://kotlinlang.org/docs/generics.html)
- [Kotlin：Inline value classes](https://kotlinlang.org/docs/inline-classes.html)
