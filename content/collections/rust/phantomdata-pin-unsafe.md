---
title: Rust PhantomData、Pin 与 unsafe 边界：如何封装编译器无法证明的不变量
date: 2026-09-04
excerpt: 从幽灵类型、型变与 drop check 出发，分析地址敏感状态、结构化固定、Future 的 Pin 契约，以及 unsafe 代码必须维护的有效性、别名、析构与并发不变量。
chapter: 类型系统
chapterOrder: 9
---

## 类型系统的边界不是安全性的边界

Rust 的安全保证由两部分共同建立：编译器能够直接验证的静态规则，以及底层实现通过 `unsafe` 承诺但由安全接口封装的不变量。

引用、生命周期、所有权和 trait 可以表达大量约束，但不能完整描述所有合法的系统编程结构。例如：

- 一个结构体只保存裸指针，却在逻辑上借用了某段数据；
- 一个容器通过裸指针拥有若干 `T`，但字段类型中看不出这种拥有关系；
- 一个值进入某种状态后，内部指针依赖它的地址不再变化；
- 一个 FFI 函数返回的整数只有部分比特模式有效；
- 一个无锁结构需要跨线程共享内存，但其同步协议无法由普通字段自动推导。

这些结构并不必然不安全。真正的问题是：哪些事实没有被普通类型直接表达，谁负责维护它们，以及安全调用者能否破坏它们。

本章讨论的三个工具分别处理不同层次：

| 工具 | 表达的事实 | 主要作用 |
|---|---|---|
| `PhantomData<T>` | 类型在逻辑上包含、借用或使用 `T` | 调整生命周期、型变、auto trait 与 drop check |
| `Pin<P>` | `P` 指向的值在固定期间不能被移动或提前失效 | 为地址敏感类型建立可组合契约 |
| `unsafe` | 某项局部操作的前置条件由程序员证明 | 实现安全 Rust 无法直接表达的底层机制 |

`PhantomData` 不会创造运行时关系，`Pin` 不会在内存中安装物理锁，`unsafe` 也不会关闭 Rust 的其他检查。它们共同做的是把编译器无法独立完成的证明，转化为明确、局部且可审计的契约。

## PhantomData 是零大小的静态声明

`PhantomData<T>` 是零大小类型。它不存储 `T`，但在静态分析中模拟一个与 `T` 相关的字段。

```rust
use std::marker::PhantomData;
use std::ptr::NonNull;

struct Iter<'a, T> {
    current: NonNull<T>,
    end: *const T,
    _borrow: PhantomData<&'a T>,
}
```

两个指针本身没有生命周期。若没有 `_borrow`，`Iter<'a, T>` 的字段无法说明迭代器产生的元素引用不能超过原切片，也无法表达它在逻辑上共享借用了 `T`。

`PhantomData<&'a T>` 同时向编译器声明：

1. 结构体受生命周期 `'a` 约束；
2. 结构体在逻辑上持有 `&'a T`；
3. 它对 `'a` 和 `T` 具有与共享引用相应的型变；
4. 它的 `Send`、`Sync` 等 auto trait 推导必须考虑 `T`；
5. 析构检查需要按这种逻辑关系判断悬垂是否合法。

零大小只说明它不增加实例大小，不代表它对类型系统没有作用。

## 裸指针不能完整表达逻辑关系

裸指针的重点是地址，而不是所有权或借用。

```rust
struct RawView<T> {
    ptr: *const T,
    len: usize,
}
```

仅看字段无法判断 `RawView<T>` 属于哪种语义：

- 它可能拥有一段 `T`，析构时负责释放；
- 它可能只借用外部切片；
- 它可能允许写入，也可能只允许读取；
- 它可能跨线程安全，也可能依赖线程局部状态；
- `T` 的生命周期可能必须覆盖 `RawView<T>`，也可能完全无关。

相同的运行时表示可以承载不同的静态契约。`PhantomData` 的参数应描述真实逻辑，而不是为了消除“未使用泛型参数”错误随意选择。

```rust
use std::marker::PhantomData;

struct Borrowed<'a, T> {
    ptr: *const T,
    _borrow: PhantomData<&'a T>,
}

struct Owned<T> {
    ptr: *mut T,
    _owns: PhantomData<T>,
}
```

前者模拟共享借用，后者模拟拥有 `T`。两者都不增加运行时字段，但它们对型变、auto trait 和析构有效性的影响不同。

## PhantomData 会继承所模拟类型的型变

第四章建立了型变模型：复合类型能否接受子类型替换，取决于类型参数出现的位置。`PhantomData` 使一个没有真实字段的位置也参与这项计算。

常见形式可以概括为：

