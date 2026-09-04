---
title: Rust 类型推导与强制转换：上下文如何确定类型
date: 2026-09-04
excerpt: 从约束求解出发，分析类型推导的边界、强制转换位置、LUB 合并、Deref coercion、unsizing、never type、as 与 TryFrom 的不同语义。
chapter: 类型系统
chapterOrder: 6
---

## 类型省略不等于动态类型

Rust 允许省略大量局部类型标注，但每个表达式在编译完成后仍有确定类型。类型推导只是由编译器根据上下文补全类型，不会把类型检查推迟到运行时。

```rust
let mut values = Vec::new();
values.push(10_u16);
values.push(20);
```

`Vec::new()` 本身没有说明元素类型，第一次 `push` 提供了 `u16` 约束，因此 `values` 被确定为 `Vec<u16>`；第二个无后缀整数也必须与这个元素类型统一。

可以把局部推导理解为约束求解：

```text
Vec<T>::new()        -> values: Vec<T>
values.push(10_u16)  -> T = u16
values.push(20)      -> 20 的类型必须是 u16
```

如果约束互相冲突，编译器不会在运行时选择：

```rust
let mut values = Vec::new();
values.push(10_u16);
// values.push("ten"); // 期待 u16，得到 &str
```

推导减少的是重复标注，而不是静态类型系统的精度。

## 信息可以从表达式两侧传播

类型信息既能从实参流向结果，也能从期望结果反向约束表达式：

```rust
let port = "8080".parse::<u16>().unwrap();

let workers: usize = "16".parse().unwrap();
```

第一种写法通过 turbofish 指定 `parse` 的类型参数；第二种写法由变量标注把 `usize` 传回 `parse` 的返回类型。

赋值、函数参数、返回类型和结构体字段都可能提供期望类型：

```rust
fn takes_u64(value: u64) -> u64 {
    value
}

struct Config {
    retries: u8,
}

let number = takes_u64(5);        // 字面量按 u64 检查
let config = Config { retries: 3 }; // 字面量按 u8 检查
```

这里没有发生运行时数值转换。无后缀字面量在类型确定前可以接受上下文约束，最终直接以目标类型构造。

## `_` 是待推导类型，不是通配类型

下划线可以要求编译器补全一个能够从上下文确定的类型位置：

```rust
let numbers: Vec<_> = (0_u8..4).collect();
let result: Result<u32, _> = "42".parse();
```

`Vec<_>` 中的 `_` 被推导为 `u8`。`Result<u32, _>` 中的错误类型由 `FromStr for u32` 的实现确定。

`_` 不表示“任意类型的容器”，也不会让 `Vec` 同时容纳多种无关类型。它只是一个必须由同一轮约束求解得到具体答案的推导变量。

公开 item 的签名需要成为独立、稳定的契约，不能把 `_` 留给调用点猜测：

```rust
// fn parse_id(text: &str) -> _ {
//     text.parse::<u64>().unwrap()
// }
```

函数参数、返回类型、`static` 项和类型别名等 API 边界应显式写出类型。函数体中的局部变量则可以利用完整上下文推导。

## 推导不会跨越缺少约束的空白

只有存在足够信息时，泛型构造才能具体化：

```rust
// let values = Vec::new();
```

如果 `values` 从未以任何能确定元素类型的方式使用，`Vec<T>` 中的 `T` 没有答案。解决方式是给出真正表达设计意图的标注：

```rust
let values: Vec<String> = Vec::new();
```

类似地，`parse` 可以生成许多实现 `FromStr` 的类型：

```rust
// let value = "127".parse().unwrap();
```

后续没有为结果提供约束时，编译器不能仅凭字符内容决定它应当是 `u8`、`i32`、IP 地址还是某个领域类型。

类型推导基于程序声明的类型关系，不基于字符串值的语义猜测。

## 数值字面量有默认回退，但没有隐式拓宽

没有后缀且没有其他有效约束的整数字面量通常回退为 `i32`，浮点字面量通常回退为 `f64`：

```rust
let integer = 10; // i32
let float = 2.5;  // f64
```

