---
title: Rust 借用与重借用：共享、独占与访问权转移
date: 2026-09-02
excerpt: 从 borrowed place、别名约束与非词法生命周期出发，分析共享借用、独占借用、重借用、字段拆分和两阶段借用。
chapter: 类型系统
chapterOrder: 3
---

## 借用转移访问权，而不转移所有权

按值传递 `T` 会转移所有权；借用则从一个 place 临时创建引用，并在引用有效期间限制原 place 的使用方式。

```rust
fn length(text: &String) -> usize {
    text.len()
}

fn append_period(text: &mut String) {
    text.push('.');
}

fn main() {
    let mut text = String::from("borrow");

    let len = length(&text);
    append_period(&mut text);

    assert_eq!(len, 6);
    assert_eq!(text, "borrow.");
}
```

`length` 获得共享引用 `&String`，只能观察字符串；`append_period` 获得独占引用 `&mut String`，可以修改字符串。两次调用结束后，`text` 仍由 `main` 中的局部变量拥有，最终也由它负责析构。

引用不是“没有所有权的普通指针”。创建引用会让被引用的位置进入 borrowed state；编译器根据引用可能被继续使用的范围，禁止与其能力冲突的访问。

## 两类安全引用表达两种访问契约

安全 Rust 的引用分为共享引用和独占引用：

| 类型 | 可以复制引用 | 可以读取目标 | 可以直接修改目标 | 同期别名 |
|---|---:|---:|---:|---|
| `&T` | 是 | 是 | 否 | 可以有多个共享引用 |
| `&mut T` | 否 | 是 | 是 | 不能存在其他可用引用 |

常见的简写是：

> 任意时刻，可以存在多个共享引用，或者一个独占引用，但不能同时存在。

更准确的描述是访问权约束：共享引用存活期间，目标只能通过共享方式访问；独占引用存活期间，目标必须由该引用排他访问。

```rust
let mut value = 10;

let left = &value;
let right = &value;
assert_eq!(*left + *right, 20);

let unique = &mut value;
*unique += 1;
assert_eq!(*unique, 11);
```

共享引用实现 `Copy`，复制 `&T` 只是增加一个共享访问入口。独占引用没有实现 `Copy`；如果可以复制 `&mut T`，同一位置就会出现两个自称独占的安全访问入口。

“共享”也比“不可变”更准确。`&T` 禁止通过普通字段访问直接修改目标，但 `T` 可能包含内部可变性：

```rust
use std::cell::Cell;

let counter = Cell::new(0);
let first = &counter;
let second = &counter;

first.set(first.get() + 1);
second.set(second.get() + 1);

assert_eq!(counter.get(), 2);
```

`Cell<T>`、`RefCell<T>`、`Mutex<T>` 和原子类型都能通过共享引用提供受控修改。它们没有绕过 Rust 的规则，而是把独占性放到复制进出、运行时检查、锁或原子指令中实现。所有安全内部可变性最终都建立在 `UnsafeCell<T>` 允许的底层语义上。

## 借用操作作用于 place

对 place expression 使用 `&` 或 `&mut` 会产生指向该位置的引用。局部变量、字段、数组元素、索引结果和解引用结果都可以是 place。

```rust
struct Point {
    x: i32,
    y: i32,
}

let mut point = Point { x: 1, y: 2 };

let x = &point.x;
assert_eq!(*x, 1);

let y = &mut point.y;
*y += 10;
assert_eq!(point.y, 12);
```

借用 value expression 时，编译器会先创建临时值，再引用该临时值：

```rust
let answer = &String::from("temporary");
assert_eq!(answer.len(), 9);
```

临时值在这里会被延长到局部绑定所需的作用域。临时生命周期延长只适用于规定的语法形式，不能理解成“只要引用了临时值，编译器就总会让它活得足够久”。复杂表达式中的临时值释放时机需要按 Reference 的 temporary scope 规则判断。

## 借用持续到引用的最后一次相关使用

早期借用检查器常把借用近似持续到整个词法作用域结束。现代 Rust 使用非词法生命周期（non-lexical lifetimes，NLL），借用通常可以在引用最后一次使用后结束。

```rust
let mut values = vec![1, 2, 3];

let first = &values[0];
println!("{first}"); // first 的最后一次使用

values.push(4);      // 可以取得 values 的独占访问
```

变量 `first` 的名字仍在作用域中，但其借用不必持续到右花括号。编译器依据控制流上的使用情况推导借用区域，而不是只看变量声明与作用域末尾。

```rust
let mut text = String::from("rust");
let view = &text;

if view.is_empty() {
    println!("empty");
}

text.push('!');
```

