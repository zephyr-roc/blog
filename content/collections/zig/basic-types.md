---
title: Zig 基本类型：从位宽、内存形状到失败路径
date: 2026-09-11
excerpt: Zig 的类型不只区分“值是什么”，还把位宽、长度、哨兵、可变性、错误路径和编译阶段直接编码进程序。
chapter: 类型与数据
chapterOrder: 2
---

## 类型首先描述机器可见的事实

在 Kotlin 或 Java 中，学习基本类型通常从 `Int`、`Long`、`Boolean` 和 `String` 开始，然后很快进入类和集合。Zig 的类型地图不一样：一个类型往往同时说明值域、内存宽度、长度是否已知、能否修改、是否可能缺失，以及信息在编译期还是运行时存在。

下面几组类型看起来都能“指向一些字节”，实际契约完全不同：

```zig
const packet: [4]u8 = .{ 0xde, 0xad, 0xbe, 0xef };
const view: []const u8 = packet[0..];
const first: *const u8 = &packet[0];
const many: [*]const u8 = &packet;
```

- `[4]u8` 拥有四个连续字节，长度属于类型；
- `[]const u8` 是带运行时长度的只读视图；
- `*const u8` 指向一个只读字节；
- `[*]const u8` 指向若干只读字节，但自身不携带长度。

Zig 很少把这些差异藏进容器实现。读懂类型本身，就能提前知道一大部分边界条件。

> 本文以 Zig 0.16.0 为基准，重点讲语言层类型。标准库容器及其 allocator API 会在后续章节单独展开。

## `const`、`var` 与类型推导

局部声明可以显式写类型，也可以从初始化表达式推导：

```zig
const retries: u8 = 3;
const timeout_ms = @as(u32, 1500);
var connected: bool = false;

connected = true;
```

`const` 和 `var` 决定绑定是否允许被修改，不是类型名。`connected` 的类型仍然是 `bool`。

当整数或浮点字面量还没有被运行时类型约束时，它们分别可能处于 `comptime_int` 和 `comptime_float`。因此下面的 `answer` 不是先默认成 `i32` 再转换：

```zig
const answer = 40 + 2;
const small: u8 = answer;
const large: i128 = answer;
```

编译器知道 `answer` 的精确编译期值，只要目标类型能表示 42，就可以把它强制转换过去。Zig 没有 Java/Kotlin 那种固定的整数字面量默认类型；**编译期数值先保持任意精度，进入运行时存储或参数边界时才必须落到具体类型。**

如果上下文不足，使用 `@as` 明确提供结果类型：

```zig
const port = @as(u16, 443);
const ratio = @as(f32, 0.75);
```

这不是随意的强制转换。`@as(T, value)` 提供类型上下文，只有语言允许的强制转换才能发生；可能丢失信息的转换需要更具体的 builtin。

## 整数：位宽属于类型

Zig 提供常见的 `i8`、`u8`、`i16`、`u16` 一直到 `i128`、`u128`，也支持任意不超过 65535 位的整数类型：

```zig
const channel: u3 = 5;      // 0...7
const temperature: i9 = -20;
const register: u24 = 0x12_ab_cd;
```

`u3` 不只是“逻辑上只用三位的 u8”，而是一个值域为 0 到 7 的类型。这对 packed struct、协议字段、硬件寄存器和位级算法尤其重要。

| 类型 | 含义 | 典型用途 |
|---|---|---|
| `iN` | N 位二进制补码有符号整数 | 可能为负的精确宽度字段 |
| `uN` | N 位无符号整数 | 位模式、长度、无符号协议字段 |
| `isize` | 与目标指针同宽的有符号整数 | 指针相关差值，较少作为普通业务整数 |
| `usize` | 与目标指针同宽的无符号整数 | 长度、索引、内存大小 |
| `comptime_int` | 编译期任意精度整数 | 字面量和编译期计算，不能作为运行时存储 |

### 溢出语义由运算符写出来

在启用运行时安全检查的构建模式中，普通整数溢出会触发安全检查；编译期已知的溢出则直接成为编译错误。需要其他语义时，不应依赖构建模式或平台偶然行为，而要选择对应运算符：

```zig
const wrapped = @as(u8, 250) +% 10;   // wrapping，结果为 4
const saturated = @as(u8, 250) +| 10; // saturating，结果为 255
```

