---
title: Rust 生命周期、子类型与型变：引用关系如何传播
date: 2026-09-04
excerpt: 从引用的来源关系出发，分析生命周期标注、省略规则、outlives 约束、生命周期子类型、协变、逆变、不变与高阶生命周期边界。
chapter: 类型系统
chapterOrder: 4
---

## 生命周期描述引用之间的关系

生命周期不是对象的计时器，也不会让任何值活得更久。它是编译器用来描述引用有效区间及其相互关系的类型参数。

```rust
fn first_word(text: &str) -> &str {
    text.split_whitespace().next().unwrap_or("")
}
```

这个函数返回的字符串切片来自参数 `text`。把省略的生命周期展开后，签名是：

```rust
fn first_word<'a>(text: &'a str) -> &'a str {
    text.split_whitespace().next().unwrap_or("")
}
```

`'a` 表达输入与输出的依赖：返回引用不能比输入引用有效得更久。它没有规定 `'a` 对应多少行代码，也没有改变字符串本身的析构时间。

```rust
let word;

{
    let text = String::from("lifetime relation");
    word = first_word(&text);
    println!("{word}");
}

// println!("{word}"); // text 已析构，借用不能继续使用
```

调用点会为 `'a` 选择一个满足约束的有效区间。只要输出引用仍可能被使用，它所依赖的 `text` 就必须保持有效。

## 生命周期标注连接来源，不证明值永久存在

当返回值可能来自多个输入时，签名必须明确它与哪些输入共享约束：

```rust
fn longest<'a>(left: &'a str, right: &'a str) -> &'a str {
    if left.len() >= right.len() { left } else { right }
}
```

这里的 `'a` 不表示两个输入的实际生命周期完全相同。调用时，较长的生命周期可以缩短到共同可用的区域，返回值受这个共同区域约束。

```rust
let outer = String::from("outer value");

{
    let inner = String::from("inner");
    let result = longest(&outer, &inner);
    println!("{result}");
}
```

`result` 不能逃出内部作用域，因为实现可能返回 `inner` 的切片。即使运行时恰好返回了 `outer`，类型签名也必须覆盖函数所有可能的执行路径。

如果函数永远返回第一个输入，就应使用两个独立的生命周期：

```rust
fn choose_left<'a, 'b>(left: &'a str, _right: &'b str) -> &'a str {
    left
}
```

这个签名只把输出绑定到 `left`；`right` 可以更早失效。生命周期标注的精度会直接决定调用方能安全使用结果多久。

## 无法返回指向局部变量的引用

生命周期参数只能描述已有关系，不能制造一个可返回的来源：

```rust
fn invalid() -> &str {
    let text = String::from("local");
    // &text // E0106 / E0515：返回值引用了局部数据
    todo!()
}
```

`text` 在函数返回时析构。无论为返回类型添加什么生命周期名字，都不能让这段引用变得有效。正确设计是转移所有权：

```rust
fn owned_text() -> String {
    String::from("owned")
}
```

或者让存储由调用方提供：

```rust
fn write_text(buffer: &mut String) -> &str {
    buffer.clear();
    buffer.push_str("borrowed from caller");
    buffer.as_str()
}
```

返回借用要求数据已经存在于某个比返回引用更长寿的所有者中；函数自己的普通局部变量无法承担这个角色。

## 函数签名的生命周期省略规则

Rust 对常见函数签名应用确定的省略规则，而不是任意推断返回值来自哪里。

第一条规则：每个省略的输入生命周期都是独立参数。

```rust
fn compare(left: &str, right: &str) -> bool
```

等价于：

```rust
fn compare<'a, 'b>(left: &'a str, right: &'b str) -> bool
```

第二条规则：如果所有输入引用中只有一个生命周期，它会赋给所有省略的输出生命周期。

```rust
fn head(bytes: &[u8]) -> &[u8]
```

等价于：

```rust
fn head<'a>(bytes: &'a [u8]) -> &'a [u8]
```

第三条规则：方法存在 `&self` 或 `&mut self` 接收者时，接收者的生命周期会赋给省略的输出生命周期。

```rust
struct Frame<'a> {
    payload: &'a [u8],
}

impl<'a> Frame<'a> {
    fn payload(&self) -> &[u8] {
        self.payload
    }
}
```