| 标记 | 对 `T` 的型变 | 典型语义 |
|---|---|---|
| `PhantomData<T>` | 协变 | 逻辑上拥有 `T` |
| `PhantomData<&'a T>` | 对 `'a`、`T` 协变 | 在 `'a` 内共享借用 `T` |
| `PhantomData<&'a mut T>` | 对 `'a` 协变、对 `T` 不变 | 在 `'a` 内独占借用 `T` |
| `PhantomData<fn(T)>` | 逆变 | 只在参数位置消费 `T` |
| `PhantomData<fn() -> T>` | 协变 | 只在返回位置产生 `T` |
| `PhantomData<fn(T) -> T>` | 不变 | 同时消费和产生 `T` |
| `PhantomData<*const T>` | 协变 | 类似只读裸指针的类型关系 |
| `PhantomData<*mut T>` | 不变 | 类似可写裸指针的类型关系 |

例如，一个类型安全的作用域令牌通常不能允许两个不同作用域的品牌互相替换。可以让品牌参数同时出现在输入和输出位置，从而得到不变性：

```rust
use std::marker::PhantomData;

struct Brand<'id> {
    _invariant: PhantomData<fn(&'id ()) -> &'id ()>,
}
```

不变性会阻止编译器仅凭生命周期子类型关系缩短或扩展 `'id`。这对生成式生命周期、作用域句柄和类型状态令牌很重要，因为两个运行时表示完全相同的令牌，在语义上仍可能属于不同作用域。

## PhantomData 也参与 auto trait 推导

`Send`、`Sync`、`Unpin` 等 auto trait 通常根据字段递归推导。如果结构体只包含整数和地址，而真正关联的数据没有出现在字段中，自动推导就可能遗漏关键约束。

```rust
use std::marker::PhantomData;

struct ThreadBound<T> {
    handle: usize,
    _value: PhantomData<T>,
}
```

`PhantomData<T>` 使 `ThreadBound<T>` 的 auto trait 计算像真实包含 `T` 一样考虑 `T`。若 `T` 不是 `Send`，该包装类型也不会因为运行时只存一个 `usize` 就自动成为 `Send`。

但标记的选择必须与语义一致。以下两个类型虽然都没有实际存储函数指针，auto trait 行为却可能不同：

```rust
use std::marker::PhantomData;

struct Owns<T>(PhantomData<T>);
struct Produces<T>(PhantomData<fn() -> T>);
```

`Owns<T>` 模拟包含一个 `T`；`Produces<T>` 只把 `T` 放在函数返回位置。后者适合表达型变而不表达拥有关系，但不能用来掩盖真实拥有的 `T`。

### PhantomData 不能证明手写的 Send 与 Sync

`PhantomData` 只能影响自动推导，不能替代并发正确性的证明。

```rust
unsafe impl<T: Send> Send for SomeRawOwner<T> {}
unsafe impl<T: Sync> Sync for SomeRawOwner<T> {}
```

这类实现意味着：只要约束成立，跨线程转移或共享该类型不会产生数据竞争、悬垂指针或其他未定义行为。实现者必须检查所有可达状态、别名路径、析构路径和内部同步协议。添加一个标记字段并不会自动使上述结论成立。

## PhantomData 与 drop check

析构函数可能在值生命周期的最后阶段访问泛型参数携带的数据。drop check 必须保证析构期间相关引用仍然有效。

```rust
struct Inspector<'a>(&'a str);

impl Drop for Inspector<'_> {
    fn drop(&mut self) {
        println!("{}", self.0);
    }
}
```

`Inspector<'a>` 析构时读取 `&'a str`，因此被引用字符串必须活到析构完成。

对于使用裸指针实现的所有者，`PhantomData<T>` 可以表达“这个类型逻辑上拥有并可能析构 `T`”：

```rust
use std::marker::PhantomData;
use std::ptr::NonNull;

struct Buffer<T> {
    ptr: NonNull<T>,
    len: usize,
    capacity: usize,
    _owns: PhantomData<T>,
}
```

现代 Rust 中，泛型类型存在 `Drop` 实现时，drop check 已会保守地认为析构逻辑可能使用泛型参数。`PhantomData<T>` 仍然会影响型变和 auto trait；在没有显式 `Drop`、具有传递 drop glue 或使用标准库内部的 `#[may_dangle]` 等高级情形中，它也会继续影响析构分析。

`#[may_dangle]` 是标准库使用的不稳定、unsafe 优化入口。它允许析构实现承诺不访问可能已经悬垂的参数，但如果类型确实拥有并需要析构 `T`，这一承诺会受到传递 drop glue 的限制。普通库不应依赖它设计稳定接口。

## PhantomPinned 专门用于退出 Unpin

`PhantomData<T>` 不能用来选择性退出 `Unpin`。标准库提供了专门的零大小标记 `PhantomPinned`：

```rust
use std::marker::PhantomPinned;

struct AddressSensitive {
    data: String,
    pointer_into_data: *const str,
    _pin: PhantomPinned,
}
```

因为 `PhantomPinned` 不实现 `Unpin`，包含它的 `AddressSensitive` 默认也不实现 `Unpin`。这只关闭了安全 API 中“固定后仍可任意移动”的通道，并没有自动初始化内部指针，也没有使任意裸指针解引用变得安全。

## 移动与地址变化是两个相关但不同的概念

所有权语义中的 move 表示值的所有权从一个 place 转移到另一个 place。机器层面通常会把值的字节搬到新地址，但语言不保证一个普通值在两次借用之间地址稳定。