回退只解决未受约束的字面量类型，不建立数值类型之间的子类型关系。已经确定为 `u8` 的值不会自动拓宽成 `u32`：

```rust
let small: u8 = 10;
let large: u32 = 20;

// let total = small + large;
let total = u32::from(small) + large;
assert_eq!(total, 30);
```

Rust 不把“数值范围更小”解释为类型子集。`u8` 与 `u32` 有不同布局、运算 trait 实现和溢出语义，因此转换必须由代码明确表达。

字面量可以受上下文直接确定，而已经生成的值需要转换，这两个过程不能混为一谈。

## 闭包推导一次后就是具体类型

闭包参数和返回值通常从首次使用或期望的 `Fn` 约束中推导：

```rust
let identity = |value| value;

let text = identity(String::from("rust"));
// let number = identity(42); // 闭包参数已确定为 String
```

这个闭包不是泛型函数。第一次调用使其参数和返回值都确定为 `String`，之后不能再用 `i32` 调用同一个闭包值。

真正的泛型函数会把类型参数写入 item 签名：

```rust
fn identity<T>(value: T) -> T {
    value
}

let text = identity(String::from("rust"));
let number = identity(42_i32);
```

两个调用分别为 `T` 选择不同具体类型。闭包可以捕获环境并拥有匿名具体类型；泛型 item 则为每次调用保留类型选择维度。

当闭包需要特定签名时，期望类型能直接约束它：

```rust
fn apply_twice<F>(value: i32, operation: F) -> i32
where
    F: Fn(i32) -> i32,
{
    operation(operation(value))
}

let result = apply_twice(3, |value| value + 1);
assert_eq!(result, 5);
```

`Fn(i32) -> i32` 为闭包参数和返回值提供了完整上下文。

## 推导、强制转换和显式转换是三种机制

类型看似“自动变化”时，需要先区分三类行为：

| 机制 | 是否改变已确定的类型 | 是否需要特定位置 | 是否可能失败 |
|---|---:|---:|---:|
| 类型推导 | 否，负责确定尚未确定的类型 | 依赖上下文约束 | 约束不足或冲突时编译失败 |
| coercion 强制转换 | 是，执行受限的隐式类型变化 | 是，只在 coercion site | 不提供运行时失败分支 |
| 显式转换 | 是，由 `as` 或转换 API 请求 | 由表达式显式触发 | 取决于具体转换方式 |

下面三行分别体现三种机制：

```rust
let inferred = 1_u8;                // 推导变量类型为 u8
let shared: &u8 = &mut 1_u8;        // &mut u8 coercion 为 &u8
let widened = inferred as u32;      // 显式数值 cast
```

`From`、`Into`、`TryFrom`、`TryInto` 和 `FromStr` 属于普通 trait API。它们表达语义转换，不属于语言定义的隐式 coercion。

## coercion 只发生在指定位置

coercion 是受语言严格限制的隐式操作。它不会在任意子表达式之间搜索转换链，而是在目标类型明确或能从明确类型传播的位置发生。

常见 coercion site 包括：

- 带显式类型的 `let` 绑定；
- `static` 和 `const` 项；
- 函数调用的实参；
- 结构体、联合体和枚举变体的字段；
- 函数返回表达式及显式 `return`；
- 已有变量的赋值右侧。

```rust
fn read_only(value: &i32) -> i32 {
    *value
}

let mut number = 7;

let copied = read_only(&mut number);
let shared: &i32 = &mut number;

assert_eq!(*shared, copied);
```

显式绑定类型和函数参数类型都提供了 `&i32` 目标，因此 `&mut i32` 可以弱化为共享引用。

没有期望类型时，表达式保持原类型：

```rust
let reference = &mut number; // &mut i32
```

coercion 不是全局规范化步骤。是否处于 coercion site 会影响看似相同的表达式能否转换。

## 传播表达式把目标类型传给内部表达式

数组、元组、括号、代码块和部分控制流表达式可以把外层的目标类型传播到内部：

```rust
let mut first = 1;
let mut second = 2;

let shared: [&i32; 2] = [&mut first, &mut second];
```

