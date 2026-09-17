---
title: Project Panama：Java 如何重新定义 Native 边界
date: 2026-09-17
excerpt: 从 JNI 的历史包袱进入 Foreign Function & Memory API，理解 MemorySegment、Arena、MemoryLayout、Linker、downcall、upcall、jextract，以及 Java 与 C、Rust 和 Kotlin 的现代互操作边界。
chapter: 现代 Java 与平台边界
chapterOrder: 1
---

如果只从 Spring、集合和面向对象开始理解 Java，很容易把它看成一座封闭的托管世界：对象留在 GC heap 中，机器码由 JVM 生成，操作系统与本地库被 JNI 隔在另一侧。

Project Panama 改变的正是这条边界。

它并不是给 Java 增加一个更短的 `native` 关键字，而是尝试让 JVM 用自身已经擅长的类型描述、生命周期检查、MethodHandle 和 JIT 优化，直接理解：

- 一段堆外内存有多大、何时失效、能被哪些线程访问；
- 一个 C 函数的参数、返回值和调用约定是什么；
- C struct 的大小、对齐、padding 和字段偏移如何表达；
- Java 如何调用 native function，也如何把 Java 方法暴露成 callback；
- 显式 SIMD 如何映射到 x64、AArch64 等平台的向量指令。

对长期使用 Kotlin/JVM 的开发者，Panama 也揭示了一个重要变化：现代 JVM 不再满足于“通过 JNI 勉强接上 native 世界”，而是在建立一套可分析、可组合、可优化的平台边界。

## 先厘清：Project Panama 不只是一套 FFI

Panama 是 OpenJDK 中改进 Java 与非 Java API 互操作的长期项目，今天最重要的成果可以分成三条线：

| 能力 | 解决的问题 | 当前状态 |
|---|---|---|
| Foreign Function & Memory API | 调用外部函数、访问堆外内存 | 从 JDK 22 起正式稳定 |
| jextract | 从 C header 生成 FFM binding | 独立工具，不属于 Java SE 标准 API |
| Vector API | 显式表达可移植 SIMD | JDK 27 仍处于第十二轮孵化 |

因此，“Panama 已经稳定”只能准确地用于 FFM API，不能顺手把 Vector API 也说成正式标准。

这篇文章以稳定的 `java.lang.foreign` 为主线。Vector API 会解释它在整体设计中的位置，但不会把孵化 API 当作普通业务代码的默认依赖。

## 为什么 Java 需要替代 JNI 的现代路径

JNI 能完成几乎所有 native 互操作，但它要求开发者同时维护两套世界之间的胶水。

一个普通 JNI 调用通常需要：

1. 在 Java 中声明 `native` 方法；
2. 生成或手写 C header；
3. 编写 C/C++ wrapper；
4. 通过 `JNIEnv*` 转换字符串、数组和对象；
5. 管理 local/global reference；
6. 在 native 与 Java exception 之间手工翻译；
7. 为每个 OS、CPU 与 C runtime 构建动态库；
8. 确保 native thread attach、GC pinning 和 class loader 生命周期正确。

问题并不只是代码多。JNI 的抽象中心是“native code 操作 JVM 对象”，于是边界逻辑天然落在 C/C++ 中：JVM 很难看穿 wrapper 的真实意图，Java 类型系统也无法描述 native memory 的大小与生命周期。

FFM 选择了另一条路：

> 不把 C 世界伪装成 Java 对象，而是在 Java 中显式描述 ABI、地址、布局和生命周期。

它减少了中间 C glue，但没有消灭 native 世界的复杂性。调用约定、结构体布局、资源所有权和动态库分发仍然存在，只是这些事实不再隐藏于一层 JNI 模板代码之后。

## FFM 的五个核心抽象

理解 `java.lang.foreign`，不需要先背完整 API。先抓住五个角色：

| 抽象 | 它描述什么 |
|---|---|
| `MemorySegment` | 一段有边界、有生命周期的连续内存 |
| `Arena` | 一组 segment 的分配与释放作用域 |
| `MemoryLayout` | 数据的大小、对齐、顺序和嵌套结构 |
| `SymbolLookup` | 从进程或动态库中查找 native symbol |
| `Linker` | 按平台 ABI 在 native function 与 MethodHandle 间建立链接 |