借用何时结束取决于所有可能控制流。如果某条后续路径仍可能使用 `view`，相冲突的修改就不能提前发生。

```rust
let mut text = String::from("rust");
let view = &text;

// text.push('!');
// println!("{view}");
```

这段代码中的修改不能放在 `println!` 前，因为 `view` 随后仍被使用。NLL 缩短的是实际不再需要的借用，不会放松别名规则。

## `&mut` 的绑定可变性与目标可变性不同

`&mut T` 中的 `mut` 描述引用指向的目标可被修改；`let mut binding` 描述绑定本身可被重新赋值。这是两套独立属性。

```rust
let mut value = 1;

let reference = &mut value;
*reference += 1; // binding 不需要是 mut，目标仍可修改
```

如果需要让引用变量改为指向另一个位置，绑定才需要 `mut`：

```rust
let mut left = 1;
let mut right = 2;

let mut current = &mut left;
*current += 10;

current = &mut right;
*current += 20;

assert_eq!(left, 11);
assert_eq!(right, 22);
```

同理，拥有一个值的绑定是否可变，也决定能否从它创建独占借用：

```rust
let text = String::from("fixed");
// let reference = &mut text; // 不能独占可变地借用不可变绑定
```

## 重借用暂时缩短并转交访问权

重借用（reborrow）是从已有引用再次创建引用。它不访问原所有者的变量，而是通过现有引用取得一个更短的访问窗口。

```rust
fn add_one(value: &mut i32) {
    *value += 1;
}

let mut number = 0;
let original = &mut number;

let temporary = &mut *original;
add_one(temporary);

add_one(original);
assert_eq!(*original, 2);
```

`&mut *original` 从 `original` 重借用目标。`temporary` 有效期间，不能使用 `original`，因为独占访问权已经暂时交给重借用；`temporary` 最后一次使用后，`original` 恢复可用。

```rust
let mut number = 1;
let original = &mut number;
let temporary = &mut *original;

// *original += 1; // 冲突：temporary 仍持有独占重借用
*temporary += 1;
*original += 1;    // temporary 不再使用后恢复
```

重借用不是复制 `&mut T`。新的引用受到原引用有效期的约束，而且在新的独占借用期间会冻结旧的访问路径。

### 从独占引用创建共享重借用

独占访问权也可以暂时降级成共享访问：

```rust
let mut text = String::from("rust");
let unique = &mut text;

let shared = &*unique;
println!("{shared}");

unique.push('!');
```

`shared` 有效期间不能通过 `unique` 修改字符串；共享重借用结束后，独占引用重新可用。这种降级不会永久改变 `unique` 的类型。

### 函数调用经常隐式创建重借用

把 `&mut T` 传给明确接收 `&mut T` 的函数时，编译器通常创建一个临时重借用，因此同一个独占引用可以连续传入多次：

```rust
fn clear(text: &mut String) {
    text.clear();
}

let mut text = String::from("first");
let reference = &mut text;

clear(reference);
reference.push_str("second");
clear(reference);
```

这不能推广成“`&mut T` 传参不会移动”。在没有明确重借用上下文时，独占引用仍然是非 `Copy` 值，按值使用可能发生移动：

```rust
fn identity<T>(value: T) -> T {
    value
}

let mut number = 1;
let first = &mut number;
let second = identity(first);

// *first += 1; // first 已移动
*second += 1;
```

显式写出 `&mut *first` 可以在需要时明确要求重借用：

```rust
let second = identity(&mut *first);
```

## 自动解引用与方法调用隐藏了借用细节

方法调用会根据接收者类型执行自动引用和自动解引用。`String::len` 接收 `&self`，`String::push_str` 接收 `&mut self`：

```rust
let mut text = String::from("rust");

let len = text.len();   // 共享借用
text.push_str(" lang"); // 独占借用

assert_eq!(len, 4);
```

这两行分别近似表达 `String::len(&text)` 和 `String::push_str(&mut text, " lang")`。方法语法很简洁，但借用冲突仍由实际的接收者能力决定。

多层智能指针还可能经过 `Deref` 或 `DerefMut`：

```rust
let mut boxed = Box::new(String::from("box"));
boxed.push('!');
```

这里的方法查找会沿解引用链找到 `String` 的方法，并为调用建立所需的独占借用。自动解引用不会转移被指向的 `String`，也不会绕过借用规则。

## 两阶段借用允许部分“先读后改”的调用

以下代码能够通过编译：

```rust
let mut values = vec![10, 20];
values.push(values.len());
```

方法接收者需要独占借用 `values`，参数 `values.len()` 又需要共享借用同一个值。编译器对某些隐式创建的独占借用使用两阶段借用（two-phase borrow）：

