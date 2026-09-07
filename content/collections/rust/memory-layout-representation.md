---
title: Rust 内存布局：值如何落到栈、堆与字节中
date: 2026-09-07
excerpt: 从大小、对齐与 padding 出发，分析栈和堆的真实边界、repr(Rust/C/transparent/packed)、枚举 niche、零大小类型、DST、胖指针与布局相关 unsafe 契约。
chapter: 内存与资源
chapterOrder: 10
---

## 内存布局描述的是值，不是变量名

Rust 类型系统规定一个值可以处于哪些合法状态；内存布局进一步规定这些状态如何占用字节。一个类型的 layout 主要包含：

- 大小：连续数组中相邻两个值之间相隔多少字节；
- 对齐：值的起始地址必须满足什么倍数关系；
- 字段偏移：复合类型中每个字段相对起始地址的位置；
- 枚举表示：判别值和各变体载荷如何组合；
- 有效值集合：哪些比特模式能够被解释成该类型的合法值。

```rust
use std::mem::{align_of, size_of};

assert_eq!(size_of::<u8>(), 1);
assert_eq!(size_of::<u32>(), 4);
assert_eq!(align_of::<u8>(), 1);
```

布局属于类型和值的表示，不直接承诺局部变量一定存在于某个物理栈槽。优化器可以把值保存在寄存器中、完全消除它，或者把多个临时值合并。讨论“栈上的值”时，通常描述的是抽象执行模型和存储期限；讨论布局时，描述的是一旦值需要占用内存，它必须满足的表示约束。

## 大小包含数组步长所需的尾部 padding

`size_of::<T>()` 不只是字段有效数据之和，而是 `[T; N]` 中相邻元素的步长。

若 `T` 的对齐是 `a`，`size_of::<T>()` 必须是 `a` 的整数倍，这样数组中每个元素都能正确对齐。

```rust
#[repr(C)]
struct Header {
    tag: u8,
    length: u32,
}
```

在常见的 `u32` 对齐为 4 的目标上，布局为：

```text
offset 0      tag: u8
offset 1..4   padding
offset 4..8   length: u32
size          8
alignment     4
```

末尾已经处于 4 的倍数，因此不再增加尾部 padding。若再追加一个 `u8`，字段有效数据结束于 offset 9，但结构体大小通常需要向上补齐到 12，保证 `[Header; 2]` 的第二个元素仍从 4 的倍数开始。

```rust
use std::mem::{align_of, offset_of, size_of};

#[repr(C)]
struct PacketHeader {
    kind: u8,
    length: u32,
    flags: u8,
}

assert_eq!(offset_of!(PacketHeader, kind), 0);
assert_eq!(offset_of!(PacketHeader, length), 4);
assert_eq!(offset_of!(PacketHeader, flags), 8);

assert_eq!(align_of::<PacketHeader>(), 4);
assert_eq!(size_of::<PacketHeader>(), 12);
```

这些具体断言依赖目标平台对字段类型的对齐。固定宽度整数的大小稳定，但其自然对齐仍可能因目标 ABI 而变化。

## 对齐限制了哪些地址可以存放一个值

对齐为 `n` 表示起始地址必须是 `n` 的倍数。Rust 中对齐至少为 1，并且是 2 的幂。

```rust
#[repr(align(64))]
struct CacheLine<T>(T);

assert!(std::mem::align_of::<CacheLine<u8>>() >= 64);
```

提高对齐可能用于 SIMD 指令、DMA、缓存行隔离或外部 ABI，但会同时改变：

- 单个值的占用空间；
- 数组元素步长；
- 分配器需要满足的 `Layout`；
- 容器中的 padding；
- FFI 两侧必须一致的布局约定。

对齐不是性能提示，而是访问有效性的前置条件。把未对齐地址强制转成 `&T`，即使硬件支持未对齐读取，也已经违反 Rust 引用要求。

## 栈与堆描述分配策略，不是类型分类

