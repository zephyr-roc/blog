---
title: Rust 类型系统导论：让非法状态无法表示
date: 2026-08-31
excerpt: 第一章先建立 Rust 类型系统的整体地图：类型如何描述数据、所有权、借用关系、失败路径与状态转换，以及后续各章要解决什么问题。
chapter: 类型系统
chapterOrder: 1
---

## 类型不是注解，而是约束

在一些语言里，类型更像变量旁边的说明：它告诉编译器一段内存应该怎样解释。Rust 的类型承担得更多。一个函数签名同时可以表达：

- 值是什么；
- 谁拥有它；
- 调用者能否修改它；
- 引用之间必须满足怎样的生命周期关系；
- 操作可能成功、失败，还是根本没有返回值。

因此，Rust 编译器拒绝一段代码时，通常不是在挑剔写法，而是在指出：程序声明的约束彼此无法同时成立。

```rust
fn first_word(text: &str) -> &str {
    text.split_whitespace().next().unwrap_or("")
}
```

这个签名包含了三层信息：函数借用字符串而不取得所有权；返回值仍是一个借用；输出引用不会比输入引用活得更久。调用者不需要阅读实现，就能知道函数不会保存、修改或释放传入的文本。

## 本章边界：先建立地图

Rust 类型系统不可能在一篇文章里讲完。本章只建立共同词汇和整体结构：下面每个主题都会展示一个最小例子，帮助你理解它在整套系统中的位置，但不会用这些例子替代后续的推导、反例和编译器行为分析。

这个系列将继续拆成独立章节：

1. **所有权、移动与复制**：值语义、`Copy`、析构顺序和部分移动；
2. **借用与重借用**：`&T`、`&mut T`、别名规则和非词法生命周期；
3. **生命周期系统**：省略规则、子类型、型变和高阶生命周期约束；
4. **trait 与泛型**：trait bound、关联类型、一致性规则和单态化；
5. **类型推导与强制转换**：推导边界、自动解引用、unsizing 与 `as`；
6. **静态与动态分发**：`impl Trait`、`dyn Trait`、对象安全和虚表布局；
7. **高级抽象**：GAT、HRTB、never type 与不透明类型；
8. **类型状态与 unsafe 边界**：`PhantomData`、`Pin`、auto trait 和安全抽象的证明责任。

读完第一章的目标不是记住所有规则，而是能判断一个问题属于哪一层，并知道接下来应该追问什么。

## Rust 的类型全景

学习所有权之前，先要分清语言内建类型、复合类型和标准库类型。Rust Book 通常把最基础的内建值类型分成 **标量类型**（scalar types）和 **复合类型**（compound types）。

### 标量类型：一个值

标量类型表示单个值，共四类：

| 类别 | 类型 | 说明 |
|---|---|---|
| 有符号整数 | `i8`、`i16`、`i32`、`i64`、`i128`、`isize` | `isize` 宽度与目标平台指针宽度一致 |
| 无符号整数 | `u8`、`u16`、`u32`、`u64`、`u128`、`usize` | `usize` 常用于索引和集合长度 |
| 浮点数 | `f32`、`f64` | 遵循 IEEE 754；默认推导为 `f64` |
| 布尔值 | `bool` | 只有 `true` 和 `false` |
| 字符 | `char` | 一个 Unicode 标量值，占 4 字节，不等于 UTF-8 的一个字节 |

```rust
let retries: u8 = 3;
let offset: isize = -1;
let ratio = 0.75_f32;
let enabled: bool = true;
let crab: char = '🦀';
```

整数字面量默认推导为 `i32`，浮点字面量默认推导为 `f64`，但上下文可以改变结果。`usize` 不是“更快的无符号整数”，它主要用于表示内存中的大小与索引。

### 复合类型：把多个值组合起来

语言内建的基础复合类型是 **元组**和**数组**。

```rust
let response: (u16, &str) = (200, "OK");
let (status, message) = response;

let ports: [u16; 3] = [80, 443, 8080];
let zeros: [u8; 1024] = [0; 1024];
```

元组可以组合不同类型，长度固定；数组的所有元素类型相同，长度也是类型的一部分，所以 `[u8; 16]` 和 `[u8; 32]` 是不同类型。两者通常直接存放其元素，不像某些动态语言的数组那样天然意味着堆分配。

两个容易忽略的特殊类型是：

- `()`：unit type，表示“没有有意义的返回值”；空语句块的结果就是 `()`；
- `!`：never type，表示计算永远不会正常返回，例如 `panic!()` 或无限循环。

### 切片和字符串切片：没有固定长度的视图

`[T]` 表示一段连续元素，但它的长度不在类型中，因此是动态大小类型，通常通过引用使用：