数组目标元素类型是 `&i32`，因此每个元素位置都成为 coercion site。

返回类型也能穿过代码块约束尾表达式：

```rust
fn choose(value: &mut String, empty: bool) -> &str {
    if empty {
        ""
    } else {
        value
    }
}
```

函数返回类型为 `&str`。`if` 两个分支的尾表达式都在相应目标下检查，`&mut String` 经可变引用弱化和 deref coercion 得到 `&str`。

## LUB coercion 为多个分支寻找共同类型

某些表达式没有预先给定唯一目标类型，却要求所有组成部分产生同一种结果。编译器会尝试计算 least upper bound coercion，逐步寻找各候选类型能够共同转换到的目标。

LUB coercion 用于：

- `if` 各分支；
- `match` 各分支；
- 数组元素；
- 带标签代码块与 `loop` 的多个 `break` 值；
- 具有多个返回点的闭包或函数。

```rust
let owned = String::from("owned");

let text = if std::env::args().len() > 1 {
    owned.as_str()
} else {
    "default"
};
```

两个分支分别产生来自 `String` 的 `&str` 与 `&'static str`。生命周期子类型和 coercion 共同得到一个覆盖实际可用区域的 `&str`。

数组也会寻找共同元素类型：

```rust
fn increment(value: i32) -> i32 {
    value + 1
}

fn double(value: i32) -> i32 {
    value * 2
}

let operations: [fn(i32) -> i32; 2] = [increment, double];
```

每个函数 item 有自己的具体类型，但都能 coercion 为相同的函数指针类型。

LUB 不是普通继承体系中的类层次合并，其精确求解也不是所有类型组合都存在答案。无法找到合法共同目标时，必须显式选择枚举、trait object 或其他统一表示。

## 可变引用可以弱化，不能反向增强

`&mut T` 可以隐式 coercion 为 `&T`：

```rust
fn length(value: &String) -> usize {
    value.len()
}

let mut text = String::from("coercion");
let len = length(&mut text);
assert_eq!(len, 8);
```

转换丢弃的是通过当前引用修改目标的能力。共享引用不能反向变成独占引用，因为类型系统无法仅凭一个共享访问入口证明别名唯一。

```rust
let shared = &text;
// let unique: &mut String = shared;
```

这与生命周期缩短一致：coercion 可以安全地减少能力或有效范围，不能凭空增加排他性与寿命。

裸指针也存在相似的单向弱化：`*mut T` 可以 coercion 为 `*const T`。但裸指针本身不携带安全借用保证，解引用仍需要 unsafe 并满足有效性、对齐、初始化和别名规则。

## deref coercion 转换的是引用目标

如果 `T: Deref<Target = U>`，`&T` 可以在 coercion site 转成 `&U`。`String` 到 `str` 是最常见的例子：

```rust
fn first_byte(text: &str) -> Option<u8> {
    text.as_bytes().first().copied()
}

let owned = String::from("Rust");
let first = first_byte(&owned);
assert_eq!(first, Some(b'R'));
```

实参原本是 `&String`，参数要求 `&str`。由于 `String: Deref<Target = str>`，编译器插入 deref coercion。

转换可以沿 `Deref` 链重复：

```rust
use std::rc::Rc;

let text = Rc::new(String::from("shared"));
let slice: &str = &text;
```

概念上的目标链为：

```text
&Rc<String> -> &String -> &str
```

`DerefMut` 则允许 `&mut T` coercion 为 `&mut U`。此外，可变引用还可以丢弃可变性，最终得到共享目标引用。

`Deref` 会影响大量隐式行为，应主要用于指针式封装。把普通领域对象实现为另一个类型的 `Deref` 目标，可能让方法解析、API 边界和不变量暴露得难以判断。

## 方法调用的自动引用与解引用是独立查找过程

`value.method()` 不只是普通函数调用的简写。编译器会构造候选接收者类型：重复解引用接收者，在每一步加入值、共享引用和可变引用候选，并在末端尝试数组到切片等 unsizing，然后按规则查找可见方法。

```rust
let boxed = Box::new(String::from("method"));
let length = boxed.len();
```