```rust
fn consume(value: String) -> String {
    value
}

let text = String::from("rust");
let text = consume(text);
```

`String` 的三字字段可能从调用者栈帧移动到被调函数，再移动到返回位置；它指向的堆缓冲区通常没有因此搬迁。若某个裸指针指向 `String` 自身字段，外层 `String` 的移动就可能使它悬垂；若指针指向独立堆缓冲区，则需要分析哪些操作会重新分配该缓冲区。

地址稳定性是针对特定 pointee 的契约，不能笼统地说“放在堆上的值不会移动”。

```rust
let boxed = Box::new(String::from("rust"));
let moved_out: String = *boxed;
```

`Box<T>` 的分配地址在盒子移动时通常保持不变，但安全代码仍可把 `T` 从 `Box<T>` 中移动出来。只有 `Pin<Box<T>>` 在 `T: !Unpin` 时限制这种操作。

## Pin 固定的是指针所指向的值

`Pin<P>` 包装的是指针 `P`，固定的是 `P::Target`，不是指针对象本身。

```rust
use std::pin::Pin;

fn poll_like(value: Pin<&mut AddressSensitive>) {
    // value 可以作为一个 Pin 句柄被传递；
    // 受契约约束的是它指向的 AddressSensitive。
}
```

`Pin<Box<T>>` 自身可以在变量之间移动，因为移动 `Box` 只移动指针值，不会搬迁堆上的 `T`。`Pin<&mut T>` 也可以重借用和传参，只要这些操作不允许安全代码取得能移出 `T` 的 `&mut T`。

固定契约包含两部分：

1. 从值被固定到析构开始，它不能被移动到其他地址；
2. 其存储不能在未执行适当析构的情况下提前失效或被复用。

第二条使 intrusive collection 等结构能够在 `Drop` 中解除指向自身的链接。仅保证“字节没搬家”还不够；若内存被提前释放，其他节点保存的地址仍会悬垂。

## Pin 是库契约，不是编译器魔法

构造 `Pin<P>` 不会改变机器内存，也不会让编译器追踪物理地址。它通过限制安全 API 建立契约。

对 `Pin<&mut T>`：

- 若 `T: Unpin`，可以安全取得 `&mut T`，因为移动 `T` 不破坏其语义；
- 若 `T: !Unpin`，安全代码不能取得可用于 `mem::replace`、`mem::take` 或解引用移出的 `&mut T`；
- unsafe 代码仍能通过 `get_unchecked_mut` 取得 `&mut T`，但必须保证后续操作不移动被固定部分。

```rust
use std::pin::Pin;

fn replace_unpin<T: Unpin>(mut value: Pin<&mut T>, replacement: T) -> T {
    std::mem::replace(value.as_mut().get_mut(), replacement)
}
```

该函数之所以安全，是因为 `T: Unpin` 明确表示 `T` 不依赖固定契约。

## Unpin 表示固定不会增加约束

`Unpin` 是 auto trait。绝大多数普通类型会自动实现它。

`T: Unpin` 不表示值当前没有被固定，也不表示 `Pin<T>` 不存在；它表示即使通过 `Pin<P>` 访问 `T`，移动 `T` 也不会破坏任何地址相关不变量。因此 `Pin<&mut T>` 对这类 `T` 基本退化为普通 `&mut T`。

`!Unpin` 也不表示值从创建开始就不可移动。更准确的生命周期是：

1. 创建 `!Unpin` 值；
2. 在固定前仍可移动它；
3. 通过正确的构造过程把它固定；
4. 从固定开始，所有能观察地址敏感状态的操作都必须遵守 Pin 契约；
5. 在同一地址执行析构，然后存储才可失效。

类型是否实现 `Unpin` 与值当前是否已经 pinned 是两个不同维度。

## 安全地建立固定

堆固定通常使用 `Box::pin`：

```rust
use std::marker::PhantomPinned;
use std::pin::Pin;

struct Node {
    value: String,
    _pin: PhantomPinned,
}

let node: Pin<Box<Node>> = Box::pin(Node {
    value: String::from("node"),
    _pin: PhantomPinned,
});
```

`Box::pin` 完成分配并直接返回固定指针，调用者没有机会在固定建立后通过未受约束的 `Box<Node>` 移出节点。

栈上固定可以使用标准库 `pin!` 宏：

```rust
use std::pin::pin;

let future = async { 42 };
let mut future = pin!(future);
```

返回的 `Pin<&mut T>` 受底层栈变量生命周期限制，不能逃逸到变量失效之后。手写 `Pin::new_unchecked(&mut value)` 时，调用者必须额外证明该引用有效期间不会通过其他别名移动、交换或覆盖 `value`，因此正确性比表面语法复杂。

## 自引用值必须分阶段初始化

包含指向自身字段的指针时，不能在普通构造函数中先取得地址再返回整个值：返回会移动值，使指针指向旧位置。

一种可控模式是先分配并固定，再初始化内部指针：

