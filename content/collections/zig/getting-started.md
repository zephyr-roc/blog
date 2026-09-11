---
title: Zig：把成本、控制流与平台边界写在明处
date: 2026-07-20
excerpt: Zig 不只是“更现代的 C”。它试图用一套很小的语言核心，让控制流、内存分配、错误路径和跨平台构建都保持可见。
chapter: 认识 Zig
chapterOrder: 1
---

## Zig 不只是“更好的 C”

Zig 经常被概括成“更好的 C”。这个说法说明了它想进入的领域，却没有说清它真正特别的地方。

Zig 确实能直接调用 C、导出 C ABI、编译 C 源码，并把交叉编译器和构建系统一起放进工具链。但它并不是给 C 增加几个安全语法，也不是试图成为 Rust 的轻量版本。它更核心的目标是：**让系统程序的关键成本和关键分支在源码里保持可见，同时尽量减少语言机制之间的例外。**

官方对 Zig 的目标使用了四个词：robust、optimal、reusable、maintainable。翻成工程语言，大致可以理解为：

- 边界情况也要有明确行为，包括内存不足；
- 不因为抽象而被迫接受不需要的运行时成本；
- 同一份代码可以适配不同平台和资源约束；
- 程序要能精确地向编译器和下一位维护者表达意图。

这让 Zig 看起来很朴素。它没有垃圾回收器，没有借用检查器，没有异常，没有类和继承，也没有一套独立的宏语言。可它并不只是删功能：错误联合、可选类型、`defer`、`comptime`、类型反射和一体化工具链，组成了另一种系统编程方案。

> 本系列以 Zig 0.16.0 为基准。Zig 在 1.0 之前仍会调整语言和标准库 API，旧文章里的 I/O、构建脚本和容器用法尤其可能过时；语言核心通常比标准库接口稳定。

## 第一段程序已经暴露了语言性格

```zig
const std = @import("std");

pub fn main() void {
    std.debug.print("Hello, {s}!\n", .{"Zig"});
}
```

运行它只需要：

```bash
zig run hello.zig
```

短短几行里已经出现了不少 Zig 的核心设计：

- `@import("std")` 在编译期取得一个模块；
- 顶层 `const` 声明不依赖书写顺序；
- `pub` 明确决定声明是否对模块外可见；
- `void` 表示函数正常返回时没有结果；
- `.{"Zig"}` 是匿名元组字面量，格式化函数在编译期检查格式串和参数；
- `std.debug.print` 面向调试输出，写入标准错误且忽略写入失败，适合最小示例而不是所有生产 I/O。

如果程序确实要向标准输出写入，并处理 I/O 错误，Zig 0.16 的入口也可以显式接收进程初始化上下文：

```zig
const std = @import("std");

pub fn main(init: std.process.Init) !void {
    try std.Io.File.stdout().writeStreamingAll(
        init.io,
        "Hello, stdout!\n",
    );
}
```

这里的 `!void` 表示“成功时返回 `void`，也可能返回错误”；`try` 表示遇到错误就立即把它返回给调用方。控制流发生了变化，但改变它的符号就写在调用点上。

## `const` 与 `var`：先说明绑定是否需要改变

Zig 不鼓励用一个宽泛的“变量”概念掩盖状态变化。局部绑定必须从 `const` 或 `var` 中二选一：

```zig
const max_retries: u8 = 3;
var attempts: u8 = 0;

attempts += 1;
```

`const` 表示不能通过这个绑定修改值，`var` 表示它确实会变化。如果把从未修改的局部量写成 `var`，编译器会要求改成 `const`。这不是格式偏好，而是在逼迫源码准确描述状态。

需要注意，`const` 约束的是通过该引用进行修改的能力，不自动解决所有别名和生命周期问题。Zig 没有 Rust 的借用检查器；当多个指针指向同一片内存时，维护有效期和别名规则仍然是程序员的责任。

## 没有隐藏控制流：意外分支必须留下痕迹

Zig 的设计原则常被总结为：

