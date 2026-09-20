---
title: Project Valhalla：Null Restriction、扁平数组与内存布局
date: 2026-09-20
excerpt: 从 nullable 引用的表示成本出发，拆解 null-restricted storage、严格字段初始化、默认值、数组扁平化、GC 扫描、原子性与迁移兼容性，并明确 JDK 28 已预览能力与后续草案的边界。
chapter: 数据布局与值语义
chapterOrder: 7
---

声明一个 value class，只回答“对象有没有身份”，没有回答“这个字段能不能为 `null`”。

这两个问题必须分开。无身份让 JVM 可以复制和拆解值；排除 `null` 才让某个存储位置能够只保留字段内容，而不必同时编码“这里没有值”。

截至 JDK 28，Value Objects 与 Strict Field Initialization 已进入预览，Null-Restricted Types/Storage 仍属于后续设计工作。本文用 `Point!` 等写法解释当前草案思路，不把它当作已经定稿的 Java 语法或 JDK 28 正式能力。

## 为什么 nullable 会阻碍最紧凑的布局

假设有一个二维点：

```java
value class Point {
    int x;
    int y;
}
```

如果字段允许 `null`：

```java
class Particle {
    Point position;
}
```

JVM 必须表示至少两类状态：

```text
null
Point(x, y)
```

若直接内联为两个 `int`，所有 64 位组合都可能是合法点，不能天然选一个组合作为 null sentinel。于是实现需要：

- 额外 null bit；
- 每个对象或数组的 null bitmap；
- 保留某种非法字段组合；
- 或继续用引用，`0` 引用自然代表 `null`。

只有存储位置明确承诺“永不为 null”，JVM 才能稳定采用：

```text
[x | y]
```

而不是：

```text
[null marker | x | y]
```

## Null restriction 是使用位置属性

“值类”是类声明的属性；“不允许 null”更适合成为字段、变量、参数、返回值或数组元素类型的属性。

草案通常用类似写法表达：

```java
Point! position;   // 草案：明确排除 null
Point? previous;   // 草案：明确允许 null
Point legacy;      // 传统/未指定 nullness
```

设计重点不是标点符号，而是类型系统同时服务两个目的：

1. 让编译器静态检查 nullness；
2. 把可验证的 null restriction 传到 class file 和 JVM，以支持紧凑布局。

普通 nullability annotation 通常只能帮助静态分析。若 VM 看不见或不强制，它就不能把“开发者大概不会写 null”当作数据布局保证。

## 为什么注解不够

今天可以写：

```java
@NonNull Point position;
```

但注解的语义由工具决定：

- 编译器可能忽略；
- 反射或旧字节码可以写入 null；
- 不同注解库含义不同；
- class file verifier 不一定强制；
- JVM 不能据此删除 null 表示。

Null-restricted storage 需要运行时强约束：所有写入路径都检查，构造器必须及时初始化，反射、method handle、unsafe/native 边界也不能绕过。

一旦 JVM 真的用 `[x|y]` 存储字段，写入 null 已不只是“晚一点抛 NPE”的问题，而是根本没有可写入的 null 物理状态。

## 最大难题：对象刚分配时字段是什么

JVM 传统分配流程先清零内存：

```text
new object
    ↓
all bytes = 0
    ↓
constructor writes fields
```

对 nullable 引用，零就是 `null`；对 primitive，零是语言规定的默认值。null-restricted value 字段却不能临时为 `null`。

一种诱人的做法是把 value class 的全零状态当作默认值，但它会产生严重问题：

- 构造器可能禁止该状态；
- 引用字段的零仍是 null；
- 类型不变量可能要求非零、非空或校验和一致；
- 用户会无意得到一个绕过构造器的实例。

因此 Valhalla 不应依赖“每个值类都有一个神奇默认值”，而需要可靠的初始化协议。

## JEP 539：严格字段初始化补上构造缺口

Strict Field Initialization 在 JVM 层引入可验证的字段初始化约束。简化理解：

- class file 可以标记需要严格初始化的字段；
- 构造器必须在规定阶段写入字段；
- verifier 跟踪未初始化的 `this` 与字段状态；
- 在字段完成初始化前，禁止读取或不安全地泄露对象；
- 非法字节码在类验证时被拒绝，而不是等到线上出现布局损坏。

这项机制不仅服务 value class。任何需要“不能观察默认零值”的字段语义，都需要比传统 definite assignment 更强的 VM 保证。

