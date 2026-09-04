---
title: Rust 静态分发、动态分发与对象安全：调用目标何时确定
date: 2026-09-04
excerpt: 从调用目标的确定时机出发，分析泛型单态化、枚举分发、trait object、胖指针、虚表、对象生命周期、dyn compatibility 与 trait upcasting。
chapter: 类型系统
chapterOrder: 7
---

## 分发决定调用哪一份实现

trait 允许多个类型实现同一组能力。当泛型代码调用 trait 方法时，还需要确定本次调用最终进入哪个具体实现，这个选择过程称为分发。

```rust
trait Render {
    fn render(&self) -> String;
}

struct Text(String);
struct Number(i64);

impl Render for Text {
    fn render(&self) -> String {
        self.0.clone()
    }
}

impl Render for Number {
    fn render(&self) -> String {
        self.0.to_string()
    }
}
```

`Text::render` 与 `Number::render` 都满足 `Render` 契约，但它们是两份不同实现。调用代码必须通过以下某种信息选中其中一份：

- 编译期已知接收者的具体类型，执行静态分发；
- 运行时从 trait object 携带的元数据中读取函数指针，执行动态分发；
- 通过枚举的判别值进入对应分支，执行显式的闭集分发。

分发方式改变的不只是一次调用的机器指令，还会改变容器能否异构、API 是否允许下游扩展、返回类型是否暴露以及优化器能看到多少具体信息。

## 泛型使用静态分发

泛型函数以类型参数接收实现者：

```rust
fn render_twice<T: Render>(value: &T) -> String {
    format!("{} | {}", value.render(), value.render())
}

let text = Text(String::from("Rust"));
let number = Number(7);

assert_eq!(render_twice(&text), "Rust | Rust");
assert_eq!(render_twice(&number), "7 | 7");
```

调用 `render_twice::<Text>` 时，`T` 已确定为 `Text`；调用 `render_twice::<Number>` 时，`T` 已确定为 `Number`。编译器可以为实际使用的具体实例生成专门代码，并把 `value.render()` 解析到对应实现。

这个过程通常称为单态化：带类型参数的抽象代码在代码生成阶段形成面向具体类型的实例。它带来两个重要结果：

1. 调用目标通常能在编译期确定，不需要运行时查询虚表；
2. 优化器可以跨越泛型边界观察具体实现，从而内联、常量折叠或消除无用分支。

单态化是语义和代码生成模型，不应简单理解为“源码中每用一种类型，二进制里必然完整复制一个函数”。编译器可能内联全部代码，也可能合并机器码相同的实例；链接时优化还会继续改变最终形态。

## 参数位置的 `impl Trait` 仍是静态分发

参数位置的 `impl Trait` 表示匿名类型参数：

```rust
fn render_once(value: &impl Render) -> String {
    value.render()
}
```

它大致对应：

```rust
fn render_once<T: Render>(value: &T) -> String {
    value.render()
}
```

调用方仍为每次调用提供一个具体类型，函数仍可单态化。`impl Render` 不表示 trait object，也不会自动生成虚表调用。

显式类型参数在需要表达参数之间的同型关系时更清楚：

```rust
fn render_pair<T: Render>(left: &T, right: &T) -> String {
    format!("{} / {}", left.render(), right.render())
}
```

如果分别写两个 `&impl Render`，两个参数可以是不同具体类型。选择显式泛型还是参数位置 `impl Trait`，首先是 API 中类型关系的选择，不是分发机制的选择。

## 返回位置的 `impl Trait` 隐藏具体类型但不擦除它

返回位置的 `impl Trait` 让函数决定一个具体类型，只把 trait 能力暴露给调用方：

```rust
fn numbers() -> impl Iterator<Item = u32> {
    (0..10).filter(|value| value % 2 == 0)
}
```

迭代器链的具体类型依然存在，而且对这个函数的所有返回路径必须相同。调用者不能写出或依赖该类型的名字，但编译器知道它，所以仍能静态分发。

```rust
fn choose_iterator(reverse: bool) -> impl Iterator<Item = u32> {
    if reverse {
        // (0..4).rev() // 与另一个分支不是同一具体类型
        0..4
    } else {
        0..4
    }
}
```

`impl Trait` 的“隐藏”是 API 层面的不透明，不是运行时类型擦除。若不同分支必须返回不同具体类型，需要枚举封装或 trait object。

