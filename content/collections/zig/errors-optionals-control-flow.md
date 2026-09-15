---
title: Zig 错误、optional 与控制流：让每条提前退出都留在类型里
date: 2026-09-15
excerpt: optional、error union、switch 与 defer 共同描述成功、缺失、失败和清理路径，让控制流不再藏在异常或空引用之后。
chapter: 类型与数据
chapterOrder: 6
---

## 控制流也是类型设计

读取配置时，至少可能出现三种结果：找到一个合法值、根本没有配置、配置存在但内容错误。许多语言把它们折叠成 `null`、异常和若干约定；Zig 倾向于让函数签名直接区分这些状态：

```zig
fn readPort(text: ?[]const u8) !?u16 {
    const raw = text orelse return null;
    const port = try std.fmt.parseInt(u16, raw, 10);
    if (port == 0) return error.ReservedPort;
    return port;
}
```

返回类型 `!?u16` 可以从右向左阅读：成功时得到一个“可能缺失的 `u16`”，失败时得到 error。这里 `null` 不是失败，文本无法解析或端口被保留才是失败。

Zig 的 `if`、`switch`、循环、`try`、`catch`、`defer` 看似是控制流语法，其实都围绕同一个目标：把每条离开当前路径的理由说清楚。

> 本文以 Zig 0.16.0 为基准。标准库具体错误集合可能演进，示例更关注语言层的组合方式。

## optional 表达“没有值”

`?T` 只有两种状态：`null` 或一个 `T`。检查时可以捕获内部值：

```zig
fn printNickname(nickname: ?[]const u8) void {
    if (nickname) |name| {
        std.debug.print("nickname: {s}\n", .{name});
    } else {
        std.debug.print("no nickname\n", .{});
    }
}
```

如果拿到的是 optional pointer，还可以捕获指针并修改原值：

```zig
fn increment(value: ?*u32) void {
    if (value) |pointer| {
        pointer.* += 1;
    }
}
```

`orelse` 适合给出默认值或提前退出：

```zig
const timeout = configured_timeout orelse 5_000;
const token = maybe_token orelse return error.MissingToken;
```

右侧是惰性求值的：只有左侧为 `null` 时才会执行。由于 `return`、`break` 和 `continue` 不需要产生普通值，它们自然能出现在这里。

optional 不携带失败原因。如果调用者需要知道“为什么没有”，应该使用 error union 或带 tag 的 union，而不是不断增加特殊 `null` 约定。

## error set 是一组可命名的失败值

error 本身不是异常对象。可以先声明一个有限集合：

```zig
const DecodeError = error{
    Empty,
    InvalidPrefix,
    Overflow,
};

fn decodeId(text: []const u8) DecodeError!u32 {
    if (text.len == 0) return error.Empty;
    if (!std.mem.startsWith(u8, text, "id:")) {
        return error.InvalidPrefix;
    }
    return std.fmt.parseInt(u32, text[3..], 10) catch error.Overflow;
}
```

`DecodeError!u32` 是 error union：要么是集合中的一个 error，要么是 `u32`。它不像 JVM exception 那样从任意深处沿调用栈隐式穿过所有签名。

小范围函数可以让编译器推导错误集合：

```zig
fn inferred(text: []const u8) !u32 {
    return std.fmt.parseInt(u32, text, 10);
}
```

但公共 API 的显式 error set 更像一份稳定契约。调用者能看见允许哪些失败；实现也不会因为内部换了一个依赖，就不经意扩大对外错误面。

多个组件的错误集合可以合并：

```zig
const ReadError = error{ NotFound, PermissionDenied };
const ParseError = error{ InvalidSyntax, OutOfRange };
const LoadError = ReadError || ParseError;
```

这不是把异常层级继承起来，而是构造一个包含两边成员的新集合。

## `try` 是可见的错误传播

`try expression` 在成功时解包 payload，在失败时立即把 error 返回给调用者：