> No hidden control flow. No hidden memory allocations.

“没有隐藏控制流”并不意味着程序没有抽象，也不意味着函数调用内部不能做复杂工作。它强调的是：一段看似普通的表达式，不应因为重载、属性访问器、异常传播或隐式生命周期钩子，突然执行调用点看不出的分支。

因此 Zig 没有用户自定义运算符重载、隐式异常展开、构造/析构函数协议、把字段访问变成任意代码的 getter/setter，也不会自动插入堆分配。

当控制流确实需要改变时，Zig 使用显眼的语言结构：

```zig
const std = @import("std");

const ParseError = error{
    Empty,
    InvalidDigit,
};

fn parsePort(text: []const u8) ParseError!u16 {
    if (text.len == 0) return error.Empty;

    var value: u16 = 0;
    for (text) |byte| {
        if (byte < '0' or byte > '9') return error.InvalidDigit;
        value = value * 10 + (byte - '0');
    }
    return value;
}

pub fn main() void {
    const port = parsePort("443") catch |err| {
        std.debug.print("invalid port: {}\n", .{err});
        return;
    };
    std.debug.print("port = {}\n", .{port});
}
```

`catch` 明确标出了失败分支，`return` 明确结束当前函数。换成 `try parsePort(...)` 时，源码同样明确表示“这里可能提前返回”。Zig 追求的不是没有控制流，而是让控制流的变化可搜索、可审计。

## 错误是值，不是异常对象

Zig 把可恢复失败拆成两部分：错误集合描述可能出现哪些错误，错误联合描述一次计算可能得到错误或正常结果。

```zig
const OpenError = error{
    NotFound,
    PermissionDenied,
};

fn openConfig() OpenError![]const u8 {
    return error.NotFound;
}
```

`OpenError![]const u8` 不是一个需要堆分配的异常包装对象。调用方可以用 `try` 传播，用 `catch` 恢复，也可以通过 `if` 解包错误联合。错误路径进入了函数类型，因此 API 不能假装失败不存在。

资源清理则由 `defer` 和 `errdefer` 明确描述：

```zig
const std = @import("std");

fn duplicate(
    allocator: std.mem.Allocator,
    source: []const u8,
) ![]u8 {
    const copy = try allocator.alloc(u8, source.len);
    errdefer allocator.free(copy);

    @memcpy(copy, source);
    return copy;
}
```

`errdefer` 只在当前作用域以错误退出时执行，适合回滚已经完成的一部分初始化。它不是析构函数：值离开作用域时不会自动根据类型运行任意用户代码，清理动作就在资源取得位置附近。

## 没有隐藏分配：谁申请，谁就要面对失败与释放

在 Zig 中，一个普通函数不会因为语言协议而悄悄选择堆。需要动态内存的 API 通常接收分配器：

```zig
const std = @import("std");

fn makeBuffer(
    allocator: std.mem.Allocator,
    len: usize,
) ![]u8 {
    return allocator.alloc(u8, len);
}
```

调用者决定使用通用堆分配器、固定缓冲区分配器、arena，还是某个领域专用分配策略；分配失败则自然进入错误联合。于是“分配策略”不再是库内部无法观察的全局决定，而成为依赖和 API 契约的一部分。

这种显式性也意味着 Zig 不会替你证明内存安全。它提供运行时安全检查、边界检查、可选类型、对齐信息和严格的指针类型，但释放过早、重复释放、泄漏和无效别名仍可能发生。与 Rust 相比：

| 维度 | Rust | Zig |
|---|---|---|
| 生命周期 | 借用检查器在编译期证明大量关系 | 由程序员和 API 约定维护 |
| 资源清理 | `Drop` 随作用域自动执行 | `defer` 在使用点显式登记 |
| 动态内存 | 容器通常自行封装分配策略 | 常把 allocator 作为参数传入 |
| 失败 | `Result<T, E>` 与 `?` | 错误联合 `E!T` 与 `try` |
| unsafe 边界 | 大部分危险操作要求 `unsafe` | 指针操作更直接，依赖安全检查和纪律 |
| 泛型 | 类型参数、trait 与单态化 | 类型是编译期值，使用 `comptime` 生成特化代码 |

