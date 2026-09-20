---
title: Project Valhalla：Value Object 的 JVM 底层模型
date: 2026-09-20
excerpt: 深入 value class 的身份约束、对象头、相等性、构造协议、标量化与物化、调用约定、反射和并发原子性，理解“没有身份”如何变成 JVM 的优化自由。
chapter: 数据布局与值语义
chapterOrder: 6
---

Value Object 最容易被误解成“Java 的栈上对象”。这既不准确，也低估了 Valhalla 的设计。

对象放在栈、寄存器还是堆，是一次具体执行的物理决策；身份是否存在，是程序在所有执行中都必须遵守的语义。只有先消除身份，JVM 才能在调用、字段、数组、解释器、JIT 和 GC 之间自由改变表示。

JEP 401 在 JDK 28 预览的关键贡献，就是把“这个实例没有身份”从优化器的临时证明，提升为 class file 与运行时都理解的永久事实。

## 身份到底包含什么

Java 对象身份不只是内存地址。移动式 GC 可以改变对象物理地址，但引用仍指向同一逻辑对象。身份是一组可观察能力：

- 引用相等判断；
- monitor ownership 与 `synchronized`；
- `System.identityHashCode`；
- `IdentityHashMap` 的 key 语义；
- 弱引用、终结机制和某些 JVMTI/JNI 观察；
- 多个引用是否指向同一可变状态。

只要其中任何一个能力保留，JVM 就不能随意复制对象。若把同一个 identity object 拆成两份，两个 monitor、两个 identity hash 或两份可变状态会让程序观察到差异。

Value Object 的核心不变量是：复制、合并与重建等价实例不会改变程序结果。

## 值类为什么必须受到限制

一个具体值类通常具备这些性质：

- 没有对象身份；
- 实例字段在初始化后不可重新赋值；
- 具体类不可再被继承，以固定状态形状；
- 不能把实例当作 monitor；
- 不能依赖 identity-sensitive operation；
- 可以有多个字段、构造器和普通方法；
- 可以实现接口，并参与受限的值类继承模型。

这些不是语言刻意“阉割对象”，而是优化成立的证明条件。

若允许子类增加字段，运行时只看到静态类型时就不知道值有多大；若允许字段变化，两份标量化副本会分叉；若允许锁对象，重新物化时无法知道哪一个实体应拥有 monitor。

## 对象头为什么可能消失

普通 HotSpot 对象需要 header 来保存或关联：

- GC 标记与年龄信息；
- klass pointer；
- identity hash 或锁状态等运行信息。

独立存在的 value object 仍可能在堆中以某种对象形式物化，此时实现仍需要足够的运行时元数据。但在扁平字段或数组中，元素类型由容器元数据已知，元素没有独立 identity hash 和 monitor，也不需要每个元素都重复一个普通对象头。

```text
引用数组：
[ref][ref][ref]  --->  [header|x|y] [header|x|y] [header|x|y]

平坦数组：
[array header | x|y | x|y | x|y]
```

这里的节省不只是一份 header。还同时消除了元素引用、对象对齐缝隙、独立分配和引用追踪。

但 JEP 401 本身没有保证所有 `Point[]` 都采用第二种布局。nullable 元素、原子更新、VM 策略和后续 null-restricted storage 都会影响选择。

## `==` 不再能表达身份

值对象没有“是不是同一个实例”的问题。对它执行引用身份比较要么没有意义，要么可能泄露 VM 当前是否复用了某个物化对象。

如果 JVM 有时把 `Point(1, 2)` 保存在寄存器，有时临时装箱成堆对象，那么让 `==` 暴露物化次数会把优化策略变成程序语义。这正是 JEP 401 必须重新约束身份敏感操作的原因。

应用代码应使用值语义：

```java
if (left.equals(right)) {
    // 比较内容所代表的值
}
```

对值类而言，`equals` 与 `hashCode` 必须与状态等价关系一致；具体生成和覆盖规则应以目标预览版本规范为准。不要通过 identity hash、对象地址或 native handle 为值对象制造“伪身份”。

## 锁为什么被禁止

下面的设计依赖对象身份：

```java
synchronized (account) {
    updateLedger();
}
```

锁住的是某个特定对象。若 `account` 是值，运行时可能存在零个、一个或多个临时物化副本，无法定义“这把锁属于哪个副本”。即使字段内容相同，也不能推断所有相同值都应共享一把全局锁。

因此值对象不能充当 monitor。需要同步时，应锁定稳定的 identity object，或者使用 `Lock`、原子变量、actor/消息传递等显式协调机制：

```java
final class AccountCell {
    private final ReentrantLock lock =
        new ReentrantLock();
    private Money balance;
}
```

`Money` 可以是值，`AccountCell` 是拥有生命周期与同步责任的实体。这样的分层也更符合领域模型。

## 构造期间为什么需要特殊状态