`FunctionDescriptor` 则是连接 `MemoryLayout` 与 `Linker` 的函数签名描述。

这套设计不是“Java 版裸指针”。它把原本散落在 C header、文档和程序员记忆中的约束变成运行时可检查的对象。

## MemorySegment：地址之外还要有边界与生命期

在 C 中，一个指针本身通常只是一串地址：

```c
double *values;
```

单看 `values` 无法知道：

- 它指向多少个元素；
- 内存是否已经释放；
- 当前线程能否访问；
- 它来自 malloc、mmap、共享内存还是 Java heap；
- 读写时采用什么布局。

`MemorySegment` 把一段连续内存表示为带边界和 scope 的对象。最简单的堆外分配如下：

```java
import java.lang.foreign.Arena;
import java.lang.foreign.MemorySegment;
import java.lang.foreign.ValueLayout;

try (Arena arena = Arena.ofConfined()) {
    MemorySegment values = arena.allocate(
        ValueLayout.JAVA_INT,
        4
    );

    values.setAtIndex(ValueLayout.JAVA_INT, 0, 10);
    values.setAtIndex(ValueLayout.JAVA_INT, 1, 20);
    values.setAtIndex(ValueLayout.JAVA_INT, 2, 30);
    values.setAtIndex(ValueLayout.JAVA_INT, 3, 40);

    int third = values.getAtIndex(
        ValueLayout.JAVA_INT,
        2
    );
}
```

离开 `try` 后 arena 被关闭，继续访问 `values` 会失败，而不是静默读到已经释放的地址。

FFM 在 Java 侧提供两类核心保证：

- **spatial safety**：访问不能越过 segment 边界；
- **temporal safety**：arena 失效后不能继续访问 segment。

这比 `Unsafe`、裸 native address 或随意包装的 `DirectByteBuffer` 更容易建立局部推理。

但要注意保证边界：如果把 segment 的地址传给一个错误的 C 函数，native code 仍然可以越界写、重复释放或保存悬空指针。FFM 约束的是 Java 侧访问和生命周期协议，不可能替一个不安全的 native library 证明内存安全。

## Arena：释放策略是 API 契约的一部分

`Arena` 不只是 allocator，它决定 segment 何时有效以及线程如何访问。

### `Arena.ofConfined()`

由创建它的线程独占访问，关闭时确定性释放。它应是同步 native 调用的默认选择：

```java
try (Arena arena = Arena.ofConfined()) {
    MemorySegment request = arena.allocate(1024);
    // 编码、调用 native、读取结果
}
```

若把 segment 交给另一个平台线程或虚拟线程访问，会违反 confinement。虚拟线程更换 carrier thread 并不会改变它自身的 `Thread` 身份；真正的问题是是否把资源跨任务共享，而不是 carrier 是否变化。

### `Arena.ofShared()`

允许多个线程访问，仍可显式关闭。适合确实跨线程共享的 native state，但关闭与正在执行的访问之间需要清楚协调。

共享 arena 不是“更方便的 confined arena”。它放宽线程限制，也把并发正确性还给调用方。

### `Arena.ofAuto()`

由 GC 判断何时回收，不提供确定性释放。适合生命周期难以显式建模、资源本身又不稀缺的场景，不适合文件描述符、GPU buffer、大块 native memory 或必须及时归还的 handle。

### `Arena.global()`

生命周期与进程相同，不能释放。只适合真正的全局常量、永久映射或进程级 symbol，不应被当作逃避生命周期设计的出口。

如果一个 API 返回 `MemorySegment`，它还必须解释：谁拥有 arena、调用方能使用多久、能否跨线程、native code 会不会在函数返回后继续保存地址。没有这些信息，Java 类型写得再漂亮也只是把悬空指针推迟到运行时。

## MemoryLayout：把 C 数据布局写进模型

FFM 不假设所有数据都只是 Java primitive 的连续数组。`MemoryLayout` 可以描述：

- primitive value；
- 固定长度 sequence；
- struct；
- union；
- address；
- padding；
- 对齐与字节序。

假设 C 有一个结构体：

```c
#include <stdint.h>

struct sensor_sample {
    int32_t sensor_id;
    int64_t timestamp;
    double value;
};
```