1. 先保留未来的独占借用；
2. 计算其他参数，此时允许兼容的共享访问；
3. 真正调用方法时激活独占借用。

它不是对所有表达式都生效的通用求值顺序规则。显式创建的独占引用通常不会获得同样待遇：

```rust
let mut values = vec![10, 20];
let reference = &mut values;

// reference.push(values.len());
// values 已经被 reference 独占借用
```

遇到复杂调用时，把只读计算提前到局部变量通常最清晰：

```rust
let next = values.len();
values.push(next);
```

## 编译器可以证明结构体字段互不重叠

结构体字段具有静态偏移，借用检查器能够证明不同字段是互不重叠的 place，因此可以同时独占借用：

```rust
struct Pair {
    left: i32,
    right: i32,
}

let mut pair = Pair { left: 1, right: 2 };

let left = &mut pair.left;
let right = &mut pair.right;

*left += 10;
*right += 20;

assert_eq!(pair.left, 11);
assert_eq!(pair.right, 22);
```

解构可以一次表达这种拆分：

```rust
let Pair { left, right } = &mut pair;
*left += 1;
*right += 1;
```

数组和切片索引则更困难。即使两个索引在运行时不同，普通索引语法也不足以向借用检查器证明它们不重叠：

```rust
let mut values = [1, 2, 3, 4];

// let first = &mut values[0];
// let second = &mut values[1]; // 与第一次借用冲突
```

标准库用 `split_at_mut` 把一个切片拆成两个不重叠的独占切片：

```rust
let mut values = [1, 2, 3, 4];
let (left, right) = values.split_at_mut(2);

let first = &mut left[0];
let third = &mut right[0];

*first += 10;
*third += 30;

assert_eq!(values, [11, 2, 33, 4]);
```

`split_at_mut` 的安全接口承诺两段范围不相交；其实现使用 unsafe 代码从原始指针构造两个切片，并负责证明边界与不重叠条件。`iter_mut` 也以安全接口连续产生互不重叠的 `&mut T`，底层容器实现承担相同的证明责任。

## 不能通过引用直接移出非 `Copy` 值

引用只提供临时访问权，不拥有目标，因此不能通过解引用把非 `Copy` 值直接移动出来：

```rust
fn take_name(name: &mut String) -> String {
    // *name // 不能移出借用的内容
    std::mem::take(name)
}

let mut name = String::from("Ferris");
let owned = take_name(&mut name);

assert_eq!(owned, "Ferris");
assert!(name.is_empty());
```

`mem::take` 用 `T::default()` 替换原值，再返回旧值；`mem::replace` 接受显式替代值。目标位置始终保持已初始化，所有者之后仍能安全析构它。

```rust
fn replace_name(name: &mut String) -> String {
    std::mem::replace(name, String::from("replacement"))
}
```

如果目标类型实现 `Copy`，`*reference` 出现在值上下文时会复制，而不是移动：

```rust
let value = 42_u64;
let reference = &value;
let copied = *reference;

assert_eq!(value, copied);
```

## `&str` 与 `&[T]` 表达借用视图

只读函数通常应接收切片，而不是借用具体拥有型容器：

```rust
fn word_count(text: &str) -> usize {
    text.split_whitespace().count()
}

fn sum(values: &[i32]) -> i32 {
    values.iter().sum()
}
```

`&str` 可以引用 `String` 的全部内容、字符串字面量或字符串的一部分；`&[T]` 可以引用数组、`Vec<T>` 或连续子区间。它们把接口需要的能力缩小为“借用一段连续数据”。

```rust
let owned = String::from("borrowed view");
let literal = "static view";

assert_eq!(word_count(&owned), 2);
assert_eq!(word_count(literal), 2);

let vector = vec![1, 2, 3];
let array = [4, 5, 6];

assert_eq!(sum(&vector), 6);
assert_eq!(sum(&array[1..]), 11);
```

接收 `&String` 或 `&Vec<T>` 并非错误；当函数确实需要这些具体类型独有的操作时，这样的签名是合理的。只使用文本或元素视图时，切片接口能接受更多来源，也更准确地表达能力边界。

## 内部可变性把检查移动到合适的层级

静态独占关系无法表达所有程序结构。例如图结构、回调注册和共享缓存可能需要多个所有者共同访问同一对象。内部可变性类型提供不同的检查策略。

```rust
use std::cell::RefCell;

let values = RefCell::new(vec![1, 2, 3]);

{
    let read = values.borrow();
    assert_eq!(read.len(), 3);
}

values.borrow_mut().push(4);
```