`Box<String>` 没有自己的 `len` 方法。接收者查找沿 `Box<String>`、`String`、`str` 等候选类型前进，并应用所需的 autoref，最终找到 `str::len`。

完全限定调用能绕过点语法中的推测：

```rust
let text = String::from("abc");
let bytes = str::as_bytes(&text);
assert_eq!(bytes, b"abc");
```

方法接收者查找与普通实参 coercion 相关，但不是同一算法。出现同名方法、泛型接收者或多层智能指针时，应分别判断：

1. 接收者候选如何通过 autoderef 和 autoref 生成；
2. 在哪个候选上找到了 inherent 或 trait 方法；
3. 其余普通参数是否在各自 coercion site 转换。

## coercion 不会替泛型参数实现 trait

某个值能 coercion 到实现了 trait 的类型，不代表原类型也实现了该 trait：

```rust
trait ReadMarker {}

impl ReadMarker for &i32 {}

fn require_marker<T: ReadMarker>(_value: T) {}

let mut number = 1;
let unique = &mut number;

// require_marker(unique);
```

`&mut i32` 可以在目标明确时 coercion 为 `&i32`，但泛型调用首先要为 `T` 选择实参的类型。这里 `T = &mut i32`，而该类型没有实现 `ReadMarker`。

可以先建立明确目标：

```rust
let shared: &i32 = unique;
require_marker(shared);
```

trait resolution 不会任意插入 coercion 来搜索“附近某个实现”。否则实现选择会依赖复杂转换路径，破坏上一章讨论的一致性与可预测性。方法接收者的自动调整是专门规定的例外查找过程，不能推广到所有泛型约束。

## unsized coercion 建立宽指针

数组 `[T; N]` 的长度属于类型和静态布局的一部分，切片 `[T]` 则是动态大小类型。引用数组可以 coercion 为引用切片：

```rust
fn sum(values: &[i32]) -> i32 {
    values.iter().sum()
}

let values = [1, 2, 3, 4];
assert_eq!(sum(&values), 10);
```

`&[i32; 4]` 是只含数据地址的引用，`&[i32]` 需要同时携带数据地址和长度元数据。unsized coercion 构造目标宽指针，不复制数组元素。

结构体类型也可以在满足布局条件时对最后一个字段执行 unsizing。标准库指针类型如 `Box<T>` 还能从定长目标转成相应的动态大小目标：

```rust
let boxed_array = Box::new([10_u8, 20, 30]);
let boxed_slice: Box<[u8]> = boxed_array;
assert_eq!(boxed_slice.len(), 3);
```

具体类型到 `dyn Trait`，以及 `dyn SubTrait` 到 supertrait object 的 upcasting，也属于 unsized coercion。它们如何构造数据指针与虚表元数据、哪些 trait 满足 dyn compatibility，将在下一章集中分析。

## 函数 item 可以 coercion 为函数指针

每个函数 item 都有独立、不可直接写出的零大小类型：

```rust
fn add_one(value: i32) -> i32 {
    value + 1
}

fn add_two(value: i32) -> i32 {
    value + 2
}
```

当目标需要统一表示时，函数 item 可以 coercion 为 `fn` 指针：

```rust
let operation: fn(i32) -> i32 = add_one;
let operations: [fn(i32) -> i32; 2] = [add_one, add_two];

assert_eq!(operation(5), 6);
```

不捕获环境的闭包也可以转为兼容的 `fn` 指针：

```rust
let triple: fn(i32) -> i32 = |value| value * 3;
assert_eq!(triple(4), 12);
```

捕获闭包包含捕获状态，不能缩减成只有代码地址的普通函数指针：

```rust
let factor = 3;
let multiply = |value| value * factor;

// let pointer: fn(i32) -> i32 = multiply;
```

这类闭包需要通过具体闭包类型的泛型参数或 trait object 传递。

## 发散表达式通过 never-to-any 参与合并

`return`、`break`、`continue`、`panic!` 和无限 `loop` 等表达式不会按正常路径产生值。它们的类型是 never type `!`，可以在 coercion site 转换到所需目标类型。

