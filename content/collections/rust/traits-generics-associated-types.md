---
title: Rust trait、泛型与关联类型：能力如何进入类型系统
date: 2026-09-04
excerpt: 从泛型代码的可用操作出发，分析 trait bound、静态分发、关联类型、默认类型参数、完全限定语法、一致性规则与 newtype 模式。
chapter: 类型系统
chapterOrder: 5
---

## 泛型不是“接受任意类型”

一个泛型函数并不是把参数类型擦掉，再到运行时尝试调用某个方法。它仍然需要在编译期完成类型检查，只是检查时使用的是类型参数及其约束。

```rust
fn duplicate<T>(value: T) -> (T, T) {
    (value, value)
}
```

这段代码不能通过编译。对一个没有任何约束的 `T`，编译器只知道它是某种类型，并不知道它能否复制。第一次把 `value` 放入元组时发生移动，第二次便不能再次使用。

为 `T` 声明 `Copy` 约束后，函数体才获得复制这个值的能力：

```rust
fn duplicate<T: Copy>(value: T) -> (T, T) {
    (value, value)
}

assert_eq!(duplicate(7_u32), (7, 7));
```

因此，更准确的模型是：

- 泛型参数表示一族可能的具体类型；
- trait bound 描述这族类型必须提供的能力；
- 函数体只能使用约束已经证明的操作；
- 调用点再选择满足全部约束的具体类型。

泛型扩大了程序可接受的类型集合，trait 则控制这组类型的共同接口。两者共同工作，而不是互相替代。

## Rust 有三类泛型参数

Rust 的泛型参数包括生命周期参数、类型参数和常量参数：

```rust
struct Window<'a, T, const N: usize> {
    title: &'a str,
    values: [T; N],
}
```

这里：

- `'a` 是生命周期参数，约束 `title` 的引用关系；
- `T` 是类型参数，决定数组元素的类型；
- `N` 是常量参数，参与数组类型本身的构造。

`Window<'a, i32, 4>` 与 `Window<'a, i32, 8>` 是不同类型。常量泛型不是运行时传入的普通整数，它在类型检查阶段已经成为类型的一部分。

类型参数可以带默认值，生命周期参数不能带默认值。泛型参数的排列也受语法约束：生命周期参数必须出现在类型和常量参数之前，但类型参数与常量参数可以交错排列。

本章主要讨论类型参数。生命周期参数已经在上一章展开，常量泛型的表达能力与限制将在后续高级类型章节中单独分析。

## 类型推导补全调用点，不补全能力约束

调用泛型函数时，编译器通常能从实参或期望的返回类型推导类型参数：

```rust
fn identity<T>(value: T) -> T {
    value
}

let number = identity(42_u64); // T = u64
let text = identity("rust");   // T = &str
```

当上下文不足时，可以使用 turbofish 语法显式指定类型参数：

```rust
let values = (0..4).collect::<Vec<_>>();
assert_eq!(values, vec![0, 1, 2, 3]);
```

更常见的写法把类型标注放在接收结果的位置：

```rust
let values: Vec<_> = (0..4).collect();
```

这两种写法都只是在调用点帮助确定具体类型。它们不能为泛型函数体凭空增加能力。如果函数体要比较两个 `T`，签名必须声明 `PartialOrd` 等相应约束；调用点恰好传入可比较类型，并不能弥补签名中缺失的证明。

```rust
fn max_ref<'a, T: PartialOrd>(left: &'a T, right: &'a T) -> &'a T {
    if left >= right { left } else { right }
}
```

泛型函数按照声明出来的约束进行检查，而不是查看当前有哪些调用，再为每个调用猜测一套合法函数体。

## trait 定义能力契约

trait 可以包含关联函数、方法、关联类型和关联常量。每个 trait 都隐含一个 `Self` 类型参数，表示正在实现该 trait 的具体类型。

