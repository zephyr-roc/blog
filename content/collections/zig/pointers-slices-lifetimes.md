---
title: Zig 指针与切片：类型能描述边界，却不会替你守住生命周期
date: 2026-09-15
excerpt: 从单项指针、多项指针、切片和哨兵出发，理解 const、对齐、optional pointer，以及 Zig 把哪些内存安全责任留给程序员。
chapter: 类型与数据
chapterOrder: 3
---

## 指针首先是一份能力说明

在 C 中，`T *` 可以指向一个值、数组首元素、可能为空的地址，甚至只是一个等待转换的整数地址。大量信息存在于注释和调用约定中。

Zig 没有消灭指针，而是把常见约定拆成不同类型：

| 类型 | 表达的契约 |
|---|---|
| `*T` | 指向恰好一个可修改的 `T` |
| `*const T` | 指向恰好一个只读的 `T` |
| `[*]T` | 指向连续的多个 `T`，但不携带长度 |
| `[]T` | 指向连续的多个 `T`，并携带运行时长度 |
| `[*:S]T` | 多项指针，以值 `S` 作为终点 |
| `[:S]T` | 带长度且保证结尾哨兵为 `S` 的切片 |
| `[*c]T` | C ABI 边界使用的 C 指针 |
| `?*T` | 一个有效单项指针或 `null` |

这些类型的机器表示可能很接近，能力却不同。Zig 的安全并不来自禁止直接访问内存，而来自让“知道多少信息”尽量体现在类型上。

> 本文以 Zig 0.16.0 为基准。它讨论的是语言保证与 API 责任，不把 Debug 模式下的运行时检查误当成生命周期证明。

## 单项指针：指向一个确定的值

使用 `&value` 取得地址，用 `pointer.*` 解引用：

```zig
fn increment(value: *u32) void {
    value.* += 1;
}

var count: u32 = 41;
increment(&count);
```

函数签名已经说明三件事：

- 调用者必须提供一个有效的 `u32`；
- 函数可以修改它；
- 指针不能为 `null`。

如果只需要读取，应缩窄能力：

```zig
fn isEven(value: *const u32) bool {
    return value.* % 2 == 0;
}
```

`*u32` 可以强制转换为 `*const u32`，反方向则不成立。被调用者不应获得超过任务所需的能力，这和切片参数优先使用 `[]const T` 是同一个原则。

### `const` 修饰的是访问路径

```zig
var count: u32 = 1;
const writable: *u32 = &count;
const readonly: *const u32 = writable;

writable.* += 1;
// readonly.* += 1; // 编译错误
```

`readonly` 不能修改底层值，但底层值仍可能通过 `writable` 改变。Zig 的 `const` 不是全局深度不可变证明，而是当前访问路径的权限。

这点和 Kotlin 的 `val` 有相似之处：绑定本身不变，不代表对象在所有地方都不变；区别是 Zig 把指针指向的可变性也直接放进类型。

## 多项指针：地址连续，但边界来自外部

`[*]T` 表示从某个地址开始存在多个连续元素，可以索引和进行指针运算，但指针自身没有 `len`：

```zig
fn sumFirst(pointer: [*]const u16, count: usize) u32 {
    var total: u32 = 0;
    for (0..count) |index| {
        total += pointer[index];
    }
    return total;
}

const values = [_]u16{ 10, 20, 30 };
const total = sumFirst(&values, values.len);
```

这里的安全依赖 `pointer` 与 `count` 必须匹配。传入 100 并不会因为指针类型而自动发现真实数组只有三个元素。

所以应用内部 API 通常不应把地址和长度拆开。多项指针适合：

- 调用只提供裸地址和独立长度的 C API；
- 指针算法确实需要移动起点；
- 长度通过别的协议字段管理；
- 构造切片之前的底层边界代码。

一旦长度已知，尽早把约定收紧成切片。

## 切片：地址和长度组成的运行时视图

切片 `[]T` 在概念上包含 `ptr` 与 `len`。它不拥有元素，也不决定元素存在哪里：

```zig
fn checksum(bytes: []const u8) u32 {
    var result: u32 = 0;
    for (bytes) |byte| result +%= byte;
    return result;
}

const packet = [_]u8{ 1, 2, 3, 4 };
const body: []const u8 = packet[1..3];
const result = checksum(body);
```

数组切片语法 `start..end` 使用左闭右开区间。`packet[1..3]` 包含下标 1、2，长度为 2。

切片的价值不是让所有访问绝对安全，而是让边界成为值的一部分：

