---
title: Zig allocator 与资源管理：没有隐藏分配之后，责任如何流动
date: 2026-09-15
excerpt: 理解 Allocator、alloc/free、create/destroy、defer/errdefer，以及如何让拥有型对象、借用视图和失败回滚形成清晰契约。
chapter: 类型与数据
chapterOrder: 4
---

## “没有隐藏分配”不是“没有堆”

Zig 经常强调没有隐藏的内存分配，但真实程序依然需要动态数组、字符串、哈希表和生命周期跨越当前栈帧的数据。

它拒绝的不是堆，而是由语言、运算符或普通 API 在调用者不知情时偷偷选择堆。需要分配的函数通常把 `std.mem.Allocator` 作为参数：

```zig
const std = @import("std");

fn duplicate(
    allocator: std.mem.Allocator,
    source: []const u8,
) ![]u8 {
    return allocator.dupe(u8, source);
}
```

从签名可以直接看到：

- 函数可能因为分配失败而返回错误；
- 分配策略由调用者选择；
- 返回值是一段新缓冲区，而不是对输入的借用；
- 调用方最终必须用兼容的 allocator 释放它。

最后一条并没有编码在 `[]u8` 类型里。Zig 让分配动作可见，却不会自动追踪所有权；资源管理仍依赖 API 契约。

> 本文以 Zig 0.16.0 为基准。0.16 的部分标准库容器采用 unmanaged 风格：容器值不保存 allocator，修改和释放时显式传入 allocator。

## `Allocator` 是能力接口，不是一块堆

`std.mem.Allocator` 是一个统一的分配接口。调用者可以把不同策略放到同一参数位置：

- 通用堆分配器；
- 测试分配器；
- arena；
- 固定缓冲区分配器；
- 追踪、限制或包装其他 allocator 的自定义实现。

因此，接收 `Allocator` 的函数只要求“这里能够申请、调整或释放内存”，不要求内存一定来自操作系统堆。

```zig
fn buildMessage(
    allocator: std.mem.Allocator,
    prefix: []const u8,
    body: []const u8,
) ![]u8 {
    const result = try allocator.alloc(u8, prefix.len + body.len);
    errdefer allocator.free(result);

    @memcpy(result[0..prefix.len], prefix);
    @memcpy(result[prefix.len..], body);
    return result;
}
```

业务函数不需要知道 allocator 背后是 arena 还是逐块释放的堆。策略被推迟到系统组装位置，而不是埋进领域逻辑。

这和依赖注入相似，但对象不是为了可替换而存在；传入的是一项很具体的底层能力。

## `alloc/free` 与 `create/destroy`

申请多个连续元素时使用 `alloc`，返回切片：

```zig
const bytes = try allocator.alloc(u8, 4096);
defer allocator.free(bytes);
```

申请单个对象时使用 `create`，返回单项指针：

```zig
const Node = struct {
    value: i32,
    next: ?*Node = null,
};

const node = try allocator.create(Node);
defer allocator.destroy(node);

node.* = .{ .value = 42 };
```

配对关系必须准确：

| 取得资源 | 释放资源 | 返回形状 |
|---|---|---|
| `allocator.alloc(T, n)` | `allocator.free(slice)` | `[]T` |
| `allocator.dupe(T, source)` | `allocator.free(slice)` | `[]T` |
| `allocator.create(T)` | `allocator.destroy(pointer)` | `*T` |

不要对 `alloc` 的结果调用 `destroy`，也不要把一个 allocator 分配的内存交给不兼容的 allocator 释放。切片只保存地址和长度，不记得自己的分配器。

### 初始化和分配是两件事

`create(T)` 只取得足够容纳 `T` 的存储，不会调用隐藏构造函数：

```zig
const node = try allocator.create(Node);
errdefer allocator.destroy(node);

node.* = .{
    .value = 42,
    .next = null,
};
```

先分配，再显式写入有效值。若初始化还会继续失败，`errdefer` 保证错误路径释放已经取得的存储。

同样，`destroy` 只归还内存，不会自动递归释放字段。若 `Node` 内部拥有其他资源，类型自己的 `deinit` 必须先处理它们，再由外层销毁对象存储。

## `defer`：把清理绑定到词法作用域

```zig
const file = try openFile();
defer file.close();

try process(file);
```

`defer` 在当前作用域退出时执行，无论是正常走到结尾、`return`，还是通过 `try` 提前返回错误。它把清理动作放在资源取得位置附近，避免所有出口重复代码。

多个 `defer` 按后进先出顺序执行：