“基本类型在栈上，复杂类型在堆上”不是 Rust 的类型规则。同一个类型可以出现在不同存储位置：

```rust
let stack_value = 42_u64;
let heap_value = Box::new(42_u64);
```

两个 `u64` 的布局完全相同。区别是 `stack_value` 作为局部值由当前调用帧管理，`heap_value` 的 `u64` 位于动态分配中，局部变量持有管理这块分配的 `Box<u64>`。

反过来，`String` 自身是编译期大小固定的句柄，因此可以直接作为局部值、结构体字段或数组元素。它管理的 UTF-8 缓冲区通常位于堆上。

```rust
let text = String::from("layout");

println!("handle: {}", std::mem::size_of_val(&text));
println!("bytes:  {}", text.capacity());
```

`size_of_val(&text)` 测量 `String` 句柄，不包含其动态分配的容量。内存占用分析必须区分：

- inline size：值本身的布局大小；
- owned allocation：值独占管理的外部内存；
- shared allocation：可能由多个句柄共享的内存；
- allocator overhead：分配器的元数据与大小类别损耗；
- retained capacity：已分配但当前未使用的空间。

`size_of` 只回答第一项。

## 栈分配不是显式语言保证

Rust 语义关注值的所有权、生命周期与可观察行为，不保证某个普通局部变量最终一定写入机器栈。

```rust
fn sum(values: [u32; 4]) -> u32 {
    values.into_iter().sum()
}
```

优化后，数组可能被拆成寄存器或直接折叠为常量。即使调试构建为它保留栈槽，也不能把这个编译结果当作跨版本 ABI。

需要显式动态分配时使用 `Box`、`Vec`、`String` 或分配器 API；需要与外部系统共享地址时使用明确的 FFI、固定、映射或硬件接口。不要通过观察一次汇编结果推导语言级存储承诺。

## Sized 表示编译期已知统一布局

若一种类型的所有值具有相同且编译期已知的大小与对齐，它实现 `Sized`。

泛型参数默认隐含 `Sized`：

```rust
fn consume<T>(value: T) {
    let _ = value;
}
```

大致等价于：

```rust
fn consume_sized<T: Sized>(value: T) {
    let _ = value;
}
```

按值传递需要知道参数占用多少空间。要接受可能不定长的类型，必须通过指针间接访问并显式放宽约束：

```rust
fn byte_size<T: ?Sized>(value: &T) -> usize {
    std::mem::size_of_val(value)
}

assert_eq!(byte_size("rust"), 4);
assert_eq!(byte_size(&[1_u16, 2, 3][..]), 6);
```

`?Sized` 不是“要求 T 不定长”，而是取消默认的 `Sized` 要求，使 `T` 可以是 Sized，也可以是 DST。

## DST 的大小由指针元数据补全

常见动态大小类型包括：

- `[T]`：元素数量在运行时确定；
- `str`：UTF-8 字节长度在运行时确定；
- `dyn Trait`：具体实现类型被擦除；
- 尾字段为 DST 的结构体。

```rust
struct Packet<T: ?Sized> {
    kind: u16,
    payload: T,
}
```

只有最后一个字段可以是不定长字段，因为编译器必须先确定前面字段的偏移，再利用运行时元数据确定尾部大小和整个值的布局。

DST 不能作为普通局部值按值存在，但可以位于某种指针之后：

```rust
let slice: &[u8] = &[1, 2, 3];
let text: &str = "rust";
let object: &dyn std::fmt::Display = &42;
```

这些引用自身是 Sized。它们把数据地址与解释 DST 所需的元数据一起传递。

## 胖指针的第二部分取决于 pointee

从概念上看，不同 DST 指针携带不同元数据：

| pointee | 数据地址指向 | 元数据含义 |
|---|---|---|
| `[T]` | 第一个元素 | 元素数量 |
| `str` | 第一个 UTF-8 字节 | 字节数量 |
| `dyn Trait` | 具体值 | 与具体类型和 trait 对应的虚表信息 |

