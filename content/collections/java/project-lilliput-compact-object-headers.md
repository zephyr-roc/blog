---
title: Project Lilliput：HotSpot 如何压缩 Java 对象头
date: 2026-09-20
excerpt: 从 64 位 HotSpot 的对象头布局出发，拆解 Compact Object Headers 如何把 96 位头部压到 64 位、mark word 与 klass pointer 的位预算、锁与 GC 状态迁移、真实内存收益及其与 Valhalla 的边界。
chapter: 数据布局与值语义
chapterOrder: 9
---

Java 程序里最小的普通对象，可能比它承载的数据还“重”。一个只有两个 `int` 字段的对象，在启用压缩类指针的传统 64 位 HotSpot 上，字段本身是 8 字节，头部却通常占 12 字节；再算上对象对齐，整个对象常常是 24 字节。

Project Lilliput 想削减的正是这类长期存在的固定成本。它的第一阶段已经进入 HotSpot：Compact Object Headers 将常见的 96 位对象头收进 64 位。JDK 24 以实验特性预览，JDK 25 成为可选择启用的正式产品特性，JDK 27 则默认采用紧凑对象头。

这不是把 Java 对象变成值，也不是把所有对象都压小三分之一。它改变的是 HotSpot 对象头的表示：对象身份、字段和引用仍在；每个对象少带一部分固定元数据。理解收益与限制，必须先看原来的 12 字节由什么组成。

## 先分清三个“压缩”

HotSpot 里有几个容易混淆的压缩机制：

| 机制 | 压缩的内容 | 典型影响位置 |
|---|---|---|
| Compressed Oops | 堆中对象引用 | 普通对象字段、引用数组元素 |
| Compressed Class Pointers | 指向类元数据的指针 | 对象头中的 klass word |
| Compact Object Headers | 对象头整体布局 | 每个对象头本身 |

Compressed Oops 把许多 64 位堆引用以较窄编码存储；Compressed Class Pointers 则把 klass 指针从 64 位缩到 32 位。即使两者都启用，传统对象头通常仍是 64 位 mark word 加 32 位 klass word，也就是 96 位、12 字节。

对象对齐通常以 8 字节为单位，所以对象头虽然是 12 字节，分配大小却要向上对齐。若没有压缩类指针，klass word 通常需要 64 位，传统头部则是 128 位、16 字节。具体值取决于 VM、平台和启动参数，不能把某一种布局当成 Java 语言承诺。

## 一个对象头里装着什么

普通 HotSpot 对象可以粗略画成：

```text
传统 64 位 HotSpot（Compressed Class Pointers）

+-----------------------------+-------------------+
| mark word：64 位            | klass：32 位      |
+-----------------------------+-------------------+
| 锁/运行时状态、年龄、identity hash 等 | 类元数据引用 |
+-----------------------------+-------------------+
总计 96 位 = 12 字节
```

这里的 `klass` 是 HotSpot 对对象所属类的运行时描述的引用，不是 Java 层的 `Class` 对象引用。VM 需要它来完成类型检查、字段偏移访问、虚调用分派、GC 扫描等工作。

`mark word` 则是一个多用途状态槽。它参与对象锁状态表示，可承载 GC 年龄与 identity hash，并且在某些运行时转换中会编码或关联额外状态。它不是一组永远同时存在的独立字段：同一批位会根据对象当前状态采用不同解释。

因此，“对象头”并非一个单纯的类型标签。它是解释对象其余内存所需的信息，加上一些运行时协议的入口。

## 压到 64 位：重新安排位，而不是丢掉类信息

Compact Object Headers 的核心思路，是把压缩后的类引用编码进 64 位 mark word 所在的紧凑头部，使 mark、klass 以及少量状态信息共同满足一个 64 位布局。概念上从：

```text
[ 64-bit mark word ][ 32-bit klass word ]
```

变为：

```text
[ lock/state | compressed klass identity | hash/age/GC state ... ]
                 64 位紧凑头部
```

这只是说明“位预算被合并”，不是稳定的逐位规范。实际字段位置、标记位和特殊状态会随 HotSpot 版本及运行时状态变化；应以目标 JDK 对应的 JEP 和源码为准，应用代码不应自行读写这些位。

压缩类引用本身也不是把任意 64 位地址直接塞进少数几位。HotSpot 已有压缩类指针的基址、移位与 klass 编码机制；紧凑头部再为这个编码安排更小的位预算。当前实现因此必须在可表达的类数量、类元数据寻址范围以及其他头部状态之间做设计取舍。拥有极端多动态类、复杂 class-loader 生命周期或特殊 VM 配置的服务，应在目标发行版上做启动与压力验证，而不是假定所有边界都与传统头部完全相同。

