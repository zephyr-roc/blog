---
title: Rust GAT、HRTB 与 never type：类型关系如何跨越量化层级
date: 2026-09-04
excerpt: 从类型族与量化关系出发，分析泛型关联类型、借出式迭代、必需 where 子句、高阶生命周期约束、无值类型、发散表达式与 never fallback。
chapter: 类型系统
chapterOrder: 8
---

## 高级类型的核心是选择权

普通泛型参数、关联类型、GAT 与 HRTB 的差异，首先体现在谁选择参数以及选择发生在哪一层。

```rust
trait Iterator {
    type Item;

    fn next(&mut self) -> Option<Self::Item>;
}
```

普通关联类型由 trait 实现选择。给定 `Self` 后，`Self::Item` 就是一种固定类型。

```rust
trait LendingIterator {
    type Item<'a>
    where
        Self: 'a;

    fn next<'a>(&'a mut self) -> Option<Self::Item<'a>>;
}
```

GAT 不是为实现选择一个 `Item`，而是选择一整个类型族：每给出一个生命周期 `'a`，都能得到相应的 `Self::Item<'a>`。

```rust
fn call_with_local<F>(function: F)
where
    F: for<'a> Fn(&'a str),
{
    let text = String::from("local");
    function(&text);
}
```

HRTB 则要求一个约束对所有 `'a` 都成立。具体生命周期由使用该能力的代码选择，而不是由 `F` 的提供者预先固定。

这三种关系可以概括为：

| 形式 | 选择内容 | 选择者 |
|---|---|---|
| `trait Trait<T>` | trait 参数 `T` | 实现或调用所处的具体关系 |
| `trait Trait { type Item; }` | 一个固定关联类型 | trait 实现者 |
| `type Item<'a>` | 随 `'a` 变化的类型族 | 实现者定义映射，使用处代入 `'a` |
| `for<'a> Bound<'a>` | 任意 `'a` 都成立的能力 | 使用该能力的代码 |

高级类型语法不是为了增加抽象层数，而是为了把这种选择权准确写入类型系统。

## 普通关联类型只能选择一个结果

普通关联类型表达从实现者到类型的固定映射：

```rust
trait View {
    type Output;

    fn view(&self) -> Self::Output;
}
```

若实现者想返回借用自身的数据，必须为 `Output` 选择某个具体生命周期。这个生命周期不能由每次 `view` 调用的 `&self` 借用临时决定。

```rust
struct Text(String);

// 无法把“与本次 &self 一样长的 &str”写成一个固定 Output。
// impl View for Text {
//     type Output = &str;
// }
```

`&str` 必须携带生命周期。若把生命周期放在 trait 本身：

```rust
trait ViewAt<'a> {
    type Output;

    fn view(&'a self) -> Self::Output;
}
```

整个 trait 实例都被参数化为某个 `'a`，而不是让每次方法调用独立选择借用长度。某些 API 可以接受这个设计，但借出式接口通常需要更局部的关系。

## GAT 表达由参数索引的关联类型族

Generic Associated Type 允许关联类型拥有生命周期、类型或常量泛型参数：

```rust
trait View {
    type Output<'a>
    where
        Self: 'a;

    fn view(&self) -> Self::Output<'_>;
}

struct Text(String);

impl View for Text {
    type Output<'a> = &'a str
    where
        Self: 'a;

    fn view(&self) -> Self::Output<'_> {
        self.0.as_str()
    }
}
```

`Text` 的实现定义了映射：

```text
'a -> <Text as View>::Output<'a> = &'a str
```

方法借用 `self` 多久，就代入相应的 `'a`，得到同样长的输出引用。`Output` 不再是一个固定类型，而是一族通过生命周期索引的类型。

```rust
let text = Text(String::from("generic associated type"));
let view = text.view();
assert_eq!(view, "generic associated type");
```

这里没有延长引用生命周期。GAT 只是允许 trait 准确描述“输出借用来自本次接收者借用”的关系。

## GAT 可以同时接受三类泛型参数