`payload` 的返回值默认绑定到这次 `&self` 借用，而不是直接采用结构体参数 `'a`。多数情况下这个更短的借用正是所需契约。

如果多个输入都可能成为输出来源，省略规则无法选择，必须显式标注：

```rust
// fn select(left: &str, right: &str) -> &str
// 无法判断输出来自 left 还是 right
```

省略只隐藏能由固定规则恢复的标注，不会减少类型系统中的生命周期约束。

## 结构体中的引用把有效性带入类型

结构体保存引用时，类型必须记录引用的生命周期：

```rust
#[derive(Debug)]
struct Header<'a> {
    name: &'a str,
    value: &'a str,
}

fn parse_header(line: &str) -> Option<Header<'_>> {
    let (name, value) = line.split_once(':')?;
    Some(Header {
        name: name.trim(),
        value: value.trim(),
    })
}
```

`Header<'a>` 不能比它引用的输入行活得更久。它是零拷贝视图，不拥有字段文本。

```rust
let line = String::from("Content-Type: text/plain");
let header = parse_header(&line).unwrap();

assert_eq!(header.name, "Content-Type");
assert_eq!(header.value, "text/plain");
```

这种类型适合协议解析：缓冲区拥有字节，解析结果只保存指向其中的切片。但它也意味着缓冲区在视图有效期间不能被扩容、清空或移走。

```rust
let mut buffer = String::from("Key: Value");
let header = parse_header(&buffer).unwrap();

// buffer.clear(); // header 仍借用 buffer
println!("{}", header.value);
```

需要让解析结果脱离缓冲区长期保存时，应把边界转换成拥有型数据，而不是强行延长生命周期：

```rust
#[derive(Debug)]
struct OwnedHeader {
    name: String,
    value: String,
}

impl From<Header<'_>> for OwnedHeader {
    fn from(header: Header<'_>) -> Self {
        Self {
            name: header.name.to_owned(),
            value: header.value.to_owned(),
        }
    }
}
```

## `'_` 表示在此处推导生命周期

占位生命周期 `'_` 表示让编译器按省略规则推导这个位置的生命周期：

```rust
fn parse_header(line: &str) -> Option<Header<'_>> {
    // ...
    todo!()
}
```

它与 `'static` 完全不同。`'_` 是一个待推导的关系，`'static` 则表示引用可以在程序整个剩余运行期内有效。

在类型路径中显式写 `'_` 往往能清楚表明“这个类型携带借用，但具体生命周期由上下文决定”：

```rust
fn print_header(header: Header<'_>) {
    println!("{}: {}", header.name, header.value);
}
```

## `'static` 引用与 `T: 'static` 不是一回事

字符串字面量通常具有 `&'static str` 类型，因为其字节存放在程序的静态数据中：

```rust
let language: &'static str = "Rust";
```

`&'static T` 是一个能在程序整个剩余运行期内保持有效的引用。它并不表示底层内存一定不可释放；例如 `Box::leak` 可以通过主动泄漏堆分配得到静态引用，但这通常不是资源管理方案。

`T: 'static` 是类型的 outlives bound，表示 `T` 内部不包含寿命短于 `'static` 的借用。拥有型数据常常满足它：

```rust
fn requires_static<T: 'static>(_value: T) {}

let owned = String::from("owned");
requires_static(owned);
```

`String: 'static` 不代表这个 `String` 值会存活到进程结束；它仍然可以在函数结束时析构。这个约束只说明类型内部没有借用某个较短生命周期的数据。

相反，包含局部引用的类型通常不满足 `'static`：

```rust
let local = String::from("local");
let borrowed = local.as_str();

// requires_static(borrowed);
```

并发任务、线程和长期保存的回调经常要求 `T: 'static`，因为执行方无法接受捕获短期栈引用的值；它们不一定要求传入值永远不析构。

## outlives bound 明确“至少一样长”

`'long: 'short` 读作 `'long` outlives `'short`，表示 `'long` 至少覆盖 `'short`：

```rust
fn shorten<'long, 'short>(value: &'long str) -> &'short str
where
    'long: 'short,
{
    value
}
```

较长的引用可以在只需要较短引用的位置使用。约束方向可以理解为：`'long` 提供的有效区间足以满足 `'short` 的要求。

类型也可以带 outlives bound：