```rust
use std::marker::PhantomPinned;
use std::pin::Pin;
use std::ptr::NonNull;

struct SelfRef {
    text: String,
    text_ptr: Option<NonNull<str>>,
    _pin: PhantomPinned,
}

impl SelfRef {
    fn new(text: String) -> Pin<Box<Self>> {
        let mut value = Box::pin(Self {
            text,
            text_ptr: None,
            _pin: PhantomPinned,
        });

        let ptr = NonNull::from(value.text.as_str());

        // SAFETY: value 已由 Box::pin 固定；这里只修改非结构化固定字段，
        // 不会移动 text、SelfRef 或使现有地址失效。
        unsafe {
            value.as_mut().get_unchecked_mut().text_ptr = Some(ptr);
        }

        value
    }

    fn text(self: Pin<&Self>) -> &str {
        self.get_ref().text.as_str()
    }

    fn pointed_text(self: Pin<&Self>) -> &str {
        let ptr = self.get_ref().text_ptr.expect("initialized");

        // SAFETY: 指针在固定后由 text.as_str() 创建；SelfRef 的安全 API
        // 不会移动或替换 text，返回引用不超过 self 的借用期。
        unsafe { ptr.as_ref() }
    }
}
```

这个实现的 soundness 依赖一组完整不变量：

- `text_ptr` 只能在固定后初始化；
- 指针始终来自当前实例的 `text`；
- 固定后不能替换或移动 `text`；
- `text` 的内容可以改变时，还要保证不会因重新分配使指针失效；
- 所有派生引用的生命周期不能超过 `self` 的当前借用；
- 析构前不能让底层存储失效。

示例没有暴露修改 `text` 的安全方法，正是因为 `String::push` 可能重新分配缓冲区。Pin 只固定 `SelfRef` 本身和结构化固定字段的位置，不会自动固定 `String` 管理的外部分配。

## Future 为什么使用 Pin

`async fn` 会被编译成状态机。跨越 `.await` 保存的局部变量成为状态机字段，另一些状态可能在逻辑上引用这些字段。状态机被首次轮询后，就可能进入依赖自身地址的状态。

`Future::poll` 的签名是：

```rust
use std::future::Future;
use std::pin::Pin;
use std::task::{Context, Poll};

trait PollShape {
    type Output;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output>;
}
```

`Pin<&mut Self>` 允许执行器在不取得可随意移动 `Self` 的 `&mut Self` 的前提下推进状态机。这样，编译器生成的内部引用可以依赖状态机地址稳定。

固定一个 future 不会让每个 future 都产生堆分配：

- `pin!` 可以在栈上固定；
- `Box::pin` 在堆上固定并提供所有权；
- 多层 future 组合可以作为一个更大的状态机整体固定，不必每层各自分配；
- 对 `Unpin` future，普通可变引用已足够，因为移动不会破坏其状态。

`.await` 语法由编译器和执行器协议处理固定。手写组合器、流、执行器或保存异构 future 时，`Pin` 的边界才会直接出现在 API 中。

## Pin projection 决定哪些字段也被固定

拥有 `Pin<&mut Struct>` 后，把它投影为字段引用不是普通借用问题，而是 API 对字段固定语义的选择。

```rust
struct Task<F> {
    future: F,
    attempts: u32,
}
```

设计者可以规定：

- `future` 是结构化固定字段，父对象被固定后它也不能移动；
- `attempts` 不是固定字段，可以通过普通 `&mut u32` 修改或替换。

概念上的投影接口是：

```rust
struct TaskProjection<'a, F> {
    future: Pin<&'a mut F>,
    attempts: &'a mut u32,
}
```

手工实现通常需要 `Pin::map_unchecked_mut` 或 `get_unchecked_mut`。这段 unsafe 代码必须证明：

1. 返回的固定字段在父对象保持 pinned 时不会被移动；
2. 不会在 `Drop` 中把该字段移出；
3. 父类型的 `Unpin` 实现不会绕过字段的 `!Unpin`；
4. 投影引用的生命周期与别名规则正确；
5. 不固定字段的安全访问不会间接移动固定字段。

生产代码通常使用经过审计的 projection 宏生成这些实现，因为字段增加、`Drop` 实现和泛型约束变化都可能破坏手写证明。

## 固定字段会约束 Unpin 与 Drop

若 `Task<F>` 的 `future` 被定义为结构化固定字段，那么 `Task<F>` 只有在 `F: Unpin` 时才能安全实现 `Unpin`。无条件实现会允许安全代码移动一个仍依赖地址的 `F`。

```rust
// 只有当所有结构化固定字段都允许移动时才成立。
impl<F: Unpin> Unpin for Task<F> {}
```

普通 `Drop::drop(&mut self)` 获得 `&mut Self`，理论上能够通过 `mem::replace` 移出字段。对于依赖固定的不变量，实现者必须把析构体视为 pinned drop：不能移动结构化固定字段，并确保地址敏感资源在存储失效前正确解除关系。

即使没有显式 `Drop`，字段的自动析构顺序也属于证明的一部分。某字段的析构若会访问另一个字段，结构体声明顺序、手动 drop 和 panic 路径都可能影响有效性。