- `bytes.len` 与数据一起传递；
- `for (bytes)` 不需要独立长度；
- 启用运行时安全检查时，越界索引会触发检查；
- 子切片继续保留自己的边界。

不过，如果切片已经悬垂，长度再准确也没有意义。

## 数组指针、切片和多项指针如何转换

```zig
var storage = [_]u8{ 10, 20, 30, 40 };

const array_pointer: *[4]u8 = &storage;
const slice: []u8 = &storage;
const many: [*]u8 = &storage;
```

三者不是同一类型：

- `*[4]u8` 指向一个完整数组，长度 4 在子类型中；
- `[]u8` 是运行时有界视图；
- `[*]u8` 只有起点。

固定长度可以参与编译期检查：

```zig
fn encryptBlock(block: *[16]u8) void {
    for (block) |*byte| byte.* ^= 0xaa;
}
```

这个函数不能误收 15 或 17 字节的数组。若算法允许任意长度，就接收 `[]u8`；若算法要求精确块大小，数组指针比切片加运行时断言更准确。

选择类型时应从最强契约开始：

1. 长度编译期固定：`*[N]T`；
2. 长度运行时已知：`[]T`；
3. 只有外部协议知道长度：`[*]T` 加独立边界；
4. C ABI 要求：`[*c]T`。

## 字符串字面量和哨兵

字符串字面量的类型类似 `*const [N:0]u8`：长度在类型里，末尾还有一个额外的 0 哨兵。它可以缩窄为普通字节切片：

```zig
const literal = "hello";
const bytes: []const u8 = literal;
```

也可以保留哨兵保证：

```zig
fn acceptsCString(text: [:0]const u8) void {
    _ = text;
}

acceptsCString("hello");
```

`[:0]const u8` 同时携带运行时长度，并保证 `text[text.len]` 是 0。它比 `[]const u8` 多一条契约，因此可以安全地继续传给需要 NUL 结尾的数据边界。

哨兵不是只为字符串存在：

```zig
const sequence: [3:255]u8 = .{ 10, 20, 30 };
const view: [:255]const u8 = &sequence;
```

这里结束值是 255。哨兵只说明如何识别终点，不说明元素编码、所有权或生命周期。

### 从无界哨兵指针恢复切片

`[*:0]const u8` 知道最终会遇到 0，却不直接存储长度。可以通过切片操作建立有界视图，但这一步必须确信哨兵确实可达：

```zig
fn firstFive(pointer: [*:0]const u8) [:0]const u8 {
    return pointer[0..5 :0];
}
```

切片语法中的 `:0` 声明结束位置之后存在哨兵。如果实际内存不满足契约，问题不会被类型系统凭空修复。越接近外部边界，越需要验证而不是断言。

## optional pointer：空地址必须进入类型

普通 Zig 指针不能为 `null`：

```zig
var value: u32 = 42;
var pointer: ?*u32 = &value;

if (pointer) |valid| {
    valid.* += 1;
}

pointer = null;
```

`?*T` 把空值可能性放在类型里，调用者必须先解包。对齐大于 0 的普通指针通常可以直接用地址 0 表示 `null`，因此 optional pointer 往往与普通指针大小相同：

```zig
comptime {
    if (@sizeOf(?*u8) != @sizeOf(*u8)) {
        @compileError("unexpected optional pointer layout");
    }
}
```

不要由此推导所有 `?T` 都“免费”。`?u8` 需要区分 256 个数值和 `null`，通常必须保存额外状态；是否存在 niche 优化取决于底层类型的无效表示。

## 对齐也是指针契约

CPU 和 ABI 可能要求某些值位于特定地址边界。Zig 可以把对齐写进指针类型：

```zig
fn loadWord(pointer: *align(4) const u32) u32 {
    return pointer.*;
}
```

一个普通 `*const u32` 已经具有 `u32` 的自然对齐；显式 `align(N)` 常出现在更特殊的缓冲区、链接段、SIMD 或外部 ABI 中。

从较弱对齐恢复较强对齐时，需要 `@alignCast`：

```zig
fn asAligned(pointer: *align(1) const u32) *const u32 {
    return @alignCast(pointer);
}
```

`@alignCast` 不会移动数据。它是在声明运行时地址确实满足目标对齐；安全检查开启时，错误声明会触发检查。能在创建缓冲区时保留正确类型，就不要到使用点再靠 cast 猜测。

## `volatile` 不是线程同步

内存映射硬件寄存器可能在程序控制之外变化，访问不能被普通优化消除。这时使用 volatile 指针：

```zig
fn readStatus(register: *volatile const u32) u32 {
    return register.*;
}
```