Rust 更愿意用复杂类型系统预先排除错误；Zig 更愿意让机器模型保持直观，并把责任留在明确的代码边界。它们都反对模糊成本，只是选择了不同的证明方式。

## `comptime`：用同一种语言生成类型和代码

许多系统语言最终都需要模板、宏、代码生成器或反射。Zig 的答案是让编译期执行成为语言本身的一部分。

```zig
fn Matrix(comptime rows: usize, comptime cols: usize) type {
    return [rows][cols]f32;
}

const Transform = Matrix(4, 4);

fn identity(comptime size: usize) Matrix(size, size) {
    var result: Matrix(size, size) =
        @splat(@splat(0.0));

    inline for (0..size) |index| {
        result[index][index] = 1.0;
    }
    return result;
}
```

这里没有另一套模板语法：函数接收编译期参数，返回值甚至可以是 `type`。当 `size` 已知时，循环可以在编译期展开，返回类型也由普通 Zig 表达式构造。

`comptime` 的重要性不只是“提前算斐波那契数”。它承担了 Zig 中许多高级抽象：参数化容器和算法、根据字段反射生成序列化逻辑、编译期校验格式串和配置、根据目标平台选择实现，以及生成固定布局且没有运行时元数据的特化代码。

代价也很直接：编译期程序仍然是程序，可能变慢、报出很深的求值错误，或制造难以阅读的元编程。好的 Zig API 会让 `comptime` 服务于清晰的运行时接口，而不是把全部逻辑塞进类型魔术。

## 文件、结构体与模块使用同一种容器模型

Zig 没有 class。`struct` 可以同时容纳字段和声明，源文件本身也像一个隐式结构体：

```zig
const Counter = struct {
    value: usize = 0,

    const Self = @This();

    fn increment(self: *Self) void {
        self.value += 1;
    }
};

var counter = Counter{};
counter.increment();
```

`counter.increment()` 会在 `Counter` 中寻找第一个参数能接收 `counter` 的函数。它提供熟悉的点调用体验，但不引入继承、虚方法或隐式对象生命周期。多态通常通过编译期参数、函数指针、显式 tagged union，或自己定义的接口结构实现。

这体现了 Zig 的“少机制”倾向：命名空间、模块和用户类型没有被切成三套互不相干的系统。声明仍然是声明，组合方式由程序明确选择。

## C 互操作不只是能调用几个函数

Zig 可以直接导入 C 头文件：

```zig
const c = @cImport({
    @cInclude("sqlite3.h");
});
```

也可以导出 C ABI：

```zig
export fn add(left: c_int, right: c_int) c_int {
    return left + right;
}
```

更实用的是，Zig 工具链本身可以扮演 C/C++ 编译器驱动：

```bash
zig cc -target aarch64-linux-gnu hello.c -o hello
```

它把目标三元组、libc 选择和交叉编译能力纳入同一个入口。对已有 C 工程而言，即使暂时不把业务代码改写成 Zig，也能先用 `zig cc` 和 `zig build` 简化可复现构建，再逐步引入 Zig 模块。

不过，“容易互操作”不代表 C 自动变安全。导入的裸指针、宏、所有权约定和线程规则仍然来自 C API；Zig 只能让边界更方便被包装，不能替外部库补上不存在的契约。

## 一套工具链覆盖编译、测试、构建和格式化

Zig 把常用工程动作放进同一个可执行文件：

```bash
zig run src/main.zig
zig test src/parser.zig
zig fmt src build.zig
zig build
```

测试也是语言级声明：

```zig
const std = @import("std");

fn add(left: i32, right: i32) i32 {
    return left + right;
}

test "add keeps negative values" {
    try std.testing.expectEqual(@as(i32, -1), add(1, -2));
}
```