GAT 的参数与普通泛型参数一样，可以是生命周期、类型和常量：

```rust
trait BufferFamily {
    type Buffer<T, const N: usize>;

    fn filled<T: Clone, const N: usize>(value: T) -> Self::Buffer<T, N>;
}

struct Arrays;

impl BufferFamily for Arrays {
    type Buffer<T, const N: usize> = [T; N];

    fn filled<T: Clone, const N: usize>(value: T) -> Self::Buffer<T, N> {
        std::array::from_fn(|_| value.clone())
    }
}

let values = Arrays::filled::<String, 3>(String::from("x"));
assert!(values.iter().all(|value| value == "x"));
```

这个实现为每组 `(T, N)` 选择数组 `[T; N]`。关联类型的泛型参数由使用处代入，实现者定义完整映射规则。

Rust 的 `for<...>` 目前量化生命周期，不支持任意 `for<T>` 类型量化。GAT 能表达许多需要类型构造器的模式，但不等同于提供完整的 higher-kinded types 系统。

## `where Self: 'a` 保留实现自由度

借出式 GAT 常见以下约束：

```rust
trait LendingIterator {
    type Item<'a>
    where
        Self: 'a;

    fn next<'a>(&'a mut self) -> Option<Self::Item<'a>>;
}
```

`&'a mut self` 的良构性已经隐含 `Self: 'a`：被借用的 `Self` 必须至少覆盖借用 `'a`。当 `Self::Item<'a>` 出现在返回类型中，这个可证明条件也需要写到 GAT 声明上。

它允许实现把来自 `Self` 的数据借入关联类型：

```rust
impl LendingIterator for Text {
    type Item<'a> = &'a str
    where
        Self: 'a;

    fn next<'a>(&'a mut self) -> Option<Self::Item<'a>> {
        Some(self.0.as_str())
    }
}
```

如果 GAT 不提供 `Self: 'a`，实现就可能无法合法选择包含 `&'a` 自身数据的类型。必需 where 子句的目标是让 trait 声明暴露方法签名已经证明、并且实现关联类型所需的条件。

必需约束由 GAT 在 trait 各方法中的使用共同决定，不能只凭固定口诀添加。多个方法使用同一个 GAT 时，编译器根据各使用位置可证明条件的交集判断哪些约束必须出现在声明上。

## 借出式迭代把元素生命周期绑定到每次调用

标准 `Iterator` 的 `Item` 对一个实现固定：

```rust
trait Iterator {
    type Item;
    fn next(&mut self) -> Option<Self::Item>;
}
```

它很适合返回拥有型值，或返回借用了迭代器外部存储的引用。若迭代器自己拥有缓冲区，并希望每次 `next` 返回借用该缓冲区的视图，固定 `Item` 无法表达“与本次 `&mut self` 一样长”。

```rust
struct Lines {
    text: String,
    cursor: usize,
}

impl Lines {
    fn new(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            cursor: 0,
        }
    }
}

impl LendingIterator for Lines {
    type Item<'a> = &'a str
    where
        Self: 'a;

    fn next<'a>(&'a mut self) -> Option<Self::Item<'a>> {
        if self.cursor >= self.text.len() {
            return None;
        }

        let rest = &self.text[self.cursor..];
        let line_len = rest.find('\n').unwrap_or(rest.len());
        let line = &rest[..line_len];

        self.cursor += line_len;
        if self.cursor < self.text.len() {
            self.cursor += 1;
        }

        Some(line)
    }
}
```

返回类型 `<Lines as LendingIterator>::Item<'a>` 是 `&'a str`，其中 `'a` 来自本次对 `self` 的独占借用。

```rust
let mut lines = Lines::new("alpha\nbeta");

let first = lines.next().unwrap();
assert_eq!(first, "alpha");

let second = lines.next().unwrap();
assert_eq!(second, "beta");
```

只要 `first` 仍会继续使用，对 `lines` 的独占借用就仍有效，不能再次调用 `next`：