`volatile` 表示每次读写都是可观察的外部行为。它不提供原子性、内存序或线程间 happens-before 关系；多线程同步应使用原子操作和锁。

把共享内存问题归因于“编译器优化”，然后随手加 `volatile`，是从 C 时代延续下来的典型误区。

## C 指针是边界类型，不是内部默认

`[*c]T` 为 C 互操作保留了更宽松的语义，包括可为 0、可与整数 0 比较，以及对单项/多项用途不作严格区分。

这正是它不适合内部 API 的原因。进入 Zig 边界后，应尽快验证：

- 地址是否为空；
- 数据有几个元素；
- 是否存在终止哨兵；
- 谁拥有数据；
- 数据能活多久；
- 是否允许修改。

然后转换成 `?*T`、`[]T`、`[:0]T` 或其他更严格类型。C 指针负责兼容，严格指针负责推理。

## 生命周期：切片不会拥有它指向的字节

下面的思路是错误的：

```zig
fn broken() []const u8 {
    var buffer = [_]u8{ 'z', 'i', 'g' };
    return buffer[0..];
}
```

函数返回后，`buffer` 的栈存储已不再属于调用者可以使用的有效对象，返回切片会悬垂。Zig 可能在某些构建配置或优化结果下暴露错误，也可能暂时“看起来可用”；语言没有借用检查器系统地拒绝这类返回值。

正确设计必须明确数据来自哪里。

### 方案一：调用者提供缓冲区

```zig
fn writeName(buffer: []u8) ![]const u8 {
    const name = "zig";
    if (buffer.len < name.len) return error.BufferTooSmall;

    @memcpy(buffer[0..name.len], name);
    return buffer[0..name.len];
}

var storage: [16]u8 = undefined;
const name = try writeName(&storage);
```

返回切片借用调用者的 `storage`，生命周期关系虽没有写成泛型参数，却从 API 结构上保持清晰。

### 方案二：返回静态存储

```zig
fn protocolName() []const u8 {
    return "quic";
}
```

字符串字面量具有静态存储期，返回其切片安全。

### 方案三：由 allocator 创建所有权

```zig
const std = @import("std");

fn duplicate(
    allocator: std.mem.Allocator,
    source: []const u8,
) ![]u8 {
    return allocator.dupe(u8, source);
}
```

这时函数返回拥有型缓冲区，但 Zig 的 `[]u8` 类型本身不记录“必须 free”。所有权是 API 契约的一部分，调用方要使用同一 allocator 释放。下一篇会完整讨论这一模型。

## 所有权不是类型构造，而是 API 关系

Rust 可以从 `String`、`&str` 与生命周期参数中表达大量所有权关系。Zig 的数组和切片只描述表示与访问能力，不自动编码所有者身份。

因此，阅读 Zig API 时要问：

1. 参数是借用，还是所有权转移？
2. 返回切片来自参数、静态存储、对象字段，还是新分配？
3. 谁调用 `deinit` / `free`？使用哪个 allocator？
4. 对象移动后，内部自引用是否仍然有效？
5. 回调或线程会不会保存这个指针？

这些问题不能只靠 `[]T` 得到答案。优秀的 Zig API 会通过命名、文档、初始化/释放函数配对和调用者提供缓冲区来缩小含糊空间。

## 别名：两个合法指针也可能组成非法程序

```zig
fn copyAndClear(destination: []u8, source: []u8) void {
    @memcpy(destination, source);
    @memset(source, 0);
}
```

如果两个切片重叠，`@memcpy` 的前提就不成立。每个切片单独看都有有效地址和长度，组合起来仍可能违反操作约定。

需要支持重叠复制时使用 `@memmove`；需要独占访问时，应让 API 和调用流程保证不会同时保留别名。Zig 不会像 Rust 那样根据 `&mut` 排他借用规则自动证明这件事。

这也是为何“Zig 有边界检查”不能简化成“Zig 内存安全”：

- 边界检查解决索引是否落在切片长度内；
- 生命周期解决内存是否仍有效；
- 别名规则解决多条访问路径能否同时存在；
- 对齐解决地址是否适合目标类型；
- 初始化状态解决字节是否已经形成有效值。

它们是不同维度。

## `undefined`：延迟初始化，不是任意值容器

```zig
var header: [8]u8 = undefined;
try reader.readSliceAll(&header);
```

`undefined` 适合立刻被完整写入的存储，避免无意义的预填充。读取尚未初始化的内存属于非法行为；在 Debug 模式中，Zig 可能用特殊字节填充来帮助暴露问题，但 Release 构建不能依赖这种行为。