```rust
trait Encode {
    type Error;

    const MEDIA_TYPE: &'static str;

    fn encode(&self, output: &mut Vec<u8>) -> Result<(), Self::Error>;

    fn media_type(&self) -> &'static str {
        Self::MEDIA_TYPE
    }
}
```

这个定义同时表达了四件事：

1. 实现者必须选择一个错误类型 `Self::Error`；
2. 实现者必须提供关联常量 `MEDIA_TYPE`；
3. 实现者必须实现 `encode`；
4. `media_type` 已有默认实现，实现者可以直接继承或覆盖。

大写的 `Self` 是类型，表示实现者；小写的 `self` 是方法接收者所绑定的值。`Self::Error` 是由实现者选择的关联类型，而 `self.encode(...)` 是对当前值调用方法。

```rust
use std::convert::Infallible;

struct PlainText(String);

impl Encode for PlainText {
    type Error = Infallible;

    const MEDIA_TYPE: &'static str = "text/plain";

    fn encode(&self, output: &mut Vec<u8>) -> Result<(), Self::Error> {
        output.extend_from_slice(self.0.as_bytes());
        Ok(())
    }
}
```

`impl Encode for PlainText` 不是声明继承关系，而是向类型系统注册一项事实：`PlainText` 满足 `Encode` 契约，并给出了该契约要求的全部具体选择。

## trait bound 决定泛型函数体能够做什么

最短的约束写法把 trait 放在类型参数之后：

```rust
use std::fmt::Display;

fn announce<T: Display>(value: T) {
    println!("{value}");
}
```

多个约束使用 `+` 连接：

```rust
use std::fmt::{Debug, Display};

fn inspect<T: Display + Debug>(value: &T) {
    println!("display: {value}");
    println!("debug: {value:?}");
}
```

约束复杂时，`where` 子句能把能力关系与参数列表分开：

```rust
fn render_all<I>(items: I) -> String
where
    I: IntoIterator,
    I::Item: Display,
{
    items
        .into_iter()
        .map(|item| item.to_string())
        .collect::<Vec<_>>()
        .join(", ")
}
```

这里不仅约束了 `I`，还约束了它的关联类型 `I::Item`。函数体因此能够：

- 对 `I` 调用 `into_iter`；
- 把产生的每个元素格式化为字符串；
- 不必知道迭代器或元素的具体类型。

`where` 不是另一种运行机制，只是更适合表达多类型、生命周期和关联类型之间的约束。

## 泛型类型可以按条件获得能力

泛型结构体的定义不需要提前要求所有能力。可以只在某个 `impl` 块上添加该块真正需要的约束：

```rust
use std::fmt::{self, Display};

struct Pair<T> {
    left: T,
    right: T,
}

impl<T> Pair<T> {
    fn new(left: T, right: T) -> Self {
        Self { left, right }
    }
}

impl<T: PartialOrd> Pair<T> {
    fn larger(&self) -> &T {
        if self.left >= self.right {
            &self.left
        } else {
            &self.right
        }
    }
}

impl<T: Display> Display for Pair<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "({}, {})", self.left, self.right)
    }
}
```

所有 `Pair<T>` 都能调用 `new`。只有 `T: PartialOrd` 的 `Pair<T>` 能调用 `larger`，只有 `T: Display` 时，`Pair<T>` 才实现 `Display`。

把约束放在最小必要范围内，可以避免让整个类型背负某个方法才需要的条件。

## `impl Trait` 在不同位置表达不同抽象

参数位置的 `impl Trait` 可以简化只有一个匿名类型参数的签名：

```rust
use std::fmt::Display;

fn log(value: impl Display) {
    println!("{value}");
}
```

它大致对应：

```rust
fn log<T: Display>(value: T) {
    println!("{value}");
}
```

但两种形式并非在所有 API 设计上完全可互换。显式类型参数可以让多个参数共享同一个类型：

```rust
fn same_type<T: Display>(left: T, right: T) {
    println!("{left}, {right}");
}
```