在常见 64 位 ABI 中，`sensor_id` 后需要 4 字节 padding，使 `timestamp` 按 8 字节对齐：

```java
import java.lang.foreign.MemoryLayout;
import static java.lang.foreign.MemoryLayout.PathElement.groupElement;
import static java.lang.foreign.ValueLayout.JAVA_DOUBLE;
import static java.lang.foreign.ValueLayout.JAVA_INT;
import static java.lang.foreign.ValueLayout.JAVA_LONG;

static final MemoryLayout SENSOR_SAMPLE =
    MemoryLayout.structLayout(
        JAVA_INT.withName("sensor_id"),
        MemoryLayout.paddingLayout(4),
        JAVA_LONG.withName("timestamp"),
        JAVA_DOUBLE.withName("value")
    );

static final long SENSOR_ID_OFFSET =
    SENSOR_SAMPLE.byteOffset(groupElement("sensor_id"));

static final long VALUE_OFFSET =
    SENSOR_SAMPLE.byteOffset(groupElement("value"));
```

这里最重要的不是语法，而是 ABI 意识：C 的 `long`、`size_t`、alignment 和 struct return rules 会随 OS、CPU 与编译器 ABI 变化。Java 的 `JAVA_LONG` 表示 Java `long` 的布局，不等于所有平台上的 C `long`。

生产 binding 不应凭“我的机器是 64 位”猜布局。应依据目标 header、平台 ABI、`Linker.canonicalLayouts()`，或让 jextract 从 header 生成平台对应的 binding。

## 第一个 downcall：直接调用 C 的 `strlen`

下面的例子不需要手写 JNI wrapper：

```java
import java.lang.foreign.Arena;
import java.lang.foreign.FunctionDescriptor;
import java.lang.foreign.Linker;
import java.lang.foreign.MemorySegment;
import java.lang.foreign.SymbolLookup;
import java.lang.foreign.ValueLayout;
import java.lang.invoke.MethodHandle;

public final class NativeStringLength {
    private static final Linker LINKER =
        Linker.nativeLinker();

    private static final SymbolLookup STDLIB =
        LINKER.defaultLookup();

    private static final MethodHandle STRLEN =
        LINKER.downcallHandle(
            STDLIB.findOrThrow("strlen"),
            FunctionDescriptor.of(
                ValueLayout.JAVA_LONG,
                ValueLayout.ADDRESS
            )
        );

    public static long length(String value) {
        try (Arena arena = Arena.ofConfined()) {
            MemorySegment cString =
                arena.allocateFrom(value);

            try {
                return (long) STRLEN.invokeExact(cString);
            } catch (Throwable error) {
                throw new RuntimeException(error);
            }
        }
    }
}
```

这段代码针对 `size_t` 为 64 位的目标平台。若要支持 32 位 ABI，返回 layout 与 Java carrier type 必须跟着平台变化。

整个调用链可以拆成四步：

1. `SymbolLookup` 找到 `strlen` 的地址；
2. `FunctionDescriptor` 声明 native signature；
3. `Linker` 按当前平台 ABI 生成一个 `MethodHandle`；
4. Java 把 arena 中的零结尾 UTF-8 字符串地址传给它。

`MethodHandle.invokeExact` 要求调用点类型与 descriptor 完全一致。这里的严格不是多余负担：FFM 无法从错误的 ABI 描述中自动恢复。把 `size_t` 错写成 32 位、把 struct pointer 错写成内联 struct，结果可能不是 Java exception，而是寄存器错位或进程崩溃。

## 调用自己的动态库

假设 native library 暴露一个稳定的 C ABI：

```c
#include <stddef.h>

double sum_values(
    const double *values,
    size_t length
) {
    double result = 0.0;
    for (size_t index = 0; index < length; index++) {
        result += values[index];
    }
    return result;
}
```

Java 侧可以先加载 library，再从当前 class loader 可见的 native libraries 中查找 symbol：