`RefCell<T>` 在运行时维护借用状态：多个 `Ref<T>` 或一个 `RefMut<T>`。违反规则不会产生未定义行为，而会 panic；`try_borrow` 和 `try_borrow_mut` 可以把冲突表示成 `Result`。

多线程代码常用 `Mutex<T>` 或 `RwLock<T>` 在运行时协调访问：锁守卫的 `Deref`/`DerefMut` 实现把锁的持有期与借用访问绑定起来。原子类型则为特定整数或布尔操作提供无需独占引用的并发修改能力。

选择内部可变性并不是取消别名约束，而是明确由哪种机制维护约束：

| 类型 | 适用范围 | 冲突处理 |
|---|---|---|
| `Cell<T>` | 单线程、小型可复制值或整体替换 | 通过复制或替换避免暴露内部引用 |
| `RefCell<T>` | 单线程、动态借用关系 | 运行时借用计数，冲突时 panic 或返回错误 |
| `Mutex<T>` | 多线程、独占访问 | 阻塞或返回获取失败 |
| `RwLock<T>` | 多线程、多读单写 | 读写锁协调 |
| 原子类型 | 多线程、有限的原子操作 | 由内存顺序和原子指令约束 |

## 常见借用冲突的结构化改写

借用错误通常表示一个操作同时要求了不兼容的访问能力。修复方向不是机械增加 `.clone()`，而是缩短借用、拆分 place 或调整接口。

### 先完成读取，再执行修改

```rust
let mut values = vec![10, 20, 30];

let last = values.len() - 1;
values[last] = 99;
```

把索引计算放到独占索引操作之前，使只读访问和写访问顺序明确。

### 返回索引或拥有值，避免长期持有容器借用

```rust
fn find_index(values: &[String], target: &str) -> Option<usize> {
    values.iter().position(|value| value == target)
}

let mut values = vec![String::from("a"), String::from("b")];

if let Some(index) = find_index(&values, "a") {
    values[index].push('!');
}
```

索引本身不借用容器。查找阶段结束后，可以重新取得独占访问。

### 拆分结构，而不是借用整个 `self`

```rust
struct State {
    input: Vec<i32>,
    output: Vec<i32>,
}

impl State {
    fn process(&mut self) {
        let input = &self.input;
        let output = &mut self.output;

        output.extend(input.iter().map(|value| value * 2));
    }
}
```

字段级借用让编译器看到读取 `input` 与修改 `output` 不重叠。把辅助方法设计为接收实际需要的字段引用，也常比让它接收整个 `&mut self` 更容易组合。

### 用所有权转换结束借用关系

当结果必须脱离源对象长期保存时，可以返回拥有型数据：

```rust
fn normalized_name(name: &str) -> String {
    name.trim().to_lowercase()
}
```

这里的分配不是借用检查器的妥协，而是接口语义：返回值需要独立于输入存活。相反，如果结果只是输入的一段视图，返回 `&str` 能避免复制，但会建立输出依赖输入的生命周期关系。

## 借用规则维护的核心不变量

共享借用、独占借用和重借用共同维护以下不变量：

1. 引用指向的值在引用有效期间保持已初始化且可访问；
2. 共享访问期间不存在未经内部可变性协调的写入；
3. 独占访问期间不存在其他可用的访问路径；
4. 重借用不能比它所依赖的原引用活得更久；
5. 安全接口产生多个独占引用时，必须保证它们指向不重叠的位置。

NLL、自动引用、自动解引用和两阶段借用改善了表达能力，但没有改变这些不变量。它们让编译器更精确地识别访问何时开始、何时真正激活以及何时不再需要。

下一章将进入生命周期系统，分析引用有效期之间如何形成约束，并进一步讨论生命周期省略、子类型、型变和高阶生命周期边界。

## 延伸阅读

- [The Rust Reference：Borrow operators](https://doc.rust-lang.org/reference/expressions/operator-expr.html#borrow-operators)
- [The Rust Reference：Method call expressions](https://doc.rust-lang.org/reference/expressions/method-call-expr.html)
- [The Rust Reference：Temporaries](https://doc.rust-lang.org/reference/expressions.html#temporaries)
- [The Rustonomicon：Splitting Borrows](https://doc.rust-lang.org/nomicon/borrow-splitting.html)
- [The Rustonomicon：Aliasing](https://doc.rust-lang.org/nomicon/aliasing.html)
- [std::cell](https://doc.rust-lang.org/std/cell/)
- [std::mem::take](https://doc.rust-lang.org/std/mem/fn.take.html)
- [std::primitive::slice::split_at_mut](https://doc.rust-lang.org/std/primitive.slice.html#method.split_at_mut)