```rust
use std::mem::size_of_val;

let array = [10_u32, 20, 30];
let slice: &[u32] = &array;

assert_eq!(slice.len(), 3);
assert_eq!(size_of_val(slice), 12);
```

`size_of_val(slice)` 使用引用携带的长度计算 pointee `[u32]` 的运行时大小，而不是返回引用句柄的大小。

当前主流目标上的 DST 指针通常表现为两个机器字，但 Rust Reference 只保证指向 DST 的指针是 Sized，且其大小和对齐不小于薄指针。除非使用具有明确保证的公开 API或 ABI，不应把所有胖指针持久化成固定的两个 `usize`。

## unsizing 改变指针元数据，不搬迁 pointee

数组引用可以强制转换为切片引用：

```rust
let array = [1_u8, 2, 3, 4];
let slice: &[u8] = &array;
```

`&[u8; 4]` 的 pointee 是 Sized，引用只需要地址；转换为 `&[u8]` 后，指针增加长度元数据。数组本身没有因为转换被复制到新位置。

同理：

```rust
let value = 42_i32;
let display: &dyn std::fmt::Display = &value;
```

从 `&i32` 到 `&dyn Display` 的 unsizing 生成适当元数据，使动态分发能够找到 `i32` 的方法和布局信息。底层 `i32` 仍在原地址。

这解释了 `Box<[T; N]> -> Box<[T]>` 与 `Box<T> -> Box<dyn Trait>` 为什么通常不需要重新分配 pointee：变化的是所有权指针携带的类型与元数据。

## 数组布局具有直接的步长保证

`[T; N]` 的大小为 `size_of::<T>() * N`，对齐与 `T` 相同，第 `n` 个元素位于：

```text
n * size_of::<T>()
```

```rust
use std::mem::{align_of, size_of};

assert_eq!(size_of::<[u32; 4]>(), 16);
assert_eq!(align_of::<[u32; 4]>(), align_of::<u32>());
```

这里的步长使用 `size_of::<T>()`，它已经包含 `T` 的尾部 padding。数组不会在元素之间再引入另一套独立间距规则。

切片 `[T]` 的元素布局与数组相同，只是长度不在类型中而由指针元数据携带。

## 默认 repr(Rust) 只承诺 soundness 所需的布局

没有 `repr` 属性的 struct、enum 和 union 使用默认 Rust representation。

```rust
struct Metrics {
    enabled: bool,
    count: u64,
    category: u8,
}
```

对普通结构体，稳定保证主要是：

- 每个字段偏移满足自身对齐；
- 整体对齐至少为字段最大对齐；
- 非零大小字段的存储不重叠。

声明顺序不等于内存顺序。编译器可以重排字段以减少 padding，也可以在不同版本、目标或泛型实例间选择不同布局。

因此不能依赖：

```rust
// 错误前提：默认 repr 的第一个声明字段一定在 offset 0。
```

也不能把两个字段列表相同的默认 repr 类型直接 `transmute`。布局恰好相同仍不代表它们具有相同有效值集合。

## repr(C) 固定字段排列算法

`#[repr(C)]` 的结构体按照声明顺序排列字段，并按目标 C ABI插入 padding。

```rust
#[repr(C)]
struct Coordinates {
    x: f64,
    y: f64,
    visible: u8,
}
```

它适合：

- 与 C 结构体交换数据；
- 需要稳定字段偏移的底层代码；
- 实现由明确布局驱动的序列化或映射层；
- 构造包含 tag 与 union 的显式表示。

`repr(C)` 不会递归改变字段类型自身的 representation。若字段是默认 repr 的内部结构体，外层只能稳定地放置整个字段，不能据此假设内部字段顺序。

`repr(C)` 也不自动使类型 FFI-safe。例如 `String`、`Vec<T>`、Rust trait object 和普通引用仍包含 Rust 专属语义与有效性约束，不能因为外层加了属性就直接交给 C。