```java
import static java.lang.foreign.ValueLayout.ADDRESS;
import static java.lang.foreign.ValueLayout.JAVA_DOUBLE;
import static java.lang.foreign.ValueLayout.JAVA_LONG;

System.loadLibrary("fastmath");

Linker linker = Linker.nativeLinker();
SymbolLookup lookup = SymbolLookup.loaderLookup();

MethodHandle sumValues = linker.downcallHandle(
    lookup.findOrThrow("sum_values"),
    FunctionDescriptor.of(
        JAVA_DOUBLE,
        ADDRESS,
        JAVA_LONG
    )
);

double[] input = {1.0, 2.0, 3.0, 4.0};

try (Arena arena = Arena.ofConfined()) {
    MemorySegment nativeInput =
        arena.allocateFrom(JAVA_DOUBLE, input);

    double result = (double) sumValues.invokeExact(
        nativeInput,
        (long) input.length
    );
}
```

这里仍假设目标平台的 `size_t` 与 64 位 Java `long` 对应。真正跨平台的 binding 应从 canonical layout 或生成代码中获得 C 类型映射。

### 动态库不是 JAR 内的一段普通资源

发布时仍要面对：

- Linux `.so`、macOS `.dylib`、Windows `.dll`；
- x86-64、AArch64 等架构；
- glibc 与 musl 差异；
- transitive native dependency；
- RPATH、loader search path 与代码签名；
- 容器基础镜像的 C runtime；
- symbol version 与最低系统版本。

Panama 简化调用层，不会自动把一个本地库变成跨平台制品。

## Rust 与 Panama：优先稳定 C ABI

Java 不应该直接绑定 Rust 自身不稳定的 ABI。Rust 侧应导出窄小、明确的 C ABI：

```rust
#[unsafe(no_mangle)]
pub extern "C" fn sum_values(
    values: *const f64,
    length: usize,
) -> f64 {
    if values.is_null() {
        return 0.0;
    }

    let values = unsafe {
        std::slice::from_raw_parts(values, length)
    };

    values.iter().copied().sum()
}
```

工程上还必须定义：

- Rust panic 不能穿越 C ABI；
- 谁分配、谁释放；
- 字符串采用 UTF-8 + length，还是零结尾；
- error 使用整数码、out parameter，还是显式 result struct；
- handle 是不透明指针还是整数 token；
- callback 能在哪个线程、何时发生；
- library 与 Java binding 如何共同版本化。

一个可靠的接口常比语言内部 API 更“笨”：primitive、pointer、length、opaque handle 和显式 error code。边界越稳定，Java 与 Rust 两侧越能独立演进。

## upcall：让 native code 回调 Java

`Linker.upcallStub` 可以把 Java `MethodHandle` 暴露为 native function pointer。

概念结构如下：

```java
import java.lang.invoke.MethodHandles;
import java.lang.invoke.MethodType;

static int compare(
    MemorySegment left,
    MemorySegment right
) {
    int leftValue = left.get(
        ValueLayout.JAVA_INT,
        0
    );
    int rightValue = right.get(
        ValueLayout.JAVA_INT,
        0
    );
    return Integer.compare(leftValue, rightValue);
}

MethodHandle target = MethodHandles.lookup()
    .findStatic(
        NativeSort.class,
        "compare",
        MethodType.methodType(
            int.class,
            MemorySegment.class,
            MemorySegment.class
        )
    );

var pointerToInt =
    ValueLayout.ADDRESS.withTargetLayout(
        ValueLayout.JAVA_INT
    );

FunctionDescriptor comparatorType =
    FunctionDescriptor.of(
        ValueLayout.JAVA_INT,
        pointerToInt,
        pointerToInt
    );

try (Arena arena = Arena.ofConfined()) {
    MemorySegment comparator =
        Linker.nativeLinker().upcallStub(
            target,
            comparatorType,
            arena
        );

    // 把 comparator 传给只在当前调用期间使用它的 C API
}
```

upcall 最大的风险不是创建 stub，而是生命周期：

- native library 是否只在当前 downcall 中调用 callback；
- 是否会保存 function pointer，在未来异步调用；
- callback 发生在哪个线程；
- arena 关闭后 native 是否仍持有地址；
- Java exception 如何阻止越过 native frame；
- native lock 与 Java callback 是否会形成死锁。

短生命周期同步 callback 可以由 confined arena 管理。若 native library 长期保存 callback，就需要 shared/global 生命周期、显式注销协议和对并发关闭的严格设计。

## native access 是显式权限，不是静默能力