## unsafe 表示未被编译器验证的证明义务

`unsafe` 不是“允许出现 bug”的标记，而是静态验证责任的转移。

Rust 中常见的 unsafe 操作包括：

1. 解引用裸指针；
2. 调用 unsafe 函数或方法；
3. 访问或修改 `static mut`；
4. 实现 unsafe trait；
5. 读取 union 字段。

此外，FFI 的 `extern` 块、部分属性以及内联汇编也具有各自的 unsafe 契约。

进入 `unsafe {}` 后，借用检查、类型检查、生命周期检查和模式穷尽检查仍然存在。unsafe 只允许执行少数编译器无法证明安全的操作；它不允许创建违反语言有效性规则的值。

```rust
unsafe {
    // 这里仍不能把 String 当成 Vec<u32>，
    // 也不能同时以普通方式违反所有权规则。
}
```

真正新增的能力通常很小，但其前置条件可能跨越较大范围。

## unsafe fn 声明调用者的责任

unsafe 函数表示：存在编译器无法检查的前置条件，调用者必须在调用前证明它们。

```rust
/// # Safety
///
/// `ptr` 必须满足：
/// - 对读取 `len` 个连续 `T` 有效；
/// - 正确对齐且非空，即使 `len == 0`；
/// - 指向的元素在返回引用的生命周期内已初始化；
/// - 这段内存没有在同一期间被可变访问；
/// - 总字节长度不超过 `isize::MAX`。
unsafe fn slice_from_raw<'a, T>(ptr: *const T, len: usize) -> &'a [T] {
    // SAFETY: 由该函数的调用契约逐项保证。
    unsafe { std::slice::from_raw_parts(ptr, len) }
}
```

返回生命周期 `'a` 没有来自输入引用，它是由调用者选择的无界生命周期。函数签名无法证明底层存储真的活到 `'a`，所以所有有效性条件都必须写入 `# Safety` 契约。

在 Rust 2024 的规则下，`unsafe fn` 的函数体不会自动把所有 unsafe 操作视为已授权；具体操作仍应放进 `unsafe {}`，从而区分两层责任：

- 函数签名把哪些前置条件交给调用者；
- 函数体中的局部 unsafe 块如何利用这些条件证明某一步合法。

## unsafe block 声明实现者的责任

安全函数内部的 unsafe 块不能把责任转嫁给调用者。调用者只能依据安全签名使用函数，因此实现必须对所有能由安全代码构造的输入都保持 sound。

```rust
fn first<T>(slice: &[T]) -> Option<&T> {
    if slice.is_empty() {
        None
    } else {
        // SAFETY: 已检查长度至少为 1，slice.as_ptr() 正确对齐且指向已初始化元素。
        Some(unsafe { &*slice.as_ptr() })
    }
}
```

注释应描述可验证的不变量与它们的来源，而不是只写“这里是安全的”。有效说明需要回答：

1. unsafe 操作要求什么；
2. 哪段安全检查或上层契约建立了这些条件；
3. 条件在本次操作完成前为何不会失效；
4. 返回值是否把新的长期义务暴露给后续代码。

## unsafe trait 声明其他代码可以依赖的事实

unsafe trait 表示其实现正确性会被其他 unsafe 代码依赖。

`Send` 和 `Sync` 是典型例子：

- `T: Send` 表示把 `T` 的所有权转移到另一个线程不会造成未定义行为；
- `T: Sync` 表示通过共享引用跨线程访问 `T` 是安全的，等价地要求 `&T: Send`。

```rust
unsafe trait StableAddress {
    /// 实现必须保证进入稳定状态后，安全 API 不会移动该值。
}
```

声明 trait 为 unsafe，是因为错误实现可能使完全无关的 unsafe 使用者基于错误前提执行非法操作。相反，一个普通 trait 即使实现逻辑错误，通常也只能造成业务错误或 panic，而不能仅凭实现错误产生未定义行为。

`unsafe impl` 的审计范围不能只看实现块本身，还必须覆盖类型的全部安全方法、字段可见性、`Drop`、auto trait、内部可变性以及未来可添加的实现。

## 安全抽象必须对所有安全输入保持 sound

unsafe 代码可以出现在安全 API 内部，但安全 API 的使用者不能被要求维护未写入类型系统的隐藏前置条件。

错误的安全封装：

```rust
fn get_unchecked<T>(slice: &[T], index: usize) -> &T {
    unsafe { slice.get_unchecked(index) }
}
```

函数没有检查 `index`，却以安全签名暴露。调用者传入越界索引时没有违反任何显式契约，因此未定义行为属于实现错误。

正确边界可以选择检查：

```rust
fn get_checked<T>(slice: &[T], index: usize) -> Option<&T> {
    if index < slice.len() {
        // SAFETY: index 已证明小于 len。
        Some(unsafe { slice.get_unchecked(index) })
    } else {
        None
    }
}
```

也可以选择把责任写进 unsafe API：

