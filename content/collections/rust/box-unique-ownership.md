---
title: Rust Box 与唯一所有权分配：堆对象如何被创建、移动和释放
date: 2026-09-07
excerpt: 从 Box 的所有权与布局出发，分析堆分配、Deref、析构、递归类型、DST、裸指针往返、延迟初始化、主动泄漏、FFI 所有权和性能边界。
chapter: 内存与资源
chapterOrder: 11
---

## Box 把唯一所有权绑定到一块分配

`Box<T>` 是 Rust 最基础的拥有型智能指针。它通常完成三件事：

1. 为 `T` 请求满足大小和对齐的动态存储；
2. 在这块存储中放置一个合法的 `T`；
3. 以唯一所有者身份管理 `T` 的析构和存储释放。

```rust
let value = Box::new(String::from("owned allocation"));
```

这里存在两层值：

- `Box<String>` 句柄本身是编译期大小固定的拥有型指针；
- pointee `String` 位于 Box 管理的分配中，`String` 又管理自己的 UTF-8 缓冲区。

因此这段代码通常包含两次动态分配：一次用于存放 `String` 句柄，另一次由 `String` 为文本字节申请。`Box<T>` 只负责它直接拥有的 `T` 分配；`T` 内部继续拥有的资源由 `T::drop` 递归清理。

## 唯一所有权不等于始终只有一个引用

`Box<T>` 保证同一分配只有一个拥有者，不禁止对 pointee 创建借用：

```rust
let mut number = Box::new(40_i32);

let shared: &i32 = &number;
assert_eq!(*shared, 40);

*number += 2;
assert_eq!(*number, 42);
```

共享引用结束后，可以再次通过 Box 获得独占访问。借用规则仍然控制同一时刻的别名：

- 可以同时存在多个 `&T`；
- 存在 `&mut T` 时不能再使用其他引用访问同一值；
- Box 被移动、析构或移出 pointee 时，相关借用必须已经结束。

“唯一”描述释放责任和所有者数量；“独占借用”描述某段时间内的访问权限。二者相关但不相同。

## Box::new 在语义上把值移动进分配

```rust
let text = String::from("rust");
let boxed = Box::new(text);

// text 的所有权已经转移，不能继续使用。
assert_eq!(boxed.len(), 4);
```

`Box::new(text)` 消费 `text`。若 `T` 不是 `Copy`，原绑定失效；堆分配中的位置成为新的拥有位置。

这个 move 不等于调用 `clone`：

- `String` 自己管理的字节缓冲区不会因为 move 被复制；
- `String` 句柄的字段被转移到 Box 的 pointee 位置；
- 最终只有 Box 内的 `String` 负责释放文本缓冲区。

机器层面是否真的先在栈上形成完整临时值再复制到堆中属于优化结果，不是 `Box::new` 的稳定保证。对于极大值和调试构建，不能假设编译器一定消除中间栈空间。

## 移动 Box 通常只移动拥有型指针

```rust
fn forward<T>(value: Box<T>) -> Box<T> {
    value
}

let first = Box::new([0_u8; 4096]);
let second = forward(first);
```

`first` 到 `second` 的所有权转移移动的是 Box 句柄，pointee 的 4096 字节仍位于原分配。

这产生两个重要性质：

- 大对象的所有权可以用固定大小句柄传递；
- 指向堆分配的地址通常不因 Box 句柄移动而变化。

但“分配地址没变”不等于“pointee 永远不能被移出”。普通 `Box<T>` 允许：

```rust
let boxed = Box::new(String::from("movable"));
let text: String = *boxed;
```

这里 `String` 被移出分配，Box 的存储随后被释放。只有 `Pin<Box<T>>` 在 `T: !Unpin` 时建立不能移出 pointee 的额外契约。

## Box<T> 的布局取决于 T 是否 Sized

当 `T: Sized` 时，标准库保证 `Box<T>` 表示为单个指针。Box 本身的大小不随 `T` 增长：

```rust
use std::mem::size_of;

assert_eq!(size_of::<Box<u8>>(), size_of::<*mut u8>());
assert_eq!(size_of::<Box<[u8; 4096]>>(), size_of::<*mut u8>());
```

对于 DST，Box 还需要保留 pointee 元数据：

```rust
let bytes: Box<[u8]> = vec![1, 2, 3].into_boxed_slice();
let text: Box<str> = String::from("rust").into_boxed_str();
let display: Box<dyn std::fmt::Display> = Box::new(42_i32);
```

