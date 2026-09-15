---
title: Zig 内存布局：普通、extern 与 packed 类型如何对应机器
date: 2026-09-15
excerpt: 同样是 struct，普通数据、C ABI 与位级协议需要三种不同承诺；选对表示方式，才能让类型与真实字节一致。
chapter: 类型与数据
chapterOrder: 5
---

## 字段相同，不代表字节相同

写下一个结构体时，我们很容易把源码里的字段顺序想成内存中的字节顺序：

```zig
const User = struct {
    active: bool,
    id: u32,
    level: u8,
};
```

但普通 `struct` 的首要目标是让 Zig 程序正确、高效地访问字段，不是向外部承诺一种稳定的二进制格式。编译器可以选择字段布局；字段之间也可能因为对齐产生空洞。升级编译器、改变目标平台或调整字段，都不应该被视为兼容现有磁盘数据的操作。

Zig 因此没有把所有“结构体”混成同一种抽象。根据边界不同，通常要在三种表示之间选择：

| 声明 | 主要承诺 | 适合的边界 |
|---|---|---|
| `struct` | Zig 语义下的字段集合 | 程序内部数据 |
| `extern struct` | 与目标平台 C ABI 兼容的布局 | C 函数、系统 API |
| `packed struct` | 字段按位紧密排列 | 寄存器、明确的位字段 |

这三者不是“普通、优化版、更优化版”。它们回答的是三个不同问题。

> 本文以 Zig 0.16.0 为基准。ABI 与目标平台有关；网络协议和磁盘格式还必须单独处理字节序与版本兼容。

## 用 builtin 观察，而不是凭直觉猜

Zig 在编译期提供了一组查询布局的 builtin：

```zig
const std = @import("std");

const Header = struct {
    tag: u8,
    length: u32,
};

test "inspect layout" {
    std.debug.print("size={} align={} offset={}\n", .{
        @sizeOf(Header),
        @alignOf(Header),
        @offsetOf(Header, "length"),
    });
}
```

- `@sizeOf(T)` 是一个值占用的字节数；
- `@alignOf(T)` 是类型要求的对齐；
- `@offsetOf(T, field)` 是字段相对结构体起点的字节偏移；
- `@bitSizeOf(T)` 则适合观察非整字节宽度的整数和 packed 类型。

这些结果可以用于断言某个外部接口的前提，却不应反过来把普通 `struct` 当成持久化协议：今天观察到一个偏移，不等于语言替未来版本作出了保证。

```zig
comptime {
    if (@sizeOf(usize) != @sizeOf(*anyopaque)) {
        @compileError("this target uses an unexpected pointer model");
    }
}
```

布局查询本身也是编译期值，因此错误能在生成产物前暴露，而不是上线后才由一次越界访问揭晓。

## 对齐为什么会产生空洞

假设某个目标上 `u32` 要求四字节对齐。若一个 `u8` 后立刻放 `u32`，编译器可能需要在中间插入三个填充字节：

```zig
const Record = extern struct {
    kind: u8,
    value: u32,
};
```

这里使用 `extern` 是为了便于讨论固定 ABI；实际大小仍应针对目标平台查询。填充不是无用浪费，而是处理器和 ABI 对合法、高效访问提出的要求。

这也带来两个常见陷阱：

1. 不能用字段大小之和推断结构体大小；
2. 不能把包含 padding 的结构体整块写入磁盘，并期待 padding 字节具有确定值。

如果二进制格式规定“1 字节种类 + 4 字节大端长度”，最可靠的做法是逐字段编码：

```zig
fn encodeHeader(out: *[5]u8, kind: u8, length: u32) void {
    out[0] = kind;
    out[1] = @intCast(length >> 24);
    out[2] = @intCast(length >> 16);
    out[3] = @intCast(length >> 8);
    out[4] = @intCast(length);
}
```

显式代码看起来比一次 `@bitCast` 多几行，却把字节序、长度和边界都写进了实现。

## `extern struct`：承诺 C ABI，不承诺网络协议

与 C 库交互时，双方需要对字段偏移、大小和对齐达成一致：

```c
typedef struct {
    uint32_t id;
    uint16_t flags;
} C_Record;
```

对应的 Zig 类型可以写成：

```zig
const CRecord = extern struct {
    id: u32,
    flags: u16,
};
```

`extern struct` 只允许具有明确 C ABI 表示的字段类型。它适合被 `extern fn` 接收，或由 `export fn` 暴露给 C：

```zig
extern fn consume_record(record: *const CRecord) c_int;

export fn record_is_enabled(record: *const CRecord) bool {
    return (record.flags & 1) != 0;
}
```

边界内最好仍转换成 Zig 自己的领域类型。这样 C 的空指针、整数标志位和资源所有权只集中在薄薄的一层适配器中，而不会扩散到整个程序。

`extern` 也不等于“跨平台序列化格式”。C ABI 会随目标架构变化，而且结构体仍可能有 padding；网络字节序也没有因此自动统一。FFI、磁盘格式和网络协议是三类边界，不能共用一个“看起来布局固定”的理由。

## C 指针把风险带到边界

C API 经常用一个指针同时表达单值、数组和可空状态。Zig 的 `[*c]T` 为兼容这种语义而存在，但在 Zig 内部应尽快收窄：

```zig
fn fromC(data: [*c]const u8, len: usize) ![]const u8 {
    if (data == null and len != 0) return error.NullData;
    if (len == 0) return "";
    return data[0..len];
}
```

