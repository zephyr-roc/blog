---
title: Zig comptime：当类型也是值，泛型就不再需要另一套语言
date: 2026-09-15
excerpt: Zig 用同一套语法执行编译期计算、生成类型并检查接口；理解 comptime，也就理解了它的泛型与反射。
chapter: 类型与数据
chapterOrder: 7
---

## Zig 只有一套语言

许多语言为泛型、宏、注解处理和构建脚本分别设计机制。Zig 的选择更统一：普通 Zig 代码只要输入在编译期已知，就可以在编译期执行；类型本身也是一种编译期值。

```zig
fn maxValue(comptime T: type) T {
    return std.math.maxInt(T);
}

const byte_max = maxValue(u8);   // 255
const word_max = maxValue(u16);  // 65535
```

参数 `T` 的类型是 `type`，并由 `comptime` 要求在编译期已知。函数的返回类型又依赖 `T`，所以编译器会为具体调用分析出对应代码。

这里没有独立的模板语法，也没有运行时的 `Class<T>` 对象。理解泛型之前，需要先理解“何时一个值是编译期已知的”。

> 本文以 Zig 0.16.0 为基准。反射 API 会随语言版本调整，尤其应以对应版本文档中的 `@typeInfo` 定义为准。

## 编译期已知不等于写了 `const`

`const` 表示绑定不可重新赋值，`comptime` 表示值必须在编译期间确定，两者不是同义词：

```zig
const runtime_value = readFromNetwork(); // const，但只能运行时知道
const fixed_value = 12;                  // 编译期可知
```

一个表达式能否在编译期执行，取决于它依赖的数据和操作。读取网络、系统时间或普通运行时参数显然不能；整数运算、遍历编译期数组、构造类型则可以。

可以用 `comptime` block 明确要求一段代码在编译时完成：

```zig
const table = comptime blk: {
    var values: [8]u8 = undefined;
    for (0..values.len) |index| {
        values[index] = @intCast(index * index);
    }
    break :blk values;
};
```

最终产物只包含计算好的数组，不需要在程序启动后再运行初始化循环。

## 返回 `type` 就是在生成类型

既然类型是编译期值，函数也可以返回类型：

```zig
fn Pair(comptime A: type, comptime B: type) type {
    return struct {
        first: A,
        second: B,
    };
}

const Entry = Pair([]const u8, u32);

const item: Entry = .{
    .first = "zig",
    .second = 16,
};
```

大写函数名不是语法要求，而是 Zig 社区常用约定：它提示调用结果是一个类型，阅读体验接近内建容器 `ArrayList(T)`。

一个有容量参数的容器也可以这样生成：

```zig
fn RingBuffer(comptime T: type, comptime capacity: usize) type {
    if (capacity == 0) {
        @compileError("RingBuffer capacity must be greater than zero");
    }

    return struct {
        const Self = @This();

        items: [capacity]T = undefined,
        head: usize = 0,
        len: usize = 0,

        fn push(self: *Self, value: T) !void {
            if (self.len == capacity) return error.Full;
            const index = (self.head + self.len) % capacity;
            self.items[index] = value;
            self.len += 1;
        }

        fn pop(self: *Self) ?T {
            if (self.len == 0) return null;
            const value = self.items[self.head];
            self.head = (self.head + 1) % capacity;
            self.len -= 1;
            return value;
        }
    };
}
```

`capacity` 成为数组长度和取模常量；`T` 决定元素表示。`RingBuffer(u8, 64)` 与 `RingBuffer(Packet, 8)` 是两个具体类型，各自只包含需要的代码和数据。

## `anytype`：让调用点决定参数类型

如果函数只需要对参数执行少量操作，不一定要显式写 `comptime T: type`：

```zig
fn twice(value: anytype) @TypeOf(value) {
    return value + value;
}
```

`anytype` 不是一种可以在运行时容纳任意值的动态类型。它表示该参数的具体类型由每个调用点决定，函数随后针对这个类型被分析。

```zig
const a: u16 = twice(@as(u16, 21));
const b: f32 = twice(@as(f32, 1.5));
```

如果传入不支持 `+` 的类型，错误会在实例化该调用时出现。这种写法简洁，但公共 API 若依赖很多隐含操作，错误信息可能离真正的接口意图很远。

比较稳妥的原则是：

- 参数只需要一两个显然的操作时，`anytype` 很合适；
- 类型决定字段、返回值或数据布局时，显式接收 `comptime T: type`；
- 复杂接口应主动验证必要声明，或接受一个明确的函数/配置对象。

## 反射读取类型事实

`@typeInfo(T)` 返回一个 tagged union，描述类型属于整数、指针、结构体、函数等哪一类。它只能在编译期使用：

```zig
fn fieldCount(comptime T: type) usize {
    return switch (@typeInfo(T)) {
        .@"struct" => |info| info.fields.len,
        else => @compileError("fieldCount expects a struct type"),
    };
}

const User = struct {
    id: u32,
    active: bool,
};

comptime {
    if (fieldCount(User) != 2) @compileError("unexpected User shape");
}
```

`@hasField(T, "name")` 和 `@hasDecl(T, "parse")` 适合做较小的能力检查：

```zig
fn requireId(comptime T: type) void {
    if (!@hasField(T, "id")) {
        @compileError(@typeName(T) ++ " must contain an id field");
    }
}
```

这并不是 Java/Kotlin 的运行时反射。编译完成后，程序未必保留字段名表或类型对象；反射主要帮助编译器选择并验证要生成的代码。

## `inline for` 展开编译期结构

普通 `for` 在运行时遍历集合；`inline for` 会为每次迭代分别生成代码。当迭代对象来自类型信息时，这正好能处理不同字段类型：