概念上：

- `Box<[T]>` 保存数据地址和元素数量；
- `Box<str>` 保存数据地址和字节长度；
- `Box<dyn Trait>` 保存数据地址和动态分发元数据。

Box 句柄仍然是 Sized，因此可以作为局部变量、字段或集合元素；它管理的 pointee 可以是 `?Sized`。

## Box 不会为零大小类型申请实际存储

```rust
struct Marker;

let marker = Box::new(Marker);
```

`Marker` 大小为零，`Box::new` 不需要向全局分配器申请数据字节。Box 仍必须携带一个非空、满足对齐要求的指针表示，且仍拥有一个需要按 Rust 语义析构的值。

```rust
struct Guard;

impl Drop for Guard {
    fn drop(&mut self) {
        println!("drop guard");
    }
}

let guard = Box::new(Guard);
drop(guard);
```

即使没有真实分配，`Guard::drop` 仍会运行。资源所有权与占用字节数是两个维度。

手工为 ZST 构造 Box 时，裸指针依然必须非空并满足类型对齐；标准库推荐从正确对齐的 `NonNull::dangling()` 建立表示，而不是使用空指针。

## 解引用把智能指针接入普通引用体系

`Box<T>` 实现 `Deref<Target = T>` 和 `DerefMut`，因此可以像引用一样访问 pointee：

```rust
let mut text = Box::new(String::from("rust"));

text.push_str(" box");
assert_eq!(text.as_str(), "rust box");
```

方法调用会执行自动借用和 deref adjustment。概念上，`text.push_str(...)` 需要从 `Box<String>` 获得 `&mut String`，再调用 `String` 方法。

函数参数中的 deref coercion 也能连续发生：

```rust
fn print_text(value: &str) {
    println!("{value}");
}

let text = Box::new(String::from("coercion"));
print_text(&text);
```

转换链为：

```text
&Box<String> -> &String -> &str
```

这些转换只创建借用，不转移 Box 的所有权，也不复制字符串内容。

## `*box` 的结果取决于表达式上下文

解引用表达式可以被借用、读取或移出：

```rust
let boxed = Box::new(String::from("value"));

let borrowed: &String = &*boxed;
assert_eq!(borrowed, "value");
```

这里 `&*boxed` 只借用 pointee。

```rust
let boxed = Box::new(String::from("value"));
let moved: String = *boxed;
```

这里目标位置需要一个拥有型 `String`，因此 pointee 被移出。之后不能再使用 Box，因为它已经在解引用移动中被消费。

对于 `Copy` 类型：

```rust
let boxed = Box::new(42_u32);
let copied = *boxed;

assert_eq!(copied, 42);
assert_eq!(*boxed, 42);
```

读取执行 Copy，Box 仍然有效。`*` 本身不固定表示“移动”或“复制”，具体语义由目标类型和使用上下文决定。

## Drop glue 先清理值，再归还存储

Box 离开作用域时，析构过程逻辑上包含：

1. 对 pointee 执行 drop glue；
2. pointee 内部字段和资源按规则析构；
3. 使用与原分配兼容的 allocator 和 Layout 释放 Box 存储。

```rust
struct Connection {
    name: String,
}

impl Drop for Connection {
    fn drop(&mut self) {
        println!("close {}", self.name);
    }
}

{
    let _connection = Box::new(Connection {
        name: String::from("primary"),
    });
}
```

离开代码块时，`Connection::drop` 先运行，随后 `name` 字段被析构，最后 Box 分配被释放。

类型没有显式 `Drop` 实现，也不表示没有析构工作。编译器会生成 drop glue，递归处理需要析构的字段。

## 提前释放应调用 std::mem::drop

不能直接调用 `Drop::drop`：它只接收 `&mut self`，直接调用后原值仍然存在，作用域结束又会再次析构。

提前结束所有权应消费整个值：

```rust
let buffer = Box::new(vec![0_u8; 1024]);

drop(buffer);

// buffer 已经被移动给 drop，不能继续使用。
```

`std::mem::drop` 的实现可以是空函数体；关键在于参数按值接收，调用点把所有权移动进去，参数离开函数时触发正常 drop glue。

提前 drop 的常见用途不是手工内存管理，而是缩短资源持有时间，例如提前释放锁 guard、文件句柄、大缓冲区或独占借用。

## Box 解决递归布局，而不是递归语义

直接内联递归无法得到有限大小：

```rust
// enum List<T> {
//     Node(T, List<T>),
//     Empty,
// }
```

