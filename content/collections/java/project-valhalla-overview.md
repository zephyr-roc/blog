---
title: Project Valhalla：Java 为什么需要没有身份的对象
date: 2026-09-20
excerpt: 从对象身份的隐藏成本出发，理解 Value Object 的语义、内存局部性、标量替换、JDK 28 预览边界，以及 Valhalla 与 record、Kotlin value class、C# struct 和 Rust 值语义的差异。
chapter: 数据布局与值语义
chapterOrder: 5
---

Java 的对象模型有一个长期被视为理所当然的前提：每个对象都有身份。

即使两个对象的字段完全相同，它们也可以是两个不同对象；可以用 `==` 区分，可以锁住其中一个，可以取得与身份相关的 hash，还可以在对象图中让多个引用指向同一实例。这套模型非常适合用户、连接、线程、缓存节点等实体，却也被强制套在坐标、复数、日期片段、金额和颜色这些“只由内容决定是什么”的数据上。

Project Valhalla 要解决的核心问题不是“给 Java 再加一种 struct 语法”，而是：

> 当一个对象不需要身份时，程序能否明确放弃身份，让 JVM 不再为一个永远不会被观察的性质付费？

截至 JDK 28，JEP 401 将 Value Objects 作为预览特性引入，JEP 539 同时预览 JVM 的严格字段初始化。Null-Restricted Types、增强装箱与泛型特化仍是后续工作，不能与 JEP 401 已交付的能力混为一谈。

## 身份并不是免费的

普通对象在堆中的概念形态通常包含：

```text
reference ──> [ object header | fields | padding ]
```

对象头要支撑 GC、类型信息、同步和身份相关状态；引用本身占空间；对象通常单独分配；读取字段要先沿引用跳转。实际布局受压缩指针、对象对齐、GC 和 JVM 实现影响，但成本类别不变：

- header 与对齐浪费内存；
- 每个对象需要分配与回收；
- 数组保存的是引用，元素散落在堆中；
- 多一次 pointer chasing，增加 cache miss 风险；
- GC 要扫描更多对象和引用边。

考虑一百万个二维点：

```java
record Point(int x, int y) {}

Point[] points = new Point[1_000_000];
```

今天的 `record` 仍是有身份的普通对象。数组主体保存一百万个引用，每个 `Point` 还要单独占据一个堆对象。真正计算距离时，CPU 想要的是连续的 `x, y`，拿到的却是连续引用与离散对象。

手工改成两个 `int[]` 可以获得更好的布局，却破坏了领域模型：坐标不再是一个类型，而是两组必须永远同步的数组。

Valhalla 想保留“像类一样建模”，同时给 JVM “像一组值一样存储”的自由。

## Value Object 的第一原则是语义，不是布局

JEP 401 使用 `value` 修饰符声明值类：

```java
value class Point {
    int x;
    int y;

    Point(int x, int y) {
        this.x = x;
        this.y = y;
    }

    double distanceTo(Point other) {
        int dx = x - other.x;
        int dy = y - other.y;
        return Math.hypot(dx, dy);
    }
}
```

这段声明首先承诺：`Point` 实例没有可观察身份。由此才派生出 JVM 的优化自由。

| 身份对象 | 值对象 |
|---|---|
| 两个字段相同的实例仍可被身份区分 | 相同状态代表同一个值 |
| 可以作为 monitor | 不能依赖对象监视器 |
| 实例字段可变 | 实例状态浅不可变 |
| 引用位置通常保存对象地址 | JVM 可保存引用，也可拆成字段 |
| 复制引用保留共享身份 | 复制值不改变程序含义 |

因此不要把 `value` 读成 `inline`、`stack` 或 `packed`。它没有承诺对象一定在栈上、一定没有引用，或者字段一定紧密排列；它承诺的是程序不能观察身份，于是 JVM 可以在不改变语义的前提下选择表示。

## 没有身份为什么能解锁优化

假设方法接收一个普通 `Point`：

```java
int sum(Point point) {
    return point.x() + point.y();
}
```

只要对象身份可能被观察，JVM 就必须考虑：

- 调用方是否还持有同一引用；
- 方法中是否执行 `==`、锁或 identity hash；
- 对象是否可能被别处修改；
- 调试、反射或 native 边界是否需要真实对象。

逃逸分析可以在局部证明安全时消除分配，但它依赖每次编译的全局上下文，跨模块、反射、复杂控制流后容易失效。

值类把关键事实写进类型定义：所有使用者都不得依赖身份。JVM 因而可以更稳定地进行：

- **scalarization**：把对象拆成若干标量，在寄存器或栈槽中传递；
- **flattening**：把字段内容嵌入容器或数组，而不是保存引用；
- **allocation elimination**：不建立独立堆对象；
- **reconstruction**：需要调试、反射或边界对象时再物化一个等价实例。