## FFI 布局与函数 ABI 是两个问题

相同的大小、对齐和字段偏移，不保证两个类型在函数边界上的传递方式相同。寄存器分类、返回值传递、调用约定和平台 ABI 还会决定参数如何穿过边界。

```rust
#[repr(C)]
struct Point {
    x: i32,
    y: i32,
}

unsafe extern "C" {
    fn translate(point: Point, dx: i32, dy: i32) -> Point;
}
```

这里同时依赖：

- `Point` 的 C representation；
- `extern "C"` 的函数调用约定；
- C 端具有匹配的声明；
- 两侧整数宽度、目标平台和编译选项兼容；
- 返回值只包含 Rust `Point` 允许的有效字段值。

只验证 `size_of::<Point>()` 不能证明整个 FFI 接口正确。

## repr(transparent) 让包装器继承单个字段的表示

newtype 经常需要提供新的类型身份，同时保持与内部标量或句柄兼容的布局：

```rust
#[repr(transparent)]
struct FileDescriptor(i32);
```

`repr(transparent)` 要求最多一个具有非零大小的字段；其他字段只能是不影响布局的零大小字段。类型的布局与 ABI由该字段决定。

```rust
use std::marker::PhantomData;

#[repr(transparent)]
struct Handle<T> {
    raw: usize,
    _type: PhantomData<fn() -> T>,
}
```

`PhantomData` 不占空间，因此 `Handle<T>` 可以保留 `usize` 的表示，同时用 `T` 区分不同资源句柄。

transparent 只保证表示与 ABI关系，不会自动继承内部类型的全部 trait 或业务不变量。`FileDescriptor(-1)` 是否合法仍由类型定义和构造 API决定。

## repr(u8) 等原始表示控制枚举判别值

无字段枚举可以指定与某个整数类型相应的 representation：

```rust
#[repr(u8)]
enum Opcode {
    Read = 1,
    Write = 2,
    Flush = 3,
}
```

它使大小与对齐匹配 `u8`，并限制可使用的判别值范围。但合法 Rust 值仍只有列出的变体。把任意 `u8` 直接重解释为 `Opcode`，当字节为 0 或 255 时会制造非法枚举值。

外部协议解析应先验证整数，再构造枚举：

```rust
impl TryFrom<u8> for Opcode {
    type Error = u8;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            1 => Ok(Self::Read),
            2 => Ok(Self::Write),
            3 => Ok(Self::Flush),
            other => Err(other),
        }
    }
}
```

C enum 往往允许未命名的整数值，Rust enum 不允许。FFI 中若外部端可能传入任意标志或未知版本值，使用经过验证的整数 newtype 通常比 Rust field-less enum 更稳健。

## 枚举布局由判别信息与载荷共同决定

概念上，数据枚举可以表示为 tag 加最大载荷：

```rust
enum Message {
    Empty,
    Number(u64),
    Bytes(Vec<u8>),
}
```

实际默认布局不必真的把独立 tag 放在固定位置。编译器可以利用载荷类型中原本无效的比特模式编码变体，这称为 niche optimization。

最常见的例子是非空引用：

```rust
use std::mem::size_of;

assert_eq!(size_of::<Option<&u8>>(), size_of::<&u8>());
```

Rust 引用不能为 null，因此空指针比特模式可以表示 `None`，所有合法引用表示 `Some(reference)`。不需要额外判别字节。

类似优化还可能出现在 `NonZeroUsize`、函数指针和某些嵌套枚举中，但不应从一个例子推广出任意 enum 的稳定布局。只有文档明确保证的 null pointer optimization 组合才能作为跨版本 unsafe 契约。

## 大小相同不代表可以 transmute

`transmute::<A, B>` 首先要求源类型和目标类型大小相同，但这只是必要条件，不是充分条件。

```rust
assert_eq!(std::mem::size_of::<u8>(), std::mem::size_of::<bool>());
```