`+%`、`-%`、`*%` 表达环绕运算，`+|`、`-|`、`*|` 表达饱和运算。还可以用 `@addWithOverflow` 等 builtin 同时取得结果和是否溢出。

这种设计把意图放在表达式上：协议序号需要环绕、音频采样需要饱和、金额计算需要拒绝溢出，它们不应共享一个含糊的 `+`。

### 除法也要求明确语义

带符号整数除法涉及向零截断还是向负无穷取整。Zig 不让运行时有符号整数直接使用语义含糊的 `/`：

```zig
const toward_zero = @divTrunc(@as(i32, -7), 3); // -2
const toward_floor = @divFloor(@as(i32, -7), 3); // -3
```

同理，`@rem` 与 `@mod` 分别对应不同的余数定义。底层代码最怕“大家都知道它大概怎么取整”；Zig 倾向于让名字成为契约。

## 浮点数：精度和模式同样显式

Zig 的浮点类型包括 `f16`、`f32`、`f64`、`f80`、`f128`，以及只存在于编译期的 `comptime_float`：

```zig
const distance: f32 = 12.5;
const precise: f64 = 1.0 / 3.0;
const compile_time = 0.1 + 0.2;
```

`comptime_float` 拥有比普通运行时浮点更高的表示能力，但一旦落入 `f32` 或 `f64`，仍要遵循目标类型的精度限制。它不是十进制定点数，也不适合直接表达货币规则。

Zig 默认使用严格浮点模式。性能敏感且可以接受更宽松语义的局部代码，可以显式使用 `@setFloatMode(.optimized)` 改变当前作用域的浮点模式。与溢出一样，数值语义不应被一个看不见的全局开关随意改变。

## `bool`、`void` 与 `noreturn`

`bool` 只有 `true` 和 `false`，不会和整数隐式互换：

```zig
const enabled: bool = true;
const bit: u1 = @intFromBool(enabled);
```

`void` 表示一个正常完成、但没有有意义结果的值。它是零位类型，`@sizeOf(void)` 为 0：

```zig
fn markReady() void {
    // 完成后正常返回
}
```

`noreturn` 则表示控制流永远不会正常返回，例如无限循环、`unreachable` 或总会终止进程的函数：

```zig
fn forever() noreturn {
    while (true) {}
}
```

这个区别会参与类型推导。由于 `return`、`break`、`continue` 和 `unreachable` 都不会产生普通的后续值，它们可以出现在需要其他结果类型的分支中。

## 数组：长度是编译期契约

数组类型写作 `[N]T`，长度 `N` 是类型的一部分：

```zig
const ipv4: [4]u8 = .{ 192, 168, 1, 10 };
const zeros = [_]u16{ 0, 0, 0, 0 };
const repeated = [_]u8{0xaa} ** 8;
```

`[4]u8` 和 `[8]u8` 是不同类型。`_` 让编译器根据元素个数推导长度；`**` 可以连接或重复数组。数组直接包含元素，不等于堆上的动态集合：

```zig
const matrix: [2][3]i32 = .{
    .{ 1, 2, 3 },
    .{ 4, 5, 6 },
};
```

这里的布局就是两个连续的 `[3]i32`。当函数接收固定协议帧、哈希摘要或数据块时，把长度放进类型能防止传入形状不匹配的数据。

### 哨兵终止数组

`[N:S]T` 在 N 个正常元素之后额外存放一个哨兵值 `S`：

```zig
const name: [4:0]u8 = .{ 'z', 'i', 'g', '!' };
```

它既保留已知长度，又保证索引 `N` 处存在哨兵。与 C 字符串互操作时，哨兵 0 尤其常见，但“带哨兵”不自动等于 UTF-8 字符串，元素解释仍由 API 决定。

## 切片：指针与长度组成的借用视图

切片写作 `[]T` 或 `[]const T`。它不拥有内存，只保存起始地址和运行时长度：

```zig
fn sum(values: []const i32) i32 {
    var total: i32 = 0;
    for (values) |value| total += value;
    return total;
}

const values = [_]i32{ 10, 20, 30, 40 };
const middle: []const i32 = values[1..3];
```