```zig
fn loadLimit(text: []const u8) !usize {
    const value = try std.fmt.parseInt(usize, text, 10);
    if (value > 10_000) return error.LimitTooLarge;
    return value;
}
```

它大致等价于一个展开的 `catch`：

```zig
const value = std.fmt.parseInt(usize, text, 10) catch |err| {
    return err;
};
```

区别不在运行时魔法，而在代码阅读：每个可能传播失败的调用前都有 `try`，失败路径不会藏在普通函数调用外观下。

`catch` 则负责恢复、映射或终止：

```zig
const workers = std.fmt.parseInt(u8, text, 10) catch |err| switch (err) {
    error.InvalidCharacter => 4,
    error.Overflow => return error.TooManyWorkers,
};
```

`catch` 本身是表达式，所以恢复分支必须产生与成功 payload 兼容的值，或者通过 `return` 等方式离开。

## `if` 与 `switch` 会产生值

Zig 不把表达式和语句切成两个完全不同的世界：

```zig
const transport = if (encrypted) "https" else "http";

const retry_delay: u32 = switch (attempt) {
    0 => 100,
    1...3 => 500,
    else => 2_000,
};
```

每个可到达分支必须得到兼容的结果类型。这样“变量先声明、在多个分支里再赋值”的临时状态常常可以消失。

对于 enum 和 tagged union，`switch` 还能检查穷尽性：

```zig
const State = enum { idle, running, stopped };

fn label(state: State) []const u8 {
    return switch (state) {
        .idle => "idle",
        .running => "running",
        .stopped => "stopped",
    };
}
```

新增 enum 成员后，这个函数会停止编译，直到开发者决定新状态的语义。若随手写一个 `else`，就主动放弃了这种提醒；只有确实希望把未来成员归到同一路径时才应该这么做。

## block 可以给表达式命名并返回值

复杂计算不必拆成可变临时变量。带标签的 block 可以用 `break :label value` 产生结果：

```zig
const category = blk: {
    if (score >= 90) break :blk "excellent";
    if (score >= 60) break :blk "passed";
    break :blk "retry";
};
```

循环也可以借标签把值交给外层：

```zig
const found = for (items) |item| {
    if (item.id == wanted_id) break item;
} else null;
```

这里循环完整结束时得到 `null`，提前找到时得到 `item`，最终类型是 optional。控制流的形状直接对应结果类型。

## `defer` 负责离开作用域，`errdefer` 只负责失败

手动资源管理最怕提前返回漏掉清理。`defer` 在当前作用域退出时执行，无论正常返回还是失败：

```zig
var file = try std.fs.cwd().openFile(path, .{});
defer file.close();

const data = try readAll(file);
return decode(data);
```

多个 defer 按后进先出执行，与资源的构造顺序相反：

```zig
acquireA();
defer releaseA();

acquireB();
defer releaseB(); // 先释放 B，再释放 A
```

`errdefer` 只在当前函数通过 error 离开时执行，特别适合实现“要么完整构造，要么回滚”：

```zig
fn duplicate(allocator: std.mem.Allocator, input: []const u8) ![]u8 {
    const output = try allocator.alloc(u8, input.len);
    errdefer allocator.free(output);

    @memcpy(output, input);
    try validate(output);
    return output;
}
```

成功返回后，所有权交给调用者，`errdefer` 不运行；`validate` 失败时，刚分配的内存会被释放。调用者不需要知道实现走到了哪一步。

还可以捕获具体错误用于日志或计数：

```zig
errdefer |err| std.log.err("loading failed: {s}", .{@errorName(err)});
```

不要把 `errdefer` 当作 catch：它负责副作用和清理，不会吞掉或替换正在传播的 error。

## 一条完整的解析管线

把 optional、error union 和表达式控制流放在一起，可以得到边界清晰的配置解析：