`u8` 有 256 个合法值，`bool` 只有 `false` 与 `true` 的合法表示。把值 `2_u8` transmute 成 `bool` 会制造非法值。

完整判断至少包括：

1. 大小是否一致；
2. 对齐与目标存放地址是否满足；
3. 字段布局和 padding 是否兼容；
4. 目标类型是否接受源比特模式；
5. 所有权语义是否会导致重复释放；
6. 引用的来源、别名与生命周期是否有效；
7. 枚举判别值与 niche 是否合法；
8. 是否存在更窄、更明确的转换 API。

数值转换应使用 `From`、`TryFrom`、`to_ne_bytes`、`from_ne_bytes` 等语义化接口。布局重解释应被限制在真正需要并能完整证明的底层边界。

## padding 字节通常不是值语义的一部分

结构体为满足对齐而产生的 padding 不属于任何字段。普通赋值和 ABI传递不承诺保留 padding 中的具体字节，padding 也可能包含未初始化数据。

```rust
#[repr(C)]
struct Record {
    tag: u8,
    value: u32,
}
```

即使 `Record` 的总大小为 8，也不能安全地把任意 `&Record` 直接视为完整初始化的 `[u8; 8]` 并发送。offset 1..4 的 padding 可能未初始化，读取它们会违反内存初始化规则，还可能泄露旧内存内容。

稳定序列化应逐字段编码：

```rust
impl Record {
    fn encode(self) -> [u8; 5] {
        let mut bytes = [0_u8; 5];
        bytes[0] = self.tag;
        bytes[1..].copy_from_slice(&self.value.to_le_bytes());
        bytes
    }
}
```

这样同时固定字段顺序、整数端序和输出长度，不依赖主机 ABI或 padding。

## 端序不属于普通 struct layout

`repr(C)` 决定字段的相对布局，但不会把整数转换为网络字节序。多字节整数仍使用目标机器的 native endian 表示。

```rust
let value = 0x1234_u16;

assert_eq!(value.to_be_bytes(), [0x12, 0x34]);
assert_eq!(u16::from_le_bytes([0x34, 0x12]), value);
```

磁盘格式、网络协议和哈希输入必须显式选择 `to_le_bytes`、`to_be_bytes` 或规范定义的编码。把内存快照当作跨平台格式，会同时绑定字段布局、padding、端序、指针宽度、枚举表示和编译器版本。

## repr(packed) 降低对齐但不改变字段类型要求

```rust
#[repr(C, packed)]
struct PackedHeader {
    tag: u8,
    length: u32,
}
```

`length` 可能位于未满足 `u32` 自然对齐的地址。直接创建 `&header.length` 会形成未对齐引用，即使只读取也不合法。

需要通过裸指针执行显式未对齐访问：

```rust
use std::ptr;

fn length(header: &PackedHeader) -> u32 {
    let pointer = ptr::addr_of!(header.length);

    // SAFETY: pointer 来自有效 header，指向已初始化的 u32 字节；
    // repr(packed) 可能未对齐，因此使用 read_unaligned。
    unsafe { pointer.read_unaligned() }
}
```

`packed` 不是节省空间的通用优化。它可能增加每次访问的指令成本、阻止借用字段、扩大 unsafe 范围，并造成与外部平台不同的 ABI。只有协议、设备寄存器或既有二进制格式确实要求紧凑排列时才应使用。

## 零大小类型有值但不占数组步长

零大小类型 ZST 的 `size_of` 为 0：

```rust
use std::mem::{align_of, size_of};

struct Marker;

assert_eq!(size_of::<Marker>(), 0);
assert_eq!(size_of::<()>(), 0);
assert_eq!(size_of::<[Marker; 1_000]>(), 0);
assert_eq!(align_of::<()>(), 1);
```

ZST 仍然可以有合法值、所有权、生命周期和析构行为：