而分别写两个 `impl Display` 会引入两个可能不同的匿名类型：

```rust
fn possibly_different(left: impl Display, right: impl Display) {
    println!("{left}, {right}");
}
```

返回位置的 `impl Trait` 含义不同：函数选择一个具体返回类型，但只向调用者公开它满足的 trait。

```rust
fn even_numbers() -> impl Iterator<Item = u32> {
    (0..10).filter(|number| number % 2 == 0)
}
```

调用者不需要写出闭包参与构造的复杂迭代器类型，但函数的所有返回路径仍必须解析为同一个隐藏的具体类型。`impl Trait` 不是“任意实现该 trait 的值”，也不是自动发生动态分发。

## 静态分发把约束落实到具体类型

泛型函数在定义处根据 trait bound 完成类型检查。代码生成阶段，编译器可以为实际使用的具体类型生成专门版本，这一过程通常称为单态化。

```rust
fn twice<T>(value: T) -> T
where
    T: std::ops::Add<Output = T> + Copy,
{
    value + value
}

let integer = twice(21_i32);
let float = twice(1.5_f64);
```

从概念上看，调用点分别需要 `i32` 与 `f64` 版本。具体优化结果由编译器决定，不能据此保证二进制中一定存在两个可辨认的函数副本；内联、去重和链接时优化都可能改变最终机器码。

静态分发的主要性质是：

- 调用目标可由具体类型在编译期确定；
- 优化器能看到具体实现，便于内联和常量传播；
- 不需要通过虚表在运行时选择方法；
- 大量不同实例可能增加编译时间与代码体积。

trait 本身并不等于动态分发。只有使用 `dyn Trait` 等类型擦除形式时，才进入另一套表示和调用机制。trait 是否能构造成 trait object 还受 dyn compatibility 规则约束，这部分将在静态分发与动态分发专章展开。

## 关联类型表达“由实现者决定的类型”

`Iterator` 的核心形状可以简化为：

```rust
trait Iterator {
    type Item;

    fn next(&mut self) -> Option<Self::Item>;
}
```

实现 `Iterator` 时，每个实现者必须选择自己的 `Item`：

```rust
struct Countdown(u8);

impl Iterator for Countdown {
    type Item = u8;

    fn next(&mut self) -> Option<Self::Item> {
        if self.0 == 0 {
            None
        } else {
            self.0 -= 1;
            Some(self.0)
        }
    }
}
```

关联类型建立了一种从实现者到类型的映射：

```text
Self -> Self::Item
```

知道 `Self = Countdown` 后，`Self::Item` 就唯一确定为 `u8`。调用者不必在每次使用 `Iterator` 时再选择一次元素类型。

约束关联类型时，可以使用等式形式：

```rust
fn sum_bytes<I>(input: I) -> u64
where
    I: IntoIterator<Item = u8>,
{
    input.into_iter().map(u64::from).sum()
}
```

`Item = u8` 不是给 `IntoIterator` 新增一个普通类型参数，而是要求它为当前 `Self` 选择的关联类型恰好为 `u8`。

## 关联类型与 trait 类型参数解决不同问题

下面两个设计表面相似：

```rust
trait Produce {
    type Output;
    fn produce(&self) -> Self::Output;
}

trait Convert<T> {
    fn convert(&self) -> T;
}
```

差别在于选择权和实现数量。

对 `Produce`，某个类型通常只有一个 `Produce` 实现，因此只有一个由该实现选定的 `Output`。对 `Convert<T>`，同一个 `Self` 可以针对不同的 `T` 分别实现 trait：

```rust
struct Temperature(f64);

impl Convert<i64> for Temperature {
    fn convert(&self) -> i64 {
        self.0.round() as i64
    }
}

impl Convert<String> for Temperature {
    fn convert(&self) -> String {
        format!("{:.1}°C", self.0)
    }
}
```