概念上：

```text
Point add(Point a, Point b)

可以被 JVM 当作近似：

(ax, ay, bx, by) -> (ax + bx, ay + by)
```

这里不是 Java ABI 真变成多返回值，而是 VM 内部可以自由拆解和重组。

## 浅不可变，不等于对象图完全不可变

值类的实例字段不能在构造完成后变化，但字段可以引用可变对象：

```java
value class Tags {
    List<String> values;

    Tags(List<String> values) {
        this.values = values;
    }
}
```

`values` 这个引用不能被换掉，不代表列表内容不能变化。这样的类型虽然满足语言层面的浅不可变，却很可能不满足业务对“值”的直觉，也削弱 JVM 对深层状态的推理。

更稳妥的设计是复制并封装：

```java
value class Tags {
    List<String> values;

    Tags(List<String> values) {
        this.values = List.copyOf(values);
    }
}
```

Valhalla 不会替应用设计真正的不可变对象图；它只规定值对象自身的实例状态不能被重新赋值。

## Value Class 与 record 不是同一条轴

`record` 解决的是数据载体的声明样板：组件、构造器、访问器、`equals`、`hashCode` 和 `toString`。它仍然是 identity class。

`value` 解决的是对象是否拥有身份。一个普通类可以是 value class，record 也可以表达为 value record；两者是可组合的维度：

| 形式 | 关注点 |
|---|---|
| `class` | 自定义类 API 与实现 |
| `record` | 透明数据聚合与生成成员 |
| `value class` | 放弃实例身份 |
| `value record` | 透明数据聚合，同时放弃身份 |

迁移时不能机械地给所有 record 加 `value`。如果代码依赖 `==`、`IdentityHashMap`、对象锁、弱引用身份、对象代理或自引用结构，它就不是合适的值对象。

## 适合与不适合的类型

典型值对象：

- `Point`、`Vector`、`Complex`；
- `Money(amount, currency)`；
- `Rgb(r, g, b)`；
- 小型日期时间片段；
- UUID、哈希、版本号等固定内容标识；
- 领域中的测量单位和受约束数字。

典型身份对象：

- 用户、订单、账户等会持续演化的实体；
- 锁、线程、连接、文件句柄；
- 图节点、双向链表节点等依赖引用拓扑的对象；
- ORM entity 与 lazy proxy；
- 需要独立生命周期和共享可变状态的服务对象。

“字段少”不是充分条件，“不可变”也不是充分条件。真正的问题是：两个实例内容相同后，程序是否仍有理由区分它们。如果有，身份就是业务语义，而不是性能负担。

## JDK 28 预览交付了什么

需要把 Valhalla 的路线拆成三个层次：

| 层次 | 状态 | 解决的问题 |
|---|---|---|
| Value Objects，JEP 401 | JDK 28 预览 | 在语言和 JVM 中表达无身份对象 |
| Strict Field Initialization，JEP 539 | JDK 28 预览 | 在字节码验证层保证关键字段及时初始化 |
| Null restriction、紧凑存储、泛型特化 | 后续设计工作 | 可靠触发扁平字段/数组并消除泛型装箱 |

JEP 401 很重要，但它不是 Valhalla 的终点。仅声明值类并不等于每个使用位置都保证扁平化：普通引用位置仍要表示 `null`，并受原子性、布局兼容、类加载和 GC 约束。

因此准确表述应是：`value` 给 JVM 许可；具体存储是否扁平化取决于使用位置与 VM 策略。未来 null-restricted storage 才会提供更强的布局契约。

## 为什么 null 会妨碍扁平化

如果一个字段或数组元素既要保存一个展开后的 `Point(x, y)`，又要保存 `null`，布局必须额外表示“缺失”：

```text
nullable element = null-bit + x + y
```

这个 null bit 可能需要位图、额外字节、保留值或退回引用表示。数组更新还涉及原子性与并发可见性。JVM 不能仅因类型是 value class 就忽略这些语义。

所以 Valhalla 的长期设计将“是否有身份”与“是否允许 null”分开：

- value class 决定对象语义；
- null restriction 决定某个存储位置能否排除 `null`；
- JVM 再据此选择平坦或间接布局。

这比把“值类型”设计成一个同时承担所有含义的新类型家族更利于兼容已有 Java。

## 与 Kotlin value class 的根本区别

Kotlin/JVM 的 `@JvmInline value class` 是编译器层面的包装消除，当前只能有一个底层属性：

```kotlin
@JvmInline
value class UserId(val raw: Long)
```

它在一些调用位置可以用 `long` 表示，在泛型、接口、可空类型等位置会装箱为 wrapper。方法需要名称改编，Java 互操作也能看到编译器生成的表示细节。

Valhalla 值类是 JVM 原生对象模型：