```rust
struct Guard;

impl Drop for Guard {
    fn drop(&mut self) {
        println!("released");
    }
}
```

`Guard` 不占数据字节，但离开作用域仍会执行 `Drop`。零大小描述布局，不代表没有语义。

多个 ZST 字段或数组元素可以具有相同地址。程序不能用 ZST 的地址唯一性表示对象身份。

## ZST 仍然有对齐要求

零大小并不意味着对齐一定为 1：

```rust
#[repr(align(32))]
struct AlignedMarker;

assert_eq!(std::mem::size_of::<AlignedMarker>(), 0);
assert_eq!(std::mem::align_of::<AlignedMarker>(), 32);
```

构造引用时，即使 pointee 大小为 0，指针仍必须非空且正确对齐。标准库容器为 ZST 使用特殊指针和容量策略时，也必须维持这些要求。

手写集合迭代器若使用“地址加一”推进 ZST 会失败，因为元素步长为 0；若把地址当整数递增，又可能产生未对齐指针。ZST 是验证 unsafe 容器实现的重要边界用例。

## 空类型与零大小类型不是一回事

```rust
struct UnitLike;
enum Never {}
```

`UnitLike` 有一个合法值且大小为 0；`Never` 没有任何合法值。二者讨论的是不同维度：

- ZST：每个值占多少字节；
- uninhabited type：是否存在合法值。

无变体枚举可能使包含它的状态不可达，编译器也可能据此优化枚举布局。unsafe 代码不能通过写入任意零字节来“初始化”无值类型，因为不存在任何可接受的比特模式。

## 指针大小不等于 pointee 大小

```rust
use std::mem::{size_of, size_of_val};

let value = Box::new([0_u8; 4096]);

println!("box handle: {}", size_of_val(&value));
println!("pointee:    {}", size_of_val(&*value));
println!("array type: {}", size_of::<[u8; 4096]>());
```

移动 `Box<[u8; 4096]>` 通常只移动拥有型指针，堆中的 4096 字节不随句柄搬迁。把数组直接按值移动则语义上移动整个数组；优化器可以消除实际复制，但 API成本模型不能假设总会消除。

选择是否 Box 化应考虑：

- 是否需要动态大小或递归类型；
- 值是否很大且频繁移动；
- 是否需要稳定分配地址；
- 是否需要 trait object；
- 堆分配、指针追踪和缓存局部性的成本；
- 所有权是否应与分配绑定。

“大于某个固定字节数就放堆上”不是通用规则。

## 递归类型需要通过间接层获得有限布局

直接递归结构无法求出有限大小：

```rust
// enum List {
//     Empty,
//     Node(i32, List),
// }
```

若 `List` 内联包含另一个 `List`，则计算其大小会无限展开。加入固定大小的指针后，外层布局变得可计算：

```rust
enum List {
    Empty,
    Node(i32, Box<List>),
}
```

`Box<List>` 的句柄大小在编译期已知，递归数据位于独立分配。这里解决的是布局递归，不是把 `List` 变成 DST。

其他间接层也能终止递归，例如 `Rc<List>`、`Arc<List>` 或 arena index。它们具有不同的所有权、分配与并发语义，不能仅按指针大小互换。

## 闭包与 async 状态机也是复合布局

闭包值会存储它捕获的环境：

```rust
let prefix = String::from("value=");
let render = move |value: i32| format!("{prefix}{value}");

println!("{}", std::mem::size_of_val(&render));
```

具体闭包类型由编译器生成，没有稳定布局保证。捕获方式、优化和编译器版本都可能改变字段集合与排列。

`async` 块同样会生成状态机，保存跨 `.await` 存活的局部状态和判别信息。它的大小会受以下因素影响：

- 跨暂停点存活的局部变量；
- 各状态所需载荷的最大组合；
- 枚举布局与 niche 优化；
- 嵌套 future 是否内联；
- 是否通过 `Box` 或 trait object 引入间接层。