```rust
struct Ref<'a, T: 'a> {
    value: &'a T,
}
```

`T: 'a` 表示 `T` 内部包含的所有生命周期参数都至少覆盖 `'a`，从而保证 `&'a T` 在该期间有效。现代 Rust 会从字段中推导许多显然的 outlives 约束，因此经常不必手写 `T: 'a`；在泛型 API 的 `where` 子句中，它仍是重要的关系表达。

## 生命周期形成 Rust 中最主要的子类型关系

Rust 的子类型远比传统面向对象语言有限。忽略生命周期后，安全 Rust 中大多数类型关系就是类型相等；子类型主要来自生命周期和高阶生命周期。

如果 `'long: 'short`，那么 `&'long T` 可以在要求 `&'short T` 的地方使用：

```rust
fn use_for_call<'short>(value: &'short str) {
    println!("{value}");
}

let static_text: &'static str = "available forever";
use_for_call(static_text);
```

可以把 `&'static str` 视为任意更短 `&'a str` 的子类型。这里的“子类型”不表示继承，而表示某个值能隐式用于另一个类型要求的位置。

方向不能反过来。一个只在局部作用域有效的引用不能提升成 `&'static T`：

```rust
let text = String::from("short");
let short = text.as_str();

// let forever: &'static str = short;
```

## 型变决定子类型关系能否穿过泛型类型

已知 `Sub` 是 `Super` 的子类型，并不能自动推出 `F<Sub>` 是 `F<Super>` 的子类型。`F` 如何传播内部参数的子类型关系，称为它对该参数的型变：

- **协变**（covariant）：方向保持，`F<Sub>` 是 `F<Super>` 的子类型；
- **逆变**（contravariant）：方向反转，`F<Super>` 是 `F<Sub>` 的子类型；
- **不变**（invariant）：不能由内部参数推出两种外层类型的子类型关系。

Rust 会根据类型参数在字段中的使用位置自动计算用户定义结构体和枚举的型变。

## 共享引用对生命周期和目标类型协变

`&'a T` 对 `'a` 和 `T` 都是协变的。较长生命周期可以缩短，目标类型的子类型关系也能向外传播。

```rust
fn shorten_shared<'long, 'short>(value: &'long str) -> &'short str
where
    'long: 'short,
{
    value
}
```

共享引用只允许读取目标，缩短有效区间不会引入写入能力，也不会把不满足要求的值写回原位置，所以这种转换是安全的。

拥有型只读容器通常也对元素类型协变，例如 `Vec<T>`、`Box<T>`、数组和切片。它们只有通过取得独占访问才能替换元素，而独占访问会另外受到借用规则约束。

## 独占引用对生命周期协变，对目标类型不变

`&'a mut T` 对生命周期 `'a` 协变，因此独占借用可以被重借用为更短的独占引用；但它对 `T` 不变。

```rust
fn shorter_mut<'long, 'short>(value: &'long mut i32) -> &'short mut i32
where
    'long: 'short,
{
    value
}
```

目标类型必须不变，是因为 `&mut T` 不仅能读取 `T`，还能写入新的 `T`。如果允许把目标类型协变缩短，会制造悬垂引用：

```rust
fn overwrite<'a>(slot: &mut &'a str, value: &'a str) {
    *slot = value;
}

let static_text: &'static str = "static";
let mut slot = static_text;

{
    let local = String::from("local");

    // 如果 &mut &'static str 能被当作 &mut &'short str，
    // overwrite 就能把 local 的短引用写入 slot。
    // overwrite(&mut slot, &local);
}

println!("{slot}");
```

`slot` 的类型要求内部引用为 `'static`。允许上述转换后，短生命周期引用会被写进它并在 `local` 析构后继续读取。因此 `&mut T`、`Cell<T>`、`RefCell<T>`、`UnsafeCell<T>` 和裸指针 `*mut T` 等可写位置通常对 `T` 不变。

“`&mut` 对目标不变”与“`&mut` 可以重借用为更短生命周期”并不矛盾：前者讨论目标类型 `T`，后者讨论外层引用自身的生命周期 `'a`。

## 函数参数逆变，返回值协变

函数类型对参数类型逆变，对返回类型协变：

```rust
fn accepts_any(value: &str) {
    println!("{value}");
}

fn call_with_static(function: fn(&'static str)) {
    function("static input");
}

call_with_static(accepts_any);
```