Java 编译器本来会检查 blank final field，但 JVM 必须面对所有 class file 生产者。只有 verifier 也理解严格字段，跨语言编译器、字节码生成库和 agent 才不能绕过约束。

## 构造顺序为什么牵涉 `super()`

Java 构造器传统上先调用父类构造器，再初始化当前类字段。问题是 `super()` 可能通过虚调用、回调或异常路径间接观察尚未初始化的子类对象。

严格初始化模型需要划分构造阶段，并限制字段何时写入、`this` 何时可用。JEP 539 使用 early-larval 等概念描述对象尚未成为完整实例的阶段。

这与 Flexible Constructor Bodies 的语言工作相互呼应：允许在显式构造器调用前执行受限语句，并不意味着可以任意使用未初始化的 `this`。语言规则与 verifier 状态机必须一致，才能既支持计算构造参数，又不破坏对象不变量。

## 扁平字段的收益与代价

假设：

```java
value class Point {
    int x;
    int y;
}

class Segment {
    Point! start; // 草案语法
    Point! end;
}
```

理想布局近似：

```text
[Segment header | start.x | start.y | end.x | end.y]
```

相较两个引用加两个独立对象，它减少：

- 两次子对象分配；
- 两个对象头；
- 两个引用间接层；
- GC 中两个独立对象节点。

但容器对象变大。若 `Segment` 只偶尔读取点，或大量复制整个 `Segment`，更大的对象体可能增加带宽和复制成本。布局优化应由 VM 和 profile 决定，而不是“一律 flatten”。

## 扁平数组为何价值最大

数值、图形、金融行情和机器学习前后处理常遍历大量同构小对象。引用数组的访问路径是：

```text
array -> element reference -> element object -> field
```

平坦数组则是：

```text
array -> element fields
```

对于 `Point`：

```text
引用数组： [r0][r1][r2]...
对象区域： [h|x|y] [h|x|y] [h|x|y]...

平坦数组： [array header|x|y|x|y|x|y...]
```

收益包括连续预取、更少 cache miss、更低 footprint 和更轻 GC。它让 `Point[]` 有机会接近手写 `int[] xs + int[] ys` 或 interleaved buffer 的效率，同时保留类型封装。

## Array of Structures 与 Structure of Arrays

Valhalla 的自然平坦数组更接近 AoS：

```text
x0 y0 | x1 y1 | x2 y2
```

某些 SIMD 算法更喜欢 SoA：

```text
x0 x1 x2 | y0 y1 y2
```

因此平坦值数组不是所有数据密集计算的终极布局。它主要消除 Java 对象图的额外成本；向量化是否理想，还取决于访问模式。

若算法只读取所有 `x`，SoA 仍可能更高效；若总是成对读取 `x, y`，AoS 局部性更自然。性能敏感代码应与 Vector API、Panama `MemoryLayout` 和真实硬件基准共同评估。

## 数组初始化的语义困境

传统：

```java
Point[] points = new Point[100];
```

每个元素初始为 `null`。null-restricted 数组不能这样做，却也不能无条件构造一百个业务上有效的 `Point`。

可能的设计方向包括：

- 要求元素类型拥有可用默认值；
- 创建后必须通过受控初始化 API 填满；
- 分配处接受初始化函数；
- 使用 verifier/运行时状态跟踪未初始化数组；
- 对部分场景不采用扁平布局。

这说明 null restriction 不只是把 `!` 加到类型名。它会影响数组创建、反射、复制、序列化和异常安全，最终语法与 API 必须以未来 JEP 为准。

## 数组协变是历史兼容包袱

Java 数组是协变的：

```java
Object[] objects = new String[10];
```

每次写入都要运行时检查。对平坦值数组，元素可能根本不是一个普通引用槽，`Object[]` 视图又期望可写入任意兼容引用。

JVM 需要保留语言语义，可能通过特殊数组种类、适配、限制或退回非平坦表示处理。泛型集合没有数组协变，却受擦除和装箱约束；这也是 Valhalla 同时推进数组增强与泛型特化的原因。

## GC 扫描与 barrier

只含 primitive 的平坦值数组可以被 GC 当作无引用区域跳过。包含引用字段的值数组则需要布局图：

```java
value class Quote {
    long price;
    String symbol;
}
```

概念布局：

```text
price0 symbolRef0 | price1 symbolRef1 | ...
```

GC 要知道每个元素中 reference slot 的步长和偏移；写入 `symbol` 时仍要执行 write barrier；压缩指针、ZGC 染色引用等机制仍然存在。