一旦转换成 slice，长度重新成为值的一部分。后续代码就不必反复记住“这个裸指针旁边的哪个整数才是它的长度”。

类似地，`?*T` 通常能以空指针表示 `null`，不必额外保存一个标签；但这是语言为可空指针提供的专门表示优化。不要据此假设任意 `?T` 都与 `T` 一样大，应该在真正依赖布局时用 `@sizeOf` 验证。

## `packed struct`：字段按位排列

硬件寄存器或某些协议头会把一个字节拆成多个字段：

```zig
const Status = packed struct(u8) {
    ready: bool,
    mode: u2,
    error_code: u4,
    reserved: u1,
};

test "decode register" {
    const raw: u8 = 0b0_0101_10_1;
    const status: Status = @bitCast(raw);

    try std.testing.expect(status.ready);
    try std.testing.expectEqual(@as(u2, 0b10), status.mode);
    try std.testing.expectEqual(@as(u4, 0b0101), status.error_code);
}
```

`packed struct(u8)` 指定了 backing integer，字段的位宽之和必须适配它。这里 `u2`、`u4` 不再只是更窄的数值范围，它们直接决定表示中的位数。

`@bitCast` 只在源和目标具有相同位数时成立，并且复制位模式而不做数值转换。它不会替你解决：

- 外部字节序与主机字节序不同；
- 输入包含协议禁止的位组合；
- 指向该数据的地址不满足对齐；
- 外部格式未来增加了版本或保留位规则。

因此一个安全的解析边界通常先读取整数、处理字节序，再 bitcast 成 packed 类型，最后验证语义。

## tagged union 的布局不是协议

Zig 的 tagged union 很适合表达“值只可能是这些分支之一”：

```zig
const Message = union(enum) {
    ping,
    text: []const u8,
    code: u16,
};
```

它拥有一个 tag 和对应 payload，`switch` 还能检查是否穷尽。但这份语义保证不等于固定的线格式：tag 的表示、payload 的对齐和整体 padding 都不应直接拿来做网络协议。

真正的编码层应该显式决定 tag 数字与 payload 字节：

```zig
fn wireTag(message: Message) u8 {
    return switch (message) {
        .ping => 0,
        .text => 1,
        .code => 2,
    };
}
```

当以后加入新分支时，编译器会迫使 `switch` 更新；协议编号却仍由你的代码控制，而不是偶然跟随内部布局改变。

## FFI 边界要把所有权也写清楚

内存布局一致，只解决了“双方如何读这些字节”，没有解决“谁负责释放”。一个 C 函数返回 `[*c]u8` 时，还需要明确：

- 返回值是否可能为空；
- 长度从哪里获得；
- 内存由谁分配；
- 应调用哪个释放函数；
- 指针能存活多久；
- 回调期间能否保留它。

可以用 Zig wrapper 把原始约定收束成资源对象：

```zig
const ForeignBuffer = struct {
    ptr: [*]u8,
    len: usize,

    fn bytes(self: ForeignBuffer) []u8 {
        return self.ptr[0..self.len];
    }

    fn deinit(self: *ForeignBuffer) void {
        c_release(self.ptr);
        self.* = undefined;
    }
};

extern fn c_release(ptr: [*]u8) void;
```

这个类型不能像 Rust 所有权那样在编译期阻止复制，也不会自动析构；但它建立了 Zig 项目常见的 `deinit` 约定。调用端通过 `defer buffer.deinit()` 让释放路径可见。

## Kotlin、Rust 与 Zig 的关注点不同

Kotlin/JVM 通常让对象布局成为虚拟机实现细节。业务代码关心引用与字段，很少合法地观察对象偏移；与 native 互操作时则进入 JNI、JNA 或 Kotlin/Native 的另一层机制。

Rust 的 `repr(C)`、`repr(transparent)` 与 Zig 的 `extern` 有相近动机，Rust 借用检查器还会约束许多指针生命周期。Zig 更直接地暴露目标 ABI、对齐和指针类型，同时把生命周期责任留给 API 约定、测试与代码审查。

Zig 的取舍是：**布局相关的事实可以精确查询，布局相关的承诺必须明确声明。** 普通类型保持实现自由；跨边界时，由程序员选择承诺哪一种表示。

## 选择表示方式的顺序

设计一个类型时，可以按下面的顺序判断：

1. 只在 Zig 内部传递：使用普通 `struct` 或 `union(enum)`；
2. 必须匹配目标平台 C ABI：使用 `extern struct` / `extern union`，并针对目标验证大小与偏移；
3. 必须描述精确位字段：考虑 `packed struct` 和明确 backing integer；
4. 必须跨网络或落盘：写显式编码/解码，不直接转储内存；
5. 接收外部指针：立即检查空值、长度、对齐与所有权，再转换成更严格的 Zig 类型。

内存安全问题很少只来自某一个错误指针。更常见的根因是：程序默默依赖了一个从未承诺过的布局。把边界类型选对，才能让“源码中看到的数据”与“机器真正读取的字节”保持一致。

## 延伸阅读

- [Zig 0.16.0 Language Reference：struct](https://ziglang.org/documentation/0.16.0/#struct)
- [Zig 0.16.0 Language Reference：extern struct](https://ziglang.org/documentation/0.16.0/#extern-struct)
- [Zig 0.16.0 Language Reference：packed struct](https://ziglang.org/documentation/0.16.0/#packed-struct)
- [Zig 0.16.0 Language Reference：C Pointers](https://ziglang.org/documentation/0.16.0/#C-Pointers)