插入 Box 后，每个节点只内联一个固定大小指针：

```rust
enum List<T> {
    Node(T, Box<List<T>>),
    Empty,
}
```

这解决的是编译期布局方程：

```text
size(List<T>) = tag + max(size(T) + size(Box<List<T>>), 0) + padding
```

Box 不会自动提供：

- 共享所有权；
- 父节点指针；
- 环检测；
- O(1) 随机访问；
- 缓存连续性；
- 非递归析构。

它只提供拥有型间接层。数据结构的算法性质仍由整体设计决定。

## 深递归 Box 结构可能在析构时耗尽栈

默认 drop glue 会递归析构链表：当前节点析构其 `Box<List<T>>`，后者再析构下一个节点。

非常深的链可能造成栈溢出。可以通过显式循环逐个拆开所有权：

```rust
struct List<T> {
    head: Link<T>,
}

type Link<T> = Option<Box<Node<T>>>;

struct Node<T> {
    value: T,
    next: Link<T>,
}

impl<T> Drop for List<T> {
    fn drop(&mut self) {
        let mut current = self.head.take();

        while let Some(mut boxed_node) = current {
            current = boxed_node.next.take();
            // boxed_node 在本轮结束时析构，但 next 已被取走，
            // 因而不会沿整条链递归。
        }
    }
}
```

`Option::take` 用 `None` 替换字段并返回旧所有权。每轮只保留当前节点的析构深度，把递归释放转换为迭代释放。

若 `T::drop` 自身 panic，还需分析栈展开时剩余链表由谁持有。安全 Rust 会防止 double free，但资源释放是否完整仍取决于所有权暂存方式与 panic 策略。

## Box 可以把 Sized 类型弱化为 DST

数组 Box 可以 unsize 为切片 Box：

```rust
let array: Box<[u32; 4]> = Box::new([10, 20, 30, 40]);
let slice: Box<[u32]> = array;

assert_eq!(slice.len(), 4);
```

转换改变 Box 指针携带的类型和元数据，不移动底层数组，也不重新分配元素。

具体类型也能转换为 trait object：

```rust
trait Command {
    fn execute(&self) -> String;
}

struct Ping;

impl Command for Ping {
    fn execute(&self) -> String {
        String::from("pong")
    }
}

let command: Box<dyn Command> = Box::new(Ping);
assert_eq!(command.execute(), "pong");
```

`Box<dyn Command>` 拥有被擦除的具体值，drop 时通过动态元数据执行正确析构，再释放具有正确 Layout 的分配。

## Box<[T]> 表达固定长度的拥有型连续数据

`Vec<T>` 同时管理指针、长度和容量，允许增长。若数据构造完成后不再需要额外容量，可以转换为 boxed slice：

```rust
let mut values = Vec::with_capacity(128);
values.extend([1_u32, 2, 3, 4]);

let values: Box<[u32]> = values.into_boxed_slice();
assert_eq!(&*values, &[1, 2, 3, 4]);
```

`Box<[T]>` 的长度位于指针元数据中，没有公开 capacity 概念。它表达：

- 唯一拥有一段连续元素；
- 元素数量固定；
- 可以通过切片 API访问；
- 整段所有权可以低成本移动。

转换是否复用原 Vec 分配属于具体实现与容量状态；API语义只保证元素和值的所有权正确转移。

类似地，`Box<str>` 唯一拥有一段有效 UTF-8 字节，但不提供 `String` 的增长能力。

## Box<dyn Any> 可以安全恢复具体所有权

`Any` 为 `'static` 类型提供运行时类型身份：

```rust
use std::any::Any;

fn recover(value: Box<dyn Any>) -> Result<Box<String>, Box<dyn Any>> {
    value.downcast::<String>()
}

let value: Box<dyn Any> = Box::new(String::from("typed"));
let text = match recover(value) {
    Ok(text) => text,
    Err(_) => panic!("expected String"),
};

assert_eq!(*text, "typed");
```

成功时，Box 的动态元数据被验证后恢复为 `Box<String>`；底层分配不需要复制。失败时，原 `Box<dyn Any>` 被返回，所有权不会泄漏。

unsafe 的 `downcast_unchecked` 省略类型检查，调用者必须证明具体类型完全匹配。大小或字段相似不能替代 `TypeId` 相等。

## into_raw 暂停自动资源管理

`Box::into_raw` 消费 Box 并返回裸指针：