`accepts_any` 能处理任意有效期的 `&str`，自然也能处理 `'static` 输入。反过来，只接受 `&'static str` 的函数不能替代接受任意短引用的函数，因为调用方可能传入局部数据。

返回值方向则保持：能返回更长寿引用的函数，可以满足只要求较短引用的使用位置。

参数和返回值同时使用同一生命周期时，协变与逆变要求会合并，可能使整个函数类型对该生命周期不变。阅读复杂函数指针或回调错误时，需要分别检查每个参数出现的位置。

## 用户定义类型的型变来自字段

只保存共享引用的结构体通常对生命周期协变：

```rust
struct View<'a> {
    text: &'a str,
}

fn shorten_view<'long, 'short>(view: View<'long>) -> View<'short>
where
    'long: 'short,
{
    view
}
```

如果字段把参数放入不变位置，整个结构体对该参数也会变为不变：

```rust
use std::cell::Cell;

struct Slot<'a> {
    text: Cell<&'a str>,
}
```

`Cell<&'a str>` 可以替换内部引用，因此不能把 `Slot<'static>` 当成 `Slot<'short>`。否则就能经由较短视图写入短引用，再从原来的静态类型读取。

零大小标记字段也参与型变计算。后续讨论 `PhantomData` 与 unsafe 抽象时，会进一步分析如何用标记字段声明逻辑上的拥有、借用和型变关系。

## 高阶生命周期把选择权交给调用点

普通生命周期参数通常由调用者为一次调用选择：

```rust
fn apply<'a, F>(value: &'a str, function: F) -> &'a str
where
    F: Fn(&'a str) -> &'a str,
{
    function(value)
}
```

这里的 `F` 只需要适用于这一次具体的 `'a`。如果一个回调必须能够接受任意生命周期的引用，需要高阶 trait bound：

```rust
fn call_with_local<F>(function: F)
where
    F: for<'a> Fn(&'a str) -> &'a str,
{
    let local = String::from("local");
    let result = function(&local);
    println!("{result}");
}

call_with_local(|text| text.trim());
```

`for<'a>` 可以读作“对所有 `'a`”。具体 `'a` 直到 `call_with_local` 内部创建局部引用时才确定，因此不能由函数外部预先固定。

高阶约束比某个具体生命周期更强：

```rust
for<'a> Fn(&'a str) -> &'a str
```

表示回调对任意输入生命周期都成立；而：

```rust
Fn(&'static str) -> &'static str
```

只要求它处理静态引用。前者可以用于局部字符串，后者不能。

函数指针和闭包 trait 的常见省略形式本身就可能隐含 HRTB：

```rust
type Transformer = for<'a> fn(&'a str) -> &'a str;

fn trim(text: &str) -> &str {
    text.trim()
}

let transformer: Transformer = trim;
```

本章只处理 HRTB 与生命周期选择权的关系；它与 GAT、trait 对象和更复杂关联类型组合后的表达能力将在高级类型章节继续展开。

## 闭包的生命周期需要由上下文具体化

函数项的签名可以直接应用生命周期省略规则：

```rust
fn identity(text: &str) -> &str {
    text
}
```

它等价于能处理任意生命周期的函数：

```rust
fn identity<'a>(text: &'a str) -> &'a str {
    text
}
```

独立闭包没有可以显式声明 `<'a>` 的函数项签名。下面这种写法可能因缺少足够的期望类型而无法把输入与输出生命周期关联起来：

```rust
// let identity = |text: &str| -> &str { text };
```

这不是“闭包不支持返回借用”，而是闭包类型必须从上下文获得所需的高阶关系。可以先给出函数指针类型：

```rust
let identity: for<'a> fn(&'a str) -> &'a str = |text| text;

assert_eq!(identity("rust"), "rust");
```

也可以通过带 HRTB 的泛型边界约束闭包：

```rust
fn accept_identity<F>(function: F) -> F
where
    F: for<'a> Fn(&'a str) -> &'a str,
{
    function
}

let identity = accept_identity(|text| text);
assert_eq!(identity("lifetime"), "lifetime");
```

期望类型告诉编译器：闭包不是只对某一个碰巧推导出的生命周期成立，而是必须保留“输入借用多久，输出最多借用多久”的通用关系。