`zig test` 会发现可达的 `test` 声明，编译并运行测试二进制。构建脚本 `build.zig` 同样使用 Zig 编写，可以根据目标、优化模式和依赖构造构建图，不需要再学习一门 DSL。

统一工具链是 Zig 很现实的竞争力：它未必让每个复杂构建都变简单，却减少了“编译器、包管理、交叉工具链、测试运行器和构建语言各自为政”的摩擦。

## Zig 主动不替你做什么

理解 Zig 不能只看它提供的功能，还要看它拒绝承担的责任：

- 不用垃圾回收器管理对象图；
- 不用借用检查器证明指针生命周期；
- 不用异常和栈展开传递普通失败；
- 不用 RAII/析构函数隐式执行清理；
- 不把反射或泛型变成庞大的独立子语言；
- 不保证 1.0 前的标准库 API 稳定。

这使它比 Rust 更容易从机器布局和 C ABI 的角度理解，也让它比 C 更能把失败、缺失、边界检查和编译期约束写进语言。但“语言更小”并不等于“写系统更轻松”：很多 Rust 编译器替你证明的事情，在 Zig 中会变成测试、封装、审查和工程纪律。

## 什么时候 Zig 特别合适

Zig 的优势通常在以下场景里最明显：

- 需要跨平台构建的命令行工具和单文件程序；
- 嵌入式、内核、游戏引擎或实时系统中的底层模块；
- 需要精确控制布局、分配与 ABI 的库；
- 为既有 C/C++ 工程建立更可复现的构建和封装层；
- WebAssembly、freestanding 或没有完整操作系统的目标；
- 希望获得现代错误处理和编译期抽象，又不想引入大型运行时的项目。

如果项目主要依赖成熟业务框架、自动内存管理和庞大包生态，JVM、.NET、Go 或其他高层平台往往更省成本。如果团队最重视编译期内存安全证明，Rust 的所有权系统也更符合目标。

选择 Zig 的理由不该只是“语法比 Rust 简单”。更准确的理由是：你愿意用显式资源管理换取直接的机器模型，并希望语言和工具链帮助你把这种显式性保持得足够整洁。

## 建立 Zig 的阅读顺序

阅读 Zig 代码时，可以依次问六个问题：

1. **哪些值在编译期已知**：寻找 `comptime`、类型参数和 `inline`；
2. **哪些绑定会改变**：区分 `const`、`var` 与通过指针发生的修改；
3. **失败怎样传播**：寻找 `!T`、`try`、`catch` 和 `errdefer`；
4. **内存由谁提供**：查看 allocator、缓冲区和返回切片的有效期；
5. **数据是什么形状**：区分数组、切片、单项指针、多项指针和 C 指针；
6. **平台边界在哪里**：查看 `@cImport`、`extern`、`export`、目标与构建选项。

这套顺序比先找“类层级”更适合 Zig。它首先是一门描述数据布局、计算阶段和资源责任的语言。

## 结论：Zig 的简洁来自责任可见

Zig 的简洁不是让所有事情自动发生，而是尽量减少会自动发生的事情。

错误通过错误联合进入签名，提前返回由 `try` 标出；分配器进入 API，释放由 `defer` 标出；泛型和反射发生在 `comptime`，目标平台进入构建图；与 C 的边界也使用明确的 ABI 和指针类型。

这套设计不会消灭系统编程的复杂性。它做的是把复杂性从隐含协议重新放回源码，让成本、阶段和责任尽可能能被看到。

## 下一章

下一章将进入新的 CHAPTER「类型与数据」，系统梳理 Zig 的基本类型：从任意位宽整数、编译期数值、数组与切片开始，再建立指针、optional、错误联合、struct、enum 与 tagged union 之间的完整关系。

## 延伸阅读

- [Zig 0.16.0 Language Reference](https://ziglang.org/documentation/0.16.0/)
- [Zig 0.16.0 Release Notes](https://ziglang.org/download/0.16.0/release-notes.html)
- [Zig Learn Overview](https://ziglang.org/learn/overview/)
- [Zig Download and Release Index](https://ziglang.org/download/)