```rust
let mut lines = Lines::new("alpha\nbeta");
let first = lines.next().unwrap();

// let second = lines.next();
// println!("{first} {second:?}");
```

这不是借用检查器对 GAT 的额外限制，而是签名编码的安全关系：下一次调用可能修改、移动或覆盖 `first` 所指向的内部缓冲区。

## 借出式接口让零拷贝关系进入 trait

解析器、数据库游标、压缩缓冲区和网络帧读取器经常复用内部存储。若每次输出都必须拥有数据，接口可能需要分配或复制；若返回引用，又必须把引用生命周期绑定到当次访问。

```rust
trait Parser {
    type Record<'a>
    where
        Self: 'a;

    type Error;

    fn parse_next<'a>(
        &'a mut self,
    ) -> Result<Option<Self::Record<'a>>, Self::Error>;
}
```

实现者可以选择借用切片、字段视图或包含多个借用字段的结构体：

```rust
#[derive(Debug, PartialEq, Eq)]
struct Record<'a> {
    key: &'a str,
    value: &'a str,
}
```

GAT 不保证零拷贝，也不强制关联类型是引用。它只提供足够的类型表达力，让实现者在每个 `'a` 下选择正确输出；是否复制由具体实现决定。

## GAT 的边界约束属于类型族契约

可以直接约束 GAT 产生的每个类型：

```rust
trait LendingIterator {
    type Item<'a>: std::fmt::Debug
    where
        Self: 'a;

    fn next<'a>(&'a mut self) -> Option<Self::Item<'a>>;
}
```

这要求每个合法 `'a` 对应的 `Self::Item<'a>` 都实现 `Debug`。所有实现者都必须满足它，使用者不必重复声明。

若只有个别算法需要 `Debug`，应把约束留在算法上：

```rust
fn debug_next<I>(iterator: &mut I)
where
    I: LendingIterator,
    for<'a> I::Item<'a>: std::fmt::Debug,
{
    if let Some(item) = iterator.next() {
        println!("{item:?}");
    }
}
```

定义处约束是所有实现的固有契约；使用处约束只是某个算法的额外需求。两者放置位置会直接改变哪些类型能够实现 trait。

## 带 GAT 的 trait 不能直接成为 trait object 基接口

上一章的 dyn compatibility 规则不允许基 trait 包含带泛型参数的关联类型。GAT 代表一整族类型，trait object 虚表接口无法在擦除 `Self` 后通过一个固定关联类型等式把全部成员具体化。

```rust
// fn consume(iterator: &mut dyn LendingIterator) {}
```

普通关联类型可以写成 `dyn Iterator<Item = u8>`，因为 `Item` 只有一个具体值。GAT 则需要针对所有 `'a` 描述 `Item<'a>`，目前不能用同样的 trait object 形式完成擦除。

这意味着 GAT 接口通常通过泛型静态分发使用，或在更外层重新设计一个不暴露 GAT 的 dyn-compatible facade。GAT 与动态分发解决的是不同维度的问题，不能把前者理解为更高级的 trait object。

## HRTB 把生命周期量词放进约束

普通生命周期参数位于函数外层，由调用者选择：

```rust
fn call_once<'a, F>(function: F, value: &'a str)
where
    F: Fn(&'a str),
{
    function(value);
}
```

调用 `call_once` 时，调用者提供 `value`，由此确定本次 `'a`。`F` 只需对这个具体生命周期可调用。

HRTB 把量词移到 trait bound 内部：

```rust
fn call_with_local<F>(function: F)
where
    F: for<'a> Fn(&'a str),
{
    let first = String::from("first");
    function(&first);

    let second = String::from("second");
    function(&second);
}
```

`for<'a>` 表示对所有 `'a`。`call_with_local` 可以在函数内部创造任意短的新生命周期，再要求 `function` 接受它们。

逻辑形状分别是：

```text
普通约束：调用者选择 'a，然后需要 F: Fn(&'a str)
HRTB：    需要 F 对任意 'a 都实现 Fn(&'a str)
```