值对象初始化完成后必须不可变，但构造器需要逐个写入字段。JVM 因而要区分对象的构造阶段与正常阶段。

概念上可以看成：

```text
分配未完成实例
    ↓
early larval：写入必须先于 super 调用的严格字段
    ↓
late larval：继续完成允许的初始化
    ↓
初始化完成：字段冻结、对象可安全发布
```

JEP 539 的 Strict Field Initialization 把这件事下沉到字节码验证层：被标为严格初始化的字段必须在规定的构造阶段写入，读取未初始化字段会被拒绝。这为值对象、null-restricted 字段和可靠的默认值语义提供基础。

它解决的是“验证器如何确信字段已赋值”，不等于 Java 所有 `final` 字段都自动变成某种新语法。语言编译器负责生成符合协议的 class file，VM verifier 负责拒绝违规字节码。

## 为什么旧的零初始化不够

传统 JVM 分配对象后先把内存清零。对引用字段，零就是 `null`；对 `int`，零是合法默认值。构造器随后再覆盖字段。

null-restricted value 字段不能以 `null` 作为临时状态。若它的全零字段组合又不是合法领域值，VM 也不能假装“零就是默认实例”。例如：

```java
value class Ratio {
    int numerator;
    int denominator; // 业务上不能为 0
}
```

把清零内存解释为 `Ratio(0, 0)` 会制造构造器不允许的状态。严格初始化让 VM 能保证字段在对象逃逸或被读取前已经写入真实值，而不是依赖一个虚构的默认对象。

## 标量化比“栈上分配”更准确

考虑：

```java
Point midpoint(Point a, Point b) {
    return new Point(
        (a.x() + b.x()) / 2,
        (a.y() + b.y()) / 2
    );
}
```

优化后不一定存在一块名为 `Point` 的栈内存。`a.x`、`a.y`、`b.x`、`b.y` 和结果可能一直待在寄存器，甚至部分表达式被常量折叠或消除。

因此三个概念要分开：

| 概念 | 含义 |
|---|---|
| stack allocation | 在栈帧中保留一块对象形状的存储 |
| allocation elimination | 完全不执行原始堆分配 |
| scalar replacement | 用若干独立标量代替聚合对象 |

Valhalla 的价值主要在后两者，并把优化机会扩展到普通逃逸分析难以稳定覆盖的边界。

## 调用边界如何传递值

JVM 内部可以根据编译层级和平台 ABI 选择：

- 若干寄存器；
- 栈槽中的字段序列；
- 指向临时缓冲区的引用；
- 物化的盒装对象；
- 解释器与已编译代码之间的适配 stub。

调用者和被调用者不必永久采用同一物理形态，只需通过 VM 约定交换等价状态。JIT 可以针对热点调用点去虚拟化、内联并消除适配；冷代码则可能使用更通用表示。

这也是为什么公共语言规范不应承诺“两个 `int` 一定放在两个寄存器”。语义稳定，表示可以随 CPU、GC、编译层级和未来 JVM 实现演进。

## 物化：当抽象需要重新变成对象

即使热点代码把值拆成标量，某些操作仍需要对象视图：

- 调试器要展示变量；
- 反射 API 需要返回 `Object`；
- 老式 erased generic 或接口调用需要引用载体；
- JNI/FFM 边界要求稳定的参数表示；
- deoptimization 要从编译帧恢复解释器状态。

JVM 可以在这些边界上物化一个等价值对象。因为程序不能观察其身份，稍后丢弃并再次物化另一个副本也合法。

deoptimization 尤其关键。优化代码可能已经把一个值拆散在多个寄存器；当类假设失效或需要进入解释器时，调试信息必须描述如何重建逻辑对象。这与 HotSpot 今天对逃逸分析后的标量替换对象做重建类似，但 Valhalla 将无身份信息变成更强、更普遍的依据。

## 字段和数组的扁平化不是同一个问题

### 字段

```java
class Segment {
    Point start;
    Point end;
}
```

若位置保证非空且布局允许，VM 可以把它近似展开为四个整数。好处是一次分配和更少间接访问；代价是 `Segment` 本身变大，复制、扫描与字段更新策略更复杂。

### 数组

```java
Point[] points = new Point[n];
```

平坦数组可以让元素连续，却必须同时处理：

- 未初始化元素表示什么；
- 数组 store 的 null 检查；
- 单个元素读写是否原子；
- 并发更新能否观察到撕裂状态；
- 数组协变与运行时类型检查；
- GC 如何找到元素内部引用。

因此数组往往比字段更难。一个看起来只是“去掉指针”的布局变化，会穿过 Java 内存模型、verifier、GC 和反射 API。

## 原子性与 tearing

普通对象引用的读写是一个引用宽度的操作。若一个 value object 被展开成 128 位甚至更大内容，硬件未必能一次原子读写全部字段。