选择原则可以概括为：

| 关系 | 更适合的表达 |
|---|---|
| 给定实现者后，结果类型应当唯一 | 关联类型 |
| 调用者需要选择目标类型 | trait 类型参数 |
| 同一实现者需要针对多个目标分别实现 | trait 类型参数 |
| 多个方法必须共享实现者选定的同一类型 | 关联类型 |

这不是“新语法优于旧语法”的关系。它们编码的是不同的类型关系，会直接影响实现能否重复、调用时是否需要消歧以及 API 未来能否扩展。

## 默认类型参数保留常用情况，也允许扩展

标准库的加法 trait 形状近似如下：

```rust
trait Add<Rhs = Self> {
    type Output;

    fn add(self, rhs: Rhs) -> Self::Output;
}
```

`Rhs = Self` 是默认类型参数。常见的同类型相加不必显式写右操作数类型，但实现者仍能选择不同的 `Rhs`：

```rust
use std::ops::Add;

#[derive(Debug, PartialEq)]
struct Millimeters(u32);

struct Meters(u32);

impl Add<Meters> for Millimeters {
    type Output = Millimeters;

    fn add(self, rhs: Meters) -> Self::Output {
        Millimeters(self.0 + rhs.0 * 1_000)
    }
}

assert_eq!(Millimeters(500) + Meters(2), Millimeters(2_500));
```

这里同时出现了两种选择：`Rhs` 是 trait 的类型参数，允许 `Millimeters` 针对不同右操作数形成不同实现；`Output` 是关联类型，由这个具体实现唯一决定。

默认类型参数适合在不增加常见调用噪声的前提下保留扩展点，但它仍然参与一致性检查，不能用来绕过重叠实现限制。

## 方法、关联函数与完全限定语法

多个 trait 可以定义同名方法，类型自身也可以定义同名关联函数。方法调用语法通常根据接收者类型和当前作用域完成查找：

```rust
trait Named {
    fn name(&self) -> &'static str;
}

trait Tagged {
    fn name(&self) -> &'static str;
}

struct Packet;

impl Named for Packet {
    fn name(&self) -> &'static str { "packet" }
}

impl Tagged for Packet {
    fn name(&self) -> &'static str { "network" }
}

let packet = Packet;
assert_eq!(Named::name(&packet), "packet");
assert_eq!(Tagged::name(&packet), "network");
```

如果仅靠 trait 名仍不足以确定实现，可以使用完全限定语法：

```rust
trait Factory {
    fn create() -> Self;
}

impl Factory for Packet {
    fn create() -> Self { Packet }
}

let packet = <Packet as Factory>::create();
```

一般形式是：

```text
<Type as Trait>::item
```

它把实现者类型、trait 和关联项全部写明，因此既适合解决名称冲突，也适合在泛型代码中准确引用关联类型和关联常量。

## 默认方法复用契约内已有的能力

默认方法只能依赖 trait 已经声明的其他能力：

```rust
trait Summary {
    fn title(&self) -> &str;

    fn summary(&self) -> String {
        format!("《{}》", self.title())
    }
}
```

实现者只需提供 `title` 就能获得 `summary`：

```rust
struct Article {
    title: String,
}

impl Summary for Article {
    fn title(&self) -> &str {
        &self.title
    }
}
```

默认实现适合表达能够从最小必需接口推导出的便利行为。它不是字段复用机制，也不能假设实现者具有 trait 中未声明的结构或方法。

覆盖默认方法后，Rust 没有直接调用“父 trait 默认版本”的语法。设计 trait 时，应当把可复用核心拆成独立的必需方法或辅助函数，避免依赖继承式的 `super` 调用模型。

## supertrait 表达能力之间的前置关系

如果实现一个 trait 必须先具备另一个 trait，可以声明 supertrait：

```rust
use std::fmt::Display;

trait Labeled: Display {
    fn label(&self) -> String {
        format!("item: {self}")
    }
}
```