```zig
fn reset(comptime T: type, value: *T) void {
    inline for (@typeInfo(T).@"struct".fields) |field| {
        @field(value, field.name) = std.mem.zeroes(field.type);
    }
}
```

每轮中的 `field.name` 和 `field.type` 都是编译期已知的，所以 `@field` 能访问名字不同、类型也不同的字段。若换成普通运行时循环，就不存在一个统一类型来代表“本轮的任意字段值”。

这类能力适合实现序列化器、格式化器、测试辅助和绑定生成，但也很容易变成难读的“编译器内程序”。优先写普通明确代码；只有重复模式确实由类型结构决定时，才让反射接管。

## lazy analysis 让无关分支不必成立

泛型函数不会在声明时把所有可能类型全部验证一遍。编译器针对实际调用分析需要的路径：

```zig
fn describe(value: anytype) []const u8 {
    const T = @TypeOf(value);
    return switch (@typeInfo(T)) {
        .int, .comptime_int => "integer",
        .pointer => "pointer",
        else => "other",
    };
}
```

配合编译期 `if`，可以让某段代码只为满足条件的类型存在：

```zig
fn zero(comptime T: type) T {
    if (@typeInfo(T) == .bool) return false;
    return 0;
}
```

当 `T` 是 `bool` 时，后一条返回不会作为运行时分支存在；当 `T` 是整数时，前一条路径被裁掉。这里的重点不是“绕过类型检查”，而是类型本身已经决定了要分析哪一种实现。

如果编译期计算过于复杂，编译器会限制求值分支数，避免一次失控计算拖垮构建。确有合理需求时可以用 `@setEvalBranchQuota` 调整，但它更像最后的容量旋钮，不是算法复杂度的解决方案。

## 编译错误也是 API 的一部分

没有 trait 或 interface 约束语法时，Zig 泛型常被称为鸭子类型：只要实际操作能编译，类型就适用。小函数里这很自然；大型公共 API 则应该尽早给出与领域相关的错误：

```zig
fn Repository(comptime Adapter: type) type {
    if (!@hasDecl(Adapter, "load")) {
        @compileError("repository adapter must declare load");
    }
    if (!@hasDecl(Adapter, "save")) {
        @compileError("repository adapter must declare save");
    }

    return struct {
        adapter: Adapter,
    };
}
```

这样的检查仍不如 Rust trait 那样形成独立、可复用且受语言约束的接口，也不像 Kotlin interface 能用于运行时多态。它的价值是把错误从模板实现深处移动到类型入口，并用项目自己的词汇解释要求。

另一种更显式的方式，是传入一组函数指针或 vtable。前者适合编译期多态和内联，后者适合运行时替换实现；不要因为会写 `anytype` 就把所有多态都变成编译期泛型。

## comptime 不是免费的运行时抽象

把工作移到编译期可以消除运行时分支、预计算常量并生成专门代码，但成本不会凭空消失：

- 每种实例化可能增加编译时间；
- 针对许多类型生成相似函数，可能扩大二进制；
- 复杂反射让错误信息和源码导航变差；
- 过度依赖编译器实现细节，会让版本升级更困难。

先问“这个差异真的影响类型或布局吗”。若只是运行时的一份配置，普通参数往往更清楚；若容量决定数组长度、字段决定生成代码、算法必须知道整数位宽，comptime 才处在最自然的位置。

## 与 Kotlin 和 Rust 的差异

Kotlin 泛型通常经过 JVM type erasure，reified 类型参数只在 inline 函数中获得部分运行时类型信息；注解处理、反射和编译器插件又是不同工具。它适合对象与框架生态，但很难用普通 Kotlin 函数直接生成一个具有 `[N]T` 布局的新类型。

Rust 用泛型、trait、const generics、过程宏和 `const fn` 分别提供强大能力。它的 trait 契约和诊断往往比 Zig 的鸭子类型更严格，代价是机制更多。Zig 把大量需求压到“编译期执行普通代码 + 类型反射”这一条轴上，概念更少，却要求库作者自己维护清晰边界。

Zig 的简洁不在于 comptime 什么都自动完成，而在于不为代码生成发明第二套表达方式。循环还是循环，函数还是函数，`if` 还是 `if`；变化的只是输入是否已知，以及结果是一个值还是一个类型。

## 第二章收束：类型是一份机器契约

从基本数值、数组与 union，到指针、allocator、布局、错误集合和 comptime，第二章始终围绕同一个主题：Zig 类型描述的不只是业务分类，还描述机器能够验证的事实。

- 位宽与数组长度决定存储形状；
- 指针和 slice 决定是否携带长度、能否修改；
- allocator 参数让内存来源和释放责任可追踪；
- `extern` 与 `packed` 明确布局承诺；
- optional 与 error union 区分缺失和失败；
- `type` 与 comptime 把这些事实带进代码生成。

接下来不再继续横向罗列语法。第三章会沿着 Ziglings 的练习顺序，从一个个无法编译或行为不完整的小程序出发，亲手把这些规则连成肌肉记忆。章节入口已经留好，具体练习记录由作者完成。

## 延伸阅读

- [Zig 0.16.0 Language Reference：comptime](https://ziglang.org/documentation/0.16.0/#comptime)
- [Zig 0.16.0 Language Reference：Generic Data Structures](https://ziglang.org/documentation/0.16.0/#Generic-Data-Structures)
- [Zig 0.16.0 Language Reference：@typeInfo](https://ziglang.org/documentation/0.16.0/#typeInfo)
- [Zig 0.16.0 Language Reference：@compileError](https://ziglang.org/documentation/0.16.0/#compileError)