`middle` 的长度是 2，但这个数字不属于其静态类型。切片适合作为大多数“连续元素序列”的函数参数，因为调用者可以从数组、其他切片或动态分配的缓冲区创建它。

`[]const T` 表示不能通过这个视图修改元素，`[]T` 表示可以：

```zig
fn clear(bytes: []u8) void {
    @memset(bytes, 0);
}
```

这里的 `const` 修饰元素访问能力，不代表底层内存永远不可变，也不延长它的生命。返回指向局部数组的切片仍然是错误设计；Zig 没有借用检查器替你拒绝所有悬垂引用。

## 字符串不是独立的运行时对象

Zig 没有内建的 `String` 类。字符串字面量是以 0 为哨兵的 UTF-8 字节数组指针，并且通常会被强制转换成 `[]const u8`：

```zig
const std = @import("std");

const literal = "积雨云";
const text: []const u8 = literal;

std.debug.print("bytes = {}, text = {s}\n", .{
    text.len,
    text,
});
```

`text.len` 是 UTF-8 字节数，不是 Unicode 字符数量；`text[index]` 得到的是一个字节，不是 Kotlin `Char`，更不是用户感知的字素簇。

这一区别非常重要。底层协议通常确实需要字节切片，但文本截断、光标移动和“第几个字符”必须使用理解 UTF-8/Unicode 的算法，不能把 `[]const u8` 当作固定宽度字符数组。

## 指针不是一种类型，而是一组不同契约

Zig 用不同语法区分指针能力：

| 类型 | 携带长度 | 主要能力 |
|---|---:|---|
| `*T` | 固定为一个 | 指向单个 T，用 `.*` 解引用 |
| `[*]T` | 否 | many-item pointer，可索引和指针运算 |
| `[]T` | 是 | 切片，适合有边界的序列访问 |
| `[*:S]T` | 否 | 依靠哨兵 S 表示终点 |
| `[*c]T` | 否 | C 指针，兼容 C 的宽松指针规则 |
| `?*T` | 固定为一个或空 | 可选单项指针，通常能利用 null 表示优化 |

单项指针示例：

```zig
var counter: u32 = 0;
const pointer: *u32 = &counter;
pointer.* += 1;
```

many-item pointer 只知道从哪里开始，不知道哪里结束：

```zig
const values = [_]u8{ 10, 20, 30 };
const many: [*]const u8 = &values;
const second = many[1];
```

因此，应用内部 API 应优先传切片；只有 ABI、哨兵协议或底层指针算法确实不携带长度时，才使用 many-item/C 指针。类型越弱，调用者需要从外部约定恢复的信息就越多。

对齐、地址空间、`volatile`、`allowzero` 和哨兵也都能成为指针类型的一部分。后续“指针、切片与内存生命周期”会单独分析这些限定符。

## optional：把“可能没有值”写成 `?T`

任意类型 `T` 都可以形成可选类型 `?T`：

```zig
fn findPort(secure: bool) ?u16 {
    if (secure) return 443;
    return null;
}
```

使用可选值必须显式解包：

```zig
if (findPort(true)) |port| {
    std.debug.print("port = {}\n", .{port});
} else {
    std.debug.print("no port\n", .{});
}
```

也可以提供默认值：

```zig
const port = findPort(false) orelse 80;
```

`orelse` 会在左侧为 `null` 时计算右侧，因此右侧也可以 `return`、`break` 或产生其他控制流。

optional 与指针结合时尤其有价值。普通 Zig 指针不能为 null，`?*T` 才明确表示“一个有效指针或没有指针”。很多平台上 optional pointer 可以直接用空地址编码，不需要额外标签，但代码仍获得严格的解包检查。

## 错误集合与错误联合：类型化的失败路径

错误集合声明一组可能失败的名称：

```zig
const DecodeError = error{
    TooShort,
    UnsupportedVersion,
    InvalidLength,
};
```

错误联合 `E!T` 表示结果要么是 `E` 中的错误，要么是 `T`：

```zig
fn decodeVersion(packet: []const u8) DecodeError!u4 {
    if (packet.len == 0) return error.TooShort;

    const version: u4 = @truncate(packet[0] >> 4);
    if (version != 1) return error.UnsupportedVersion;
    return version;
}
```

调用者可以传播错误：