以当前紧凑格式使用的 22-bit compressed klass 编码为例，可用编码空间量级约为 `2^22` 个 klass（约 420 万）；保留值与具体地址映射由实现决定。它不是应用能直接观察的 Java 规范上限，但清楚展示了压缩头的代价：klass 身份不能再用传统 32-bit 槽位那样宽裕地表达。大型插件体系、动态代理/字节码生成或持续创建类的服务，应关注类加载数量，并在目标 JDK 上压测极端路径。

更关键的是，对象头状态不是静止的。对象刚分配时、算过 identity hash 之后、发生锁膨胀时、被 GC 搬迁时，HotSpot 都需要保留类型信息并完成状态转换。Lilliput 的工作不是“删掉 32 位”，而是让这些状态能在更小的表示里协同工作。

## 为什么 mark word 和 klass 不能简单拼接

若把 32 位 klass 编码直接复制到原来的 64 位 mark word，位数当然超过 64。若删掉 mark word 的部分位，又要回答：

- 轻量锁或其他锁状态如何表示？
- 膨胀的 monitor 怎样关联回对象？
- identity hash 在何时、以何种表示保存？
- GC 年龄和转发状态放在哪里？
- 类指针编码最多能覆盖多少类与元数据空间？
- 解释器、JIT、GC、JVMTI 与诊断工具是否采用一致协议？

紧凑对象头需要 VM 各子系统共同调整。对象头位宽减少后，某些原来直接写在 mark word 中的状态可能需要改变编码、延迟生成或关联外部结构；执行同步或 GC 操作时，VM 必须能从对象和辅助元数据中恢复出完整状态。

这也是为什么紧凑头不能只靠 Java 编译器实现。Java 字节码完全不描述“字段之前有几个头部字节”，这属于 HotSpot 对象表示和 VM 运行时协议。

## 锁仍然存在，只是表示协议要配合

紧凑对象头不取消 `synchronized`，也不改变 Java 内存模型的 happens-before 规则。变化发生在 HotSpot 如何把对象的同步状态与更小的头部共存。

HotSpot 的锁实现经历过多轮演进。现代轻量锁路径、锁膨胀以及 `ObjectMonitor` 的管理，都需要在对象头空间变小时保持一致。概括地说：

1. 无竞争同步应尽量走低开销快速路径；
2. 竞争加剧时，运行时仍能把锁状态升级为重量级 monitor；
3. 已膨胀的 monitor 必须继续与被锁对象关联；
4. mark/klass 相关信息在状态转换期间不能丢失或混淆。

具体状态编码属于 HotSpot 实现细节，不能从某个 JDK 的位图推导出跨版本的锁协议。对应用而言，正确结论是：紧凑对象头压缩的是表示，不是同步语义；锁的吞吐与延迟仍取决于竞争、临界区和 VM 实现。

## identity hash 与对象身份没有被移除

调用 `System.identityHashCode(obj)` 会要求 VM 为该对象提供稳定的身份哈希语义。对象头变窄后，这类身份状态仍须得到支持，但哈希可能涉及不同的编码/慢路径和头部状态转换。

不要把紧凑对象头理解成“哈希已经挪到旁边”或“身份哈希更便宜”。实现会尽量在常见路径保留性能，但身份哈希本身是额外语义成本；少数大量依赖它的程序应做目标版本基准。

同样，`==`、`IdentityHashMap`、对象监视器和引用别名关系全都保留。对象仍是 identity object，只是它的 HotSpot header 占用更少。

## GC 也在对象头协议之内

移动式收集器要识别对象、遍历字段，并在必要时处理转发或年龄等信息。对象头中不同状态位的可用范围变小后，收集器与对象布局必须协调：

- GC 仍需从类元数据得到对象引用布局；
- 引用字段仍需按收集器要求执行屏障；
- 并发或移动式 GC 仍需维护对象转发/标记信息；
- 头部状态转换不能覆盖类身份或损坏对象解释。

紧凑头可能让遍历堆时每个对象读取更少字节，也可能因 cache 密度改善而间接降低扫描成本；但它不会删除字段中的引用，不会自动减少对象图边数，也不会替代某个 GC 自己的堆结构、记忆集或屏障。

因此收益应在真实收集器和负载上测量。高对象数、浅对象图、单个对象很小的服务更可能受益；主要由大数组、直接内存或大块 primitive 数据主导的程序，未必有明显变化。

## 4 字节的头部差异，何时变成 8 字节的对象差异

假设使用 8 字节对象对齐，并比较常见的 12 字节传统头部与 8 字节紧凑头部：