创建 downcall、upcall 或直接加载 native library 会绕过 JVM 的完整内存安全边界。现代 JDK 会把这类操作视为 restricted native access。

classpath 应用通常显式启用：

```bash
java \
  --enable-native-access=ALL-UNNAMED \
  -jar app.jar
```

命名模块应只授权真正执行 FFM 操作的模块：

```bash
java \
  --enable-native-access=com.example.nativebridge \
  --module-path app.jar \
  --module com.example.app/com.example.Main
```

不要把 flag 当成部署脚本里随手添加的消音参数。更好的结构是把所有 FFM 代码集中到窄小的 adapter module：

```text
business-domain
        ↓
native-port
        ↓
panama-adapter  ← 唯一获得 native access
        ↓
C ABI / Rust library
```

这样安全审计、平台替换、测试替身和 library version 检查都有明确边界。

## jextract：让 header 成为 binding 的来源

手写少量 C 函数很直观，绑定大型库则会迅速遇到：

- 数百个函数；
- typedef 与宏；
- 嵌套 struct/union；
- platform-specific layout；
- function pointer；
- 常量与枚举；
- header 条件编译。

`jextract` 读取 C header，并生成基于 FFM API 的 Java binding。它的价值不只是少打代码，而是让 declaration 更接近 header 的真实布局。

典型流程是：

```bash
jextract \
  --include-function sum_values \
  --target-package com.example.fastmath \
  --output generated-src \
  fastmath.h
```

然后在 Java 中封装生成的低层入口，而不是让业务层直接依赖 generated API。

```java
public final class FastMath {
    public static double sum(double[] values) {
        // arena、转换、错误检查与 generated binding
        // 都被收束在这里。
    }
}
```

jextract 目前是独立工具，不应假设每个 JDK distribution 都自带它。CI 必须锁定 jextract build、目标 JDK、C header 版本和生成参数；生成源码应选择提交仓库或在可重现构建中生成，不能依赖某个开发者机器上的 `/usr/include`。

## Kotlin 如何使用 FFM

FFM 是 Java API，因此 Kotlin/JVM 可以调用它：

```kotlin
Arena.ofConfined().use { arena ->
    val values = arena.allocate(
        ValueLayout.JAVA_INT,
        4,
    )

    values.setAtIndex(
        ValueLayout.JAVA_INT,
        0,
        42,
    )
}
```

但直接把 generated binding 暴露给 Kotlin 业务层通常不够优雅：

- `MethodHandle.invokeExact` 对精确 JVM 签名敏感；
- checked `Throwable`、platform type 与 overload 会污染调用体验；
- `MemorySegment` 生命周期不适合被普通 data class 随意持有；
- C 风格名称、pointer + length 和 error code 不符合 Kotlin API 习惯。

更合理的方式是保留一层 Java 或 Kotlin adapter，把 native contract 转成领域接口：

```kotlin
interface FastMath {
    fun sum(values: DoubleArray): Double
}
```

adapter 内部处理 arena、layout、symbol、错误码和 platform dispatch；调用方只看见稳定的 Kotlin 语义。

这与 Kotlin/Native 的 `cinterop` 不是同一条技术路线：

- Kotlin/JVM + Panama 仍运行在 JVM/HotSpot 上；
- Kotlin/Native 生成 native binary，采用自己的 runtime 与互操作模型；
- 二者都可绑定 C ABI，但内存管理、部署、异常和线程语义不同。

## Android/ART 为什么今天仍是 JNI 世界

桌面与服务器 JDK 中的 `java.lang.foreign` 不能直接等同于 Android API。Android runtime、Bionic、linker namespace、API level、NDK toolchain 与应用沙箱都有自己的约束；现有 Android native interoperability 仍以 JNI/NDK 为主。

从长期设计看，ART 采用类似 FFM 的语义很有吸引力：

- 减少机械 JNI glue；
- 用显式 scope 表达 native memory；
- 让 Kotlin/Java binding 更容易生成；
- 给 runtime 更多可分析信息。

但这只能作为方向判断，不能写成已公布路线。即使 Android 将来采纳，也更可能需要适配 Bionic、linker namespace、API stability 和 ART GC 的 Android 版本，而不是把 HotSpot 实现原样搬过去。