```zig
fn validate(packet: []const u8) !void {
    _ = try decodeVersion(packet);
}
```

也可以捕获并转换。`catch` 的右侧既能提供后备值，也能使用 `return` 离开当前函数：

```zig
const version = decodeVersion(packet) catch |err| {
    std.debug.print("decode failed: {}\n", .{err});
    return err;
};
```

当函数返回 `!T` 而省略左侧错误集合时，编译器会从实现推导错误集合。私有函数中这很方便；公共 API 若需要长期稳定，明确写出错误集合往往更容易控制契约，避免实现细节意外扩大调用方需要面对的失败范围。

optional 和错误联合不能互相替代：

- `?T`：没有值本身是正常情况，不解释原因；
- `E!T`：操作失败，需要保留原因；
- `E!?T`：操作可能失败，成功后也可能查不到值。

```zig
const User = struct { id: u64 };

fn loadUser(id: u64) DecodeError!?User {
    _ = id;
    return null;
}
```

类型从右向左读就是：“成功结果是 optional User，整个操作还可能得到 DecodeError。”

## struct：积类型、命名空间与方法容器

结构体把一组字段同时组合起来：

```zig
const User = struct {
    id: u64,
    name: []const u8,
    active: bool = true,

    const Self = @This();

    fn deactivate(self: *Self) void {
        self.active = false;
    }
};

var user = User{
    .id = 42,
    .name = "Zephyr",
};
user.deactivate();
```

字段默认值在构造时生效，省略没有默认值的字段会编译失败。结构体声明还可以容纳函数、常量和其他类型，因此同时充当命名空间。

但方法只是第一个参数与点调用语法匹配的普通函数。Zig 不为 struct 自动引入继承、虚分发、构造函数或析构函数。资源类型通常自己约定 `init` / `deinit`，调用者再用 `defer` 明确安排清理。

匿名 struct 字面量写作 `.{ ... }`。字段有名字时像匿名记录，没有名字时构成 tuple：

```zig
const response = .{
    .status = @as(u16, 200),
    .body = "OK",
};

const pair = .{ @as(u16, 443), true };
const port = pair[0];
```

它们常用来传格式化参数、返回少量临时组合值，或为已知目标类型提供简洁初始化。稳定的领域数据仍应优先声明命名 struct，让契约可以被搜索和复用。

## enum：给有限取值一个名字和底层表示

```zig
const Method = enum(u8) {
    get = 1,
    post = 2,
    delete = 3,
};

const method: Method = .post;
const wire_value: u8 = @intFromEnum(method);
```

`enum(u8)` 指定底层标签类型，适合协议和 ABI；普通 `enum` 可以让编译器选择标签表示。`switch` 必须穷尽所有已知成员：

```zig
const allows_body = switch (method) {
    .get => false,
    .post, .delete => true,
};
```

Zig 还有 enum literal：`.post` 的类型在目标位置确定。这种写法让局部代码简洁，但如果上下文不清楚，可以写完整的 `Method.post`。

需要表示来自外部、可能含未知数值的开放枚举时，可以加入 `_` 成员创建 non-exhaustive enum。否则，不应把任意整数未经验证地假装成有效枚举。

## union 与 tagged union：共享布局，或安全地表达分支

裸 `union` 的所有字段共享同一片存储：

```zig
const Bits = union {
    integer: u32,
    bytes: [4]u8,
};
```

它不记录当前活跃字段。访问错误字段属于非法行为，因此普通业务状态很少应该直接使用裸 union。

tagged union 使用 enum 标签记录当前分支：

```zig
const std = @import("std");

const Value = union(enum) {
    integer: i64,
    text: []const u8,
    boolean: bool,
};

fn render(value: Value) void {
    switch (value) {
        .integer => |number| std.debug.print("{}\n", .{number}),
        .text => |text| std.debug.print("{s}\n", .{text}),
        .boolean => |flag| std.debug.print("{}\n", .{flag}),
    }
}
```

它接近 Rust `enum` 或 Kotlin sealed hierarchy：一个值在任意时刻只能属于一个分支，而且分支可以携带不同数据。`switch` 同时检查标签并安全解包 payload。

当协议消息、语法树或状态机具有互斥形状时，tagged union 通常比“类型字段 + 一组 optional 字段”更准确，因为无效组合根本无法构造。