```zig
const first = try acquireFirst();
defer first.release();

const second = try acquireSecond();
defer second.release();
```

离开作用域时先释放 `second`，再释放 `first`，与资源依赖的常见建立顺序相反。

但 `defer` 不是析构函数：

- 它绑定到语句所在的词法作用域，不绑定到类型；
- 移动或复制一个值不会自动转移清理钩子；
- 容器字段不会因为外层变量离开作用域自动 `deinit`；
- API 设计必须说明谁登记清理。

这使控制流非常明确，也意味着忘记 `defer` 就真的可能泄漏。

## `errdefer`：只回滚失败路径

构造一个拥有多个资源的对象时，成功路径要把所有权交给返回值，失败路径则必须逐步回滚：

```zig
const Profile = struct {
    name: []u8,
    tags: [][]u8,

    fn deinit(self: *Profile, allocator: std.mem.Allocator) void {
        for (self.tags) |tag| allocator.free(tag);
        allocator.free(self.tags);
        allocator.free(self.name);
        self.* = undefined;
    }
};

fn createProfile(
    allocator: std.mem.Allocator,
    name: []const u8,
    raw_tags: []const []const u8,
) !Profile {
    const owned_name = try allocator.dupe(u8, name);
    errdefer allocator.free(owned_name);

    const tags = try allocator.alloc([]u8, raw_tags.len);
    errdefer allocator.free(tags);

    var initialized: usize = 0;
    errdefer {
        for (tags[0..initialized]) |tag| allocator.free(tag);
    }

    for (raw_tags, 0..) |tag, index| {
        tags[index] = try allocator.dupe(u8, tag);
        initialized += 1;
    }

    return .{
        .name = owned_name,
        .tags = tags,
    };
}
```

每完成一步，就登记对应失败回滚：

1. `owned_name` 取得后，后续失败要释放它；
2. `tags` 切片取得后，后续失败要释放外层存储；
3. 每复制一个 tag，就推进 `initialized`；
4. 任意复制失败，只清理真正初始化过的元素；
5. 成功返回时，所有 `errdefer` 都不会执行，所有权进入 `Profile`。

这种写法比异常栈展开更显式，也比手写每个错误分支更集中。它体现了 Zig 的失败原子性：构造要么返回完整对象，要么撤销已经完成的部分。

## 拥有型对象需要 `deinit`

Zig 没有语言级析构协议，但标准库和社区形成了清楚的命名习惯：

- `init` / `initCapacity`：建立一个可用对象；
- `deinit`：释放对象拥有的资源；
- `create` / `destroy`：常表示对象本身也动态分配；
- `clone` / `dupe`：产生独立所有权；
- `borrow` / `slice` / `items`：返回借用视图；
- `take` / `move`：所有权发生转移时应明确说明。

调用模式通常是：

```zig
var value = try Resource.init(allocator);
defer value.deinit(allocator);
```

如果类型内部保存 allocator，也可能让 `deinit()` 无参数。两种方式都存在，关键是整个 API 保持一致。

### `deinit` 后把值设为 `undefined`

```zig
fn deinit(self: *Profile, allocator: std.mem.Allocator) void {
    // 释放字段……
    self.* = undefined;
}
```

这不是释放所必需的步骤，却能表达对象已不可再用，并帮助 Debug 构建更早暴露 use-after-deinit。它不能阻止其他别名继续访问已经释放的内存，也不构成编译期证明。

## 标准库容器：值与 allocator 分离

Zig 0.16 中，常见的 `ArrayList` 用法是：

```zig
const std = @import("std");

fn collectEven(
    allocator: std.mem.Allocator,
    values: []const u32,
) !std.ArrayList(u32) {
    var result: std.ArrayList(u32) = .empty;
    errdefer result.deinit(allocator);

    for (values) |value| {
        if (value % 2 == 0) {
            try result.append(allocator, value);
        }
    }
    return result;
}
```

调用者接管返回容器：

```zig
var values = try collectEven(allocator, &.{ 1, 2, 3, 4 });
defer values.deinit(allocator);
```

容器值可以先用 `.empty` 创建，不发生分配；`append` 真正需要扩容时才使用传入 allocator。这个 API 让可能分配的位置在调用点保持可见。

还要区分：

- `values.items` 是借用容器存储的切片；
- 再次 append 可能重新分配，使旧的 `items` 和元素指针失效；
- `deinit` 后所有视图都失效；
- 返回 `ArrayList` 是转移所有权，返回 `[]const T` 通常只是借用。

```zig
const before = values.items;
try values.append(allocator, 6);
// 不应再假设 before 仍指向当前容器存储
```