```rust
let boxed = Box::new(String::from("raw"));
let pointer: *mut String = Box::into_raw(boxed);
```

调用后：

- 原 Box 不再存在；
- pointee 仍然有效；
- 分配仍然存在；
- 裸指针的持有者负责确保值最终只析构一次、存储只释放一次；
- 编译器不再自动跟踪这份释放责任。

这不是借用转换，而是所有权协议转换。裸指针可复制，但复制地址不会复制资源所有权。

## from_raw 恢复 Box 所有权

最简单的成对使用方式是：

```rust
let pointer = Box::into_raw(Box::new(String::from("round trip")));

// SAFETY: pointer 来自 Box::into_raw，尚未被释放或重新包装，
// 类型和 DST 元数据未改变。
let boxed = unsafe { Box::from_raw(pointer) };

assert_eq!(*boxed, "round trip");
```

`Box::from_raw(pointer)` 的核心前置条件包括：

1. 指针非空、正确对齐；
2. 指向一个已初始化且合法的 `T`；
3. 分配布局与 `T` 匹配；
4. 存储来自 Box 兼容的 allocator；
5. 当前没有其他所有者；
6. 同一指针尚未被另一次 `from_raw` 接管；
7. DST 的长度或虚表元数据仍然正确；
8. 活跃引用和裸指针访问符合别名规则。

违反任一条件都可能产生未定义行为。

## from_raw 必须恰好接管一次

以下模式会制造两个 Box 所有者：

```rust
let pointer = Box::into_raw(Box::new(42_u32));

// let first = unsafe { Box::from_raw(pointer) };
// let second = unsafe { Box::from_raw(pointer) };
```

两个 Box 离开作用域会对同一分配执行两次释放。裸指针的 Copy 性质不会改变底层分配只能有一个所有者的事实。

若需要临时观察，不应重建 Box：

```rust
let pointer = Box::into_raw(Box::new(42_u32));

// SAFETY: pointer 指向有效 u32，且本次共享借用期间没有写入或释放。
let value = unsafe { &*pointer };
assert_eq!(*value, 42);

// SAFETY: 共享借用已结束，所有权尚未被其他路径接管。
drop(unsafe { Box::from_raw(pointer) });
```

每次 unsafe 操作都承担不同责任：创建引用需要证明引用有效性和别名，恢复 Box 需要证明唯一所有权与分配来源。

## DST 裸指针必须保留元数据

```rust
let boxed: Box<[u32]> = vec![1, 2, 3].into_boxed_slice();
let pointer: *mut [u32] = Box::into_raw(boxed);
```

`pointer` 是指向切片的宽裸指针，包含长度。若只保存数据地址 `*mut u32` 而丢失长度，就无法正确恢复原 `Box<[u32]>` 的布局和逐元素析构范围。

```rust
// SAFETY: pointer 是未经修改的 Box::into_raw 结果，完整保留长度元数据。
let boxed = unsafe { Box::from_raw(pointer) };
assert_eq!(&*boxed, &[1, 2, 3]);
```

trait object 还必须保留正确虚表元数据。不能把一个 `*mut dyn Trait` 的数据地址与另一个具体类型的虚表随意组合。

## 手工分配后构造 Box 要匹配 Global allocator

稳定的普通 `Box<T>` 使用全局分配器管理非零大小值。若裸指针不是从 `Box::into_raw` 得到，`from_raw` 的调用者必须证明它来自兼容的全局 allocator，并使用与 `T` 一致的 Layout。

概念过程为：

```text
Layout::new::<T>()
    -> Global 分配存储
    -> 正确初始化 T
    -> Box::from_raw(ptr)
```

不能把以下地址直接交给 `Box::from_raw`：

- 栈上局部变量地址；
- `malloc` 返回但释放协议不兼容的地址；
- 某个 Vec 缓冲区中间元素地址；
- 内存映射区域中的对象地址；
- 设备寄存器地址；
- 已经释放的地址；
- 使用不同大小或对齐申请的地址。

Box drop 会按自己的契约析构 `T` 并释放存储，来源不匹配会破坏 allocator。

## Box 的 unsafe 别名模型接近 &mut T

Box 表达对 pointee 的唯一拥有访问能力。unsafe 代码不能把它当作“普通整数地址，可永久保存并任意使用”。

```rust
let mut boxed = Box::new(1_u32);
let pointer = Box::as_mut(&mut boxed) as *mut u32;

*boxed = 2;

// 后续是否还能使用早先 pointer，取决于当前裸指针别名模型及访问序列；
// 不能仅以地址仍相同为依据。
```