## 类型本身也是编译期值

Zig 的 `type` 是一个原始类型，类型可以由函数计算并返回：

```zig
fn Pair(comptime Left: type, comptime Right: type) type {
    return struct {
        left: Left,
        right: Right,
    };
}

const Entry = Pair([]const u8, u64);
const item = Entry{
    .left = "requests",
    .right = 1024,
};
```

这就是 Zig 泛型的基础。`Pair` 不是运行时工厂，也不返回一个描述类型的反射对象；它在编译期直接返回新类型，之后 `Entry` 和手写 struct 一样参与布局和代码生成。

泛型函数通常接收 `comptime T: type`，或使用 `anytype` 让编译器从调用点取得参数类型：

```zig
fn max(comptime T: type, left: T, right: T) T {
    return if (left > right) left else right;
}

const larger = max(u32, 10, 20);
```

配合 `@TypeOf`、`@typeInfo`、`@sizeOf`、`@alignOf` 和 `@FieldType`，普通 Zig 代码就能在编译期检查或构造类型。这比宏更统一，但也更容易把简单问题元编程化。只有当抽象确实跨多个类型且运行时不应付费时，才值得把逻辑提升到 `comptime`。

## 转换：区分提供上下文、检查范围与重解释位模式

系统编程无法避免类型转换，Zig 的重点是让不同风险使用不同名字：

| 操作 | 目的 |
|---|---|
| `@as(T, value)` | 提供结果类型，执行允许的强制转换 |
| `@intCast(value)` | 整数类型转换，目标类型由上下文决定并检查范围 |
| `@truncate(value)` | 明确丢弃高位 |
| `@floatCast(value)` | 浮点精度转换 |
| `@intFromFloat(value)` | 浮点转整数 |
| `@floatFromInt(value)` | 整数转浮点 |
| `@bitCast(value)` | 保留位模式，以同位数类型重新解释 |
| `@ptrCast(value)` | 改变指针子类型，不改变地址 |
| `@enumFromInt(value)` | 从整数构造 enum，必须满足有效标签约束 |

例如，网络长度字段转换为本机索引时，应让目标类型和失败前提清楚：

```zig
const wire_length: u16 = 1024;
const length: usize = @intCast(wire_length);
```

而解析一个 32 位寄存器的低 8 位，确实要丢弃信息，就使用 `@truncate`：

```zig
const register: u32 = 0x1234_abcd;
const low: u8 = @truncate(register);
```

不要把 `@bitCast` 当作通用转换。它只重解释相同位数的表示，不执行数值换算，也不自动解决对齐、有效值和 ABI 问题。

## 把类型组合成一个协议模型

下面用一个小型消息头把本章类型串起来：

```zig
const DecodeError = error{
    TooShort,
    UnsupportedVersion,
    UnknownKind,
};

const Kind = enum(u4) {
    heartbeat = 1,
    telemetry = 2,
    command = 3,
};

const Header = struct {
    version: u4,
    kind: Kind,
    payload_length: u16,
};

const Message = union(enum) {
    heartbeat: void,
    telemetry: []const u8,
    command: []const u8,
};

fn decodeHeader(bytes: []const u8) DecodeError!Header {
    if (bytes.len < 3) return error.TooShort;

    const version: u4 = @truncate(bytes[0] >> 4);
    if (version != 1) return error.UnsupportedVersion;

    const kind = switch (@as(u4, @truncate(bytes[0]))) {
        1 => Kind.heartbeat,
        2 => Kind.telemetry,
        3 => Kind.command,
        else => return error.UnknownKind,
    };

    const payload_length =
        (@as(u16, bytes[1]) << 8) | @as(u16, bytes[2]);

    return .{
        .version = version,
        .kind = kind,
        .payload_length = payload_length,
    };
}
```

这个模型没有复杂抽象，却把协议事实分别放进了正确位置：

- `u4` 表示两个字段各占四位；
- `[]const u8` 表示解析器借用外部字节，不取得所有权；
- `DecodeError!Header` 区分成功数据和失败原因；
- `enum(u4)` 给线上的数字标签领域含义；
- `union(enum)` 可以继续表达不同消息类型携带的 payload；
- 所有整数放大与截断都在调用点显式出现。