## 静态分发保留同质类型

`Vec<T>` 的所有元素都必须具有同一 `T`：

```rust
fn render_all<T: Render>(values: &[T]) -> Vec<String> {
    values.iter().map(Render::render).collect()
}

let values = [Text(String::from("A")), Text(String::from("B"))];
assert_eq!(render_all(&values), ["A", "B"]);
```

即使 `Text` 与 `Number` 都实现 `Render`，它们仍是不同类型，不能直接放入同一个 `Vec<T>`。trait bound 约束 `T` 的能力，但不会让所有满足约束的类型变成同一个类型。

这正是静态泛型的边界：类型选择在容器或函数实例化时完成，选择完成后，该实例内部的 `T` 保持一致。

## 枚举提供显式的闭集分发

当所有可能类型由当前 crate 掌握时，可以用枚举建立统一大小的类型：

```rust
enum Widget {
    Text(Text),
    Number(Number),
}

impl Render for Widget {
    fn render(&self) -> String {
        match self {
            Self::Text(value) => value.render(),
            Self::Number(value) => value.render(),
        }
    }
}

let widgets = vec![
    Widget::Text(Text(String::from("status"))),
    Widget::Number(Number(200)),
];
```

枚举的大小由最大变体及判别值决定，分发通常表现为对判别值的分支。编译器知道全部变体，因此能够检查匹配是否穷尽，也可能优化分支。

它适合封闭世界：

- 协议消息类型由当前程序完整定义；
- 状态机只允许有限状态；
- 性能关键路径希望避免间接调用；
- 每种变体还需要暴露不同的专属数据。

它不适合开放扩展：下游 crate 若要增加新类型，必须修改并重新发布定义枚举的 crate。trait object 则把“实现 trait”作为扩展入口，不要求中央枚举预先列出所有实现者。

## trait object 擦除具体类型

`dyn Render` 是 trait object 类型。它表示某个实现了 `Render` 的具体值，但类型系统不再公开这个具体类型是什么：

```rust
fn render_dyn(value: &dyn Render) -> String {
    value.render()
}

let text = Text(String::from("dynamic"));
let number = Number(42);

assert_eq!(render_dyn(&text), "dynamic");
assert_eq!(render_dyn(&number), "42");
```

从 `&Text` 到 `&dyn Render`、从 `&Number` 到 `&dyn Render` 的 unsized coercion 都生成统一的 trait object 引用类型。调用方可以在运行时把不同实现者交给同一个非泛型函数。

“类型擦除”只表示具体类型不再能通过这个接口直接使用。原值仍以原来的布局存在，析构时也必须执行原类型的析构逻辑；只是访问能力被限制为 trait object 暴露的基 trait、auto trait、supertrait 与生命周期边界。

## `dyn Trait` 是动态大小类型

具体实现者的大小可能完全不同：

```rust
struct Small(u8);
struct Large([u8; 1024]);
```

两者都可以实现同一个 trait，但一个 `dyn Trait` 值无法拥有统一的编译期大小。因此 trait object 是 dynamically sized type，不能作为普通按值局部变量或函数参数直接使用：

```rust
// fn consume(value: dyn Render) {}
```

它必须放在某种已知大小的指针之后，例如：

- `&dyn Render`：借用一个现有实现者；
- `&mut dyn Render`：独占借用并允许调用可变方法；
- `Box<dyn Render>`：拥有并在堆上存放实现者；
- `Rc<dyn Render>`：单线程共享所有权；
- `Arc<dyn Render>`：跨线程共享所有权所需的基础载体；
- `Pin<Box<dyn Render>>`：在额外固定地址契约下拥有对象。

指针本身大小已知，所以可以按值传递；它所指向的 `dyn Render` 仍是 DST。

## trait object 指针携带数据与行为元数据

指向 trait object 的指针在概念上包含两部分：

1. 数据指针，定位具体实现者的值；
2. 虚表元数据，定位该具体类型针对目标 trait 的可调用实现。

```text
&dyn Render
├── data pointer  -> Text / Number 的实例
└── vtable        -> 对应类型的 Render 实现
```

调用 `value.render()` 时，程序从虚表取得该槽位的函数指针，再把数据指针作为接收者传入。这就是运行时虚分发。