后者更强。只会接受 `&'static str` 的函数不能满足“对所有 `'a`”的要求，因为局部字符串借用不是 `'static`。

## `for<'a>` 的位置控制量词作用域

以下两种常见写法在只有一个 trait bound 时等价：

```rust
where
    for<'a> F: Fn(&'a str)
```

```rust
where
    F: for<'a> Fn(&'a str)
```

第一种量词作用到后面的整个 bound，第二种把生命周期作用域限制在紧随其后的 trait。复杂 `+` 组合中，量词放置会决定生命周期名字能在哪些约束里使用。

```rust
fn compare_with_all<F>(function: F)
where
    for<'a> F: Fn(&'a str) + Send,
{
    function("value");
}
```

`Send` 本身不使用 `'a`，但与 `Fn` 共同位于这个 bound 列表。若多个 trait 需要共享同一个绑定生命周期，把 `for<'a>` 放在整个 bound 前更直接。

HRTB 当前主要用于生命周期量化。Rust 不提供 `for<T> F: Trait<T>` 形式的任意类型量化；类型维度通常通过普通泛型参数、关联类型、GAT 或 trait 设计重新表达。

## 函数签名中的省略可能隐含 HRTB

函数指针和闭包 trait 签名中的输入、输出生命周期省略仍按函数规则处理：

```rust
type Transform = fn(&str) -> &str;
```

它等价于：

```rust
type TransformExplicit = for<'a> fn(&'a str) -> &'a str;
```

函数必须对任意输入借用成立，并返回与该次输入关联的引用：

```rust
fn trim(value: &str) -> &str {
    value.trim()
}

let transform: Transform = trim;
assert_eq!(transform(" rust "), "rust");
```

类似的 `Fn(&str) -> &str` 约束也可能隐含同样的高阶输入输出关系。遇到复杂嵌套引用时，显式写 `for<'a>` 能区分“任意调用生命周期”与“外层已经固定的某个生命周期”。

## HRTB 可以约束引用类型本身

`for<'a>` 不只用于 `Fn` trait。任何随生命周期变化的 trait bound 都可以被高阶量化：

```rust
fn equal_through_any_borrow<T>(value: &T, expected: i32) -> bool
where
    for<'a> &'a T: PartialEq<i32>,
{
    value == expected
}
```

这个约束要求 `&'a T` 对任意 `'a` 都能与 `i32` 比较。它描述的是一族引用类型的实现关系，而不是要求 `T` 自身实现 `PartialEq<i32>`。

更常见的库级形式会把借用视图、迭代能力或反序列化能力放在高阶约束中：

```rust
fn count_borrowed<T>(value: &T) -> usize
where
    for<'a> &'a T: IntoIterator,
{
    value.into_iter().count()
}
```

每次借用 `value` 都形成新的 `'a`，而约束保证所有这些引用都能转成迭代器。

## HRTB 与生命周期子类型表达不同关系

`'long: 'short` 比较两个已经命名的生命周期，表示 `'long` 至少覆盖 `'short`。`for<'a>` 则引入一个可被任意实例化的新生命周期。

```rust
fn shorten<'long, 'short>(value: &'long str) -> &'short str
where
    'long: 'short,
{
    value
}
```

这个函数依赖两个具体生命周期间的 outlives 关系。

```rust
fn use_any<F>(function: F)
where
    F: for<'a> Fn(&'a str),
{
    let local = String::from("local");
    function(&local);
}
```

这里没有可提前比较的 `'long` 与 `'short`；`F` 必须对函数内部随后产生的 `'a` 成立。

outlives bound 解决区间包含，HRTB 解决量化层级。两者可以组合，但不能互相替代。

## GAT 与 HRTB 在使用处相遇

GAT 定义一个随 `'a` 变化的类型族，HRTB 可以要求这个类型族的每个成员都满足某项能力：

```rust
fn inspect_lender<I>(iterator: &mut I)
where
    I: LendingIterator,
    for<'a> I::Item<'a>: std::fmt::Debug,
{
    if let Some(item) = iterator.next() {
        println!("{item:?}");
    }
}
```