通过 Box 发生的 move、独占重借用和写入可能使旧裸指针不再具有访问权限。地址数值相同只是必要条件之一，不能证明 provenance 和别名有效。

unsafe 容器应尽量缩短裸指针存活范围，使用标准库公开的 raw pointer API，并通过 Miri 检查具体访问序列。

## new_uninit 分离分配与初始化

`Box::<T>::new_uninit()` 返回 `Box<MaybeUninit<T>>`：存储已经获得，但其中尚不存在合法 `T`。

```rust
let mut boxed = Box::<[u64; 1024]>::new_uninit();

boxed.write([0_u64; 1024]);

// SAFETY: write 已完整初始化整个数组，且尚未读取或析构它。
let boxed = unsafe { boxed.assume_init() };

assert_eq!(boxed[0], 0);
```

这类 API提供先取得目标存储、再建立有效值的表达方式，适合：

- 让编译器有机会直接在目标分配中构造极大值；
- 与填充调用方缓冲区的 FFI 协作；
- 构建大型数组或复杂对象；
- 实现需要分阶段初始化的底层容器。

`assume_init` 的证明义务仍然完整存在。只写入部分字段、错误处理提前返回或 panic 都可能留下部分初始化状态，需要单独记录初始化进度并清理已构造元素。

是否完全消除中间临时值仍取决于具体初始化表达式和优化结果；`new_uninit` 只提供可表达这种初始化策略的存储与类型状态。

## 零填充不等于初始化任意 T

`Box::<T>::new_zeroed()` 获得填零的 `Box<MaybeUninit<T>>`。只有全零比特模式是合法 `T` 时，才能 `assume_init`。

对整数通常成立：

```rust
let value = Box::<u64>::new_zeroed();

// SAFETY: u64 的全零比特模式是合法值 0。
let value = unsafe { value.assume_init() };
assert_eq!(*value, 0);
```

对引用、`Box<U>`、`NonZeroUsize` 和许多 enum 不成立，因为这些类型禁止零值或只允许特定判别模式。

填零发生在分配字节层，合法性属于目标类型层。二者不能混为一谈。

## 分配失败与普通业务错误不同

`Box::new` 返回 `Box<T>`，不是 `Result<Box<T>, AllocError>`。稳定全局分配路径遇到无法处理的 allocation error 时通常调用分配错误处理器并终止，而不是进入普通 `Result` 错误流。

因此：

- 捕获 panic 不能可靠地恢复所有 OOM；
- 业务层 `Result` 不会自动覆盖分配失败；
- 面向严格内存预算的系统需要限制输入、复用缓冲区和预估容量；
- fallible allocation API的稳定性必须按当前工具链核对，不能假设所有 `try_new` 变体都可在稳定 Rust 使用。

嵌入式、内核和自定义运行时还可能通过 `alloc_error_handler` 或专用 allocator 制定不同策略，但这属于运行环境契约。

## Box::leak 主动放弃自动回收

`Box::leak` 消费 Box 并返回指向 pointee 的引用：

```rust
let config: &'static mut String = Box::leak(Box::new(
    String::from("runtime configuration"),
));

config.push_str(" loaded");
```

若选择 `'static`，意味着该借用可以持续到进程结束。Box 不再存在，因此不会自动析构 pointee，也不会释放 Box 分配。

主动泄漏可以用于：

- 进程期单例；
- 初始化后永不卸载的注册表；
- 某些 FFI 回调上下文；
- 明确以进程退出作为回收边界的对象。

它不适合按请求、连接或任务不断创建的对象，否则内存会随运行时间增长。

## `'static` 引用不表示值编译进二进制

`Box::leak` 证明运行时分配也能产生 `'static` 引用。`'static` 的含义是引用可以在整个程序剩余时间保持有效，不是值必须来自静态数据段。

相反，类型约束 `T: 'static` 也不表示 `T` 当前活到程序结束。它表示 `T` 不含生命周期短于 `'static` 的借用：

```rust
fn owns_static<T: 'static>(value: T) -> T {
    value
}

let text = owns_static(String::from("owned"));
drop(text);
```

`String: 'static`，但仍可立即 drop。把 `'static` 解释成“永不释放”会混淆类型关系与实际资源生命周期。

## 泄漏在 Rust 中是安全的，但可能不可接受

```rust
let value = Box::new(vec![1_u8; 1024]);
std::mem::forget(value);
```