编译器还必须能够通过擦除后的指针正确处理布局和析构，因此实现使用的元数据不只服务于方法调用。不过虚表槽位顺序和完整内存布局不是稳定公共 ABI，安全代码不应依赖或手工解析它。

胖指针不等于堆分配。`&dyn Render` 可以只借用栈上的值，没有分配；`Box<dyn Render>` 的堆分配来自 `Box` 的所有权策略，而不是来自动态分发本身。

## 动态分发解决异构集合

所有 `Box<dyn Render>` 都具有相同的指针类型，因此可以放入同一容器：

```rust
let values: Vec<Box<dyn Render>> = vec![
    Box::new(Text(String::from("items"))),
    Box::new(Number(3)),
];

let rendered: Vec<_> = values
    .iter()
    .map(|value| value.render())
    .collect();

assert_eq!(rendered, ["items", "3"]);
```

容器保存的是一组同型的胖指针，指针背后的具体值可以异构。每个元素的虚表元数据分别指向其实现，循环执行到该元素时才确定调用目标。

典型用途包括：

- 插件和驱动注册表；
- UI 组件树；
- 中间件链；
- 异构任务队列；
- 需要隐藏实现类型的稳定边界。

如果集合中的类型集合固定且很小，枚举通常能提供更强的穷尽性；如果集合天然同质，泛型通常更直接。异构本身不是使用 trait object 的唯一理由，但它是最明确的信号之一。

## 动态分发的成本不只是一次间接调用

虚表调用通常多一次函数指针加载与间接跳转。更重要的是，调用点看不到确定实现时，内联、跨调用常量传播和部分去虚化会更困难。

静态分发也不是无成本：

- 不同具体类型可能产生更多代码实例；
- 编译和链接工作量可能增加；
- 更大的机器码可能增加指令缓存压力；
- 泛型会把更多实现细节传播到调用方编译单元。

因此不能把选择简化为“静态一定快、动态一定慢”。若方法内部执行网络、分配、解析或复杂计算，分发开销可能不可见；若循环中调用极短方法数十亿次，间接调用和无法内联可能显著。实际选择应先满足类型与扩展模型，再对真实工作负载基准测试。

## `dyn Trait` 的边界是一个完整类型

trait object 类型不仅包含一个基 trait，还可以包含 auto trait 和生命周期边界：

```rust
type LocalJob<'a> = dyn Fn() + 'a;
type SharedJob = dyn Fn() + Send + Sync + 'static;
```

一个 trait object 最多有一个非 auto 基 trait，但可以带多个 auto trait，例如 `Send`、`Sync`，以及一个生命周期边界。边界顺序不改变类型：

```rust
// dyn Render + Send + Sync
// dyn Sync + Render + Send
```

它们表达相同的 trait object 类型。

不能直接把两个无关的非 auto trait 并列作为基 trait：

```rust
use std::io::{Read, Write};

// type Stream = dyn Read + Write;
```

可以定义一个同时要求两者的本地 supertrait：

```rust
trait ReadWrite: Read + Write {}

impl<T: Read + Write + ?Sized> ReadWrite for T {}

type Stream = dyn ReadWrite;
```

`ReadWrite` 成为唯一基 trait，`Read` 与 `Write` 是它的 supertraits。

## auto trait 不会因具体实现者而自动保留

即使某个具体类型实现了 `Send`，擦除成 `dyn Render` 后，目标类型也没有承诺 `Send`：

```rust
fn enqueue(value: Box<dyn Render + Send>) {
    std::thread::spawn(move || {
        let _ = value.render();
    });
}
```

参数明确要求 `dyn Render + Send`，所以只有既实现 `Render` 又实现 `Send` 的具体类型能被转换并传入。

`Box<dyn Render>` 与 `Box<dyn Render + Send>` 是不同类型。擦除边界需要写出后续代码依赖的 auto trait；不能先擦除成较弱对象，再根据原类型碰巧是线程安全的事实恢复 `Send`。

`Arc` 只提供原子引用计数，不会自动让内部值线程安全。跨线程共享通常需要 `Arc<dyn Trait + Send + Sync>`，具体约束仍由实际访问方式决定。

## 对象生命周期限制被擦除值中的借用

trait object 可能包裹含有引用的具体类型，因此对象类型需要生命周期边界：