动态容器最容易制造的错误，不一定是忘记释放，而是扩容后继续使用旧指针。

## FixedBufferAllocator：把动态策略放进固定内存

allocator 接口不等于操作系统堆。固定缓冲区也能提供同一能力：

```zig
const std = @import("std");

var backing: [1024]u8 = undefined;
var fixed = std.heap.FixedBufferAllocator.init(&backing);
const allocator = fixed.allocator();

const bytes = try allocator.alloc(u8, 128);
defer allocator.free(bytes);
```

所有内存都来自 `backing`。容量耗尽时返回 `error.OutOfMemory`，不会悄悄退回全局堆。

它适合：

- 嵌入式或 freestanding 环境；
- 请求级临时工作区；
- 测试算法在固定内存预算内是否成立；
- 禁止意外堆分配的实时路径。

`free` 是否能回收任意中间块取决于具体 allocator；代码只应依赖 `Allocator` 契约，不应把某个策略的偶然行为当成通用保证。

## ArenaAllocator：批量回收一组同生命周期对象

如果大量小对象共享生命周期，逐个 `free` 会让代码和元数据都变复杂。arena 让所有分配最终一起释放：

```zig
const std = @import("std");

fn handleRequest(parent: std.mem.Allocator) !void {
    var arena = std.heap.ArenaAllocator.init(parent);
    defer arena.deinit();

    const allocator = arena.allocator();
    const path = try allocator.dupe(u8, "/api/orders");
    const buffer = try allocator.alloc(u8, 4096);

    _ = path;
    _ = buffer;
}
```

`arena.deinit()` 一次释放 arena 从父 allocator 取得的全部内存。逻辑上不再需要逐个释放 `path` 和 `buffer`。

arena 的优点也是风险：

- 生命周期非常简单；
- 单次分配成本通常较低；
- 但单个大对象不再提前归还；
- 把 arena 内的指针保存到 arena 生命周期之外会整体悬垂；
- 长生命周期 arena 容易把逻辑泄漏变成持续增长。

适合 arena 的不是“任何需要性能的地方”，而是具有清晰批量生命周期的地方，例如一次编译、一次请求、一次场景加载或一次 AST 构建。

## allocator 的选择应该发生在边界

库函数通常接收 allocator，而不是在内部创建全局分配器：

```zig
fn parseDocument(
    allocator: std.mem.Allocator,
    input: []const u8,
) !Document {
    // ...
}
```

应用入口再选择策略：

```zig
pub fn main(init: std.process.Init) !void {
    const allocator = init.gpa;
    var document = try parseDocument(allocator, input);
    defer document.deinit(allocator);
}
```

这样做带来几个好处：

- 测试可以换成能检测泄漏的 `std.testing.allocator`；
- 短生命周期任务可以换成 arena；
- 嵌入式目标可以使用固定缓冲区；
- 库不会把平台堆选择强加给调用者；
- OOM 仍通过同一错误路径传播。

相反，如果每个小函数都临时创建 allocator，资源边界会变得破碎，调用者也无法控制内存预算。

## OOM 是正常错误路径，不是理论边角

返回 `!T` 的分配 API要求调用方承认内存不足。最简单的策略是向上传播：

```zig
const copy = try allocator.dupe(u8, source);
```

也可以在明确能降级时恢复：

```zig
const cache = allocator.alloc(Entry, capacity) catch |err| switch (err) {
    error.OutOfMemory => return useUncachedPath(),
};
```

不要在底层库里随意把 OOM 转成 panic，除非 API 明确声明无法恢复。调用者可能运行在固定内存、测试故障注入或软实时环境中，失败是其策略的一部分。

更重要的是，函数在任意一次分配失败后都不能留下半初始化对象或泄漏先前资源。`errdefer`、初始化计数和先构造后提交，是应对 OOM 的核心工具。

## 先构造，再提交

修改已有对象时，直接边分配边覆盖字段很危险：

```zig
fn rename(
    self: *Profile,
    allocator: std.mem.Allocator,
    new_name: []const u8,
) !void {
    const replacement = try allocator.dupe(u8, new_name);

    const old = self.name;
    self.name = replacement;
    allocator.free(old);
}
```

这里先完成可能失败的分配，再修改对象。若分配失败，`self` 完全不变；成功后交换所有权并释放旧值。

复杂更新可以先构造临时对象：

```zig
var replacement = try Profile.init(allocator, input);
errdefer replacement.deinit(allocator);

var old = self.*;
self.* = replacement;
old.deinit(allocator);
```