`mem::forget` 是安全函数，因为 Rust 的内存安全模型不保证析构一定发生。循环引用、进程终止、引用计数溢出保护或主动泄漏都可能使资源不被回收。

内存泄漏通常不直接产生 use-after-free、double free 或数据竞争，因此不属于 unsafe 的前置条件。但它仍可能导致：

- 长期内存增长；
- 文件描述符、锁或设备资源耗尽；
- 服务不可用；
- 数据未刷新或协议未正常关闭。

“memory-safe” 不等于“资源管理正确”。泄漏必须是经过容量和生命周期分析的设计选择，而不是恢复所有权失败后的兜底。

## 从 leak 恢复所有权需要重新证明唯一性

`Box::leak` 返回引用后，安全 API没有直接的“unleak”。理论上可以保存原地址并在所有派生引用都失效后用 `Box::from_raw` 恢复，但这属于 unsafe 协议。

必须证明：

- 地址确实来自该 Box；
- T 和 DST 元数据未改变；
- 所有引用及其派生指针不再使用；
- 没有其他路径已经恢复所有权；
- allocator 与 Layout 仍匹配。

若接口未来允许调用者保留 `'static` 引用，就无法再在其可见生命周期内安全回收。将引用标成 `'static` 是强契约，不能事后仅凭“当前似乎没人使用”撤销。

## ManuallyDrop 可以分离 pointee 析构与存储释放

```rust
use std::mem::ManuallyDrop;

let value = Box::new(ManuallyDrop::new(String::from("manual")));
drop(value);
```

Box 仍会释放存放 `ManuallyDrop<String>` 的外层分配，但不会自动运行内部 `String::drop`，因此 String 的字节缓冲区泄漏。

`ManuallyDrop<T>` 适用于 union、底层容器和自定义析构顺序，但把“不会自动 drop”引入了新的证明责任：

- 哪条路径执行真正析构；
- 是否恰好执行一次；
- panic 时谁接管；
- 对外暴露值是否仍然有效；
- drop 后字段是否可能被安全代码再次观察。

仅为避免编译器报错而包裹 `ManuallyDrop`，通常会把所有权错误转化为泄漏或 double drop 风险。

## Box 与 FFI 应明确转移方向

Rust 创建、外部端销毁的典型协议可以用裸指针表达：

```rust
#[repr(C)]
pub struct Session {
    id: u64,
}

#[unsafe(no_mangle)]
pub extern "C" fn session_new(id: u64) -> *mut Session {
    Box::into_raw(Box::new(Session { id }))
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn session_free(pointer: *mut Session) {
    if pointer.is_null() {
        return;
    }

    // SAFETY: 外部调用者必须传入 session_new 返回且尚未释放的指针。
    drop(unsafe { Box::from_raw(pointer) });
}
```

协议必须明确：

- `session_new` 把所有权交给谁；
- `session_free` 是否接受 null；
- 同一指针只能释放一次；
- 指针不能来自其他 allocator；
- 释放后所有别名立即失效；
- 结构体 ABI与版本如何保持兼容。

外部函数返回的任意 `T*` 不能直接假设为 Box。只有来源、布局、allocator 和唯一所有权全部匹配时，`from_raw` 才成立。

## Box<T> 的 Send 与 Sync 仍由 T 决定

唯一所有权不自动使对象可跨线程发送：

```rust
use std::rc::Rc;

let value = Box::new(Rc::new(42_u32));

// std::thread::spawn(move || drop(value));
```

`Rc<T>` 的引用计数不是线程安全的，因此 `Box<Rc<T>>` 也不能通过外层唯一 Box 绕过 `Rc` 的线程约束。

概念上：

- `Box<T>: Send` 需要 `T: Send`；
- `Box<T>: Sync` 需要 `T: Sync`；
- allocator 参数化的 Box 还要考虑 allocator 自身能力。

Box 只管理外层分配的所有权，不会改变 pointee 内部共享状态的并发语义。

## Box 的成本是一处分配和一次间接访问

对非零大小 `T`，`Box::new` 通常引入：

- 动态分配器调用；
- 至少一层指针间接访问；
- 可能降低缓存局部性；
- 析构时的 allocator 释放；
- 可能改善大值移动成本和外层结构大小。

```rust
struct Inline {
    payload: [u8; 256],
}

struct Indirect {
    payload: Box<[u8; 256]>,
}
```