```rust
/// # Safety
/// `index` 必须严格小于 `slice.len()`。
unsafe fn get_at<T>(slice: &[T], index: usize) -> &T {
    unsafe { slice.get_unchecked(index) }
}
```

两种设计都能成立，区别在于谁证明边界条件。不能用安全签名隐藏调用者实际上必须承担的义务。

## 有效值不等于任意比特模式

unsafe 代码经常直接操作内存，但 Rust 类型只允许特定有效值。

典型限制包括：

- `bool` 只能具有合法布尔表示；
- `char` 必须是有效 Unicode 标量值；
- 引用必须非空、正确对齐、指向有效且满足别名规则的值；
- 函数指针必须指向合法函数；
- 枚举判别值必须属于有效状态；
- `NonZeroUsize` 不能为零；
- `String` 必须维护有效 UTF-8、长度与容量关系以及合法分配；
- `Box<T>` 必须唯一拥有与其布局匹配的有效分配。

从任意字节 `transmute` 成这些类型，可能在值被读取前就已产生未定义行为。检查应在创建目标类型之前完成。

```rust
fn parse_bool(byte: u8) -> Option<bool> {
    match byte {
        0 => Some(false),
        1 => Some(true),
        _ => None,
    }
}
```

不要先制造非法 `bool` 再检查它，因为非法值本身不属于 Rust 抽象机允许的状态。

## MaybeUninit 表达尚未初始化的存储

内存已经分配不等于其中已经存在一个有效 `T`。`MaybeUninit<T>` 让“存储可用但值尚未构造”成为合法状态。

```rust
use std::mem::MaybeUninit;

let mut slot = MaybeUninit::<String>::uninit();
slot.write(String::from("ready"));

// SAFETY: 上一行已完整初始化 slot，且尚未取出或析构其中的 String。
let value = unsafe { slot.assume_init() };
```

证明义务包括：

- 每个被读取的元素都已初始化；
- 同一个值不会被 `assume_init_read` 或 `ptr::read` 取出两次；
- 已初始化元素在错误和 panic 路径上会被恰好析构一次；
- 未初始化存储不会被当作 `T` 的引用观察；
- 部分初始化数组的已初始化长度始终准确。

`mem::zeroed::<T>()` 只有在全零比特模式对 `T` 有效时才合法。`MaybeUninit::zeroed()` 本身可以创建零填充的未初始化容器，但 `assume_init` 仍需要单独证明结果对 `T` 有效。

## 裸指针操作仍受别名与来源约束

裸指针没有普通引用的自动借用检查，但不意味着可以任意读写。

解引用前至少需要证明：

1. 指针非空或相应 API 明确允许空；
2. 地址按 `T` 对齐；
3. 指向足够大的已分配存储；
4. 读取位置已经初始化为有效 `T`；
5. 指针运算没有越过允许的分配范围；
6. 访问期间满足共享/独占别名规则；
7. 存储没有释放、重分配或被其他所有者回收；
8. 访问类型与实际对象及其 provenance 兼容。

由 `&T` 转出的 `*const T` 不会因为成为裸指针就获得超越原引用的访问权。由 `&mut T` 转出的指针也不能被用来绕过仍然活跃的独占借用协议。

底层别名模型仍在演化，工程代码应优先使用标准库公开的指针 API，并用 Miri 检查可执行路径中的未定义行为，而不是依赖某次编译器优化尚未利用的偶然行为。

## UnsafeCell 是共享可变性的基础边界

普通 `&T` 承诺其可达数据在该共享借用期间不会被修改，除非可变部分位于 `UnsafeCell<U>` 内。

```rust
use std::cell::UnsafeCell;

struct CellLike<T> {
    value: UnsafeCell<T>,
}
```

`UnsafeCell` 只取消共享引用对其内部数据的不可变性假设，不会自动解决：

- 数据竞争；
- 多个 `&mut T` 同时存在；
- 值的生命周期与初始化；
- 跨线程同步；
- panic 或析构安全。

`Cell`、`RefCell`、`Mutex`、`RwLock` 和原子类型都在不同条件下围绕这一底层能力建立安全协议。自行封装时，借用状态、锁状态或原子内存顺序就是 unsafe 实现必须证明的新不变量。

## FFI 边界需要同时验证表示与协议

外部函数调用绕过 Rust ABI 和类型系统的部分保证。

```rust
unsafe extern "C" {
    fn read_packet(buffer: *mut u8, capacity: usize) -> isize;
}
```

包装为安全函数时需要验证至少四层：

1. **ABI 与布局**：调用约定、整数宽度、`#[repr(C)]`、对齐和结构体布局一致；
2. **内存**：缓冲区可写、容量正确，外部代码没有保存超期指针；
3. **返回值**：错误码、实际长度和判别值位于约定范围；
4. **并发与重入**：函数是否线程安全，回调是否可能重入或跨线程发生。