这相当于手动建立事务边界。Zig 不会因为没有异常就自动获得强异常安全；失败原子性来自更新顺序。

## 借用、复制与转移必须使用不同语言

假设一个对象保存名字：

```zig
const BorrowedUser = struct {
    name: []const u8,
};
```

这更像借用：调用者必须保证 `name` 在对象使用期间有效。

拥有型版本需要复制并提供释放：

```zig
const OwnedUser = struct {
    name: []u8,

    fn init(
        allocator: std.mem.Allocator,
        name: []const u8,
    ) !OwnedUser {
        return .{ .name = try allocator.dupe(u8, name) };
    }

    fn deinit(self: *OwnedUser, allocator: std.mem.Allocator) void {
        allocator.free(self.name);
        self.* = undefined;
    }
};
```

两者字段形状近似，但生命周期完全不同。类型名、构造方法和文档应把差异放大，而不是让调用者猜测一个 `[]u8` 是否拥有内存。

如果函数接管调用者提供的 buffer，也应在命名中表达转移，并规定失败时所有权归谁。最糟糕的 API 是“成功时接管、某些失败时也接管、另一些失败时又不接管”。

## 分配器相关的常见错误

### 返回新切片，却没有说明谁释放

`fn normalize(...) ![]u8` 仅凭类型无法区分借用与拥有。优先使用 `dupe`、`alloc`、`Owned...` 等名字，或让返回类型封装 `deinit`。

### 对容器 `deinit` 后继续使用 `items`

`items` 只是借用视图。容器释放或重新分配后，它不会自动变成 null。

### 把 arena 当作防泄漏工具

arena 只保证最终批量释放，不保证中间内存占用合理，也不阻止逃逸指针。

### 构造失败时只释放最外层对象

外层切片可能包含多个已经初始化的拥有型元素。必须记录初始化进度并逐一回滚。

### 用错误 allocator 释放

切片不记得来源。跨模块传递拥有型内存时，要么统一 allocator，要么让拥有对象保存释放策略。

### 依赖 `defer` 自动跟随所有权转移

`defer allocator.free(buffer)` 捕获的是当前作用域的清理安排。把 `buffer` 返回给调用者前必须确保成功路径不会再释放它；通常使用 `errdefer` 而不是无条件 `defer`。

## 一份资源 API 检查表

设计或审查一个 Zig 资源类型时，可以逐项确认：

1. 哪些字段拥有资源，哪些只是借用？
2. 初始化是否可能分配，错误集合是否包含 OOM？
3. 每一步初始化失败后，已取得资源如何回滚？
4. 成功返回后，调用者用什么方法释放？
5. 释放是否需要同一个 allocator？
6. 容器扩容会使哪些指针和切片失效？
7. clone 是深复制还是共享？
8. move 后旧值是否仍可能被 `deinit`？
9. arena 中的数据有没有逃逸到更长生命周期？
10. API 能否改成调用者提供缓冲区，从根本上避免所有权转移？

这些问题比“有没有写 defer”更重要。`defer` 只是执行清理的工具，所有权边界才决定清理应该属于谁。

## 结论：显式分配最终要落到显式所有权

allocator 参数让内存策略成为依赖，`alloc/free` 与 `create/destroy` 让分配和释放配对，`defer` 把清理绑定到作用域，`errdefer` 则让多阶段构造可以在失败时回滚。

但 `[]u8` 本身不区分借用和拥有，容器也不会因为离开作用域自动析构。Zig 的资源安全来自一组可审计的约定：明确的初始化与释放函数、成功后所有权转移、失败时原子回滚，以及在系统边界选择 allocator。

“没有隐藏分配”的真正后半句应当是：既然分配已经可见，谁拥有、谁释放、失败后谁收拾，也必须同样可见。

## 下一篇

下一篇将把视线从生命周期转向内存表示：普通、`extern` 与 `packed` struct 的区别，字段对齐和 padding 如何产生，enum、tagged union、optional 又怎样影响布局与 ABI。

## 延伸阅读

- [Zig 0.16.0 Language Reference：Choosing an Allocator](https://ziglang.org/documentation/0.16.0/#Choosing-an-Allocator)
- [Zig 0.16.0 Language Reference：Heap Allocation Failure](https://ziglang.org/documentation/0.16.0/#Heap-Allocation-Failure)
- [Zig 0.16.0 Language Reference：defer](https://ziglang.org/documentation/0.16.0/#defer)
- [Zig 0.16.0 Language Reference：errdefer](https://ziglang.org/documentation/0.16.0/#errdefer)