```zig
const Mode = enum { development, production };

const Config = struct {
    port: u16,
    mode: Mode,
};

fn parseMode(text: []const u8) !Mode {
    if (std.mem.eql(u8, text, "dev")) return .development;
    if (std.mem.eql(u8, text, "prod")) return .production;
    return error.UnknownMode;
}

fn parseConfig(port_text: ?[]const u8, mode_text: ?[]const u8) !Config {
    const port = if (port_text) |text|
        try std.fmt.parseInt(u16, text, 10)
    else
        8080;

    const mode_raw = mode_text orelse "dev";
    return .{
        .port = port,
        .mode = try parseMode(mode_raw),
    };
}
```

从签名和局部表达式就能回答：

- 缺少端口时使用默认值；
- 缺少模式时使用 `dev`；
- 非法数字和未知模式是失败；
- 成功后 `Config` 内部不再带 optional。

一个常见设计原则是：**在系统边界接受不确定性，验证后尽快返回更强的内部类型。** 如果每层函数都传递 `?[]const u8`，调用者就会在整个程序里重复同一套检查。

## `unreachable` 不是普通错误处理

`unreachable` 声明“这条路径按照程序不变量绝不可能发生”。如果运行时真的到达它，程序进入非法行为；安全构建通常会触发 panic，但不能把这种检查当成可恢复错误语义。

```zig
fn directionName(value: u1) []const u8 {
    return switch (value) {
        0 => "left",
        1 => "right",
    };
}
```

这里不需要 `else => unreachable`，因为 `u1` 的值域已经被穷尽。若外部输入可能是 2，就应在转换前返回 error，而不是用 `unreachable` 压掉编译器警告。

经验上可以这样区分：

- 用户输入、网络数据、文件损坏：返回 error；
- 一个合法但缺失的业务值：使用 optional；
- 程序员破坏了内部不变量：断言或 panic；
- 语言和类型已经证明不可能：才使用 `unreachable`。

## 与 Kotlin 和 Rust 的差异

Kotlin 用 nullable type 很好地表达缺失，但失败常由 exception 穿过未声明的函数边界；`try` 也是一个能产生值的表达式。Zig 把可恢复失败放进 error union，并要求传播点显式出现，因此 API 签名比异常约定更接近真实控制流。

Rust 的 `Option<T>`、`Result<T, E>` 与 `?` 能表达相似模型，而且借用与析构由编译器提供更强保证。Zig 的 error payload 只有 error 名称，没有任意结构化对象；作为交换，error set 合并和 `try` 非常轻量。需要额外上下文时，通常在边界记录日志，或设计一个带 payload 的 tagged union。

Zig 不试图消除失败。它让成功、缺失、失败和“程序不变量已损坏”成为四种不同的代码形状。只要分类准确，调用者就不必从 `null`、魔法返回值和隐式异常里猜测发生了什么。

## API 检查清单

完成一个可能失败的函数前，可以逐项确认：

1. “没有值”是正常状态还是失败？分别选择 optional 或 error；
2. 公共 API 是否值得声明有限 error set？
3. `try` 传播的错误是否仍属于当前抽象层？必要时用 `catch` 映射；
4. 每个成功前获得的资源，是否立刻配对了 `defer` 或 `errdefer`？
5. `switch` 的 `else` 是否遮住了未来新增分支？
6. 外部不可信输入是否错误地走向 `unreachable`？

类型并不会替你决定业务含义，但它能迫使这些决定留在代码里。Zig 的控制流之所以简洁，不是因为失败路径变少了，而是因为每条路径都有明确的位置。

## 延伸阅读

- [Zig 0.16.0 Language Reference：Optionals](https://ziglang.org/documentation/0.16.0/#Optionals)
- [Zig 0.16.0 Language Reference：Errors](https://ziglang.org/documentation/0.16.0/#Errors)
- [Zig 0.16.0 Language Reference：defer](https://ziglang.org/documentation/0.16.0/#defer)
- [Zig 0.16.0 Language Reference：errdefer](https://ziglang.org/documentation/0.16.0/#errdefer)