任何 `Labeled` 实现者都必须同时实现 `Display`。因此 `Labeled` 的方法体可以使用格式化能力。

```rust
struct Id(u64);

impl Display for Id {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl Labeled for Id {}
```

supertrait 表达的是契约依赖，不是面向对象中的实现继承。`Labeled: Display` 不会自动为类型生成 `Display` 实现，也不会给类型增加存储字段。

## blanket impl 把能力沿约束传播

实现可以针对一整族满足约束的类型：

```rust
trait Printable {
    fn printable(&self) -> String;
}

impl<T> Printable for T
where
    T: std::fmt::Display,
{
    fn printable(&self) -> String {
        self.to_string()
    }
}
```

这是 blanket implementation：所有实现 `Display` 的类型自动获得 `Printable`。标准库中的 `ToString` 也使用了类似思想，把 `Display` 能力转换成字符串便利方法。

blanket impl 很强，因为它会覆盖当前和未来所有满足约束的类型。发布公共 crate 后，一个宽泛实现可能阻止自己或下游 crate 再为某些具体类型提供不同实现。因此，设计 blanket impl 时必须同时考虑一致性和未来兼容性，而不只是当前代码能否编译。

扩展 trait 也是常见模式：为已有类型补充方法，而不修改其定义。

```rust
trait StrExt {
    fn is_blank(&self) -> bool;
}

impl StrExt for str {
    fn is_blank(&self) -> bool {
        self.trim().is_empty()
    }
}

assert!("  \n".is_blank());
```

只有在 trait 进入作用域后，方法语法才参与解析。这让能力的引入保持显式，也避免直接修改外部类型。

## 一致性要求实现选择保持唯一

Rust 的 coherence 规则要求：对某个 trait 与某组具体类型，不能同时存在两个都适用的实现。否则同一个调用可能有多个候选行为，新增依赖甚至可能改变已有代码的含义。

下面两个实现会重叠：

```rust
trait Describe {
    fn describe(&self) -> String;
}

// impl<T: std::fmt::Display> Describe for T { /* ... */ }
// impl Describe for String { /* ... */ }
```

`String` 已经实现 `Display`，所以两个 `Describe` 实现都会匹配它。Rust 不采用“更具体的实现自动获胜”作为稳定的一般规则，而是拒绝这类重叠。

唯一性带来一个关键性质：只要程序能够编译，trait 方法选择就不会因为某个无关 crate 又添加了实现而变得含糊。

## orphan rule 划分 crate 之间的实现所有权

一致性还需要在多个 crate 之间成立。常见情形下，实现外部 trait 时，参与实现的类型中必须有当前 crate 定义的本地类型；如果 trait 本身由当前 crate 定义，则可以为外部类型实现它。

```rust
// 当前 crate 定义的 trait 可以为外部类型实现
trait WordCount {
    fn word_count(&self) -> usize;
}

impl WordCount for String {
    fn word_count(&self) -> usize {
        self.split_whitespace().count()
    }
}
```

但不能在自己的 crate 中直接为 `Vec<T>` 实现标准库的 `Display`：trait 和目标类型都来自外部 crate。完整的 orphan rule 还包含泛型参数被本地类型覆盖的顺序规则；判断复杂实现时，应以编译器诊断和 Reference 的正式规则为准。

这一限制不是为了减少表达能力，而是防止两个互不知情的下游 crate 同时为同一对外部 trait 与外部类型提供实现，最终在依赖图汇合时发生冲突。

## newtype 把外部类型变成本地类型

需要为外部类型实现外部 trait 时，可以用本地单字段类型建立新的类型身份：

```rust
use std::fmt;

struct DisplayVec(Vec<String>);

impl fmt::Display for DisplayVec {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0.join(", "))
    }
}
```

`DisplayVec` 是当前 crate 的本地类型，因此可以为它实现 `Display`。这不是关闭 orphan rule，而是明确创建了一个语义不同的新类型。