假设值是：

```java
value class Range {
    long low;
    long high;
}
```

线程 A 从 `(0, 10)` 更新到 `(20, 30)`，线程 B 若读到 `(20, 10)`，就观察到了从未构造过的值。默认允许这种 tearing 会破坏值类构造器建立的不变量。

JVM 需要在布局密度与原子性之间权衡：

- 保持间接引用，从而原子替换引用；
- 对支持的宽度使用原子指令；
- 使用锁、版本或其他运行时协议；
- 在特定声明或访问模式下允许更弱原子性。

最终规则必须以对应 JEP 和 JMM 规范为准。工程上不要假设“flattened 就必然 lock-free”，也不要在没有同步关系时并发读写复合值。

## GC 如何扫描平坦值

若值类只包含 primitive fields，平坦数组就是一段无引用数据，GC 扫描成本可能显著下降。

若值类含引用：

```java
value class NamedPoint {
    int x;
    int y;
    String name;
}
```

展开后，GC 仍必须知道每个元素中 `name` 的偏移，并执行相应读写屏障、卡表标记或染色指针处理。数组不再保存“指向对象的引用”，不代表其中没有 GC-managed reference。

类元数据需要向 GC 提供布局描述；不同收集器还可能对引用编码和 barrier 有不同实现。Valhalla 的 VM 工作量很大，原因就在于它不是简单的 Java 语法糖。

## 反射、序列化和 native 边界

值类仍需要与现有生态交互，但工具不能继续假设每个逻辑对象都有稳定地址和身份。

### 反射

反射读取值字段时可能触发物化。依赖 `Object` 实例身份缓存结果的框架需要重新审视；按 `Class` 与成员描述缓存通常更稳妥。

### 序列化

值对象适合按字段序列化，但 Java 原生序列化、JSON 库、ORM mapper 和 schema registry 都要识别预览 class file 与构造协议。不要因为类型“看起来像 record”就假定所有库已兼容。

### JNI 与 FFM

JNI 的 `jobject` 模型长期以引用和句柄为中心。VM 可以在边界物化，但这可能丢失预期性能。大量数值数据更适合通过 Panama 的 `MemorySegment` 和明确 `MemoryLayout` 批量传递，而不是逐个把 value object 穿过 native 边界。

## 与逃逸分析的关系

逃逸分析不会因 Valhalla 消失，两者相互叠加：

- value class 提供全局语义：没有身份、状态固定；
- escape analysis 判断本次执行中引用是否越过边界；
- inlining 暴露更多标量化机会；
- profile 引导 JIT 选择高收益布局和调用适配。

普通 identity object 在证明不逃逸时仍可被消除；value object 在必须跨边界时也可能物化。区别是值类从源头移除了最难证明的一组身份约束。

## 性能测试必须观察布局而非只看吞吐

验证 Valhalla 收益时至少测量：

- 单元素实际 footprint 与数组总大小；
- allocation rate、TLAB refill 和 GC pause/work；
- L1/L2/LLC miss、memory bandwidth 与 TLB miss；
- JIT 是否标量替换，是否在边界重新装箱；
- nullable 与 null-restricted 版本的差异；
- 小值与大值的复制成本；
- 单线程读取、并发发布和并发更新；
- 反射、泛型、接口调用是否导致物化。

JMH benchmark 要消费结果、控制 warmup，并检查生成代码。只看到 `new Point` 出现在源码中，不能推断运行时发生了分配；只看到 value class，也不能推断数组一定已经 flatten。

## 结论：没有身份是一份跨层优化许可证

Value Object 的底层价值来自一条强语义：任何等价副本都可替换当前值。它允许 JVM：

- 省略独立对象头；
- 在字段和数组中选择平坦布局；
- 跨调用边界拆成标量；
- 在需要对象视图时临时物化；
- 在 deoptimization 时重建逻辑值；
- 减少分配、引用边与 GC 工作。

这些能力要求值类放弃 monitor、identity hash、别名可变性和可扩展的实例形状。限制与收益是同一个设计的两面。

JEP 401 先让 JVM 能可靠地知道“这不是实体”；JEP 539 确保构造期间不会暴露虚假默认状态。真正理解 Valhalla，要关注这份语义契约，而不是把它缩写成“对象终于上栈了”。

## 延伸阅读

- [JEP 401：Value Objects（Preview）](https://openjdk.org/jeps/401)
- [JEP 539：Strict Field Initialization in the JVM（Preview）](https://openjdk.org/jeps/539)
- [State of Valhalla：The Language Model](https://openjdk.org/projects/valhalla/design-notes/state-of-valhalla/02-object-model)
- [State of Valhalla：The JVM Model](https://openjdk.org/projects/valhalla/design-notes/state-of-valhalla/03-vm-model)
- [Project Valhalla Early-Access Builds](https://openjdk.org/projects/valhalla/early-access)