| 维度 | Kotlin value class | Valhalla value class |
|---|---|---|
| 实现层 | Kotlin 编译器编码 | Java 语言 + class file + JVM |
| 字段数 | 一个底层属性 | 可有多个实例字段 |
| 装箱模型 | 位置相关的 wrapper/underlying value | JVM 直接理解无身份对象 |
| 泛型 | 常见场景仍装箱 | 长期目标是与特化协同 |
| Java 互操作 | 名称改编与装箱规则较复杂 | 目标是平台统一模型 |
| 主要用途 | 类型安全的轻量 wrapper | 通用复合值与紧凑布局基础 |

Kotlin value class 仍非常适合 ID、单位和受约束单值；Valhalla 要解决的是 JVM 生态共同使用的多字段值模型。未来 Kotlin 编译器可以选择映射到 Valhalla 能力，但这需要语言与 ABI 演进，不会自动发生。

## 与 C# struct、Rust 的差异

C# `struct` 从语言开始就有值类型语义，默认嵌入字段、数组和栈位置，但也存在 boxing、复制大 struct 的成本、可变 struct 陷阱以及 generic constraint 等复杂性。Java 不能直接复制这条路线，因为几十年的 class file、反射、泛型擦除和库二进制兼容都以引用模型为基础。

Rust 默认按值移动或复制，布局、所有权与借用检查在编译期形成完整系统；没有 GC，也不需要保持 Java 那种动态类加载与统一对象层级。Valhalla 只借鉴“值可以没有身份”的结果，不会把 Java 变成所有权语言。

| 语言 | 核心选择 |
|---|---|
| Java Valhalla | 在现有对象模型中显式放弃身份，由 JVM自适应表示 |
| C# | `class` 与 `struct` 形成长期存在的引用/值二分 |
| Rust | 值语义、所有权与生命周期共同决定移动和存储 |
| Kotlin/JVM | 编译器对单字段 wrapper 做位置相关消除 |

## 性能价值不只来自“少一次分配”

Valhalla 最可观的收益往往来自整个内存层次：

- 更少对象头和 padding，降低 heap footprint；
- 更少引用，减轻 GC root/heap scan 压力；
- 连续数组提高 cache line 利用率；
- 减少 pointer chasing 和 TLB 压力；
- 更容易在寄存器中传递复合值；
- 领域类型不必退化成 parallel primitive arrays；
- 泛型特化落地后，可消除 wrapper allocation 与 boxing。

但扁平化也并非永远更快。大值频繁复制可能比复制引用贵；更新一个大元素要考虑原子性；稀疏数组需要付出完整元素空间；多态与 nullable 场景可能仍适合间接引用。

正确的性能模型是“让 JVM 拥有更多布局选择”，而不是“所有对象都应该 inline”。

## 迁移与设计检查表

准备把类型改成 value class 时，应逐项确认：

- 相同字段状态的实例是否完全可互换；
- 是否使用过 `==` 来判断别名关系；
- 是否进入 `IdentityHashMap`、identity set 或对象锁；
- 是否依赖 `System.identityHashCode`；
- 是否被 ORM、代理、序列化框架按实体处理；
- 是否存在自引用字段或依赖对象图节点身份；
- 字段引用的对象是否真的满足领域不可变性；
- 大值复制是否可能抵消局部性收益；
- 目标 JDK 的预览 class file 是否能被工具链识别。

预览期还必须锁定 JDK 版本，编译和运行都启用预览，并重新验证字节码工具、agent、反射框架、序列化、JNI/FFM 与调试器。不要把预览 class file 当作长期稳定的公共 ABI。

## 结论：Valhalla 改写的是对象与数据布局之间的契约

Java 过去把“领域抽象”和“对象身份”捆在一起。为了拥有方法、封装和类型安全，开发者通常也被迫接受独立分配、对象头、引用间接层和装箱。

Value Object 将两者拆开：一个类型仍然可以有构造器、方法、接口和封装，却明确声明实例只由字段值决定。JVM 因此可以拆解、复制、内联或重新物化它，而不改变程序可观察行为。

Valhalla 的价值不是让 Java 模仿某一种 `struct`，而是让抽象不再天然意味着内存间接层。JEP 401 建立无身份语义，JEP 539补上可靠初始化；null-restricted storage 与泛型特化将继续把这份语义转化为可预测的数据布局和泛型性能。

## 延伸阅读

- [JEP 401：Value Objects（Preview）](https://openjdk.org/jeps/401)
- [JEP 539：Strict Field Initialization in the JVM（Preview）](https://openjdk.org/jeps/539)
- [Project Valhalla](https://openjdk.org/projects/valhalla/)
- [Valhalla：Value Objects](https://openjdk.org/projects/valhalla/value-objects)
- [Kotlin：Inline value classes](https://kotlinlang.org/docs/inline-classes.html)