`Indirect` 句柄较小，移动成本稳定，但访问 payload 需要追踪指针且对象分布可能更离散。`Inline` 避免独立分配，数组遍历局部性通常更好，但移动和包含它的 enum 大小可能增加。

实际选择需要结合：

- 对象数量与生命周期；
- 热路径访问频率；
- 是否经常移动外层值；
- enum 最大变体膨胀；
- 分配器争用；
- 缓存 miss；
- API是否需要 DST 或稳定间接层。

不能只比较 `size_of::<Inline>()` 与 `size_of::<Indirect>()` 得出整体内存或性能结论。

## 多一层 Box 不一定带来更多语义

```rust
let value = Box::new(Box::new(42_u32));
```

`Box<Box<T>>` 通常意味着两次分配和两次间接访问。它只有在两层所有权边界分别有意义时才合理，例如外层类型擦除、独立替换内层指针，或某个 API固定要求 Box 化句柄。

如果只是“希望值在堆上”，单层 `Box<T>` 已经足够。额外间接层不会让地址更稳定，也不会提供共享所有权。

类似地，`Vec<Box<T>>` 与 `Box<[T]>` 表达不同布局：

- `Vec<Box<T>>` 连续存储指针，每个 T 通常独立分配；
- `Box<[T]>` 连续存储所有 T，只存在一个元素缓冲区分配。

前者允许单个 T 的地址在 Vec 扩容时保持不变，后者具有更好的连续局部性。

## Option<Box<T>> 通常不需要额外判别空间

`Box<T>` 对合法值非空，因此 `Option<Box<T>>` 可以用空指针 niche 表示 `None`：

```rust
use std::mem::size_of;

assert_eq!(size_of::<Option<Box<u64>>>(), size_of::<Box<u64>>());
```

这使拥有型链表可以自然使用：

```rust
type Link<T> = Option<Box<Node<T>>>;
```

没有节点时为 `None`，存在节点时为 `Some(boxed_node)`，通常无需额外 tag 字节。

布局优化不能改变语义：`None` 表示没有所有权，`Some` 表示唯一拥有分配。不能把任意 null `*mut T` 无检查地 transmute 成其他 Box 组合。

## Box 不是 arena，也不是共享所有权

Box 的回收粒度是一份所有权对应的一块分配。大量短生命周期小对象可能产生大量 allocator 调用和碎片。

当对象具有共同生命周期时，arena 可以批量分配和整体释放；当对象需要多个所有者时，`Rc<T>` 或 `Arc<T>` 通过引用计数决定最后释放者；当需要连续增长序列时，`Vec<T>` 通常比每个元素单独 Box 更合适。

选择模型时应先回答：

| 需求 | 典型所有权工具 |
|---|---|
| 一个所有者、一个独立对象 | `Box<T>` |
| 一个所有者、连续可增长元素 | `Vec<T>` |
| 单线程共享所有权 | `Rc<T>` |
| 多线程共享所有权 | `Arc<T>` |
| 一组对象共同释放 | arena |
| 借用现有对象、不参与释放 | `&T` / `&mut T` |

这些工具可能具有相似指针表示，但资源生命周期协议完全不同。

## 从 Box 代码读取所有权状态

遇到复杂 Box 流程时，可以按以下顺序恢复模型：

1. Box 当前由哪个绑定、字段或外部调用者拥有？
2. 本次操作移动的是 Box 句柄、pointee，还是只创建借用？
3. pointee 是否还管理第二层动态资源？
4. T 是 Sized 还是 DST，元数据是否必须保留？
5. 是否发生 unsizing，底层分配有没有改变？
6. 析构路径是自动 drop、显式 `drop`、`into_raw` 还是 `leak`？
7. 若进入裸指针协议，谁负责恢复唯一所有权？
8. 指针来源、allocator、Layout、类型与元数据是否匹配？
9. 是否可能从同一裸指针恢复两次？
10. panic、提前返回和线程退出时，责任仍由谁持有？

Box 的 API虽然简单，但一旦转换为裸指针，原本由类型系统维护的状态就必须在控制流中显式追踪。

## 工程中的 Box 检查

设计拥有型分配时，可以逐项检查：