```rust
fn parse_port(text: &str) -> u16 {
    match text.parse() {
        Ok(port) => port,
        Err(error) => panic!("invalid port: {error}"),
    }
}
```

成功分支产生 `u16`，失败分支发散。`panic!` 不需要制造一个假的 `u16`，因为该路径永远不会把值交给后续代码；`!` 可以在分支合并时 coercion 为目标类型。

同样的机制让提前返回自然地参与表达式：

```rust
fn first(values: &[i32]) -> i32 {
    let Some(value) = values.first() else {
        return 0;
    };

    *value
}
```

never-to-any coercion 与 never type fallback 不是同一件事。前者在目标类型已知时把发散表达式接入该目标；后者只在插入的 never coercion 仍留下未解推导变量时选择回退类型。Rust 2024 Edition 将这种回退改为 `!`，不再依赖历史上的 `()` 回退。公共和 unsafe 边界不应依靠隐含 fallback，应显式标注预期类型。

never type 的完整代数性质、稳定可用位置及其与高阶类型的组合将在高级类型章节展开。

## `as` 是受限的内建 cast

`as` 显式请求语言内建转换。它既能显式执行允许的 coercion，也支持一组额外的数值、枚举、字符、函数和裸指针转换。

```rust
let small: u8 = 250;
let wide = small as u32;

let fraction = 42.9_f64;
let integer = fraction as i32;

assert_eq!(wide, 250);
assert_eq!(integer, 42);
```

`as` 不是可由用户实现的 trait，不能为领域类型重载。它也不表示“只要内存大小相同就能转换”；不在语言许可表中的 cast 会直接编译失败。

数值 cast 的主要语义包括：

| 转换 | 语义 |
|---|---|
| 较窄整数 → 较宽整数 | 按有符号性进行符号扩展或零扩展 |
| 较宽整数 → 较窄整数 | 截断高位 |
| 同宽有符号 ↔ 无符号 | 保留补码位模式并按目标解释 |
| 浮点 → 整数 | 向零舍入，越界饱和，`NaN` 得到 `0` |
| 整数 → 浮点 | 取最接近的可表示值，可能损失精度 |
| `f32` → `f64` | 精确拓宽 |
| `f64` → `f32` | 舍入，过大时得到相应符号的无穷大 |

```rust
assert_eq!(300_u16 as u8, 44);
assert_eq!(-1_i8 as u8, 255);
assert_eq!(f64::INFINITY as i32, i32::MAX);
assert_eq!(f64::NAN as i32, 0);
```

这些结果是定义好的 cast 语义，不是调试模式下自动报错的算术溢出。若截断或精度损失不符合业务含义，应选择可检查的转换。

## `From` 与 `TryFrom` 表达语义转换

能够可靠、无歧义且不失败的转换适合 `From`：

```rust
let small: u8 = 42;
let wide = u32::from(small);
assert_eq!(wide, 42_u32);
```

实现 `From<T> for U` 后，标准库会提供对应的 `Into<U> for T`。在调用方需要由目标类型反推转换结果时，`Into` 很方便：

```rust
fn store(value: impl Into<String>) -> String {
    value.into()
}

assert_eq!(store("rust"), String::from("rust"));
```

可能因范围、格式或领域校验失败的转换应使用 `TryFrom` / `TryInto`：

```rust
use std::convert::TryFrom;

let value = u8::try_from(300_u16);
assert!(value.is_err());
```

`300_u16 as u8` 明确要求截断并得到 `44`；`u8::try_from(300_u16)` 明确要求验证范围并返回错误。两者没有绝对替代关系，选择取决于截断是否正是算法的一部分。

转换 API 的选择可以按语义区分：

- `From` / `Into`：所有合法输入都能完成的拥有权转换；
- `TryFrom` / `TryInto`：转换可能失败；
- `AsRef` / `AsMut`：低成本地获得借用视图；
- `Borrow`：除借用外还承诺哈希、相等性和排序等行为一致；
- `FromStr`：从文本解析一个值；
- `ToString`：通常由 `Display` blanket impl 提供。