约束不是只要求当前某个输出实现 `Debug`，而是要求：

```text
对所有 'a，<I as LendingIterator>::Item<'a>: Debug
```

因此函数内部无论以什么局部生命周期借用迭代器，拿到的成员都可调试输出。

这正是两者的分工：

- GAT 让输出类型可以随借用变化；
- HRTB 让算法对所有这种变化保持有效。

当错误信息同时出现 `for<'a>`、关联类型投影和 outlives 约束时，应先分别确定类型族映射、量词选择者和每个引用来源，再组合判断。

## 高阶约束比单次调用要求更强

一个闭包可能足以处理某次具体借用，却不一定对所有生命周期成立：

```rust
fn call_specific<'a, F>(function: F, value: &'a str) -> &'a str
where
    F: Fn(&'a str) -> &'a str,
{
    function(value)
}
```

这里 `F` 可以只针对外层给出的 `'a`。高阶版本则要求保持任意输入输出关系：

```rust
fn call_general<F>(function: F, value: &str) -> &str
where
    F: for<'a> Fn(&'a str) -> &'a str,
{
    function(value)
}
```

普通函数项通常能自然满足这种签名：

```rust
fn first_word(value: &str) -> &str {
    value.split_whitespace().next().unwrap_or("")
}

assert_eq!(call_general(first_word, "higher rank"), "higher");
```

捕获外部引用的闭包还携带捕获环境自己的生命周期。HRTB 只量化调用参数中的 `'a`，不会让捕获数据延长或变成 `'static`。

## rank 描述量词嵌套的位置

普通泛型函数把类型和生命周期参数放在最外层：

```rust
fn apply<'a, F>(function: F, value: &'a str)
where
    F: Fn(&'a str),
{
    function(value);
}
```

约束中的 `for<'a>` 把量词嵌入另一个类型或 trait bound 内，因此称为 higher-ranked。它允许外层函数要求参数自身具备“对任意生命周期泛型”的能力。

Rust 的稳定语法主要暴露高阶生命周期，而不是完整的任意高阶类型量化。不能仅凭数学记号类比，假设所有 `for<T>`、高阶类型构造器或 impredicative polymorphism 都能直接表达。

判断一个 API 是否需要 HRTB，可以检查：生命周期应由外层调用者固定，还是由函数内部每次调用临时选择。后者才需要 `for<'a>`。

## never type 表示不存在任何值

never type 写作 `!`，它没有任何可能的值，表示计算不会正常完成。

```rust
fn stop(message: &str) -> ! {
    panic!("{message}");
}

fn run_forever() -> ! {
    loop {
        std::thread::park();
    }
}
```

`stop` 通过 panic 终止当前正常控制流，`run_forever` 永远不离开循环。它们都不会向调用方交付返回值。

`!` 与 `()` 完全不同：

| 类型 | 值的数量 | 含义 |
|---|---:|---|
| `()` | 1 | 正常完成，但没有携带信息 |
| `!` | 0 | 不会正常完成，无法产生返回值 |

返回 `()` 的函数可以执行结束；返回 `!` 的函数若执行到普通函数尾部，反而违反签名。

当前稳定 Rust 中，`!` 语法仍只能显式用于函数返回类型。编译器内部会为发散表达式使用 never type 并执行相应 coercion，但不能把 `!` 当作任意普通泛型实参书写。

## 发散表达式可以适配任意目标类型

没有值可产生的路径不会破坏其他路径的类型合并：

```rust
fn parse_port(text: &str) -> u16 {
    match text.parse() {
        Ok(port) => port,
        Err(error) => panic!("invalid port: {error}"),
    }
}
```

成功分支产生 `u16`，失败分支的 `panic!` 发散。类型系统允许 `!` 在 coercion site 转为目标 `u16`，因为不存在一个实际的 `!` 值会被错误解释为整数。