| 对象组成 | 传统未对齐尺寸 | 传统分配尺寸 | 紧凑未对齐尺寸 | 紧凑分配尺寸 |
|---|---:|---:|---:|---:|
| 空对象 | 12 B | 16 B | 8 B | 8 B |
| 两个 `int` | 20 B | 24 B | 16 B | 16 B |
| 一个 4 B 引用字段 | 16 B | 16 B | 12 B | 16 B |

表格是对常见布局的算术示例，不代替运行时测量。它说明两件容易被忽略的事：

- 头部少 4 字节，不代表每个对象的分配尺寸都少 4 字节；对齐会让节省变成 0 或 8 字节。
- 只有小对象的固定头部占比高；对象字段越多，头部节省占整体越小。

引用数组的每个元素仍是引用槽。紧凑对象头不会把 `Object[]` 的元素从 4/8 字节变成更小，也不会自动把 `Point[]` 的每个元素扁平化。若数组中有一百万个独立小对象，受益来自那一百万个元素对象各自更小，而不是引用数组本身突然换了元素布局。

数组对象本身通常有数组长度等额外头部状态，且对齐可能掩盖头部缩减；不能不加区分地把普通对象的 12→8 直接套用到所有数组对象。

## Compressed Oops、Lilliput 与 Valhalla 的边界

三者处理的是堆表示的不同部分：

```text
普通引用字段 / Object[] 槽位  ← Compressed Oops
每个 identity object 的头部  ← Project Lilliput
值元素是否需要独立对象/头部   ← Project Valhalla
```

Compact Object Headers 不会缩短普通字段中的对象引用，不会减少引用数组槽位，也不会让 `List<Point>` 自动变成平坦存储。

Valhalla 则从类型语义出发：value object 没有可观察身份，JVM 才有机会在某些字段和数组中拆开值、消除独立对象，因而连对象引用或每元素对象头都不需要。Lilliput 面对的恰好是仍然保留身份的普通对象：它承认这些对象继续独立存在，只让每个对象携带的固定元数据更紧凑。

所以二者互补，但不是同一项目的两个名称：

| 方案 | 优化对象 | 是否保留 identity | 主要收益来源 |
|---|---|---|---|
| Lilliput / Compact Object Headers | 普通 HotSpot 对象头 | 是 | 降低每个对象的固定字节与堆扫描工作集 |
| Valhalla / Value Objects | 可无身份的值对象 | 否 | 允许标量化、扁平字段/数组与消除独立对象 |

在一个包含数百万业务实体的图里，Lilliput 可以压低实体节点成本；而对坐标、金额等纯值数据，Valhalla 的平坦化理论上能跳过“每个值都是单独对象”这层成本。两者都可能改善 cache locality，却作用在不同表示边界。

## JEP 的交付阶段，不要把实验状态写成现状

Compact Object Headers 的版本路径需要按 JDK 区分：

| JDK | 状态 | 运行时含义 |
|---|---|---|
| JDK 24 | JEP 450：Experimental | 可显式启用进行试验；不应作为生产默认假设 |
| JDK 25 | JEP 519：正式产品特性 | 产品化、测试成熟，可通过 VM 参数选择启用 |
| JDK 27 | JEP 534：默认启用 | HotSpot 默认使用紧凑头；必要时可依目标发行版的支持参数调整 |

JEP 450 的“Experimental”说的是特定 JDK 版本里的产品状态，不等于后续版本仍是实验性。JDK 25 的正式交付也不意味着所有 Java 虚拟机实现都必须采用相同布局；这是 HotSpot 的实现特性，不是 Java SE 对象表示规范。

JDK 24 的实验版本通常需要：

```bash
java -XX:+UnlockExperimentalVMOptions -XX:+UseCompactObjectHeaders -version
```

在产品化后的 JDK 25，可根据发行版用：

```bash
java -XX:+UseCompactObjectHeaders -version
```

到默认启用的 JDK 27，验证运行时实际值比猜测更可靠：

```bash
java -XX:+PrintFlagsFinal -version | grep UseCompactObjectHeaders
```

旧版本、不同厂商发行版、容器镜像和特定架构可能有差别；生产升级要以目标 JDK 的 `PrintFlagsFinal`、启动日志和兼容测试为准。JVM 参数仅用于选择 HotSpot 实现，不能写成应用程序的正确性前提。

## 类数量、工具与部署边界

紧凑头部需要在有限位数里表达 compressed klass identity 及运行状态。这会带来必须审视的实现边界，例如可编码的类数量和类元数据地址空间。绝大多数服务的 class 数远低于上限，但大型插件体系、动态代码生成、应用服务器多租户 class loader 或长期运行且不断生成类的进程，更应该关注类加载规模和卸载行为。