```rust
trait Label {
    fn label(&self) -> &str;
}

struct BorrowedLabel<'a>(&'a str);

impl Label for BorrowedLabel<'_> {
    fn label(&self) -> &str {
        self.0
    }
}

fn borrowed_label<'a>(text: &'a str) -> Box<dyn Label + 'a> {
    Box::new(BorrowedLabel(text))
}
```

`+ 'a` 表示被擦除的具体值内部携带的引用至少在 `'a` 内有效。它不是 `Box` 自身的借用；`Box` 拥有 `BorrowedLabel`，而 `BorrowedLabel` 借用了外部字符串。

省略的 trait object 生命周期使用专门的默认规则，而不是普通函数签名的三条省略规则。常见差异是：

```rust
type OwnedObject = Box<dyn Label>;
// 在这种类型别名位置，通常等价于 Box<dyn Label + 'static>

type BorrowedObject<'a> = &'a dyn Label;
// 等价于 &'a (dyn Label + 'a)
```

`Box<dyn Trait>` 的 `'static` 默认不表示这个 `Box` 必须存活到程序结束，只表示被装入的具体类型不能借用短期数据。需要保存借用对象时，应显式写 `Box<dyn Trait + 'a>`。

## 引用生命周期与对象生命周期是两层关系

下面的两个生命周期约束不同：

```rust
fn inspect<'borrow, 'object>(
    value: &'borrow (dyn Label + 'object),
) -> &'borrow str {
    value.label()
}
```

- `'borrow` 限制这次对 trait object 指针的借用；
- `'object` 限制被擦除具体值内部可能保存的引用。

通常编译器可以从包含类型推导合理边界，所以代码只写 `&dyn Label`。当 trait object 被嵌入结构体、跨层返回或出现多个候选生命周期时，显式区分两层关系可以避免把 `Box<dyn Trait>` 的默认 `'static` 误认为引用生命周期。

## dyn compatibility 决定能否构造虚表接口

过去常把这组规则称为 object safety，当前 Rust Reference 使用 dyn compatibility。一个 trait 只有满足 dyn compatibility，才能作为 `dyn Trait` 的基 trait。

核心问题是：具体类型已经被擦除后，是否仍能为每个可分发方法建立含义明确、数量有限的虚表槽位，并用 trait object 指针完成调用。

一个 dyn-compatible trait 必须满足：

1. 所有 supertrait 也 dyn-compatible；
2. trait 不能要求 `Self: Sized`；
3. 不能包含关联常量；
4. 不能包含带泛型参数的关联类型；
5. 每个关联函数要么能从 trait object 分发，要么用 `where Self: Sized` 明确排除在对象接口之外。

其中可分发方法还必须满足：

- 没有类型泛型参数，生命周期参数可以存在；
- 除接收者外，不把裸 `Self` 用作其他参数或返回类型；已经固定的 `Self::AssociatedType` 投影可以使用；
- 接收者属于支持的指针形式；
- 不返回 `impl Trait` 等不透明类型，也不是直接产生隐藏 Future 的 `async fn`；
- 没有 `where Self: Sized`。

这些是 trait 作为整体和每个方法共同形成的约束，而不只是“返回值不能写 `Self`”两条简单规则。

## `Self: Sized` 会使整个 trait 无法对象化

下面的 trait 只接受编译期已知大小的实现者：

```rust
trait Fixed: Sized {
    fn id(&self) -> u64;
}
```

`dyn Fixed` 本身是 DST，不满足 `Sized`，因此无法构造这个 trait object。

普通 trait 隐含 `Self: ?Sized`，所以不写 `: Sized` 时，trait object 作为擦除后的 `Self` 仍有可能满足契约。泛型类型参数默认 `T: Sized` 与 trait 的隐含 `Self` 规则不同，不能混用。

## 返回 `Self` 的方法不知道对象背后的类型

`Clone` 的核心方法返回 `Self`：

```rust
trait CloneLike {
    fn clone_like(&self) -> Self;
}
```

对具体的 `Text`，返回大小和类型都明确；对 `dyn CloneLike`，调用后应该在栈上产生 `Text`、`Number` 还是其他未知类型无法由擦除后的签名表达。

类似地，把 `Self` 用作普通参数也有问题：

```rust
trait Merge {
    fn merge(&self, other: Self);
}
```

两个 `&dyn Merge` 可能指向不同具体类型，trait object 类型相同并不能证明 `other` 与接收者背后的 concrete type 相同。