```rust
fn read_or_exit(path: &str) -> String {
    match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(_) => std::process::exit(1),
    }
}
```

`process::exit` 返回 `!`，所以整个 `match` 仍能得到 `String`。

这种行为类似类型理论中的 bottom type，但 Rust Reference 将它规定为 `!` 到其他类型的 coercion。讨论具体 Rust 类型关系时，应使用这条语言规则，而不是假设一套更广泛的子类型系统。

## `return`、`break` 与 `continue` 都能终止当前路径

提前返回表达式不产生当前位置所需的值：

```rust
fn positive(value: i32) -> u32 {
    if value < 0 {
        return 0;
    }

    value as u32
}
```

`return 0` 把值交给函数调用方，并使当前分支不再继续到 `if` 后方。因此该分支可以出现在需要与其他表达式合并的位置。

`continue` 终止当前循环迭代，`break` 终止目标循环或带标签代码块。无值 `break` 与携带值的 `break expression` 需要区分：携带值决定 `loop` 或标签块的结果类型，而永远不抵达结果位置的路径通过发散参与合并。

```rust
let result = loop {
    let Some(value) = Some(42) else {
        continue;
    };

    break value;
};

assert_eq!(result, 42);
```

## `let else` 要求失败分支发散

`let PATTERN = expression else { ... };` 会把成功匹配的绑定带入后续外层作用域。若匹配失败，继续执行就意味着这些绑定不存在，因此 `else` 块必须发散。

```rust
fn first(values: &[i32]) -> i32 {
    let Some(value) = values.first() else {
        return 0;
    };

    *value
}
```

`return` 保证失败路径不会抵达 `*value`。`panic!`、`continue`、`break` 或调用返回 `!` 的函数也可以满足相应控制流要求，只要它们确实离开当前后续路径。

这不是单纯的语法限制，而是绑定良构性的类型证明：进入后续代码的所有路径都必须已经成功产生模式变量。

## 空枚举在稳定 Rust 中表达无值类型

没有任何变体的枚举无法通过安全代码构造：

```rust
enum Void {}
```

获得 `Void` 值是不可能事件，因此可以用空 `match` 从逻辑矛盾推出任意结果类型：

```rust
fn absurd<T>(value: Void) -> T {
    match value {}
}
```

`match` 不需要分支，因为 `Void` 没有可匹配变体。函数也不可能被安全调用，所以它不需要真实构造一个 `T`。

这与 never-to-any coercion具有相同的逻辑基础，但 `Void` 是用户定义的普通无值类型，`!` 是语言内建 never type。两者在语法能力、coercion 和未来兼容性上不能视为完全相同。

## `Infallible` 表达不会发生的错误

标准库 `std::convert::Infallible` 是没有变体的枚举，适合稳定 API 中表示不可能出现的错误：

```rust
use std::convert::Infallible;

fn always_succeeds(value: u32) -> Result<String, Infallible> {
    Ok(value.to_string())
}

fn unwrap_infallible<T>(result: Result<T, Infallible>) -> T {
    match result {
        Ok(value) => value,
        Err(impossible) => match impossible {},
    }
}

assert_eq!(unwrap_infallible(always_succeeds(7)), "7");
```

错误分支在类型上存在于 `Result` 结构中，但没有任何合法 `Infallible` 值能进入它。

标准库计划在完整 never type 稳定后把 `Infallible` 迁移为 `!` 的类型别名。当前二者仍有可观察的一致性差异，例如分别针对 `fn() -> !` 与 `fn() -> Infallible` 的 trait 实现目前可以共存；未来成为别名后可能重叠。公共泛型实现不应依赖这种暂时差异。

## 无值类型不等于零大小类型

零大小类型描述布局不占数据字节，但仍可能有合法值：

```rust
struct Marker;

let first = Marker;
let second = Marker;
```

`Marker` 有一个可构造值。`()` 同样只有一个值。无值类型则没有任何合法值，安全代码无法产生实例。

```rust
enum Void {}
```

