---
title: Rust 所有权、移动与复制：值如何被转移和析构
date: 2026-08-31
excerpt: 从 place expression、move path 和 drop glue 出发，分析 Move、Copy、Clone、部分移动与确定性析构的精确语义。
chapter: 类型系统
chapterOrder: 2
---

## 所有权约束资源的唯一责任方

Rust 中，每个值都有一个负责其最终清理的所有者。所有权可以转移，也可以暂时借出；在没有转移的情况下，值离开作用域时由所有者负责析构。

```rust
fn consume(text: String) {
    println!("{text}");
}

fn main() {
    let text = String::from("ownership");
    consume(text);

    // println!("{text}"); // E0382：text 已被移动
}
```

`consume` 的参数类型是 `String`，因此调用表达式需要产生一个拥有所有权的 `String` 值。局部变量 `text` 的值被移动到函数参数；函数返回时，参数离开作用域并释放字符串拥有的堆内存。

这里不存在引用计数，也不存在运行时的“已移动”标记。移动后禁止再次使用原变量，是编译器的数据流分析结果。

## place expression 与 value expression

Rust Reference 区分两类表达式：

- **place expression** 表示一个内存位置，例如局部变量、解引用、数组索引和字段访问；
- **value expression** 产生一个值，例如字面量、算术结果和函数调用结果。

当 place expression 出现在需要值的上下文中时，编译器根据类型决定读取方式：

- 类型实现 `Copy`：复制该值；
- 类型没有实现 `Copy`：移动该值。

```rust
let a = String::from("a");
let b = a; // 从 place a 取值；String 非 Copy，因此发生移动

let x = 10_u32;
let y = x; // u32: Copy，因此发生复制

println!("{x} {y}");
```

赋值、函数实参、返回值、结构体字段初始化和模式绑定都可能形成这种“从位置取值”的上下文。`Move` 并不是 trait；它是没有实现 `Copy` 的值类型在这些上下文中的默认语义。

## 移动通常只复制值的表示

移动 `String` 不会复制字符串缓冲区。一个常见的 64 位实现中，`String` 自身占 24 字节，保存指向缓冲区的指针、长度和容量；具体字段顺序不属于稳定接口。

```rust
use std::mem::size_of;

fn main() {
    println!("String = {} bytes", size_of::<String>());
    println!("Vec<u8> = {} bytes", size_of::<Vec<u8>>());
}
```

语义上的移动通常可以由机器层面的若干次寄存器或内存复制实现。移动完成后，旧位置不再被视为已初始化，因此只有新所有者会执行析构。优化器还可能完全消除这些复制。

```rust
fn pass_through(value: String) -> String {
    value
}
```

源码中发生了调用者到参数、参数到返回值的所有权转移；最终机器码可能通过返回位置、寄存器传递或内联避免物理复制。Rust 保证所有权语义，不保证特定的栈布局、复制次数或返回值优化形式。

“移动很便宜”也不是普遍结论。移动大型数组或大型内联结构可能涉及大量字节；是否被优化取决于调用边界、ABI 与优化上下文。

```rust
struct InlineBuffer {
    bytes: [u8; 1024 * 1024],
}

fn consume_buffer(buffer: InlineBuffer) -> u8 {
    buffer.bytes[0]
}
```

类型是否拥有堆内存与移动成本没有直接对应关系：`String` 拥有堆内存，但自身表示很小；大型数组完全位于值内部，移动时反而可能更昂贵。

## `Copy`：允许隐式复制的标记 trait

`Copy` 表示一个值可以通过复制其位表示产生另一个独立有效的值。它没有方法，类型也不能自定义隐式复制过程。

```rust
#[derive(Debug, Clone, Copy)]
struct Point {
    x: f64,
    y: f64,
}

fn main() {
    let first = Point { x: 3.0, y: 4.0 };
    let second = first;

    println!("{first:?} {second:?}");
}
```

`first` 在赋值后仍然有效，因为 `Point: Copy`。实现 `Copy` 必须满足以下约束：

1. 类型同时实现 `Clone`；
2. 每个字段都实现 `Copy`；
3. 类型没有实现 `Drop`。

```rust
#[derive(Clone, Copy)]
struct Pair<T> {
    left: T,
    right: T,
}
```

派生实现要求 `T: Copy`。如果某个字段不是 `Copy`，整个结构也不能是 `Copy`：

```rust
// 无法派生 Copy：String 不实现 Copy
#[derive(Clone)]
struct Label {
    text: String,
}
```