还要检查对 JVM 内部对象布局有假设的工具：

- JNI/native agent 若按固定偏移读取对象头；
- heap dump、profiling、调试或诊断组件；
- Unsafe/非标准 VM API 访问头部位的代码；
- 依赖对象布局的序列化或内存分析工具。

遵守公开 JNI/JVMTI 约定的工具不应把普通对象头布局视为应用 ABI；但依赖 HotSpot 私有实现细节的工具，需要确认版本兼容。正确的 Java 程序不应通过 Unsafe 解码 header 来推断锁状态或身份哈希。

## 应该如何做性能验证

不要只用“类实例数 × 4 字节”估算节省。先从堆中找出真正的小对象热点，再进行 A/B 测试：

1. 使用同一 JDK build、GC、堆大小、压缩引用配置与应用参数；只改变 `UseCompactObjectHeaders`。
2. 固定数据集、请求回放、预热时长和采样窗口，分别观察启动与稳态。
3. 对比存活集/堆转储、类直方图、分配速率、GC CPU 与停顿、RSS、吞吐和尾延迟。
4. 结合对象布局工具确认被测 JVM 的对象大小；JOL 等工具必须支持当前 JDK 的 header 格式。
5. 至少覆盖有无 `identityHashCode`、同步热点、不同收集器以及动态类加载的关键路径。

固定 `-Xmx` 时，JVM 进程已提交的堆可能不会缩小；真正变化可能体现为同一堆里容纳更多存活对象、降低 GC 频率，或把部分工作集留在更近的 cache。也可能出现吞吐变化很小、RSS 不变、某个锁/哈希路径退化的结果。它们都不矛盾，因为对象头只占整个运行时的一部分。

微基准可以解释单对象访问和分配差异，却不能直接预测服务端收益。最重要的问题是：你的堆里有多少小型 identity object，它们是否位于访问和 GC 热路径上，以及缩小头部之后新的瓶颈在哪里。

## 一个可复用的估算框架

若工作负载里有 `N` 个普通对象，单对象平均净节省为 `s` 字节，则对象体理论节省近似：

```text
saved_bytes ≈ N × s
```

但 `s` 不是固定 4 字节：对齐会使它取决于实例字段尺寸和数组布局。真正能反映系统效果的估算还要扣除或考虑：

- 对象总数里非 HotSpot 普通对象的比例；
- 大对象、数组和 primitive 数据的占比；
- 对象图可达性与 GC 活跃数据比例；
- 元数据、线程栈、代码缓存、直接内存和 native RSS；
- `-Xmx` 保持不变带来的 committed heap 上限。

因而更靠谱的做法是用目标堆快照和运行时布局实测 `s`，再用 A/B 的 GC 与延迟数据验证系统效应。只有当对象头占活跃堆的重要比例，容量、带宽或 GC 压力才可能呈现可观改善。

## 结论：Lilliput 减轻的是身份对象的固定税

Compact Object Headers 让 HotSpot 把常见的 12 字节对象头压到 8 字节，同时继续支持对象的类型身份、同步、identity hash 与 GC 状态。它的价值不是“每个 Java 对象都精确省 4 字节”，而是让大量小型 identity object 少占固定空间，并可能改善堆密度和 cache locality。

这个改动必须同时协调 klass 编码、mark word、锁状态、GC、对象检查工具和运行时诊断。正式产品能力已经随 JDK 演进进入默认路径，但头部仍是 HotSpot 私有布局：性能结论需要在目标 JDK 和真实工作负载上测量。

把它放回现代 Java 的数据布局路线中，边界就很清楚：Compressed Oops 压引用，Lilliput 压普通对象的头部，Valhalla 则让某些值根本不再需要独立对象。三者可以协同，任何一个都不能代替另外两个。

## 延伸阅读

- [Project Lilliput](https://openjdk.org/projects/lilliput/)
- [JEP 450：Compact Object Headers (Experimental)](https://openjdk.org/jeps/450) — JDK 24
- [JEP 519：Compact Object Headers](https://openjdk.org/jeps/519) — JDK 25
- [JEP 534：Compact Object Headers by Default](https://openjdk.org/jeps/534) — JDK 27
- [HotSpot markWord 源码](https://github.com/openjdk/jdk/blob/master/src/hotspot/share/oops/markWord.hpp)
- [HotSpot compressedKlass 源码](https://github.com/openjdk/jdk/blob/master/src/hotspot/share/oops/compressedKlass.hpp)
- [Project Valhalla](https://openjdk.org/projects/valhalla/)