“大小为零”讨论表示；“值的数量为零”讨论可构造性。优化器可能利用无值分支不可达这一事实，但 API 语义不应通过 `size_of` 推断类型是否可实例化。

unsafe 代码若伪造无值类型实例，会立即破坏值有效性不变量；不能以“反正不读取字段”为理由构造它。

## never coercion 与 fallback 是不同阶段

目标类型已知时，发散表达式可以直接 coercion：

```rust
let value: u8 = panic!("no value");
```

这段代码在运行时 panic，永远不会产生 `u8`。类型检查只需要确认发散路径能适配目标。

若编译器插入 never coercion 后仍留下未约束类型变量，就需要 fallback 规则选择默认类型。Rust 2024 Edition 将 never type fallback 从历史上的 `()` 改为 `!`。

```rust
fn generic<T: Default>() -> Result<T, ()> {
    Ok(T::default())
}

fn outer() -> Result<(), ()> {
    generic::<()>()?;
    Ok(())
}
```

显式写 `::<()>` 固定了设计意图，不依赖 fallback 猜测成功类型。涉及 `?`、泛型返回值、发散闭包或 unsafe 函数时，显式类型尤其重要。

fallback 不是普通默认泛型参数，也不是 `!` 无条件变成某种类型。它只在类型推导无法完成、且编译器记录了 never coercion 的特定位置参与求解。

## Rust 2024 避免把发散误判成正常完成

历史 `()` fallback 可能让只会发散的表达式被推断成正常返回 unit，从而意外满足 `T: Trait` 或影响 unsafe API 的类型选择。Rust 2024 默认保留 `!`，使“永不返回”的语义不再无理由退化为“正常返回 `()`”。

```rust
trait UnitOnly {}
impl UnitOnly for () {}

fn run<R: UnitOnly>(function: impl FnOnce() -> R) {
    function();
}

// run(|| panic!());
```

依赖旧 fallback 时，闭包返回值可能曾被当作 `()`；在 Rust 2024 中它保持 `!`，而 `!` 没有因为 fallback 自动获得 `UnitOnly` 实现。若 API 确实需要 unit，应明确写出：

```rust
run(|| -> () { panic!() });
```

迁移的核心不是给所有 panic 闭包添加标注，而是找出哪些代码把类型选择错误地建立在旧 fallback 偶然行为上。

## `Result<T, Infallible>` 仍保留结果语义

一个错误类型不可构造，不代表外层 `Result` 可以在源码中任意当作 `T`。仍需通过模式匹配或封装函数消除 `Result`：

```rust
fn into_value<T>(result: Result<T, std::convert::Infallible>) -> T {
    let Ok(value) = result;
    value
}
```

按值匹配无值错误类型时，穷尽性检查知道 `Err` 不可能携带合法值，因此可以省略该分支。若通过引用、裸指针或 union 观察无值类型，规则会更保守，因为 unsafe 与未初始化状态会影响可达性判断。

`Result<T, Infallible>` 对泛型 API 很有用：同一接口既能容纳可能失败的实现，也能容纳不会失败的实现，而不必为后者另建完全不同的调用协议。

## 高级类型关系的错误应分层读取

GAT、HRTB 和 never type 同时出现时，编译器错误容易包含大量投影与生命周期。可以按以下顺序拆解：

1. **关联类型是谁的**：先把 `I::Item<'a>` 展开为 `<I as Trait>::Item<'a>`；
2. **参数由谁选择**：`'a` 是方法调用产生，还是外层函数参数？
3. **量词是什么**：约束只对某个 `'a`，还是 `for<'a>` 对所有生命周期？
4. **借用来自哪里**：输出是否借用 `self`、参数或外部存储？
5. **where 子句是否良构**：`Self: 'a`、`T: 'a` 等条件是否位于 GAT 契约所需位置？
6. **路径是否发散**：缺少返回值是 `()`，还是该路径根本产生不了值？
7. **推导是否依赖 fallback**：泛型成功类型是否需要显式标注？