对 future 使用 `size_of_val` 可以做具体构建下的性能诊断，但不能把结果当作稳定 ABI。

## Layout 是动态分配的算术模型

手写分配器接口需要同时提供大小和对齐。`std::alloc::Layout` 封装了这组约束：

```rust
use std::alloc::Layout;

let header = Layout::new::<u32>();
let payload = Layout::array::<u8>(128).unwrap();
let (combined, payload_offset) = header.extend(payload).unwrap();
let combined = combined.pad_to_align();

assert_eq!(payload_offset % payload.align(), 0);
assert_eq!(combined.size() % combined.align(), 0);
```

自己执行 `size + padding` 容易遗漏整数溢出、尾部对齐和零大小情况。动态布局组合应使用 `Layout::array`、`extend`、`repeat` 等公开 API，并检查返回的 `LayoutError`。

分配和释放必须使用兼容 Layout。以不同大小或对齐释放同一地址，会破坏分配器契约。

## 内存布局不是序列化格式

直接持久化对象内存通常绑定了过多隐含条件：

- 编译器可变的默认字段顺序；
- 平台对齐与 padding；
- 大小端；
- 指针宽度；
- 枚举判别表示；
- niche optimization；
- 指针只在当前进程地址空间有效；
- padding 可能未初始化；
- 类型升级后的兼容策略。

稳定格式应逐字段定义编码，明确：

- 字段编号或顺序；
- 整数宽度和端序；
- 长度前缀；
- 可选值与枚举的编码；
- 版本演进和未知字段处理；
- 校验与错误边界。

只有为 memory-mapped file、设备 ABI或高性能零拷贝协议专门设计的 POD-like 类型，才适合让内存布局承担外部格式；即便如此，也需要显式 representation、有效性验证与版本控制。

## 布局优化需要测量整体访问成本

减少 `size_of::<T>()` 不一定提升性能。字段重排可能减少 padding，但也可能把经常一起访问的字段拆开，或导致热点字段跨缓存行。

```rust
struct Entry {
    timestamp: u64,
    status: u8,
    retries: u8,
    payload: [u8; 48],
}
```

布局设计需要同时考虑：

- 每个实例的大小与集合总规模；
- 遍历时实际访问哪些字段；
- array-of-structs 与 struct-of-arrays 的局部性；
- 分支与枚举变体分布；
- 指针间接层和分配次数；
- false sharing；
- 目标 CPU、缓存层级与真实工作负载。

`size_of`、`offset_of!` 和汇编只能给出静态证据；cache miss、吞吐和尾延迟仍需基准与 profiler 验证。

## 从布局问题定位到正确工具

| 问题 | 首选工具 |
|---|---|
| 编译期大小和对齐 | `size_of::<T>()`、`align_of::<T>()` |
| 运行时 DST 大小和对齐 | `size_of_val`、`align_of_val` |
| 字段偏移 | `offset_of!` |
| 动态分配布局 | `std::alloc::Layout` |
| C 字段排列 | `#[repr(C)]` |
| 单字段 ABI包装 | `#[repr(transparent)]` |
| 提高对齐 | `#[repr(align(N))]` |
| 明确未对齐外部格式 | `#[repr(packed)]` 与 `read_unaligned` |
| 字节序列化 | `to_le_bytes` / `to_be_bytes` 与显式协议 |
| 不确定的未初始化状态 | `MaybeUninit<T>` |
| 观察具体构建的类型大小 | 编译期断言、测试、布局诊断工具 |
| 验证 unsafe 内存访问 | Miri、sanitizer、模糊测试与人工证明 |

工具选择取决于需要的是语言保证、目标 ABI保证，还是单次构建的观测结果。这三者不能混为一谈。

## 工程中的布局检查

设计内存敏感结构时，可以依次检查：