常见的 `Copy` 类型包括：

- 整数、浮点数、`bool`、`char`；
- 裸指针、函数指针；
- 共享引用 `&T`；
- 元素为 `Copy` 的数组和元组；
- 仅由 `Copy` 字段组成且显式实现 `Copy` 的结构体或枚举。

独占引用 `&mut T` 不是 `Copy`。复制它会产生两个同时有效的独占访问入口，破坏别名约束。

```rust
fn duplicate<T: Copy>(value: T) -> (T, T) {
    (value, value)
}
```

泛型函数只有在 `T: Copy` 约束成立时，才能多次按值使用同一个参数。没有该约束时，第一次按值使用会移动 `value`。

### `Copy` 是 API 语义承诺

为公共类型实现 `Copy`，意味着调用方可以依赖隐式复制。后续如果类型需要拥有文件句柄、锁守卫或其他析构资源，就无法在保持 `Copy` 的同时直接加入该字段。

句柄编号本身可能只是一个整数，但资源所有者通常不能是 `Copy`：复制编号不会复制操作系统资源的所有权，反而可能导致重复关闭。

```rust
use std::fs::File;

struct OpenFile {
    file: File,
}
```

是否实现 `Copy` 应由值的语义决定，而不是仅由当前布局是否足够小决定。

## `Clone`：显式构造另一个值

`Clone` 提供可自定义的显式复制操作：

```rust
pub trait Clone: Sized {
    fn clone(&self) -> Self;

    fn clone_from(&mut self, source: &Self) {
        *self = source.clone();
    }
}
```

标准库中的实际 trait 还包含稳定性属性与文档约束；以上代码只保留方法形状。

```rust
let first = String::from("clone");
let second = first.clone();

assert_eq!(first, second);
```

这里会为 `second` 建立独立的字符串存储。`Clone` 的成本完全由实现决定：

- `u64::clone` 只复制一个整数；
- `String::clone` 通常分配并复制 UTF-8 字节；
- `Vec<T>::clone` 分配空间并逐个克隆元素；
- `Rc<T>::clone` 和 `Arc<T>::clone` 增加引用计数，不克隆内部的 `T`；
- 自定义实现可以执行任意满足安全契约的代码。

因此，`T: Clone` 只描述能力，不描述复杂度，也不表示深拷贝或浅拷贝。

### `clone_from` 可以复用已有存储

`clone_from` 把源值克隆到已经存在的目标中。容器可以覆盖默认实现以复用目标容量。

```rust
let source = String::from("a considerably longer string");
let mut target = String::with_capacity(128);

target.clone_from(&source);
assert_eq!(target, source);
assert!(target.capacity() >= source.len());
```

在循环内反复更新同一个缓冲区时，`clone_from` 可能减少分配；是否有效仍应通过实际分配统计或 benchmark 验证。

## 移动、复制与克隆的边界

| 操作 | 源值之后是否可用 | 是否调用用户代码 | 资源行为 |
|---|---:|---:|---|
| move | 否 | 否 | 所有权转移，不复制所拥有资源 |
| `Copy` | 是 | 否 | 隐式复制值的位表示 |
| `.clone()` | 是 | 是 | 由 `Clone` 实现决定 |
| `.clone_from()` | 是 | 是 | 更新已有目标，可能复用资源 |

以下三段代码虽然都产生第二个绑定，但语义不同：

```rust
let moved = String::from("move");
let new_owner = moved;

let copied = 42_u64;
let copied_again = copied;

let cloned = String::from("clone");
let independent = cloned.clone();
```

编译器不会根据值的大小自动选择 `Copy`，也不会在移动失败时自动插入 `.clone()`。隐式克隆会隐藏分配和资源成本，因此 Rust 要求显式调用。

## 部分移动与 move path

编译器不是只跟踪“整个变量是否已移动”，还会跟踪字段、解引用路径等可移动位置。内部通常把这种路径关系称为 move path。

```rust
struct User {
    name: String,
    age: u8,
}

fn main() {
    let user = User {
        name: String::from("Ferris"),
        age: 10,
    };

    let name = user.name; // 移动非 Copy 字段

    println!("{name}");
    println!("{}", user.age); // 仍可访问未移动字段
    // println!("{}", user.name); // E0382
    // consume(user);             // 整体已部分移动
}
```