newtype 还可以：

- 隐藏不希望暴露的底层操作；
- 区分底层表示相同但语义不同的值；
- 选择性转发内部类型的方法和 trait；
- 建立验证后的构造边界。

代价是新类型不会自动拥有内部类型的所有方法。可以通过显式方法、`AsRef`、`Deref` 等方式选择性暴露能力，但不应仅为了减少几行转发代码就无条件实现 `Deref`。

## 泛型参数所在层级决定选择发生在哪里

把参数放在类型、`impl`、trait 或方法上，会改变谁负责选择它。

```rust
struct Store<T> {
    value: T,
}

impl<T> Store<T> {
    fn map<U, F>(self, f: F) -> Store<U>
    where
        F: FnOnce(T) -> U,
    {
        Store { value: f(self.value) }
    }
}
```

`T` 属于 `Store<T>` 和整个 `impl<T>`，创建 `Store` 时就已经确定。`U` 与 `F` 属于 `map` 方法，每次调用 `map` 时可以重新选择。

trait 参数则由实现声明的一部分确定：

```rust
trait ParseAs<T> {
    fn parse_as(&self) -> Option<T>;
}
```

关联类型由某个 trait 实现确定：

```rust
trait Repository {
    type Record;
    fn find(&self, id: u64) -> Option<Self::Record>;
}
```

API 设计的关键不是“能否写成泛型”，而是选择应该在哪一层发生、同一个实现者能否拥有多个不同选择，以及调用者需要看到多少类型细节。

## `Sized` 是多数类型参数的隐含约束

普通类型参数默认隐含 `Sized`：

```rust
fn consume<T>(value: T) {
    // T 默认要求 Sized
}
```

这是因为按值参数需要在编译期知道布局。若泛型代码只通过指针或引用操作可能为动态大小的类型，可以放宽为 `?Sized`：

```rust
fn byte_len<T: ?Sized + AsRef<[u8]>>(value: &T) -> usize {
    value.as_ref().len()
}
```

`?Sized` 不是“可能不安全”，而是移除默认的 `Sized` 约束。`T` 仍可能是 `Sized` 类型，只是不再强制要求。`?Trait` 语法目前主要用于 `?Sized` 这类放宽隐含约束的场景，不是普通 trait bound 的否定形式。

引用本身的大小已知，所以 `&T` 可以指向 `str`、切片或 trait object 等动态大小类型。动态大小类型的布局、宽指针和 `dyn Trait` 会在后续分发章节继续展开。

## 关联类型也可以继续带约束

trait 可以在定义处约束关联类型：

```rust
trait Cache {
    type Key: Eq + std::hash::Hash;
    type Value;

    fn get(&self, key: &Self::Key) -> Option<&Self::Value>;
}
```

所有实现者选择的 `Key` 都必须满足 `Eq + Hash`。使用 `Cache` 的泛型代码可以直接依赖这些能力，不必在每个函数中重复声明。

也可以把额外约束留给具体使用者：

```rust
fn clone_first<I>(items: I) -> Option<I::Item>
where
    I: IntoIterator,
    I::Item: Clone,
{
    items.into_iter().next().map(|item| item.clone())
}
```

选择定义处约束还是使用处约束，取决于该能力是否是 trait 契约的固有部分。过早放进 trait 会排除本可合法的实现者；完全留给调用点则可能造成重复约束和更复杂的错误信息。

关联类型本身还可以拥有泛型参数，即 Generic Associated Types。GAT 能表达“输出类型随某次借用的生命周期变化”等关系，但它涉及更高阶约束与借用传播，将在高级类型章节中结合 lending iterator 等案例展开。

## 常见错误来自选择位置不明确

### 在无约束的 `T` 上调用具体方法

```rust
fn length<T>(value: T) -> usize {
    // value.len() // T 没有声明 len 能力
    0
}
```