类型系统不能替代协议校验，但好的类型能保证校验后的代码不再反复猜测同一条约定。

## 一张类型地图

| 问题 | Zig 类型或机制 | 关键事实 |
|---|---|---|
| 固定位宽数值 | `iN` / `uN` / `fN` | 宽度和值域进入类型 |
| 编译期数值 | `comptime_int` / `comptime_float` | 任意精度，只能在编译期存在 |
| 固定长度序列 | `[N]T` | 长度是类型的一部分，直接包含元素 |
| 运行时长度视图 | `[]T` / `[]const T` | 指针加长度，不拥有数据 |
| 单个对象地址 | `*T` / `*const T` | 指向一个值，不可为 null |
| 无长度连续地址 | `[*]T` | 可索引，但边界来自外部契约 |
| 可能缺失 | `?T` | 必须通过 `if`、`while` 或 `orelse` 解包 |
| 可能失败 | `E!T` | 使用 `try`、`catch` 或条件解包 |
| 多字段同时存在 | `struct` | 积类型，同时也是声明容器 |
| 有限命名取值 | `enum` | 可指定整数标签，`switch` 可检查穷尽性 |
| 多分支共享存储 | `union` | 裸 union 不追踪活跃字段 |
| 安全的互斥分支 | `union(enum)` | 标签与 payload 绑定 |
| 生成类型 | `comptime ... type` | 类型是编译期值，不需要独立模板语言 |

## 常见误区

### 把 `[]const u8` 当成有所有权的 String

切片只是视图。保存它之前必须确认底层内存活得足够久；需要拥有副本时，应通过调用者提供的 allocator 明确复制。

### 所有索引和长度都习惯性使用 `usize`

内存大小和容器索引适合 `usize`，协议字段则应使用协议规定的位宽。过早转换为 `usize` 会丢失领域约束，也可能掩盖跨平台差异。

### 用 `null` 表示所有失败

查不到数据可以是 optional；格式错误、权限失败和 I/O 失败应使用错误联合。选择 `?T` 还是 `E!T`，本质上是在决定调用方是否需要知道原因。

### 用裸 union 建业务状态

如果程序需要知道当前分支，就使用 `union(enum)`。裸 union 适合确实由外部标签或底层布局管理活跃字段的边界代码。

### 认为 `const` 等于深度不可变

`const` 限制通过当前绑定进行修改的能力，不是跨整个程序的不可变性证明。别名、指针有效期和线程同步仍然需要单独设计。

### 把所有泛型都写成反射框架

类型作为值很强大，但许多 API 只需要一个普通 `comptime T: type` 参数。先选择最小抽象，只有确实需要枚举字段或生成布局时再使用 `@typeInfo`。

## 结论：类型就是布局、能力与分支的说明书

Zig 的基本类型之所以值得单独开一个 CHAPTER，不是因为名字多，而是因为它们构成了这门语言的机器模型。

整数携带位宽，数组携带长度，切片携带运行时边界，指针携带访问能力和限定符；optional 让缺失可见，错误联合让失败可见，tagged union 让互斥状态可见，`type` 和 `comptime` 又让这些形状可以在编译期被普通代码构造。

当类型选得准确，Zig 代码会显得异常直接：数据在哪里、占多大、能否修改、可能缺什么、会怎样失败，都可以从签名附近读出来。反过来，如果把所有数据都压成 `usize`、裸指针和返回码，再现代的语法也只是在重写 C。

## 下一章

下一章将深入指针、切片与内存生命周期：分析单项指针、多项指针、哨兵、对齐和 C 指针的区别，并进一步说明 allocator、所有权约定与 `defer` 如何共同形成 Zig 的资源管理方式。

## 延伸阅读

- [Zig 0.16.0 Language Reference：Primitive Types](https://ziglang.org/documentation/0.16.0/#Primitive-Types)
- [Zig 0.16.0 Language Reference：Pointers](https://ziglang.org/documentation/0.16.0/#Pointers)
- [Zig 0.16.0 Language Reference：Errors](https://ziglang.org/documentation/0.16.0/#Errors)
- [Zig 0.16.0 Language Reference：comptime](https://ziglang.org/documentation/0.16.0/#comptime)