1. 需要的是稳定语言语义，还是仅优化当前目标？
2. `size_of` 测量的是句柄还是它管理的全部分配？
3. 是否错误地把类型分成“栈类型”和“堆类型”？
4. 默认 `repr(Rust)` 的字段顺序是否被底层代码隐式依赖？
5. `repr(C)` 字段内部是否仍含没有稳定表示的 Rust 类型？
6. FFI 是否同时匹配数据 representation 与函数 ABI？
7. enum 的整数判别值是否经过验证后再构造？
8. 是否依赖了没有文档保证的 niche optimization？
9. transmute 两端除了大小外，是否具有兼容的全部有效值？
10. padding 是否可能被读取、比较、哈希或发送？
11. 协议是否显式规定端序，而不是复制 native bytes？
12. packed 字段是否错误地形成了未对齐引用？
13. ZST 的对齐、地址非唯一与容器迭代是否处理正确？
14. DST 的元数据属于长度还是虚表，是否被正确保留？
15. 递归类型选择的间接层是否符合实际所有权？
16. 动态分配是否使用相同 Layout 释放，并检查算术溢出？
17. 大小优化是否通过真实访问模式和基准验证？

布局代码的危险通常不是“算错了几个字节”，而是把某次实现观察误当成长期语言保证。

## 本章建立的内存模型

Rust 值的内存表示可以归纳为以下关系：

1. layout 由大小、对齐、字段偏移、枚举表示和有效值共同组成；
2. `size_of::<T>()` 是数组步长，包含满足下一元素对齐所需的尾部 padding；
3. 栈和堆是存储与分配策略，不是简单类型与复杂类型的分类；
4. Sized 类型具有编译期统一布局，DST 通过指针元数据在运行时补全布局；
5. 默认 Rust representation 只承诺 soundness 所需条件，字段声明顺序不是稳定布局；
6. `repr(C)` 固定 C 风格字段排列，但不自动提供 FFI 安全性或序列化稳定性；
7. `repr(transparent)` 在保留新类型身份时继承单个有效字段的表示与 ABI；
8. 枚举可以利用无效比特模式编码判别信息，但只能依赖文档明确保证的 niche；
9. ZST 可以有值、析构和非 1 对齐，大小为零不等于没有语义；
10. 相同大小不代表相同布局，更不代表具有相同的合法比特模式；
11. padding 和 native endian 使对象内存天然不适合作为稳定外部格式；
12. unsafe 布局代码必须区分语言保证、平台 ABI与当前编译结果。

下一章[《Rust Box 与唯一所有权分配：堆对象如何被创建、移动和释放》](/collections/rust/box-unique-ownership)将分析堆分配的创建和释放、递归类型间接层、`Deref`/`Drop`、裸指针往返、泄漏以及自定义分配边界。

## 延伸阅读

- [The Rust Reference：Type layout](https://doc.rust-lang.org/reference/type-layout.html)
- [The Rust Reference：Dynamically sized types](https://doc.rust-lang.org/reference/dynamically-sized-types.html)
- [Rust 标准库：`size_of`](https://doc.rust-lang.org/std/mem/fn.size_of.html)
- [Rust 标准库：`align_of`](https://doc.rust-lang.org/std/mem/fn.align_of.html)
- [Rust 标准库：`offset_of!`](https://doc.rust-lang.org/std/mem/macro.offset_of.html)
- [Rust 标准库：`Layout`](https://doc.rust-lang.org/std/alloc/struct.Layout.html)
- [The Rustonomicon：Alternative representations](https://doc.rust-lang.org/nomicon/other-reprs.html)
- [The Rustonomicon：Data layout](https://doc.rust-lang.org/nomicon/data.html)
- [Rust 语言圣经：Sized 和不定长类型 DST](https://beatai.org/rust-course/advance/into-types/sized)
- [Rust 语言圣经：类型转换与内存布局](https://beatai.org/rust-course/advance/into-types/converse)
- [Rust 语言圣经：Box 内存布局](https://beatai.org/rust-course/advance/smart-pointer/box#box-内存布局)