修复方式不是罗列当前会传入的类型，而是抽象出真正需要的契约，例如 `AsRef<[u8]>`、`ExactSizeIterator`，或由领域定义的本地 trait。

### 用关联类型表达本应由调用者选择的转换

如果同一来源需要转换成多种目标类型，把目标写成唯一关联类型会过早封死扩展。`From<T>`、`Into<T>` 把目标或来源放在 trait 参数中，正是为了允许多组转换关系。

### 为便利加入过宽的 blanket impl

`impl<T> MyTrait for T` 会立即占据所有类型的实现空间，也会覆盖未来类型。公共 API 中应当确认这种全覆盖确实是长期语义，而不是暂时省事。

### 把 trait 当成字段和实现继承

trait 只规定关联项及其约束。它不携带实例字段，也不自动复用另一个类型的存储结构。默认方法与 supertrait 都仍然围绕能力契约工作。

### 误以为 `impl Trait` 自动降低代码体积

参数位置的 `impl Trait` 仍属于静态泛型抽象，通常仍会按具体类型参与单态化。要在运行时统一存放不同具体类型，需要枚举、trait object 或其他显式类型擦除方案。

## 从 API 关系选择抽象工具

设计泛型 API 时，可以依次回答以下问题：

1. 函数体真正需要哪些操作，而不是当前类型碰巧有哪些方法？
2. 这些操作已有标准 trait，还是应定义领域 trait？
3. 类型选择由调用者做，还是由实现者做？
4. 给定 `Self` 后，某个输出类型应唯一吗？
5. 同一个类型是否需要针对多个参数形成多个实现？
6. 约束属于整个类型、某个 `impl`，还是单个方法？
7. blanket impl 会不会占据未来需要的实现空间？
8. trait 和目标类型分别由哪个 crate 定义，是否满足 coherence？
9. 静态分发带来的优化机会是否值得代码体积成本？
10. API 是否真的需要类型擦除，还是 `impl Trait` 已足够隐藏具体类型？

这些问题把语法选择转化为类型关系选择。trait bound 证明操作合法，关联类型表达实现者决定的唯一类型，trait 参数保留多实现维度，一致性规则则确保所有选择在整个依赖图中仍然唯一。

## 本章建立的类型模型

trait、泛型与关联类型共同维护以下结构：

1. 泛型参数表示尚未选择的类型、生命周期或常量；
2. trait bound 是泛型代码可使用能力的编译期证明；
3. 静态分发在具体类型确定后选择实现，并允许单态化优化；
4. 关联类型由具体 trait 实现选择，表达 `Self` 到相关类型的映射；
5. trait 类型参数允许同一实现者形成多组不同关系；
6. coherence 与 orphan rule 保证实现选择在 crate 组合后仍保持唯一；
7. newtype 通过建立本地类型身份，重新划定语义与实现边界。

下一章将进入类型推导与强制转换，分析编译器如何从局部约束求解具体类型，以及解引用强制转换、指针弱化、never type 强制转换与数值转换之间为何具有不同规则。

## 延伸阅读

- [The Rust Reference：Generic parameters](https://doc.rust-lang.org/reference/items/generics.html)
- [The Rust Reference：Traits](https://doc.rust-lang.org/reference/items/traits.html)
- [The Rust Reference：Trait and lifetime bounds](https://doc.rust-lang.org/reference/trait-bounds.html)
- [The Rust Reference：Implementations and coherence](https://doc.rust-lang.org/reference/items/implementations.html)
- [The Rust Reference：Associated items](https://doc.rust-lang.org/reference/items/associated-items.html)
- [Rust 语言圣经：泛型 Generics](https://course.rs/basic/trait/generic.html)
- [Rust 语言圣经：特征 Trait](https://course.rs/basic/trait/trait.html)
- [Rust 语言圣经：深入特征](https://course.rs/basic/trait/advance-trait.html)