`name` 被移动后，`user` 处于部分初始化状态。未移动的 `age` 仍可使用，但整个 `user` 不能再作为一个完整值使用。作用域结束时，编译器只析构仍然初始化的字段。

模式可以混合移动和借用：

```rust
struct Record {
    key: String,
    value: String,
}

let record = Record {
    key: String::from("language"),
    value: String::from("Rust"),
};

let Record { key, ref value } = record;

println!("{key} {value}");
// record.key 已移动，record.value 仍被借用
```

### 实现 `Drop` 的类型不能直接移出字段

如果结构体实现了 `Drop`，析构函数可能依赖所有字段保持完整，因此安全代码不能直接移出其中的非 `Copy` 字段。

```rust
struct Session {
    token: String,
}

impl Drop for Session {
    fn drop(&mut self) {
        println!("closing session for {}", self.token);
    }
}

fn take_token(session: Session) -> String {
    // session.token // E0509：不能移出实现 Drop 的类型
    session.token.clone()
}
```

需要转移字段时，可以把字段设计为 `Option<T>`，通过 `take` 留下有效的 `None`：

```rust
struct Session {
    token: Option<String>,
}

impl Session {
    fn take_token(&mut self) -> Option<String> {
        self.token.take()
    }
}
```

`Option::take` 等价于用 `None` 替换原值并返回旧值，结构体始终保持完整、可析构的状态。

## 重新赋值会析构旧值

向已经初始化的 place 赋入新值时，旧值会先失去该位置的所有权并被析构，新值成为该位置的内容。

```rust
let mut text = String::from("old");
text = String::from("new"); // old 的缓冲区在此处释放
println!("{text}");
```

遮蔽不是赋值。新的 `let` 创建另一个绑定，旧值通常仍按自身作用域的规则析构：

```rust
struct Trace(&'static str);

impl Drop for Trace {
    fn drop(&mut self) {
        println!("drop {}", self.0);
    }
}

fn main() {
    let value = Trace("first");
    let value = Trace("second");
    let _ = &value;
}
```

局部变量通常按声明的逆序析构，所以输出顺序是 `second`、`first`。遮蔽没有在第二个 `let` 处立即析构第一个值。

## `Drop` 与 drop glue

`Drop` 允许类型在值离开作用域时执行自定义清理：

```rust
struct Connection {
    id: u64,
}

impl Drop for Connection {
    fn drop(&mut self) {
        println!("close connection {}", self.id);
    }
}
```

编译器还会生成 **drop glue**，递归清理类型内部需要析构的字段。即使外层结构体没有实现 `Drop`，只要内部包含 `String`、`Vec<T>` 或其他需要析构的值，离开作用域时仍会运行相应清理逻辑。

```rust
use std::mem::needs_drop;

assert!(!needs_drop::<u64>());
assert!(needs_drop::<String>());
assert!(needs_drop::<Vec<String>>());
```

`needs_drop::<T>()` 表示类型是否需要运行析构逻辑，但不等价于“类型是否拥有堆内存”。一个自定义 `Drop` 类型即使只有整数，也会返回 `true`。

### 析构顺序

常见的析构顺序如下：

- 局部变量：声明的逆序；
- 结构体字段：声明顺序；
- 元组字段：索引顺序；
- 数组和切片元素：从第一个元素到最后一个元素。

```rust
struct Trace(&'static str);

impl Drop for Trace {
    fn drop(&mut self) {
        println!("{}", self.0);
    }
}

struct Pair {
    first: Trace,
    second: Trace,
}

let _pair = Pair {
    first: Trace("first field"),
    second: Trace("second field"),
};
```

`Pair` 的字段按 `first`、`second` 顺序析构。依赖字段析构顺序通常会使类型难以维护；资源之间有明确依赖时，更稳妥的做法是用显式方法表达关闭顺序。

### `drop(value)` 只是按值消费

标准库的 `drop` 函数可以近似写成：

```rust
pub fn drop<T>(_value: T) {}
```

调用 `drop(value)` 把所有权移动进函数参数。函数结束时参数离开作用域，编译器插入对应的 drop glue。

```rust
use std::sync::Mutex;

let lock = Mutex::new(vec![1, 2, 3]);
let guard = lock.lock().unwrap();

drop(guard); // 提前释放锁

let mut guard = lock.lock().unwrap();
guard.push(4);
```

不能直接调用 `value.drop()`；Rust 禁止显式调用 `Drop::drop`，以避免随后自动析构造成重复清理。

### panic 与析构