先恢复类型关系，再处理语法，通常比反复添加 `'static` 或复制编译器建议更可靠。`'static` 不能替代 HRTB，固定关联类型不能替代 GAT，`()` 也不能替代 `!`。

## 工程中的设计检查

设计高级泛型接口时，可以依次回答：

1. 输出类型是否需要随每次借用的生命周期变化？
2. 普通关联类型是否已经足够，还是确实需要类型族？
3. GAT 上的 `Self: 'a` 来自哪个方法签名中的可证明关系？
4. 约束是所有实现的固有要求，还是某个算法的局部要求？
5. 生命周期由外层调用者选择，还是由函数内部每次调用选择？
6. 是否真正需要 `for<'a>`，而不是某个具体 outlives bound？
7. 带 GAT 的 trait 是否被错误地设计成必须通过 `dyn Trait` 使用？
8. 发散路径是否应返回 `!`，正常无信息完成是否应返回 `()`？
9. 稳定 API 是否应使用 `Infallible` 表达不可能错误？
10. 类型推导是否依赖 edition 相关的 never fallback，而非显式契约？

GAT 适合表达借出式与类型族关系，但会增加实现与诊断复杂度；HRTB 适合把生命周期选择权交给算法内部，但比单个生命周期约束更强；无值类型适合证明路径不可能发生，但不能用 unsafe 伪造来跳过分支处理。

## 本章建立的类型模型

GAT、HRTB 与 never type 共同补全以下类型关系：

1. 普通关联类型为每个实现者选择一个固定类型；
2. GAT 为每个实现者选择一个由生命周期、类型或常量索引的类型族；
3. `where Self: 'a` 允许关联类型成员合法借用实现者，并保留实现自由度；
4. 借出式接口把输出生命周期绑定到每次方法借用，而不是固定到整个 trait 实例；
5. HRTB 用 `for<'a>` 表示约束对所有生命周期成立；
6. outlives bound 比较具体生命周期，HRTB 则引入量化生命周期；
7. HRTB 可以约束 GAT 类型族的每一个成员；
8. `!` 没有任何值，表示计算不会正常完成，并能在 coercion site 适配目标类型；
9. `Infallible` 是稳定 API 中可用的无变体错误类型，但当前尚未成为 `!` 的别名；
10. Rust 2024 的 never fallback 保留发散语义，减少 `!` 被偶然推断为 `()` 的情况。

下一章[《Rust PhantomData、Pin 与 unsafe 边界：如何封装编译器无法证明的不变量》](/collections/rust/phantomdata-pin-unsafe)将分析零大小标记如何影响拥有关系、drop check、型变与 auto trait，地址固定契约如何支持自引用 Future，以及安全抽象必须向编译器和调用者分别证明哪些不变量。

## 延伸阅读

- [The Rust Reference：Generic associated types](https://doc.rust-lang.org/reference/items/associated-items.html#associated-types)
- [The Rust Reference：Required where clauses on GATs](https://doc.rust-lang.org/reference/items/associated-items.html#required-where-clauses-on-generic-associated-types)
- [The Rust Reference：Higher-ranked trait bounds](https://doc.rust-lang.org/reference/trait-bounds.html#higher-ranked-trait-bounds)
- [The Rust Reference：Never type](https://doc.rust-lang.org/reference/types/never.html)
- [The Rust Edition Guide：Never type fallback change](https://doc.rust-lang.org/edition-guide/rust-2024/never-type-fallback.html)
- [Rust Blog：Generic associated types stabilization](https://blog.rust-lang.org/2022/10/28/gats-stabilization/)
- [Rust 标准库：`Infallible`](https://doc.rust-lang.org/std/convert/enum.Infallible.html)
- [Rust 语言圣经：GAT 稳定版介绍](https://course.rs/appendix/rust-versions/1.65.html)
- [Rust 语言圣经：生命周期约束与 HRTB](https://course.rs/advance/lifetime/advance.html#生命周期约束-hrtb)
- [Rust 语言圣经：发散函数](https://course.rs/basic/base-type/function.html#永不返回的发散函数)