```rust
fn packet(capacity: usize) -> std::io::Result<Vec<u8>> {
    let mut bytes = Vec::<u8>::with_capacity(capacity);

    // SAFETY: bytes 提供 capacity 字节可写分配；FFI 契约保证只写入返回长度。
    let written = unsafe { read_packet(bytes.as_mut_ptr(), capacity) };

    if written < 0 {
        return Err(std::io::Error::last_os_error());
    }

    let written = usize::try_from(written).expect("non-negative");
    if written > capacity {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "foreign function returned an invalid length",
        ));
    }

    // SAFETY: 已验证 written <= capacity，FFI 契约保证前 written 字节已初始化。
    unsafe { bytes.set_len(written) };
    Ok(bytes)
}
```

若外部实现违反“写入的字节数不超过容量”或“返回范围内均已初始化”的约定，Rust 包装层无法自行恢复 soundness。这些外部假设必须成为接口文档、绑定测试和版本兼容策略的一部分。

## Panic safety 也是 unsafe 证明的一部分

safe Rust 中 panic 通常只中断控制流；unsafe 数据结构若在多个步骤之间暂时破坏内部不变量，panic 可能让临时状态泄漏到安全 API。

例如扩容容器可能依次执行：

1. 分配新缓冲区；
2. 把元素移动到新缓冲区；
3. 更新指针、长度和容量；
4. 释放旧缓冲区。

若元素移动或用户提供的回调在中途 panic，析构逻辑必须知道哪些元素位于新缓冲区、哪些仍在旧缓冲区，避免双重析构、读取未初始化内存或泄漏所有权。

常用策略包括：

- 先把公开状态更新为任意时刻都可析构的保守值；
- 使用 guard 在栈展开时恢复状态或完成清理；
- 让长度只统计已完整初始化的元素；
- 在调用可能 panic 的用户代码前结束临时独占访问；
- 区分内存泄漏与未定义行为：泄漏通常安全，双重释放或悬垂访问不是。

unsafe 块本身很短不代表证明范围很小。若它依赖跨多个步骤维护的状态，整个状态机都是审计边界。

## Unsafe 边界应围绕不变量组织

理想的安全抽象不是把每个裸指针操作机械包进一对花括号，而是让一个模块完整拥有某组不变量。

```text
安全调用者
    ↓ 只能构造合法输入
安全 API
    ↓ 检查并建立局部条件
unsafe 核心
    ↓ 依赖明确不变量
内存、FFI 或硬件操作
```

一个可审计模块通常具有以下结构：

- 裸字段私有，外部无法直接制造非法状态；
- 构造函数一次性建立初始不变量；
- 每个安全方法保持这些不变量；
- unsafe 函数准确列出调用者责任；
- 每个 unsafe 块说明本地证据；
- `Drop` 覆盖完整、部分初始化和 panic 路径；
- `Send`、`Sync`、`Unpin` 等实现与字段语义一致；
- 测试覆盖空值、零大小类型、边界容量、panic 与并发交错；
- Miri、sanitizer 和模糊测试用于发现动态路径问题，但不替代证明。

边界越窄越容易审计，但过度拆散也会让同一不变量跨越多个模块。真正的目标是让负责建立、使用和恢复某项不变量的代码尽量聚合。

## PhantomData、Pin 与 unsafe 如何组合

地址敏感泛型类型经常同时使用三者：

```rust
use std::marker::{PhantomData, PhantomPinned};

struct IntrusiveNode<'a, T> {
    value: T,
    previous: *mut Self,
    next: *mut Self,
    _membership: PhantomData<&'a mut Self>,
    _pin: PhantomPinned,
}
```

它们各自只承担一部分工作：

- `PhantomData<&'a mut Self>` 表达节点在 `'a` 内受某个独占成员关系约束，并影响型变与 auto trait；
- `PhantomPinned` 使节点退出自动 `Unpin`，防止固定后由安全代码移动；
- `Pin<&mut Self>` 或 `Pin<Box<Self>>` 向操作节点的接口传递地址稳定契约；
- unsafe 链接操作负责证明相邻裸指针有效、链接对称、别名合法；
- `Drop` 必须在节点存储失效前解除链接；
- 安全外壳必须阻止重复插入、跨列表混用和已移除节点继续被访问。

缺少其中任何一层都不能由其他层自动补齐。`PhantomData` 不固定地址；`Pin` 不验证链表指针；unsafe 块也不会自动影响型变和 auto trait。

## 从类型签名读取证明责任

面对底层 API，可以按以下顺序恢复其安全模型：

1. **谁拥有存储**：`Box<T>`、`Vec<T>`、分配器、外部库还是调用者？
2. **谁借用存储**：生命周期是否由真实引用约束，还是通过 `PhantomData` 模拟？
3. **哪些类型关系参与型变**：参数处于共享引用、可变引用、函数参数还是返回位置？
4. **哪些 auto trait 可被推导**：裸句柄背后的资源真的可以 `Send` 或 `Sync` 吗？
5. **值何时地址敏感**：创建后立即开始，还是某次初始化或 `poll` 后开始？
6. **固定的 pointee 是谁**：外层容器、某个字段，还是字段管理的独立分配？
7. **哪些字段结构化固定**：投影能返回 `Pin<&mut Field>`，还是普通 `&mut Field`？
8. **析构保证是什么**：地址敏感关系在何时解除，panic 时是否仍成立？
9. **unsafe 前置条件由谁证明**：调用者、构造函数、边界检查还是外部协议？
10. **安全代码能否制造反例**：若能，抽象就不 sound，即使正常测试全部通过。