```rust
fn sum(values: &[i32]) -> i32 {
    values.iter().sum()
}

let numbers = [1, 2, 3, 4];
assert_eq!(sum(&numbers[1..3]), 5);
```

`str` 同样是动态大小的 UTF-8 字符串切片，实际代码中最常见的是 `&str`。字符串字面量的类型就是 `&'static str`。

### 用户定义类型与标准库类型

`struct`、`enum` 和 `union` 用来定义新的名义类型。`String`、`Vec<T>`、`Option<T>`、`Result<T, E>` 并不是编译器里的“基本类型”：它们是标准库提供的结构体或枚举，只是与语言功能配合得非常紧密。

| 类型 | 来自哪里 | 核心含义 |
|---|---|---|
| `str` | 语言内建 | 动态大小的 UTF-8 字符串切片 |
| `&str` | 引用 + `str` | 借用的字符串视图 |
| `String` | 标准库 | 拥有、可增长的 UTF-8 字符串 |
| `[T; N]` | 语言内建 | 固定长度数组 |
| `&[T]` | 引用 + `[T]` | 借用的连续元素视图 |
| `Vec<T>` | 标准库 | 拥有、可增长的连续元素集合 |

先分清“拥有数据的容器”和“借用数据的视图”，后面的所有权错误会容易理解很多。

## 默认是移动：`Copy` 与 `Clone`

