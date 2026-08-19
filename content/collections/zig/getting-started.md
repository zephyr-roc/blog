---
title: Zig：为什么它和其他语言不一样？
date: 2026-07-20
excerpt: Zig 的核心设计哲学是"无隐藏的控制流，无隐藏的内存分配"。这个原则贯穿了语言的每一个角落。
---

## Zig 的哲学

Zig 由 Andrew Kelley 于 2016 年创建，目标是成为一门**比 C 更好的 C**——不是 C 的超集，而是一门全新设计的系统编程语言，解决 C 的那些痛点。

核心原则：

> **没有隐藏的控制流。没有隐藏的内存分配。**

这意味着：没有异常（只有错误联合类型），没有隐式构造函数/析构函数，内存分配需要显式传入分配器。

## Hello World

```zig
const std = @import("std");

pub fn main() !void {
    const stdout = std.io.getStdOut().writer();
    try stdout.print("你好，Zig！\n", .{});
}
```

注意 `!void`：函数可能返回错误，`try` 在出错时向上传播。

## 错误处理

Zig 使用错误联合类型（Error Union），而非异常：

```zig
const FileError = error{
    NotFound,
    PermissionDenied,
};

fn readConfig(path: []const u8) FileError![]u8 {
    // ...
}

// 调用方必须处理错误
const config = readConfig("config.json") catch |err| {
    std.debug.print("读取失败：{}\n", .{err});
    return;
};
```

## 编译期执行

Zig 的 `comptime` 允许在编译期执行任意代码：

```zig
fn fibonacci(comptime n: u32) u32 {
    if (n <= 1) return n;
    return fibonacci(n - 1) + fibonacci(n - 2);
}

// 这个值在编译期计算完成，运行时是一个常量
const fib10 = fibonacci(10);
```

## 与 C 互操作

Zig 可以直接调用 C 代码，也可以作为 C 编译器使用：

```bash
# 用 Zig 编译 C 代码
zig cc -o hello hello.c
```

这让 Zig 成为了一个实用的 C 构建工具，即使你不写 Zig 代码。