如果写入可能只覆盖一部分，应跟踪已初始化长度：

```zig
var buffer: [1024]u8 = undefined;
const count = try readSome(&buffer);
const initialized = buffer[0..count];
```

对外暴露 `initialized`，而不是整个 `buffer`。类型和长度共同表达“哪些字节现在可以读”。

## 一个更可靠的解析器边界

下面的游标借用输入切片，只通过索引推进，不保存无界指针：

```zig
const Cursor = struct {
    input: []const u8,
    position: usize = 0,

    const Self = @This();

    fn remaining(self: Self) usize {
        return self.input.len - self.position;
    }

    fn take(self: *Self, count: usize) ![]const u8 {
        if (count > self.remaining()) return error.UnexpectedEnd;

        const start = self.position;
        self.position += count;
        return self.input[start..self.position];
    }

    fn takeByte(self: *Self) !u8 {
        return (try self.take(1))[0];
    }
};
```

这个类型没有拥有输入，却建立了几条局部不变量：

- `position` 不会超过 `input.len`；
- 每次 `take` 都先检查剩余长度；
- 返回切片一定来自输入切片；
- 解析器销毁不会释放输入。

Zig 无法在类型层证明返回切片不比输入活得久，但接口把数据来源保持得足够明显。系统代码经常不是在“有证明”和“完全裸奔”之间二选一，而是用更强的表示降低需要人工维护的约定数量。

## 与 Rust 引用的关键差别

| 问题 | Rust `&T` / `&mut T` | Zig 指针 / 切片 |
|---|---|---|
| 空值 | 引用不能为 null，使用 `Option<&T>` | 普通指针不能为 null，使用 `?*T` |
| 边界 | 切片引用携带长度 | Zig 切片携带长度 |
| 生命周期 | 编译器跟踪并验证关系 | 由程序员维护 |
| 可变别名 | `&mut T` 具有排他规则 | `*T` 不自动建立全局排他借用 |
| 指针运算 | 安全引用不支持 | `[*]T` 等底层类型支持 |
| 裸指针危险区 | 解引用通常需要 `unsafe` | 没有统一 `unsafe` 语法边界 |

Zig 指针语法更细，不等于它比 Rust 引用系统证明得更多。它擅长描述“指针是什么形状”，Rust 还试图证明“指针何时有效、能否同时访问”。

## 设计切片 API 的实用规则

- 只读输入优先用 `[]const T`；
- 需要原地修改才用 `[]T`；
- 固定块大小用 `*[N]T`，避免重复检查长度；
- 不要把 `[*]T` 与长度拆开穿过多层业务代码；
- 返回借用切片时，让来源尽量出现在参数或接收者上；
- 返回新分配切片时，在名字和文档中说明释放责任；
- C 指针只停留在 FFI 边界，验证后立即收紧；
- `undefined` 缓冲区只暴露已经初始化的部分；
- 重叠内存使用 `@memmove`，不要把 `@memcpy` 当作通用复制；
- `volatile` 用于设备内存，不用于普通线程同步。

## 结论：类型能收紧边界，生命周期仍是一份承诺

Zig 把 C 指针背后的多种约定拆成了单项指针、多项指针、数组指针、切片、哨兵指针和 optional pointer。长度、可变性、哨兵、对齐与 volatile 都可以进入类型，这让 API 比裸 `T *` 更容易审计。

但切片不拥有字节，`const` 不证明深度不可变，`*T` 也不建立 Rust 式排他借用。一个类型正确的指针仍可能悬垂，两个各自正确的切片仍可能非法重叠。

Zig 的路线不是让编译器接管全部生命周期，而是尽量把边界信息保留下来，再要求程序员用调用者缓冲区、静态存储、allocator 契约和局部封装维护剩余责任。

## 下一篇

下一篇将讨论 allocator 与资源管理：为什么 `[]u8` 不等于拥有型容器，`alloc/free`、`create/destroy`、`defer/errdefer` 如何配合，以及怎样设计分配失败时仍保持一致状态的 API。

## 延伸阅读

- [Zig 0.16.0 Language Reference：Pointers](https://ziglang.org/documentation/0.16.0/#Pointers)
- [Zig 0.16.0 Language Reference：Slices](https://ziglang.org/documentation/0.16.0/#Slices)
- [Zig 0.16.0 Language Reference：Sentinel-Terminated Pointers](https://ziglang.org/documentation/0.16.0/#Sentinel-Terminated-Pointers)
- [Zig 0.16.0 Language Reference：Lifetime and Ownership](https://ziglang.org/documentation/0.16.0/#Lifetime-and-Ownership)