Rust 没有名为 `Clonable` 的 trait。显式复制使用的是 [`Clone`](https://doc.rust-lang.org/std/clone/trait.Clone.html)，而 [`Copy`](https://doc.rust-lang.org/std/marker/trait.Copy.html) 是一个表示“可以隐式按位复制”的标记 trait。

### 默认行为是移动所有权

```rust
let first = String::from("rust");
let second = first;

// println!("{first}"); // 编译错误：first 的值已经移动
println!("{second}");
```

赋值把 `String` 的所有权从 `first` 移给 `second`。Rust 不会偷偷复制堆上的字符串，也不会让两个变量重复释放同一块内存。

### `Copy`：隐式、便宜、不能自定义

```rust
let first: i32 = 42;
let second = first;

println!("{first} {second}"); // i32 实现了 Copy，两个变量都可用
```

实现 `Copy` 的类型在赋值和传参时会隐式复制。`Copy` 有几条重要约束：

- `Copy` 是标记 trait，复制行为不能由类型自行编写；
- 实现 `Copy` 的类型必须同时实现 `Clone`；
- 所有字段都实现 `Copy`，结构体才可能实现 `Copy`；
- 实现了 `Drop` 的类型不能实现 `Copy`，因为隐式复制会让资源释放语义变得含糊。

常见的 `Copy` 类型包括整数、浮点数、`bool`、`char`、函数指针、共享引用 `&T`，以及元素全部为 `Copy` 的元组和数组。`String`、`Vec<T>`、`Box<T>`、文件句柄和 `&mut T` 都不是 `Copy`。

```rust
#[derive(Debug, Clone, Copy)]
struct Point {
    x: f64,
    y: f64,
}

let a = Point { x: 1.0, y: 2.0 };
let b = a;
println!("{a:?} {b:?}");
```

### `Clone`：显式，成本由实现决定

```rust
let first = String::from("rust");
let second = first.clone();

println!("{first} {second}");
```

`.clone()` 是显式操作，可能只复制几个字节，也可能分配内存、复制整个容器或递归克隆成员。看到 `Clone` 不能自动推断它很便宜；是否克隆应当由调用点明确决定。

```rust
#[derive(Debug, Clone)]
struct Profile {
    name: String,
    tags: Vec<String>,
}
```

`Profile` 可以派生 `Clone`，因为它的字段都能显式克隆；但不能派生 `Copy`，因为 `String` 和 `Vec<String>` 管理堆资源。

可以先记住这张对照表：

| 行为 | 是否显式 | 可能执行自定义代码 | 典型成本 |
|---|---:|---:|---|
| 移动 | 否 | 否 | 通常只转移栈上的表示，不复制所拥有资源 |
| `Copy` | 否 | 否 | 固定大小的按位复制 |
| `Clone` | 是，调用 `.clone()` | 是 | 由实现决定，可能分配和深拷贝 |

后续“所有权、移动与复制”一章会继续解释 `Copy` 与析构的互斥关系、部分移动、`clone_from`，以及为什么“栈上类型就是 `Copy`、堆上类型就不是”这个常见说法并不准确。

## 先从代数数据类型理解建模

Rust 最重要的建模工具是 `struct` 和 `enum`。`struct` 把多个字段组合起来，是“积类型”；`enum` 表示多个互斥分支中的一个，是“和类型”。

```rust
struct User {
    id: u64,
    name: String,
}

enum LoadState<T> {
    Idle,
    Loading,
    Ready(T),
    Failed(String),
}
```

如果把加载状态写成几个彼此独立的布尔值，就可能产生 `is_loading = true`、`has_error = true`、`data = Some(...)` 同时成立的矛盾状态。`LoadState<T>` 则从类型层面规定：任意时刻只能处于一个分支。

这就是“让非法状态无法表示”的第一层含义。类型设计得越准确，后续代码需要维护的隐含约定就越少。

### `match` 是完整性检查

`enum` 与 `match` 配合时，编译器会检查所有分支是否被处理：

```rust
fn render(state: LoadState<User>) -> String {
    match state {
        LoadState::Idle => "尚未加载".into(),
        LoadState::Loading => "加载中".into(),
        LoadState::Ready(user) => format!("你好，{}", user.name),
        LoadState::Failed(message) => format!("失败：{message}"),
    }
}
```

以后给 `LoadState` 增加 `Cancelled`，所有需要理解新状态的 `match` 都会在编译期暴露出来。相比依赖测试覆盖到每一条状态路径，这是一种更便宜、更稳定的变更传播机制。

## `Option` 和 `Result`：把缺失与失败放进类型

安全 Rust 的引用不能为 null。一个值可能不存在时，应使用 `Option<T>`：

```rust
fn find_user(id: u64) -> Option<User> {
    // 找到时返回 Some(user)，否则返回 None
    todo!()
}
```

一个操作可能失败时，应使用 `Result<T, E>`：

```rust
#[derive(Debug)]
enum CreateUserError {
    DuplicateId(u64),
    EmptyName,
}

fn create_user(id: u64, name: String) -> Result<User, CreateUserError> {
    if name.trim().is_empty() {
        return Err(CreateUserError::EmptyName);
    }
    Ok(User { id, name })
}
```

`Option` 和 `Result` 的价值不只是避免 null 或异常。它们让“缺失”和“失败”进入函数签名，使调用者无法假装这些路径不存在。`?` 运算符只是让传播失败保持简洁，并没有隐藏控制流：

```rust
fn load_name(id: u64) -> Result<String, CreateUserError> {
    let user = create_user(id, "Ferris".to_owned())?;
    Ok(user.name)
}
```

## 所有权也是类型关系

看起来都是字符串，`String`、`&String`、`&str` 和 `&mut str` 表达的能力却不同：

| 类型 | 含义 | 常见用途 |
|---|---|---|
| `String` | 拥有一段可增长的 UTF-8 数据 | 存储、转移所有权 |
| `&String` | 共享借用一个具体的 `String` | 通常可缩窄为 `&str` |
| `&str` | 共享借用一段 UTF-8 字符串切片 | 只读参数、零拷贝视图 |
| `&mut str` | 独占借用一段字符串切片 | 原地修改合法字节内容 |

共享借用 `&T` 可以同时存在多个，但借用期间不能通过它修改值；独占借用 `&mut T` 在同一时刻只能有一个。更准确地说，这条规则是：

> 任意时刻，可以有多个共享引用，或者一个独占引用，但不能两者同时存在。

它排除的不只是悬垂指针，还包括数据竞争和迭代期间修改容器等错误。

```rust
fn append_suffix(name: &mut String) {
    name.push_str(".rs");
}

let mut name = String::from("type-system");
append_suffix(&mut name);
assert_eq!(name, "type-system.rs");
```

函数只获得一次临时的独占访问权；调用结束后，所有权仍然属于 `name`。

## 生命周期描述关系，不延长生命

生命周期最容易被误解成“引用能活多少秒”。它实际描述的是引用有效区间之间的约束。

```rust
fn longest<'a>(left: &'a str, right: &'a str) -> &'a str {
    if left.len() >= right.len() { left } else { right }
}
```

`'a` 没有让任何字符串活得更久。它告诉编译器：返回引用与两个输入引用受同一个有效期约束，所以结果不能超过较短的那个输入。

多数函数不需要显式写生命周期，因为编译器会应用省略规则。只有当多个输入与输出之间的关系无法从规则中唯一确定时，才需要把关系写出来。阅读生命周期时，先问“输出借用了谁”，通常比尝试计算作用域更有效。

## trait：描述能力，而不是继承身份

trait 定义一组类型可以提供的行为：

```rust
trait Summary {
    fn summary(&self) -> String;
}

impl Summary for User {
    fn summary(&self) -> String {
        format!("#{} {}", self.id, self.name)
    }
}

fn print_summary(value: &impl Summary) {
    println!("{}", value.summary());
}
```

泛型约束关注“它能做什么”，而不是“它继承自谁”。同一个 trait 可以由互不相关的类型实现，也可以参与静态分发或动态分发：

```rust
fn static_dispatch<T: Summary>(value: &T) { /* 编译期确定具体类型 */ }
fn dynamic_dispatch(value: &dyn Summary) { /* 通过虚表调用 */ }
```

`T: Summary` 通常会在单态化后为具体类型生成代码，保留内联优化机会；`dyn Summary` 则用一个数据指针和一个虚表指针换取运行时多态。二者不是高低级之分，而是代码体积、运行时灵活性和优化空间之间的选择。

## 类型推导不会改变边界

Rust 经常省略局部变量的类型：

```rust
let ports = vec![80, 443, 8080];
let secure: Vec<_> = ports.into_iter().filter(|port| *port == 443).collect();
```

编译器会根据初始化表达式、使用位置和 trait 约束求解类型。`_` 表示“请在这里推导”，而不是动态类型。推导完成后，每个表达式仍有唯一的静态类型。

公共 API 则应明确写出参数和返回类型。这既让编译单元之间的契约稳定，也避免实现细节意外改变接口。

## 用 newtype 区分结构相同、语义不同的值

`u64` 可以同时表示用户 ID、订单 ID 和时间戳，但它们不应互相传递。newtype 用零额外运行时成本换取语义隔离：

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct UserId(u64);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct OrderId(u64);

fn load_user(id: UserId) -> Option<User> {
    todo!()
}

let order = OrderId(42);
// load_user(order); // 编译错误：期望 UserId，得到 OrderId
```

当值跨越模块、数据库或网络边界时，这种区分尤其有价值。它能阻止“形状相同但语义错误”的参数在重构中悄悄穿过系统。

## 用类型状态约束操作顺序

还可以让泛型参数表示对象所处的状态，使某些方法只在特定状态下存在：

```rust
use std::marker::PhantomData;

struct Draft;
struct Sent;

struct Request<State> {
    body: String,
    _state: PhantomData<State>,
}

impl Request<Draft> {
    fn new(body: impl Into<String>) -> Self {
        Self { body: body.into(), _state: PhantomData }
    }

    fn send(self) -> Request<Sent> {
        // 执行真实发送
        Request { body: self.body, _state: PhantomData }
    }
}

impl Request<Sent> {
    fn receipt(&self) -> &str {
        "accepted"
    }
}

let receipt = Request::new("hello").send();
assert_eq!(receipt.receipt(), "accepted");
```

`Draft` 没有 `receipt` 方法，`Sent` 也不能再次 `send`。状态转换消耗旧值并返回新类型，错误的调用顺序因而无法通过编译。这种模式适合协议握手、事务、构建器和资源生命周期，但不应为了炫技而把每个布尔状态都提升为类型；只有当错误顺序代价较高、状态数量可控时，它才真正划算。

## 转换应显式表达是否可能失败

Rust 倾向于用 trait 区分不同转换语义：

- `From` / `Into`：转换不会失败；
- `TryFrom` / `TryInto`：转换可能失败；
- `as`：底层数值转换，可能截断，应谨慎使用。

```rust
use std::convert::TryFrom;

let port = u16::try_from(8080_u32)?;
```

这种区分把“是否可能失败”放进类型和控制流。对于外部输入、长度、索引和协议字段，优先使用可检查转换，避免静默截断。

## 一套实用的阅读顺序

遇到复杂的 Rust 类型或编译错误时，可以按下面的顺序拆解：

1. **值的形状**：是 `struct`、`enum`、元组还是容器？
2. **所有权**：当前拿到的是 `T`、`&T` 还是 `&mut T`？
3. **有效期**：输出引用依赖哪个输入？借用何时结束？
4. **能力约束**：泛型要求实现哪些 trait？
5. **失败路径**：缺失和错误是否通过 `Option`、`Result` 表达？
6. **分发方式**：使用单态化泛型，还是 `dyn Trait` 的运行时多态？

Rust 类型系统的学习曲线，很大一部分来自它把其他语言中的隐含规则变成了显式约束。一旦开始把类型看成“程序状态与能力的证明”，许多编译错误就不再是阻碍，而是在告诉你：模型里还有一条没有说清楚的关系。

## 下一章

下一章将沿着 `T`、`&T`、`&mut T` 三种能力继续深入，解释移动、复制、重借用以及非词法生命周期如何共同构成所有权系统。

## 延伸阅读

- [The Rust Programming Language：Understanding Ownership](https://doc.rust-lang.org/book/ch04-00-understanding-ownership.html)
- [The Rust Reference：Types](https://doc.rust-lang.org/reference/types.html)
- [The Rust Reference：Trait Objects](https://doc.rust-lang.org/reference/types/trait-object.html)