问题不在于虚表无法保存函数地址，而在于擦除后的调用端无法构造或接收签名所要求的未知 `Self` 值。

## 泛型方法无法对应一组有限虚表槽位

泛型方法允许每个调用点重新选择类型参数：

```rust
trait Encode {
    fn encode<T>(&self, value: T) -> Vec<u8>;
}
```

`encode::<u8>`、`encode::<String>` 和任意下游类型都可能需要不同的单态化实例。创建 trait object 时，编译器无法预先列出未来所有 `T`，因此不能为这个方法建立有限、完整的虚表接口。

生命周期泛型参数是例外：生命周期在代码生成时被擦除，不要求为每个生命周期生成独立机器码槽位。

需要动态分发时，可以把变化的类型也擦除、移动到 trait 的关联类型，或重新设计调用边界。选择方式取决于调用方是否真的需要为每次调用选择不同类型。

## 普通关联类型可以用于 trait object

trait 拥有关联类型不等于不能对象化，但构造 trait object 时通常必须指定关联类型：

```rust
fn drain(input: &mut dyn Iterator<Item = u8>) -> Vec<u8> {
    input.collect()
}

let mut bytes = vec![1_u8, 2, 3].into_iter();
assert_eq!(drain(&mut bytes), [1, 2, 3]);
```

`Item = u8` 固定了擦除接口中 `next` 的返回类型，因此虚表方法签名明确。

带泛型参数的关联类型会让对象接口再次依赖调用点选择的参数，当前 dyn compatibility 规则不允许它作为 trait object 基接口的一部分。GAT 的类型关系将在下一章展开。

## 关联常量没有接收者可用于选择虚表

关联常量通过类型或 trait 路径访问，没有 `self` 接收者：

```rust
trait Versioned {
    const VERSION: u32;
}
```

动态分发依赖 trait object 值携带的虚表元数据。没有接收者时，调用端没有对象可用来选择“哪个实现者的常量”，因此带关联常量的 trait 不 dyn-compatible。

若值确实应随对象的具体实现而变化，可以把它表达为方法：

```rust
trait VersionedDyn {
    fn version(&self) -> u32;
}
```

方法有接收者，可以占据虚表槽位并按对象动态选择实现。

## 不透明返回类型也需要具体实现信息

trait 方法中的返回位置 `impl Trait` 对每个实现形成匿名关联类型：

```rust
trait Source {
    fn values(&self) -> impl Iterator<Item = u8>;
}
```

不同 `Source` 实现可能选择不同隐藏迭代器类型。擦除 `Self` 后，调用端不知道返回值布局，因而该方法不能直接从 trait object 分发。

trait 中的 `async fn` 也产生与实现相关的隐藏 Future 类型，具有同样问题。需要动态异步接口时，常见做法是显式返回带生命周期和 auto trait 约束的 boxed Future：

```rust
use std::future::Future;
use std::pin::Pin;

trait AsyncTask {
    fn run(&self) -> Pin<Box<dyn Future<Output = ()> + Send + '_>>;
}
```

这里把不同 Future 的具体类型和大小再次擦除为统一的 boxed trait object。它会引入分配与动态分发，`Pin` 保证的地址不变契约将在最终 unsafe 边界章节展开。

## `where Self: Sized` 可以把方法排除出对象接口

trait 可以保留只供具体类型使用的方法，同时让其余方法支持动态分发：

```rust
trait RenderExt {
    fn render(&self) -> String;

    fn duplicate(&self) -> (Self, Self)
    where
        Self: Sized + Clone,
    {
        (self.clone(), self.clone())
    }
}
```

`duplicate` 返回 `Self`，但 `where Self: Sized` 明确它不能在 `dyn RenderExt` 上调用。该方法不需要进入对象虚表，因此不会破坏 trait 整体的 dyn compatibility。

```rust
fn render_erased(value: &dyn RenderExt) -> String {
    value.render()
    // value.duplicate() // trait object 上不可调用
}
```

这一规则适合把对象核心接口和具体类型便利方法放在同一 trait，但公共 API 中也可以拆成基础 dyn-compatible trait 与扩展 trait，使边界更清晰。

## 接收者必须能从对象指针恢复

可动态分发的方法需要受支持的接收者形式，例如：

- `&self`；
- `&mut self`；
- `self: Box<Self>`；
- `self: Rc<Self>`；
- `self: Arc<Self>`；
- 基于这些指针的部分 `Pin<P>` 形式。