今天交付 Android library 时，仍应按 JNI/NDK 的真实边界设计，不要以“以后可能有 Panama”代替当前兼容性工作。

## FFM 与性能：少一层 glue 不等于零成本

FFM 给 JVM 更多可见信息，`MethodHandle` 也比任意 C wrapper 更容易被运行时组合和优化，但 native transition 仍然存在。

一次 downcall 可能涉及：

- Java carrier 与 ABI location 的映射；
- register/stack arrangement；
- safepoint 与线程状态转换；
- segment scope 与边界检查；
- string/array 编码和复制；
- error state 捕获；
- callback 可达性；
- native library 自身成本。

如果 native 函数只做一次整数加法，边界成本可能比计算本身更大。优化方向通常不是寻找“更神奇的调用选项”，而是扩大每次调用的工作量：

- 批量传数组而不是逐元素调用；
- 使用 struct-of-arrays 或连续 buffer；
- 复用只读 symbol 与 MethodHandle；
- 在明确所有权下复用 native buffer；
- 减少 Java String 与 C string 的往返转换；
- 把循环放在边界的一侧，而不是每次迭代跨边界。

### benchmark 应该测什么

用 JMH 比较 JNI 与 FFM 时至少区分：

1. 空调用或极小函数的 transition latency；
2. 固定大小 buffer 的复制成本；
3. 预分配 segment 与每次重新分配；
4. confined 与 shared arena；
5. downcall 是否包含 callback；
6. 吞吐与 p99 latency；
7. x86-64 与 AArch64；
8. 不同 JDK 与编译参数。

避免把 library load、symbol lookup、header generation 或一次性 warm-up 混进稳态调用基准。FFM 的意义也不只在“是否比 JNI 快 5%”：更少的 glue、更清楚的生命周期和更容易审计的边界本身就是工程收益。

## Vector API：Panama 的另一半为什么还没毕业

Vector API 希望让 Java 显式表达可移植 SIMD，而不是完全依赖 HotSpot SuperWord 自动向量化。

概念上可以写出：

```java
var species = FloatVector.SPECIES_PREFERRED;

for (int index = 0;
     index < species.loopBound(values.length);
     index += species.length()) {
    var vector = FloatVector.fromArray(
        species,
        values,
        index
    );

    vector.mul(0.5f)
        .add(1.0f)
        .intoArray(values, index);
}
```

JVM 根据目标硬件选择合适 vector shape，并把操作映射到 SIMD instruction。

它适合图像、编码、压缩、数值、解析和部分机器学习内核；不适合为了“看起来底层”替换普通业务循环。

截至 JDK 27，Vector API 仍是第十二轮 incubator。长期孵化并不代表实现不可用，而是其最终类型表达仍与 Project Valhalla 等能力有关。生产项目若采用，必须接受：

- 编译和运行需要 `--add-modules jdk.incubator.vector`；
- API 仍可能变化；
- 每次升级 JDK 都要重新验证；
- 必须用 JMH、JIT log 或反汇编证明目标路径真的获益；
- 仍需处理 scalar tail、alignment 与不支持的 operation。

FFM 解决“如何进入 native 世界”，Vector API 解决“如何在 JVM 内显式表达 SIMD”。它们都让 JVM 更接近硬件，但一个是稳定平台接口，一个仍是实验模块。

## Panama 没有解决什么

### 它不是 C/C++ 安全证明器

错误 descriptor、错误 pointer、错误 allocator 协议和 native data race 仍能导致崩溃或内存破坏。

### 它不是 C++ ABI 统一器

C++ name mangling、template、exception、STL layout 和编译器 ABI 依然不稳定。优先在 C++/Rust 外围提供稳定 C façade。

### 它不是自动跨平台打包器

不同 OS/arch 的 library 仍需构建、签名、分发、加载和测试。

### 它不是沙箱

拥有 native access 的代码与 JNI 一样可以破坏进程。第三方 binding 应被当作高权限组件审计。

### 它不是动态编译或 FaaS runtime

Panama 可以让 Java 调用已存在的 native function，但不会负责租户隔离、代码编译、类卸载、超时、资源限额或恶意代码防护。用 javac + Panama 构建函数执行平台时，这些问题仍需由上层系统解决。

## 生产落地检查表

### ABI