这些 trait 是普通 API 调用，能包含校验、分配和领域逻辑；coercion 则由语言定义、范围封闭且不提供用户自定义失败路径。

## `?` 转换错误，但不是任意隐式转换

`?` 的正式机制由 `Try` 与 `FromResidual` 描述。对普通 `Result<T, E>`，标准库的 residual 转换会利用 `From` 把当前错误转换为函数返回错误：

```rust
use std::io;
use std::num::ParseIntError;

#[derive(Debug)]
enum LoadError {
    Io(io::Error),
    Parse(ParseIntError),
}

impl From<io::Error> for LoadError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<ParseIntError> for LoadError {
    fn from(error: ParseIntError) -> Self {
        Self::Parse(error)
    }
}

fn load_number(path: &str) -> Result<u64, LoadError> {
    let text = std::fs::read_to_string(path)?;
    let number = text.trim().parse()?;
    Ok(number)
}
```

这里的两个 `?` 分别把 `io::Error` 和 `ParseIntError` 转成 `LoadError`。转换来源由返回类型和 `From` 实现明确决定。

这不意味着 Rust 会在普通函数实参、赋值或运算中自动调用 `Into`。隐式调用被限制在 `?` 等明确规定的语言结构内，避免任意用户代码悄悄参与类型匹配。

## 指针 cast 不等于获得有效引用

安全引用可以 coercion 为相应裸指针：

```rust
let value = 10_i32;
let pointer: *const i32 = &value;
```

裸指针可以通过 `as` 转换目标指针类型或提取地址：

```rust
let byte_pointer = pointer as *const u8;
let address = pointer as usize;
```

cast 只产生目标形式的指针或整数，不证明该地址适合解引用。有效引用还要求：

- 地址非空并正确对齐；
- 指向目标类型的有效、已初始化值；
- 在访问期间目标仍然存活；
- 访问满足共享与独占别名规则；
- 指针保留内存模型要求的 provenance。

整数在位级上等于某个地址，也不自动恢复原指针携带的来源信息。需要地址运算时，应优先使用标准库的指针 API，在最小 unsafe 边界内记录并证明不变量。

`transmute` 不是普通类型转换的升级版。它要求调用方自行保证目标值的布局与全部有效性不变量，属于最终 unsafe 边界章节，而不是解决常规推导或转换错误的工具。

## 转换应保留领域语义

表示相同不等于语义相同。订单号、用户 ID 和金额即使都用整数存储，也不应仅靠 `as` 互相转换：

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct UserId(u64);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct OrderId(u64);

impl From<u64> for UserId {
    fn from(value: u64) -> Self {
        Self(value)
    }
}
```

若构造需要验证，则把字段保持私有并实现 `TryFrom`：

```rust
#[derive(Debug, PartialEq, Eq)]
struct Port(u16);

#[derive(Debug, PartialEq, Eq)]
struct InvalidPort;

impl TryFrom<u16> for Port {
    type Error = InvalidPort;