这套顺序把“看见 unsafe 就逐行检查”转换成“先找不变量，再验证每个入口和退出路径”。

## 工程中的审计检查

设计或审查包含 unsafe 的类型时，可以逐项检查：

1. 是否能用安全标准库 API完成，而无需自行维护裸指针？
2. 每个 `PhantomData` 模拟的是拥有、共享借用、独占借用，还是仅调整型变？
3. 标记是否正确影响了 `Send`、`Sync`、`Unpin` 与 drop check？
4. 是否把 `PhantomPinned` 误当成已经完成固定？
5. 是否把 `Box<T>` 的稳定分配误当成 `T` 不能被移出？
6. `Pin<P>` 固定的确切 pointee 是什么？
7. 固定前和固定后的状态转换是否只有一条受控路径？
8. 结构化固定字段能否通过安全方法、`Drop` 或错误的 `Unpin` 实现被移动？
9. 内部指针指向自身字段还是字段管理的外部分配，哪些操作会重分配？
10. 每个 unsafe 函数是否完整记录有效性、对齐、初始化、别名和生命周期条件？
11. 每个 unsafe 块是否能指出这些条件的本地证据？
12. 是否在构造目标类型前验证所有比特模式与判别值？
13. 部分初始化、提前返回和 panic 时，所有值是否恰好析构一次？
14. FFI 是否验证返回长度、错误码、线程模型和回调生命周期？
15. 手写 `Send`、`Sync` 或其他 unsafe trait 实现是否覆盖所有内部状态？
16. Miri 与并发测试是否覆盖零长度、零大小类型、重分配和析构路径？

unsafe 代码的正确性不是“当前调用看起来没问题”，而是所有安全可达状态都不能违反语言不变量。

## 类型系统系列的完整模型

Rust 类型系统从普通值一直延伸到底层安全抽象，形成一条连续的证明链：

1. 基本类型与代数数据类型定义值域，避免无效业务状态；
2. 所有权、移动与析构确定资源只有一个清晰的释放责任；
3. 借用与重借用在不转移所有权时约束共享和独占访问；
4. 生命周期、子类型与型变描述引用关系如何跨越复合类型传播；
5. trait、泛型与关联类型把能力和类型之间的函数关系写入接口；
6. 类型推导与强制转换在保留语义的前提下求解局部类型约束；
7. 静态分发、动态分发与 dyn compatibility 决定类型信息何时保留或擦除；
8. GAT 与 HRTB 表达类型族和高阶量化，never type 表达不可完成路径；
9. `PhantomData` 补充没有运行时字段的逻辑关系，`Pin` 建立地址稳定契约，unsafe 在局部承担剩余证明。

安全 Rust 负责让无法满足的普通约束不能通过编译；unsafe Rust 负责实现编译器暂时无法表达、但可以由人严格证明的结构。安全抽象把后者重新封装为前者可使用的接口，使底层能力不会沿调用链无限扩散。

类型系统无法证明全部程序性质，但可以精确划定证明责任：类型签名声明关系，安全 API限制状态空间，unsafe 契约记录额外假设，封装边界保证普通调用者无法破坏这些假设。这是 Rust 在零成本抽象与内存安全之间建立工程可行性的核心机制。

## 延伸阅读

- [Rust 标准库：`PhantomData`](https://doc.rust-lang.org/std/marker/struct.PhantomData.html)
- [The Rustonomicon：PhantomData](https://doc.rust-lang.org/nomicon/phantom-data.html)
- [Rust 标准库：`std::pin`](https://doc.rust-lang.org/std/pin/index.html)
- [Rust 标准库：`Pin`](https://doc.rust-lang.org/std/pin/struct.Pin.html)
- [Rust 标准库：`PhantomPinned`](https://doc.rust-lang.org/std/marker/struct.PhantomPinned.html)
- [The Rust Reference：unsafe keyword](https://doc.rust-lang.org/reference/unsafe-keyword.html)
- [The Rust Reference：Behavior considered undefined](https://doc.rust-lang.org/reference/behavior-considered-undefined.html)
- [The Rustonomicon：What Unsafe Can Do](https://doc.rust-lang.org/nomicon/what-unsafe-does.html)
- [Rust 标准库：`MaybeUninit`](https://doc.rust-lang.org/std/mem/union.MaybeUninit.html)
- [Rust 标准库：`UnsafeCell`](https://doc.rust-lang.org/std/cell/struct.UnsafeCell.html)
- [Rust 语言圣经：Pin 和 Unpin](https://beatai.org/rust-course/advance/async/pin-unpin)
- [Rust 语言圣经：Unsafe Rust](https://beatai.org/rust-course/advance/unsafe/intro)
- [Rust 语言圣经：结构体自引用](https://beatai.org/rust-course/advance/circle-self-ref/self-referential)