所以“无对象头”不代表“GC 完全不用管”。收益来自减少独立对象与引用边，而不是让值内部引用脱离 GC。

## 原子性、volatile 与撕裂

扁平复合值可能超过硬件原子宽度。数组元素从旧值更新到新值时，另一线程不能随便看到两者字段混合，否则构造不变量失效。

对并发共享的复合值，要区分：

- 不可变值本身：字段不变；
- 保存该值的变量：可以从一个完整值替换为另一个；
- 这次替换是否具有原子性和 happens-before。

`final` 只保证值内部状态固定，不自动让容器字段的替换成为宽原子操作。`volatile`、VarHandle 和未来的 value atomicity 规则需要共同定义实现。

工程上最安全的假设仍是：没有明确同步协议，就不要让多个线程并发替换同一个大值位置。若更新频繁，保持引用间接层有时反而是正确布局。

## Null restriction 与 Kotlin null safety 不同

Kotlin 的 `T`/`T?` 主要是语言静态类型系统；在 JVM 字节码中，许多 nullness 信息通过 metadata 和 annotation 表达，Java、反射或未检查边界仍可能传入 null。

Valhalla 的 null-restricted storage 若要驱动布局，就必须由 JVM 运行时强制。两者目标重叠但层级不同：

| 维度 | Kotlin null safety | Valhalla null restriction 方向 |
|---|---|---|
| 主要执行者 | Kotlin 编译器 | Java 编译器 + class file + verifier + JVM |
| 主要收益 | 静态避免 NPE | 静态安全 + 可依赖的存储契约 |
| Java 互操作 | platform type 可能不确定 | 需兼容旧签名并在边界检查 |
| 对布局影响 | 通常不构成 VM 强保证 | 目标是允许平坦字段与数组 |

未来 Kotlin/JVM 可以利用 JVM 原生限制，但必须处理 Kotlin metadata、平台类型和旧库 ABI，不能把两套 `!/?` 语法简单等同。

## 二进制兼容与迁移

给现有公共字段或方法参数突然加 null restriction，可能让旧调用方在运行时失败。迁移需要兼顾源代码、class file descriptor、反射和序列化格式。

较稳妥的策略是：

- 新 API 从一开始就明确 nullness；
- 旧 API 保持兼容入口，在边界校验并委托；
- 内部存储先改成 null-restricted，再逐步收紧公共签名；
- 数据库、JSON 和消息 schema 明确缺失值与默认值；
- 不用全零值偷偷代表“未设置”。

类库还需考虑单独编译：新客户端调用旧库、旧客户端调用新库、反射生成调用和动态代理都必须有定义明确的行为。

## 性能验证方法

要证明扁平布局有效，不能只看源码或类声明，应检查：

- 数组实际 element scale 与 base offset；
- heap dump/JOL 类工具是否已支持目标预览版本；
- allocation rate 与 live object count；
- GC remembered set、scan time 与 barrier 成本；
- 遍历吞吐、随机访问和更新成本；
- nullable 与 null-restricted 位置是否选择不同布局；
- 大数组初始化成本；
- 多线程替换时的原子性实现与延迟。

预览实现可能为了正确性暂时采用保守布局。早期基准既不能承诺最终性能，也不能因一次没有 flatten 就判断设计无效。

## 结论：没有 null，布局才真正获得确定性

Value Object 让复制和拆解合法；Null restriction 让某个存储位置不必保留“缺失”状态。两者结合，JVM 才能把：

```text
reference -> object
```

可靠地变成：

```text
inline fields
```

这条路径还依赖 JEP 539 的严格初始化，避免新对象在构造期间暴露非法默认状态；依赖 JMM 定义复合值更新的原子性；依赖 GC 理解平坦值内部的引用布局。

因此扁平数组不是一个局部优化开关，而是类型系统、class file、verifier、内存模型和 GC 的共同结果。JDK 28 已经交付语义和初始化基础，后续 null-restricted storage 才会把它进一步变成可预测的堆布局契约。

## 延伸阅读

- [JEP 401：Value Objects（Preview）](https://openjdk.org/jeps/401)
- [JEP 539：Strict Field Initialization in the JVM（Preview）](https://openjdk.org/jeps/539)
- [Project Valhalla 当前路线](https://openjdk.org/projects/valhalla/)
- [Valhalla Legacy Links：已被取代的历史设计](https://openjdk.org/projects/valhalla/legacy)
- [State of Valhalla：The JVM Model](https://openjdk.org/projects/valhalla/design-notes/state-of-valhalla/03-vm-model)