    fn try_from(value: u16) -> Result<Self, Self::Error> {
        if value == 0 {
            Err(InvalidPort)
        } else {
            Ok(Self(value))
        }
    }
}
```

newtype 与转换 trait 共同把表示变化、校验和所有权边界写入类型系统。这样比在调用点散布数字 cast 更能保持不变量。

## 常见推导与转换错误的定位顺序

### 无法推导类型参数

先寻找缺失的约束来自哪里：返回值没有被使用、空容器没有元素、`parse` 没有目标类型，还是泛型关联函数的多个实现都可能匹配。把标注放在最接近设计选择的位置，而不是对每个中间变量重复注解。

### mismatched types

先判断源类型与目标类型是否已经确定，再检查当前位置是不是 coercion site、两者之间是否存在语言允许的 coercion。若不存在，应选择显式 cast 或转换 trait，而不是等待编译器猜测语义。

### method not found

区分方法是否属于当前类型、解引用目标或某个未导入 trait。点语法会执行接收者 autoderef/autoref，但不会让任意 trait 实现跨类型转换生效。

### type annotations needed 出现在 `collect`

`Iterator::collect` 可以构造所有实现 `FromIterator` 的目标。通常应标注接收变量或使用 turbofish：

```rust
let values: Vec<_> = (0..4).collect();
let values = (0..4).collect::<Vec<_>>();
```

### 数值 cast 得到意外结果

检查源与目标的位宽、有符号性、浮点舍入和饱和规则。业务上要求拒绝越界时使用 `TryFrom`，不能在 cast 后再判断已经丢失的高位。

### 分支类型无法合并

判断各分支是否存在共同 coercion 目标。若返回不同具体实现类型，`impl Trait` 也不能把它们自动合并成一个隐藏类型；可选择枚举封装或在确有运行时多态需求时使用 trait object。

## 工程中的约束边界

设计类型推导与转换代码时，可以依次检查：

1. 省略标注后，类型是否仍由稳定、局部的上下文唯一确定？
2. API 边界是否显式表达了调用者需要依赖的类型？
3. 当前变化是推导、语言 coercion，还是用户定义的语义转换？
4. coercion 是否发生在正式定义的位置，而不是依赖偶然的方法查找？
5. 数值转换是否可能截断、改变符号或损失浮点精度？
6. 失败是否是合法业务分支，若是，是否使用 `TryFrom` 或解析结果表达？
7. `Deref` 是否只暴露了真正的指针式目标，而没有绕过领域抽象？
8. 多个分支的共同类型是自然的引用、函数指针或切片，还是应显式建模为枚举？
9. 泛型 trait bound 是否错误地依赖了实参先 coercion 再参与实现查找？
10. 裸指针转换后的有效性与 provenance 是否在最小 unsafe 边界内得到证明？

类型标注的目的不是增加代码噪声，而是在推导有多个答案时固定设计选择。转换的目的也不是让两个类型“勉强对上”，而是准确表达能力弱化、表示变化、验证或所有权转移。

## 本章建立的类型模型

类型推导与转换共同遵守以下规则：

1. 推导通过上下文约束确定表达式的唯一静态类型；
2. `_` 是待求解变量，不能成为公开 item 签名中的未知契约；
3. 无后缀数值字面量可以接受目标约束，但已确定的数值类型不会隐式拓宽；
4. coercion 只在规定位置执行封闭、不会运行时失败的隐式变化；
5. LUB coercion 为分支、数组和多返回点寻找共同目标；
6. deref、unsizing、函数指针和 never-to-any 分别解决引用目标、动态大小表示、可调用值统一与发散路径合并；
7. `as` 执行语言内建 cast，`From` 与 `TryFrom` 则表达用户可扩展的语义转换；
8. trait resolution 不会通过任意 coercion 搜索实现；
9. 指针形式转换不证明目标可被安全解引用。

下一章[《Rust 静态分发、动态分发与对象安全：调用目标何时确定》](/collections/rust/static-dynamic-dispatch)将分析泛型单态化、`dyn Trait` 的胖指针与虚表、dyn compatibility、对象生命周期以及不同分发方式在 API、性能和异构存储上的边界。

## 延伸阅读

- [The Rust Reference：Inferred type](https://doc.rust-lang.org/reference/types/inferred.html)
- [The Rust Reference：Type coercions](https://doc.rust-lang.org/reference/type-coercions.html)
- [The Rust Reference：Type cast expressions](https://doc.rust-lang.org/reference/expressions/operator-expr.html#type-cast-expressions)
- [The Rust Reference：Method-call expressions](https://doc.rust-lang.org/reference/expressions/method-call-expr.html)
- [The Rust Edition Guide：Never type fallback change](https://doc.rust-lang.org/edition-guide/rust-2024/never-type-fallback.html)
- [Rust 语言圣经：基本类型与类型推导](https://course.rs/basic/base-type/index.html)
- [Rust 语言圣经：类型转换](https://course.rs/advance/into-types/converse.html)
- [Rust 语言圣经：Deref 解引用](https://course.rs/advance/smart-pointer/deref.html)
- [Rust 语言圣经：闭包的类型推导](https://course.rs/advance/functional-programing/closure.html#闭包的类型推导)