1. 是否确实需要独立分配，而不是内联字段或 `Vec<T>`？
2. Box 减少的是句柄移动成本，还是错误地被认为能自动提升性能？
3. pointee 是否又管理其他堆分配，真实分配次数是多少？
4. 大值的 `Box::new` 是否可能在未优化路径形成巨大栈临时值？
5. ZST 是否被错误地认为一定发生 allocator 调用？
6. `*box` 在当前上下文是借用、Copy 还是 move？
7. 递归结构的默认 drop 深度是否可能耗尽栈？
8. 固定长度数据是否更适合 `Box<[T]>`？
9. `Box<dyn Trait>` 的动态分发和类型擦除是否确实需要？
10. `into_raw` 之后是否在所有路径上恢复或明确转交所有权？
11. `from_raw` 是否只调用一次，并保留了 DST 元数据？
12. 外部分配是否与 Box 的 allocator 和 Layout 完全兼容？
13. unsafe 裸指针是否遵守 Box 类似 `&mut T` 的唯一别名要求？
14. `new_uninit` 的部分初始化和 panic 清理是否完整？
15. 全零比特模式对目标类型是否真的有效？
16. `Box::leak` 的数量是否有明确上界和进程期理由？
17. FFI 是否把创建、使用、释放和 null 规则写进同一协议？
18. `Box<T>` 的 `Send`/`Sync` 是否被 pointee 内部类型正确限制？

资源管理的核心不是“最终有没有调用 free”，而是每个时刻都能唯一确定谁有权访问、转移和释放分配。

## 本章建立的唯一所有权模型

`Box<T>` 可以归纳为以下关系：

1. Box 把一个 pointee 的唯一所有权与动态存储释放责任绑定；
2. 唯一所有者不排斥临时共享借用和独占借用，访问仍由借用规则控制；
3. `Box::new` 把 T 移入分配，移动 Box 句柄通常不会移动 pointee；
4. 普通 Box 仍允许把 T 移出，地址固定需要额外的 Pin 契约；
5. `Box<T>` 对 Sized T 是单指针表示，对 DST 还必须携带运行时元数据；
6. ZST Box 可以没有实际分配，但仍需合法指针表示并执行析构语义；
7. `Deref`/`DerefMut` 让 Box 参与普通引用和方法调用，不能改变所有权边界；
8. drop glue 递归析构 pointee 及其资源，再使用兼容 allocator 释放存储；
9. Box 终止递归类型的布局展开，但深递归析构仍可能消耗调用栈；
10. unsizing 可以把 Box 转为拥有型切片或 trait object，而不搬迁底层分配；
11. `into_raw` 把自动释放责任转为手工协议，`from_raw` 必须恰好恢复一次；
12. `new_uninit` 分离分配与初始化，`assume_init` 需要证明完整有效值已经建立；
13. `leak` 和 `forget` 在内存安全上合法，但会永久放弃自动资源回收；
14. Box 的成本和收益来自分配、间接访问、句柄大小、移动方式与缓存局部性的共同作用。

下一章将进入 `Rc<T>`、`Arc<T>` 与 `Weak<T>`，分析唯一所有权如何扩展为共享所有权、强弱引用计数如何决定资源生命周期、循环引用为何不会破坏内存安全却会造成泄漏，以及原子计数为跨线程共享增加了哪些成本。

## 延伸阅读

- [Rust 标准库：`std::boxed`](https://doc.rust-lang.org/std/boxed/index.html)
- [Rust 标准库：`Box<T>`](https://doc.rust-lang.org/std/boxed/struct.Box.html)
- [Rust 标准库：`Box::into_raw`](https://doc.rust-lang.org/std/boxed/struct.Box.html#method.into_raw)
- [Rust 标准库：`Box::from_raw`](https://doc.rust-lang.org/std/boxed/struct.Box.html#method.from_raw)
- [Rust 标准库：`Box::leak`](https://doc.rust-lang.org/std/boxed/struct.Box.html#method.leak)
- [Rust 标准库：`Drop`](https://doc.rust-lang.org/std/ops/trait.Drop.html)
- [Rust 标准库：`MaybeUninit`](https://doc.rust-lang.org/std/mem/union.MaybeUninit.html)
- [The Rustonomicon：Allocating memory](https://doc.rust-lang.org/nomicon/vec/vec-alloc.html)
- [Rust 语言圣经：`Box<T>` 堆对象分配](https://beatai.org/rust-course/advance/smart-pointer/box)
- [Rust 语言圣经：Deref 解引用](https://beatai.org/rust-course/advance/smart-pointer/deref)
- [Rust 语言圣经：Drop 释放资源](https://beatai.org/rust-course/advance/smart-pointer/drop)
- [Rust 语言圣经：Unsafe Rust 与裸指针](https://beatai.org/rust-course/advance/unsafe/superpowers)