```rust
trait Consume {
    fn inspect(&self);
    fn consume(self: Box<Self>) -> String;
}
```

`Box<dyn Consume>` 拥有对象，调用 `consume` 时可以把这个拥有型胖指针交给对应实现，并在实现中消费底层值。

任意嵌套接收者并不会自动可分发。关键是编译器是否有语言支持把当前 trait object 指针安全转换为方法所需的 concrete receiver。完整允许列表由 Reference 定义，API 不应仅凭“里面出现了 `Self` 指针”推测合法性。

## supertrait 方法属于对象可用接口

如果 `Circle: Shape`，`dyn Circle` 可以调用 `Circle` 与 `Shape` 的可分发方法：

```rust
trait Shape {
    fn area(&self) -> f64;
}

trait Circle: Shape {
    fn radius(&self) -> f64;
}

struct UnitCircle;

impl Shape for UnitCircle {
    fn area(&self) -> f64 {
        std::f64::consts::PI
    }
}

impl Circle for UnitCircle {
    fn radius(&self) -> f64 {
        1.0
    }
}

let circle: &dyn Circle = &UnitCircle;
assert_eq!(circle.radius(), 1.0);
assert_eq!(circle.area(), std::f64::consts::PI);
```

所有 supertrait 自身也必须 dyn-compatible，否则基础对象接口无法成立。

## trait upcasting 丢弃一部分动态接口

subtrait object 可以 unsized coercion 为其 supertrait object：

```rust
fn area_of(shape: &dyn Shape) -> f64 {
    shape.area()
}

let circle: &dyn Circle = &UnitCircle;
let shape: &dyn Shape = circle;

assert_eq!(area_of(shape), std::f64::consts::PI);
```

这个转换保留数据对象，调整目标 trait object 的虚表元数据，使接口从 `Circle` 缩小为 `Shape`。转换后不能再通过 `shape` 调用 `radius`，因为静态类型只承诺 `Shape`。

类似地，trait object 可以丢弃不再需要的 auto trait 边界，例如把 `&(dyn Render + Send)` 用作 `&dyn Render`。反向添加能力通常不成立；只有目标边界能由源 trait 的 supertrait 契约保证时，编译器才可能接受。

upcasting 不是具体类型 downcast。它只沿已声明的 supertrait 关系弱化接口，不恢复被擦除的实现者类型。

## `Any` 提供受限的运行时下转型

开放式 trait object API 有时需要恢复某个具体类型。标准库 `Any` 为 `'static` 类型提供运行时类型身份：

```rust
use std::any::Any;

trait Event: Any {
    fn as_any(&self) -> &dyn Any;
    fn name(&self) -> &'static str;
}

struct Connected {
    peer: String,
}

impl Event for Connected {
    fn as_any(&self) -> &dyn Any {
        self
    }

    fn name(&self) -> &'static str {
        "connected"
    }
}

fn peer(event: &dyn Event) -> Option<&str> {
    event
        .as_any()
        .downcast_ref::<Connected>()
        .map(|event| event.peer.as_str())
}
```

下转型可能失败，所以返回 `Option` 或 `Result`。`Any` 要求底层类型满足 `'static`，含短期借用的实现者不能直接使用这套身份机制。

频繁下转型通常表示 trait 抽象没有包含调用方真正需要的行为。若类型集合封闭，枚举及穷尽匹配更直接；若行为可以抽象，应优先把它加入合适的 trait 方法。`Any` 更适合边界适配、插件元数据或少量可选扩展。

## `Clone` 不能直接成为 trait object 基接口

`Clone::clone` 返回 `Self`，因此 `dyn Clone` 不成立。需要克隆 trait object 时，可以把返回类型擦除到拥有型对象：

```rust
trait TaskClone {
    fn clone_box(&self) -> Box<dyn Task>;
}

trait Task: TaskClone {
    fn run(&self) -> String;
}

impl<T> TaskClone for T
where
    T: Task + Clone + 'static,
{
    fn clone_box(&self) -> Box<dyn Task> {
        Box::new(self.clone())
    }
}

impl Clone for Box<dyn Task> {
    fn clone(&self) -> Self {
        self.clone_box()
    }
}
```