采用 unwind 策略时，panic 展开栈并析构已经初始化的局部值。采用 `panic = "abort"`、调用 `std::process::abort` 或直接终止进程时，不保证运行析构函数。

因此，`Drop` 适合内存、锁、文件描述符等进程内资源的正常清理，但不能替代需要抵抗断电、崩溃或强制终止的持久化协议。文件一致性仍需要临时文件、`fsync`、原子重命名或事务机制。

## `Copy` 与 `Drop` 必须互斥

`Copy` 允许一个值在没有显式调用的情况下产生多个副本，`Drop` 则为一个值绑定清理责任。两者同时存在会使清理次数无法与资源所有权对应，因此编译器禁止实现组合。

```rust
// 编译错误：Copy 类型不能实现 Drop
#[derive(Clone, Copy)]
struct Resource(u64);

impl Drop for Resource {
    fn drop(&mut self) {}
}
```

这种互斥也是 `String`、`Vec<T>`、`Box<T>` 和文件句柄不能实现 `Copy` 的根本原因：它们的位表示包含资源定位信息，逐位复制会制造多个自认为拥有同一资源的值。

## 忘记析构与手动析构

`std::mem::forget` 消费一个值但不运行其析构函数：

```rust
let text = String::from("leaked");
std::mem::forget(text);
```

调用是安全的，但会泄漏字符串缓冲区。Rust 从不保证析构函数一定执行，因此 unsafe 抽象不能把“调用方必然运行析构”作为内存安全前提。

`ManuallyDrop<T>` 用于需要精确控制析构的底层实现：

```rust
use std::mem::ManuallyDrop;

let mut value = ManuallyDrop::new(String::from("manual"));

unsafe {
    ManuallyDrop::drop(&mut value);
}
```

手动析构后再次访问或再次析构同一值可能造成未定义行为。普通业务代码几乎不需要 `ManuallyDrop`；它主要用于 union、FFI、容器实现和其他需要自行维护初始化状态的不安全抽象。

## 所有权操作的工程选择

| 需求 | 合适的操作 | 语义 |
|---|---|---|
| 调用方不再需要值 | 按值传递 `T` | 转移所有权 |
| 只读取，不取得所有权 | 共享借用 `&T` | 避免移动和复制 |
| 原地修改，不取得所有权 | 独占借用 `&mut T` | 临时独占访问 |
| 小型、无析构的值需要自然复用 | 实现 `Copy` | 隐式位复制 |
| 需要独立副本 | 调用 `.clone()` | 显式复制，成本可见 |
| 需要共享同一对象 | `Rc<T>` / `Arc<T>` | 引用计数共享所有权 |
| 需要取出字段并留下合法状态 | `Option::take` / `mem::replace` | 以替代值换出旧值 |

按值接收 `T` 不等于性能差；它表达函数取得资源责任。借用也不总是更优：长期借用会扩大生命周期约束，可能阻碍移动、并发或状态转换。接口应先表达正确的所有权关系，再用 profiler、分配统计与 benchmark 判断是否需要减少克隆或调整数据布局。

## 编译器维护的核心不变量

所有权、移动与析构共同维护三条关键不变量：

1. 每个需要清理的已初始化值都有明确的所有者；
2. 移动后的路径不能作为已初始化值再次使用；
3. 每个仍然初始化的值在正常控制流上至多析构一次。

`Copy` 明确放宽第二条：读取源位置不会使其失效。`Clone` 不改变所有权规则，它通过普通方法调用构造另一个独立值。部分移动、条件初始化和提前返回会让控制流更复杂，但编译器仍通过移动分析和 drop flags 确定哪些路径需要析构。

下一章将分析共享借用、独占借用、重借用与非词法生命周期，解释所有权暂时不转移时，编译器如何约束别名和可变性。

## 延伸阅读

- [The Rust Reference：Expressions](https://doc.rust-lang.org/reference/expressions.html)
- [The Rust Reference：Destructors](https://doc.rust-lang.org/reference/destructors.html)
- [The Rust Programming Language：What Is Ownership?](https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html)
- [The Rust Programming Language：Appendix C — Derivable Traits](https://doc.rust-lang.org/book/appendix-03-derivable-traits.html)
- [std::marker::Copy](https://doc.rust-lang.org/std/marker/trait.Copy.html)
- [std::clone::Clone](https://doc.rust-lang.org/std/clone/trait.Clone.html)
- [std::ops::Drop](https://doc.rust-lang.org/std/ops/trait.Drop.html)