- header 与实现来自同一版本；
- `size_t`、`long`、pointer width 没有按 Java 直觉猜测；
- struct padding、alignment、union 和 by-value return 已验证；
- C++/Rust 外部暴露稳定 C ABI；
- symbol version 与最低 OS 版本明确。

### 生命周期

- 每个 segment 的 arena owner 明确；
- native code 是否保存 pointer 有文档与测试；
- callback 有注册、注销和关闭竞态策略；
- 稀缺资源不依赖 `ofAuto()` 或 finalization；
- shared arena 的并发关闭可证明安全。

### 错误

- errno/GetLastError 或 library error code 被及时捕获；
- native error 转成稳定的 Java/Kotlin domain error；
- Java exception 不越过 C callback ABI；
- Rust panic、C++ exception 不越过 C façade；
- 崩溃时能保留 hs_err、core dump、native symbol 与版本信息。

### 构建与发布

- OS × arch × libc 矩阵有 CI；
- jextract、JDK、compiler 与 header 版本锁定；
- dynamic library 的 hash/版本可观测；
- 容器镜像包含正确 runtime dependency；
- native access 只授权 adapter module；
- 升级 JDK 后重新跑 ABI 与性能测试。

### 性能

- MethodHandle 与 symbol lookup 不在热点中重复创建；
- 小调用已尽量批处理；
- copy 与 encoding 成本单独测量；
- JNI/FFM 比较使用真实负载与同一 native implementation；
- JFR、async-profiler、perf 与 native symbols 能连起完整调用链。

## 与 JNI、JNA 和 Kotlin/Native 的选择

| 场景 | 更自然的选择 |
|---|---|
| 新建 JDK 22+ 服务，绑定稳定 C ABI | FFM/Panama |
| 需要从 header 生成大规模 binding | jextract + FFM |
| 维护成熟 JNI 库或兼容旧 JDK | 继续 JNI，逐步建立 FFM adapter |
| 简单低频调用、优先生态成熟度 | 评估 JNA/JNR 与 FFM 的维护成本 |
| Android 应用/SDK | 当前仍以 JNI/NDK 为现实基线 |
| 生成独立 native 程序 | Kotlin/Native、Rust、C/C++ 或 GraalVM Native Image，取决于目标 |
| 显式 JVM SIMD | Vector API，但接受 incubator 约束 |

FFM 不是要求所有 JNI 立即重写。已有库若稳定、测试充分、支持旧 JDK，迁移收益可能不足以覆盖风险。最适合先迁移的是 JNI glue 厚重、header 稳定、需要大量 buffer 交换，或希望 Java 侧掌控生命周期的模块。

## 结论：Java 开始承认边界，而不是隐藏边界

Project Panama 最重要的变化不是少写 C，而是改变 JVM 描述外部世界的方式：

- `MemorySegment` 让地址拥有边界；
- `Arena` 让释放策略进入程序结构；
- `MemoryLayout` 让 ABI 布局成为显式模型；
- `SymbolLookup` 与 `Linker` 让 native call 变成可组合的 MethodHandle；
- upcall 让 callback 与生命周期绑定；
- jextract 让 header 成为 binding 来源；
- Vector API 尝试让 SIMD 意图进入 Java 代码。

JNI 的思路是通过 C glue 跨越 JVM 边界；Panama 的思路是让 JVM 看懂这条边界。

这并没有取消 C ABI、内存所有权和平台差异，反而要求 Java 开发者正面理解它们。成熟的 Panama 工程不是把 `MemorySegment` 传遍业务代码，而是用一个窄小、可审计、可测试的 adapter，把 native 能力重新封装成稳定的 Java/Kotlin 领域接口。

## 延伸阅读

- [JEP 454：Foreign Function & Memory API](https://openjdk.org/jeps/454)
- [Java 25 API：java.lang.foreign](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/foreign/package-summary.html)
- [Project Panama](https://openjdk.org/projects/panama/)
- [JEP 472：Prepare to Restrict the Use of JNI](https://openjdk.org/jeps/472)
- [JEP 537：Vector API（Twelfth Incubator）](https://openjdk.org/jeps/537)
- [Inside Java：Jextract — Java Treasures from Native Code Gems](https://inside.java/2024/10/26/jextract/)