`clone_box` 的返回大小固定为 `Box<dyn Task>`，因此可以动态分发。具体类型的 `Clone` 发生在 blanket impl 内部，随后新值再次被擦除。

若对象还携带 `Send`、`Sync` 或非 `'static` 生命周期，克隆接口的返回类型必须保留相同边界，不能用一个过弱的 `Box<dyn Task>` 偷换契约。

## 默认方法仍按最终实现分发

dyn-compatible trait 可以有默认方法：

```rust
trait NamedRender {
    fn render(&self) -> String;

    fn describe(&self) -> String {
        format!("rendered={}", self.render())
    }
}
```

具体类型可以继承或覆盖 `describe`。通过 `dyn NamedRender` 调用时，虚表对应最终采用的实现；默认方法内部再调用 `self.render()`，仍会根据对象背后的具体类型分发。

默认实现不等于静态绑定到 trait 中的其他默认方法。它只是为每个实现者提供一份可采用的实现，最终 trait object 仍依赖构造时选定的 vtable。

## 泛型 API 与 trait object API 可以分层组合

静态与动态分发不是必须全局二选一。常见设计是在入口接受泛型，内部边界再按需要擦除：

```rust
struct Registry {
    renderers: Vec<Box<dyn Render + Send + Sync>>,
}

impl Registry {
    fn register<T>(&mut self, renderer: T)
    where
        T: Render + Send + Sync + 'static,
    {
        self.renderers.push(Box::new(renderer));
    }
}
```

调用者获得泛型入口的类型检查和易用性，注册表获得统一异构存储。类型擦除发生在明确的 `register` 边界，后续循环使用动态分发。

反方向也很常见：公共接口接收 `&dyn Trait` 以控制代码生成和 ABI 暴露，内部算法再对少量已知类型使用泛型辅助函数。关键是让擦除发生在真正需要开放集合或统一表示的位置。

## 返回不同实现时选择枚举或 trait object

返回位置 `impl Trait` 只能隐藏一个具体类型：

```rust
trait Operation {
    fn apply(&self, value: i32) -> i32;
}

struct Add(i32);
struct Multiply(i32);

impl Operation for Add {
    fn apply(&self, value: i32) -> i32 { value + self.0 }
}

impl Operation for Multiply {
    fn apply(&self, value: i32) -> i32 { value * self.0 }
}

fn operation(name: &str) -> Box<dyn Operation> {
    match name {
        "double" => Box::new(Multiply(2)),
        _ => Box::new(Add(1)),
    }
}
```

`Box<dyn Operation>` 允许每个分支选择不同具体类型，并把差异留到运行时。若候选集合固定，可以改用枚举，避免分配和虚调用并保留穷尽检查。

决策点不是“语法能否写通”，而是返回类型集合属于开放世界还是封闭世界，以及调用方是否需要知道各变体。

## 分发方式形成不同的 API 承诺

| 维度 | 泛型 / `impl Trait` | 枚举 | `dyn Trait` |
|---|---|---|---|
| 实现集合 | 开放，但每个实例同质 | 封闭 | 开放且可异构 |
| 调用目标 | 编译期 | 运行时判别值分支 | 运行时虚表 |
| 返回具体类型 | 编译器已知，可对调用方隐藏 | 枚举类型公开或封装 | 被擦除 |
| 容器布局 | `T` 固定 | 最大变体加判别值 | 指针固定，值在间接位置 |
| 下游新增实现 | 可直接实现 trait | 必须修改枚举 | 可直接实现 trait 并擦除 |
| 内联机会 | 通常最好 | 取决于分支优化 | 可能受间接调用限制 |
| 代码体积 | 可能随实例增加 | 通常集中 | 调用端通常集中 |
| 穷尽检查 | 不适用 | 支持 | 不支持具体实现集合穷尽 |

公开库选择泛型，会把实现类型和单态化传播给调用方；选择 trait object，会固定一组动态接口与 auto trait、生命周期边界；选择枚举，会把变体集合变成版本化 API 的一部分。

## 常见错误来自混淆“未知”与“擦除”

### 把 `impl Trait` 当成任意返回类型

返回位置 `impl Trait` 是一个由函数决定的隐藏具体类型，不是每次执行任意选择一个实现者。不同分支返回不同类型时，应显式统一表示。

### 把 `dyn Trait` 当成普通定长值