捕获外部引用的闭包还会同时携带捕获值的生命周期。HRTB 只能约束调用参数与返回值的关系，不能让闭包捕获的数据凭空延长寿命：

```rust
fn call_now<F>(function: F)
where
    F: FnOnce(),
{
    function();
}

let text = String::from("captured");
call_now(|| println!("{text}"));
```

如果闭包要被线程、任务或长期容器保存，就必须让捕获方式和所有权满足对应边界；常见做法是 `move` 捕获拥有型值，而不是把局部借用伪装成 `'static`。

## 生命周期标注不能构造自引用关系

生命周期参数擅长描述对象之间已经存在的借用关系，但不能让一个普通可移动结构体安全地引用自身字段：

```rust
struct SelfReference<'a> {
    text: String,
    // view: &'a str, // 试图指向 text
}
```

结构体在移动后，`text` 的地址可能改变，而内部引用仍指向旧位置；初始化时也无法在值完成构造前安全地创建指向其自身的引用。给两个字段添加相同的 `'a` 只增加类型约束，并不会固定地址或改变初始化顺序。

常见替代方案包括保存索引或范围、使用共享所有权、把被引用数据放在结构体外部，或者重新设计为拥有型字段。真正需要地址稳定的自引用抽象时，还要结合 `Pin` 和严格的 unsafe 不变量；这属于后续安全抽象章节的范围。

## 常见生命周期错误的判断顺序

生命周期错误可以按关系而不是按语法拆解：

1. **返回值借用了谁**：输出引用是否有真实的外部所有者？
2. **签名是否表达了来源**：多个输入中，输出与哪一个或哪几个相关？
3. **借用是否被保存**：结构体、闭包或异步任务是否把引用带出了当前调用？
4. **要求的是引用还是类型约束**：`&'static T` 与 `T: 'static` 是否被混淆？
5. **子类型能否传播**：外层类型对相关生命周期是协变、逆变还是不变？
6. **谁选择生命周期**：需要某个具体 `'a`，还是需要 `for<'a>` 对任意生命周期成立？

增加生命周期标注只会补充关系，不会延长局部值、打破借用冲突或修复自引用结构。若数据确实需要跨越其原所有者，通常应改变所有权边界；若编译器无法证明两个访问不重叠，则应缩短借用或通过安全抽象表达证明。

## 生命周期系统维护的核心不变量

生命周期、子类型与型变共同维护以下不变量：

1. 每个引用的使用都发生在其目标保持有效的区域内；
2. 返回引用的来源关系由函数签名表达并对所有实现路径成立；
3. 较长生命周期只能在允许协变传播的位置缩短；
4. 可写位置不能通过协变接收不满足原类型约束的短期引用；
5. 高阶生命周期约束必须对调用点可能选择的所有生命周期成立。

生命周期省略、NLL 和重借用减少了显式标注，但没有削弱这些约束。它们让常见关系可以从上下文恢复，并让引用的有效区域贴近真实使用范围。

下一章[《Rust trait、泛型与关联类型：能力如何进入类型系统》](/collections/rust/traits-generics-associated-types)将分析泛型代码如何声明能力约束、关联类型如何表达类型之间的函数关系，以及一致性规则如何让实现选择保持唯一。

## 延伸阅读

- [The Rust Reference：Lifetime elision](https://doc.rust-lang.org/reference/lifetime-elision.html)
- [The Rust Reference：Subtyping and variance](https://doc.rust-lang.org/reference/subtyping.html)
- [The Rust Reference：Lifetime bounds](https://doc.rust-lang.org/reference/trait-bounds.html#lifetime-bounds)
- [The Rust Reference：Higher-ranked trait bounds](https://doc.rust-lang.org/reference/trait-bounds.html#higher-ranked-trait-bounds)
- [The Rustonomicon：Subtyping and Variance](https://doc.rust-lang.org/nomicon/subtyping.html)
- [The Rustonomicon：Higher-Rank Trait Bounds](https://doc.rust-lang.org/nomicon/hrtb.html)
- [Rust 语言圣经：认识生命周期](https://course.rs/basic/lifetime.html)
- [Rust 语言圣经：深入生命周期](https://course.rs/advance/lifetime/advance.html)
- [Rust 语言圣经：`&'static` 和 `T: 'static`](https://course.rs/advance/lifetime/static.html)