`dyn Trait` 是 DST，必须通过引用、`Box`、`Rc`、`Arc` 等指针使用。指针已知大小不意味着底层对象已知大小。

### 认为 `Box<dyn Trait>` 的额外成本只有堆分配

`Box` 带来分配和所有权间接层，`dyn Trait` 带来虚表分发与具体类型擦除。`&dyn Trait` 没有堆分配，仍然动态分发；`Box<T>` 有堆分配，仍然可以静态分发。

### 忘记写 `Send + Sync`

擦除后的 auto trait 是对象类型的一部分。具体值原本线程安全，不代表较弱的 `dyn Trait` 类型可以跨线程使用。

### 误解 `Box<dyn Trait>` 的 `'static`

默认 `'static` 限制被装入对象的借用，不要求 `Box` 永不析构。需要装入借用型实现者时，应让 API 暴露 `+ 'a`。

### 只用两条旧口诀判断对象安全

当前 dyn compatibility 还涉及 `Self: Sized`、关联常量、GAT、接收者形式、不透明返回类型、async 方法和 supertrait。应从“擦除后能否建立可调用虚表接口”判断，并以编译器诊断与 Reference 为准。

## 工程中的选择顺序

设计分发边界时，可以依次回答：

1. 同一次容器或算法实例中的元素是否天然同质？
2. 实现者集合由当前 crate 封闭掌握，还是允许下游扩展？
3. 调用方是否需要穷尽处理每个具体变体？
4. 返回位置只需隐藏一个具体类型，还是运行时会选择多种类型？
5. 类型擦除后，关联类型是否已经固定？
6. 对象是否需要所有权、共享所有权，还是只需短期借用？
7. 被擦除值能否包含非 `'static` 引用，对象生命周期应写在哪里？
8. 跨线程边界是否明确保留 `Send` 与 `Sync`？
9. trait 的每个方法能否在不知道 concrete `Self` 时形成明确调用签名？
10. 热点路径中的方法是否足够短，值得为间接调用和内联差异做基准测试？

优先让类型关系决定分发方式，再让测量决定局部性能优化。为了回避虚表而把开放集合硬编码成脆弱枚举，或为了减少泛型签名而过早擦除类型，都会损失比一次调用更重要的 API 信息。

## 本章建立的类型模型

静态分发、枚举分发与动态分发共同形成以下结构：

1. 泛型和参数位置 `impl Trait` 在调用点选择具体类型，通常通过单态化静态分发；
2. 返回位置 `impl Trait` 隐藏但不擦除一个具体类型；
3. 枚举把实现集合封闭为有限变体，通过判别值显式分发；
4. `dyn Trait` 擦除 concrete type，并通过数据指针与虚表元数据支持运行时分发；
5. trait object 是 DST，必须位于已知大小的指针之后；
6. auto trait、关联类型与对象生命周期共同构成完整的 trait object 类型；
7. dyn compatibility 保证擦除 `Self` 后仍能建立有限且含义明确的对象接口；
8. `where Self: Sized` 可以把不适合虚分发的方法排除在对象接口之外；
9. trait upcasting沿 supertrait 关系弱化动态接口，`Any` 下转型则是可能失败的具体类型恢复；
10. 分发方式同时决定扩展模型、存储布局、优化空间和公共 API 承诺。

下一章[《Rust GAT、HRTB 与 never type：类型关系如何跨越量化层级》](/collections/rust/gat-hrtb-never-type)将分析“类型构造器随生命周期变化”“对所有生命周期成立”和“不可返回路径”如何进入泛型约束。

## 延伸阅读

- [The Rust Reference：Trait object types](https://doc.rust-lang.org/reference/types/trait-object.html)
- [The Rust Reference：Dyn compatibility](https://doc.rust-lang.org/reference/items/traits.html#dyn-compatibility)
- [The Rust Reference：Impl trait type](https://doc.rust-lang.org/reference/types/impl-trait.html)
- [The Rust Reference：Unsized coercions and trait upcasting](https://doc.rust-lang.org/reference/type-coercions.html#unsized-coercions)
- [The Rust Reference：Default trait object lifetimes](https://doc.rust-lang.org/reference/lifetime-elision.html#default-trait-object-lifetimes)
- [Rust 语言圣经：特征对象](https://course.rs/basic/trait/trait-object.html)
- [Rust 语言圣经：Sized 和不定长类型](https://course.rs/advance/into-types/sized.html)
