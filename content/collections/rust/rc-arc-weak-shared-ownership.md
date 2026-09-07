---
title: Rust Rc、Arc 与 Weak：共享所有权如何决定资源生命周期
date: 2026-09-07
excerpt: 从强弱引用计数出发，分析 Rc 与 Arc 的所有权语义、循环引用、并发边界、唯一性恢复、写时复制、自引用构造和裸指针协议。
chapter: 内存与资源
chapterOrder: 12
---

## 共享所有权仍然需要明确的释放条件

`Box<T>` 把一块分配交给唯一所有者。真实程序中却经常无法指定唯一的长期所有者：

- 一份只读配置被多个组件持有；
- 图中的多个节点指向同一节点；
- 多个异步任务需要访问同一状态；
- 缓存允许观察对象，但不应阻止对象销毁；
- 回调需要引用注册者，又不能形成永久环。

`Rc<T>` 和 `Arc<T>` 用引用计数表达共享所有权。每个强指针都拥有同一个值的一份释放权；最后一个强指针消失时，`T` 被析构。

```rust
use std::rc::Rc;

let first = Rc::new(String::from("shared"));
let second = Rc::clone(&first);

assert_eq!(&*first, "shared");
assert_eq!(&*second, "shared");
assert!(Rc::ptr_eq(&first, &second));
```

`Rc::clone` 不会深拷贝 `String`。它创建另一个指向同一分配的强指针，并增加强引用计数。

共享所有权没有取消 Rust 的释放规则，而是把释放条件从“一个所有者离开作用域”改为“最后一个强所有者离开”。

## 引用计数分配包含值与控制信息

概念上，一份引用计数分配包含：

```text
强引用计数 | 弱引用计数 | T
```

这只是语义模型，不是可以依赖的稳定内存布局。标准库可以使用内部哨兵、隐式弱引用或不同字段排列；程序不应根据猜测偏移读取控制块。

句柄 `Rc<T>` 或 `Arc<T>` 自身仍是固定大小的智能指针。克隆句柄通常不会移动 `T`，但会更新同一控制块中的计数。

两个计数承担不同责任：

- **强引用计数**决定 `T` 是否仍然存活；
- **弱引用计数**决定值销毁后，控制信息是否仍需保留给现存 `Weak<T>`。

最后一个强引用被释放时，`T` 立即析构。若仍有弱引用，分配中用于升级判断的控制信息还需存在；最后一个弱引用也消失后，剩余存储才能回收。

这解释了为什么 `Weak<T>` 可以安全判断目标已经死亡，却不能直接解引用目标。

## Rc 面向单线程共享

`Rc<T>` 的计数更新不使用跨线程原子操作，因此适合单线程内部的共享图、语法树、GUI 状态和局部缓存。

```rust
use std::rc::Rc;

#[derive(Debug)]
struct Schema {
    version: u32,
}

let schema = Rc::new(Schema { version: 3 });
let parser_schema = Rc::clone(&schema);
let renderer_schema = Rc::clone(&schema);

assert_eq!(parser_schema.version, 3);
assert_eq!(renderer_schema.version, 3);
assert_eq!(Rc::strong_count(&schema), 3);
```

`Rc<T>` 明确不实现 `Send` 和 `Sync`。即使 `T` 本身可以跨线程传递，也不能把 `Rc<T>` 发送到另一个线程：两个线程若并发修改非原子计数，会产生数据竞争。

这项限制由类型系统执行，不依赖开发者记住“不要并发 clone”。

## Arc 让计数更新可以跨线程

`Arc<T>` 是原子引用计数指针。它允许不同线程各自持有强指针，并以线程安全的方式增加或减少计数。

```rust
use std::sync::Arc;
use std::thread;

let message = Arc::new(String::from("immutable payload"));

let handles: Vec<_> = (0..4)
    .map(|_| {
        let message = Arc::clone(&message);
        thread::spawn(move || message.len())
    })
    .collect();

for handle in handles {
    assert_eq!(handle.join().unwrap(), 17);
}
```

原子化的是引用计数，不是 `T` 的所有操作。`Arc<T>` 能否实现 `Send` 和 `Sync`，仍取决于 `T` 是否满足相应线程安全约束。

```rust
use std::cell::RefCell;
use std::sync::Arc;

let local_only = Arc::new(RefCell::new(0));

// Arc<RefCell<i32>> 不能安全发送到多个线程；
// Arc 不会把 RefCell 的非线程安全借用计数变成线程安全。
assert_eq!(*local_only.borrow(), 0);
```

需要跨线程修改共享数据时，应显式选择同步策略：

```rust
use std::sync::{Arc, Mutex};
use std::thread;

let total = Arc::new(Mutex::new(0_u64));

let handles: Vec<_> = (0..4)
    .map(|_| {
        let total = Arc::clone(&total);
        thread::spawn(move || {
            let mut guard = total.lock().unwrap();
            *guard += 1;
        })
    })
    .collect();

for handle in handles {
    handle.join().unwrap();
}

assert_eq!(*total.lock().unwrap(), 4);
```

常见组合各自表达不同并发协议：

- `Arc<Mutex<T>>`：同一时刻一个线程修改；
- `Arc<RwLock<T>>`：多个读者或一个写者；
- `Arc<AtomicUsize>`：对单个原子值进行无锁操作；
- `Arc<OnceLock<T>>`：共享一次性初始化结果；
- 只读的 `Arc<T>`：初始化后不再修改。

应从访问模式选择同步原语，而不是把所有共享状态机械地包装成 `Arc<Mutex<_>>`。

## Rc 和 Arc 解决的是所有权，不是可变性

共享指针通常只提供 `&T`。原因不是实现缺少一个 `DerefMut`，而是多个强指针可以同时存在；任意句柄若能直接生成 `&mut T`，就会破坏独占引用规则。

```rust
use std::rc::Rc;

let mut value = Rc::new(String::from("draft"));
let alias = Rc::clone(&value);

// value.push_str("!"); // 不能通过共享 Rc 直接可变访问 String。
assert_eq!(&*alias, "draft");
```

单线程共享可变状态常用 `Rc<RefCell<T>>`：

```rust
use std::cell::RefCell;
use std::rc::Rc;

let names = Rc::new(RefCell::new(vec![String::from("Ada")]));
let editor = Rc::clone(&names);

editor.borrow_mut().push(String::from("Linus"));
assert_eq!(names.borrow().len(), 2);
```

这里的职责分层十分重要：

- `Rc` 管理共享生命周期；
- `RefCell` 在运行时检查借用；
- 违反借用规则会 panic，而不是产生未定义行为。

下一章将专门分析 `Cell<T>`、`RefCell<T>` 与 `UnsafeCell<T>`，因此本章只把它们作为共享所有权的访问策略使用。

## Weak 是不拥有目标的观察指针

从强指针可以创建对应的弱指针：

```rust
use std::rc::Rc;

let strong = Rc::new(String::from("temporary"));
let weak = Rc::downgrade(&strong);

assert_eq!(weak.upgrade().as_deref(), Some("temporary"));

drop(strong);

assert!(weak.upgrade().is_none());
```

`downgrade` 增加弱引用计数，不增加强引用计数。`Weak::upgrade` 返回 `Option<Rc<T>>` 或 `Option<Arc<T>>`：

- `Some` 表示目标仍存活，并获得一个新的强所有者；
- `None` 表示最后一个强所有者已经释放了值。

失败必须进入类型。弱引用的调用者不能假定目标还活着，也不应把 `upgrade().unwrap()` 当作通用写法。

## 强边表达拥有，弱边表达观察

建模对象图时，最重要的问题不是“哪里方便放一个指针”，而是哪条边应当延长目标生命周期。

以树为例：

- 父节点拥有子节点，因此父到子的边使用 `Rc`；
- 子节点只需要寻找父节点，不应让父节点因此永生，因此子到父的边使用 `Weak`。

```rust
use std::cell::RefCell;
use std::rc::{Rc, Weak};

#[derive(Debug)]
struct Node {
    name: String,
    parent: RefCell<Weak<Node>>,
    children: RefCell<Vec<Rc<Node>>>,
}

let root = Rc::new(Node {
    name: String::from("root"),
    parent: RefCell::new(Weak::new()),
    children: RefCell::new(Vec::new()),
});

let leaf = Rc::new(Node {
    name: String::from("leaf"),
    parent: RefCell::new(Rc::downgrade(&root)),
    children: RefCell::new(Vec::new()),
});

root.children.borrow_mut().push(Rc::clone(&leaf));

let parent = leaf.parent.borrow().upgrade().unwrap();
assert_eq!(parent.name, "root");
```

一个实用判断是：删除源对象时，目标对象是否应当仅因这条边继续存活？

- 若应继续存活，这条边通常是强边；
- 若不应继续存活，这条边通常是弱边或临时借用；
- 若答案依赖业务状态，生命周期策略需要成为显式领域规则。

## 强引用环会造成安全的内存泄漏

引用计数只能观察局部入度，不能判断整个对象图是否仍能从程序根节点到达。若两个对象互相持有强指针，它们的强计数永远不会降到零。

```rust
use std::cell::RefCell;
use std::rc::Rc;

#[derive(Debug)]
struct Person {
    partner: RefCell<Option<Rc<Person>>>,
}

let alice = Rc::new(Person {
    partner: RefCell::new(None),
});
let bob = Rc::new(Person {
    partner: RefCell::new(None),
});

*alice.partner.borrow_mut() = Some(Rc::clone(&bob));
*bob.partner.borrow_mut() = Some(Rc::clone(&alice));

drop(alice);
drop(bob);
```

最后两个局部变量消失后，每个 `Person` 仍被另一个对象强持有，两个值都不会析构。

这不会产生悬垂指针或越界访问，因此不破坏内存安全；它破坏的是资源回收。泄漏的内容还可能包含文件句柄、缓存、连接或其他需要及时释放的资源，所以“安全”不等于“可以忽略”。

`Arc` 同样无法自动收集强引用环。原子计数解决线程间计数竞争，不是追踪式垃圾回收器。

## 用 Weak 打断非拥有方向

环本身不是错误；错误在于环上的每条边都宣称拥有目标。将至少一条非拥有边改为 `Weak`，强所有权图就能重新形成可释放结构。

```rust
use std::cell::RefCell;
use std::rc::{Rc, Weak};

#[derive(Debug)]
struct Person {
    partner: RefCell<Weak<Person>>,
}

let alice = Rc::new(Person {
    partner: RefCell::new(Weak::new()),
});
let bob = Rc::new(Person {
    partner: RefCell::new(Weak::new()),
});

*alice.partner.borrow_mut() = Rc::downgrade(&bob);
*bob.partner.borrow_mut() = Rc::downgrade(&alice);

assert!(alice.partner.borrow().upgrade().is_some());
drop(bob);
assert!(alice.partner.borrow().upgrade().is_none());
```

在实际领域中，双方关系未必都是弱边。可以由聚合根强持有成员，成员之间互相弱引用；也可以指定一方拥有关系、另一方观察关系。关键是把生命周期方向写入数据结构。

## Weak 适合缓存、订阅和任务句柄

弱引用不仅用于树的 parent 字段，还适合任何“不应续命”的关系。

缓存可以保存 `Weak<T>`：

```rust
use std::collections::HashMap;
use std::rc::{Rc, Weak};

#[derive(Debug)]
struct Asset {
    bytes: Vec<u8>,
}

#[derive(Default)]
struct Cache {
    entries: HashMap<String, Weak<Asset>>,
}

impl Cache {
    fn get_or_insert_with(
        &mut self,
        key: &str,
        load: impl FnOnce() -> Asset,
    ) -> Rc<Asset> {
        if let Some(asset) = self.entries.get(key).and_then(Weak::upgrade) {
            return asset;
        }

        let asset = Rc::new(load());
        self.entries
            .insert(key.to_owned(), Rc::downgrade(&asset));
        asset
    }
}
```

缓存命中时升级为强引用；所有使用者都释放对象后，缓存不会独自阻止回收。下一次访问发现升级失败，再重新加载并替换条目。

同一模式可用于：

- 事件总线保存订阅者的弱句柄；
- 后台任务观察拥有者是否仍存活；
- intern 表复用仍在使用的对象；
- 父子组件之间的反向链接；
- 避免闭包捕获 `Arc<Self>` 形成永久任务环。

## 闭包捕获是隐蔽的强边

循环引用不只出现在结构体字段中。闭包被对象保存，同时闭包又强捕获对象，也会形成环。

```rust
use std::sync::{Arc, Weak};

struct Worker {
    name: String,
}

impl Worker {
    fn callback(this: &Arc<Self>) -> impl Fn() + Send + Sync + 'static {
        let weak: Weak<Self> = Arc::downgrade(this);

        move || {
            let Some(worker) = weak.upgrade() else {
                return;
            };

            println!("{} is alive", worker.name);
        }
    }
}
```

长生命周期的计时器、任务、回调注册表和 actor mailbox 都应审查捕获列表。`move` 只说明捕获值被移入闭包，不代表捕获关系是弱的；移动一个 `Arc` 会把强所有权一并移入。

## strong_count 和 weak_count 主要用于诊断

标准库暴露计数查询：

```rust
use std::rc::Rc;

let value = Rc::new(5);
let weak = Rc::downgrade(&value);
let clone = Rc::clone(&value);

assert_eq!(Rc::strong_count(&value), 2);
assert_eq!(Rc::weak_count(&value), 1);

drop(clone);
drop(weak);
```

它们适合测试局部生命周期、调试泄漏和讲解模型，不适合成为业务正确性的基础。

对 `Arc` 而言，查询返回后其他线程可能立刻 clone 或 drop；把 `Arc::strong_count(&x) == 1` 当作“现在可以无同步修改”的判断存在竞争。需要唯一访问时，应使用能够原子地维护契约的标准库 API，而不是先看计数再操作。

计数方法暴露的值也不应被解释为控制块内部的完整实现状态。程序只能依赖 API 定义的计数语义。

## get_mut 在真正唯一时恢复可变引用

若当前引用计数指针确实没有其他强指针或弱指针，`get_mut` 可以安全返回 `&mut T`：

```rust
use std::sync::Arc;

let mut config = Arc::new(vec![1, 2]);

Arc::get_mut(&mut config).unwrap().push(3);
assert_eq!(&*config, &[1, 2, 3]);

let _observer = Arc::downgrade(&config);
assert!(Arc::get_mut(&mut config).is_none());
```

`&mut Arc<T>` 只保证这个句柄不能同时被当前代码别名访问，不保证分配没有其他句柄。`get_mut` 还必须检查引用计数状态。

弱指针也会使安全的 `get_mut` 失败，因为已有观察者与该分配的身份相关联。若要在存在共享时修改，需要内部可变性或写时复制，而不是绕过检查。

## make_mut 提供写时复制

当 `T: Clone` 时，`Rc::make_mut` 和 `Arc::make_mut` 可以把“共享读取、偶尔独立修改”表达为 clone-on-write：

```rust
use std::sync::Arc;

let original = Arc::new(vec![1, 2, 3]);
let mut branch = Arc::clone(&original);

Arc::make_mut(&mut branch).push(4);

assert_eq!(&*original, &[1, 2, 3]);
assert_eq!(&*branch, &[1, 2, 3, 4]);
assert!(!Arc::ptr_eq(&original, &branch));
```

若存在其他强引用，`make_mut` 克隆 `T` 到独立分配，再返回可变引用；原来的使用者仍观察旧值。若当前已经唯一，则直接返回原值的可变引用，不发生数据克隆。

还有一个容易忽略的情况：没有其他强引用、但仍有弱引用时，`make_mut` 可以将当前强指针与原弱引用解除关联，而不克隆 `T`；原弱引用随后无法升级。

因此写时复制的语义不是“永远在原对象上修改”，而是“调用者获得一个可独占修改的逻辑值”。依赖分配身份的代码必须区分值相等与指针相同。

## ptr_eq 判断分配身份

普通 `==` 比较的是 `T` 的值语义，`ptr_eq` 判断两个智能指针是否指向同一分配：

```rust
use std::rc::Rc;

let first = Rc::new(String::from("same"));
let alias = Rc::clone(&first);
let equal = Rc::new(String::from("same"));

assert_eq!(first, equal);
assert!(Rc::ptr_eq(&first, &alias));
assert!(!Rc::ptr_eq(&first, &equal));
```

身份比较适合图节点、intern 对象和缓存条目，但不应取代领域中的值相等。若程序频繁依赖堆地址身份，应明确说明地址何时有效、对象销毁后身份如何失效。

## try_unwrap 在只剩一个强所有者时取回 T

`try_unwrap` 消费一个强指针；若它是最后一个强引用，就把 `T` 移出：

```rust
use std::rc::Rc;

let value = Rc::new(String::from("owned again"));
let observer = Rc::downgrade(&value);

let inner = Rc::try_unwrap(value).unwrap();

assert_eq!(inner, "owned again");
assert!(observer.upgrade().is_none());
```

现存弱引用不妨碍成功，因为弱引用不拥有 `T`。取出值后，它们的升级结果变为 `None`。

失败时，`try_unwrap` 用 `Err` 归还传入的强指针：

```rust
use std::sync::Arc;

let first = Arc::new(vec![1, 2, 3]);
let second = Arc::clone(&first);

let first = Arc::try_unwrap(first).unwrap_err();
assert!(Arc::ptr_eq(&first, &second));
```

这允许调用者继续使用原指针或选择其他处理策略。

## Arc::into_inner 提供并发消费保证

`into_inner` 也消费一个引用计数指针，并在能取得值时返回 `Some(T)`。对 `Arc`，它还有一个并发场景中的重要保证：若对同一分配的每个 `Arc` clone 都恰好调用一次 `Arc::into_inner`，其中恰好一个调用会得到值。

不能用 `Arc::try_unwrap(arc).ok()` 替代这项保证。多个线程可能同时发现自己不是最后一个强引用，各自得到 `Err(Arc<T>)`，随后 `.ok()` 丢弃返回的指针；最终值被析构，却没有任何线程取得它。

```rust
use std::sync::Arc;
use std::thread;

let first = Arc::new(String::from("one winner"));
let second = Arc::clone(&first);

let left = thread::spawn(move || Arc::into_inner(first));
let right = thread::spawn(move || Arc::into_inner(second));

let results = [left.join().unwrap(), right.join().unwrap()];
assert_eq!(results.into_iter().flatten().count(), 1);
```

选择 API 时应依赖其完整并发后置条件，而不是根据单线程下看似等价的返回类型自行组合。

## new_cyclic 构造指向自身的弱引用

有些对象需要保存指向自身的句柄，例如把自己注册为回调目标。直接在构造前取得 `Rc<Self>` 不可能，因为 `Self` 尚未创建；保存强自引用又会永久泄漏。

`new_cyclic` 先建立控制块，把一个弱指针交给初始化闭包，再放入闭包返回的值：

```rust
use std::rc::{Rc, Weak};

struct Component {
    name: String,
    self_ref: Weak<Component>,
}

let component = Rc::new_cyclic(|weak| Component {
    name: String::from("editor"),
    self_ref: weak.clone(),
});

let same = component.self_ref.upgrade().unwrap();
assert!(Rc::ptr_eq(&component, &same));
assert_eq!(same.name, "editor");
```

初始化闭包执行时，`T` 还没有放入分配，因此在闭包内部调用 `upgrade` 必须得到 `None`。闭包只能克隆并保存该弱指针，等 `new_cyclic` 返回后再升级。

`Arc::new_cyclic` 提供对应的线程安全计数版本。两者都只解决“构造时获得自弱引用”，不应被用来建立自强引用。

## Rc<dyn Trait> 和 Arc<dyn Trait> 共享动态对象

与 `Box` 一样，引用计数指针支持无尺寸目标和 trait object：

```rust
use std::sync::Arc;

trait Formatter: Send + Sync {
    fn format(&self, input: &str) -> String;
}

struct Uppercase;

impl Formatter for Uppercase {
    fn format(&self, input: &str) -> String {
        input.to_uppercase()
    }
}

let formatter: Arc<dyn Formatter> = Arc::new(Uppercase);
let another = Arc::clone(&formatter);

assert_eq!(another.format("rust"), "RUST");
```

`Arc<dyn Formatter>` 的句柄需要携带数据指针和虚表元数据。`Arc::clone` 共享同一个具体对象和控制块，不会复制对象。

`dyn Formatter + Send + Sync` 中的线程安全边界必须体现在 trait object 类型上。仅仅把 `Rc<dyn Trait>` 替换为 `Arc<dyn Trait>`，不能自动证明被擦除的具体类型可跨线程共享。

## 裸指针转换会把计数责任交给调用者

`Rc::into_raw` 和 `Arc::into_raw` 可以消费强指针并返回指向 `T` 的裸指针。对应的 `from_raw` 恢复那一份强所有权：

```rust
use std::sync::Arc;

let value = Arc::new(String::from("ffi payload"));
let raw = Arc::into_raw(value);

unsafe {
    assert_eq!(&*raw, "ffi payload");

    let value = Arc::from_raw(raw);
    assert_eq!(&*value, "ffi payload");
}
```

进入这个协议后必须保持以下不变量：

1. 指针确实来自兼容类型和 allocator 的 `into_raw`；
2. `from_raw` 恰好接回对应的一份强引用；
3. 不能从同一份原始所有权恢复两次；
4. DST 指针的元数据不能丢失或伪造；
5. 外部代码持有期间，目标不会因计数错误提前析构；
6. 跨线程使用还必须满足 `T` 的 `Send`/`Sync` 契约。

标准库还提供手动增加和减少强计数的 unsafe API，主要服务于 FFI 等低层协议。它们不是普通共享代码的性能捷径：任何不平衡、错指针或重复归还都可能造成泄漏、重复析构或释放后使用。

## 引用计数不是借用的替代品

如果生命周期关系完全是词法化的，借用通常比引用计数更直接：

```rust
fn longest_name<'a>(items: &'a [String]) -> Option<&'a str> {
    items.iter().max_by_key(|item| item.len()).map(String::as_str)
}
```

这里返回引用即可表达结果依赖输入，没有必要分配 `Rc<String>`。

适合引用计数的信号包括：

- 所有者数量在运行时变化；
- 持有者生命周期彼此交错，难以指定单一根所有者；
- 值需要被存入多个长期存在的结构；
- 跨线程任务各自需要独立拥有句柄；
- 弱观察关系属于领域模型的一部分。

不适合的信号包括：

- 只是为了绕过一个可以通过重构作用域解决的借用错误；
- 数据本可由上层拥有，下层只需短暂借用；
- 热循环中大量 clone/drop 造成可见计数开销；
- 图实际需要追踪式垃圾回收或 arena 批量释放；
- 生命周期由 ID、索引或句柄表表达更清晰。

## Rc、Arc 与其他拥有方式的选择

| 需求 | 常见表示 | 核心语义 |
|---|---|---|
| 唯一拥有动态对象 | `Box<T>` | 最后且唯一的所有者释放 |
| 单线程共享只读对象 | `Rc<T>` | 非原子强引用计数 |
| 单线程共享可变对象 | `Rc<RefCell<T>>` | 共享生命周期加运行时借用检查 |
| 跨线程共享只读对象 | `Arc<T>` | 原子强引用计数 |
| 跨线程互斥修改 | `Arc<Mutex<T>>` | 共享生命周期加互斥协议 |
| 跨线程读多写少 | `Arc<RwLock<T>>` | 共享生命周期加读写锁 |
| 不延长生命周期的观察 | `Weak<T>` | 可失败的升级 |
| 稳定索引与批量释放 | arena + ID | 容器拥有，对象用非拥有标识 |

表中的组合不是固定配方。例如消息传递能转移所有权时，channel 可能比共享锁更清晰；不可变快照频繁读取、偶尔更新时，`Arc::make_mut` 或整体替换可能比细粒度锁更合适。

## 引用计数的成本来自多个层次

`Rc::clone` 和 `Arc::clone` 都是常数复杂度，但常数复杂度不等于免费。

主要成本包括：

1. 控制块和 `T` 通常需要动态分配；
2. 访问 `T` 多一层间接寻址；
3. clone 和 drop 都要更新计数；
4. `Arc` 的计数更新需要原子操作；
5. 多核频繁修改同一计数缓存行可能产生竞争；
6. 最后一个强引用承担 `T` 的析构成本；
7. `Weak::upgrade` 必须检查生命周期并尝试获得强引用；
8. `Rc<RefCell<T>>`、`Arc<Mutex<T>>` 等组合还叠加各自的运行时协议。

性能判断需要结合共享粒度：让每个小节点各自拥有一个 `Arc`，与让整棵不可变树共享一个 `Arc`，计数流量和局部性完全不同。

减少无意义 clone 的方法包括：

- 能借用时传 `&T` 或 `&Arc<T>`；
- 需要长期持有时才 clone；
- 在 API 中明确参数是借用还是取得共享所有权；
- 将多个相关小值聚合到一次共享分配；
- 对读多写少数据使用不可变快照；
- 用基准测试确认计数或锁确实是瓶颈。

## Clone 参数应表达所有权意图

接受 `Arc<T>` 表示函数会消费或长期保存一份共享所有权；接受 `&Arc<T>` 通常表示函数需要访问智能指针本身，例如创建 `Weak` 或 clone 后保存；只需要读取值时，接受 `&T` 最宽松。

```rust
use std::sync::{Arc, Weak};

struct Registry<T> {
    observers: Vec<Weak<T>>,
}

impl<T> Registry<T> {
    fn register(&mut self, value: &Arc<T>) {
        self.observers.push(Arc::downgrade(value));
    }
}

fn inspect(value: &str) -> usize {
    value.len()
}
```

调用者可以把 `&Arc<String>` 通过解引用强制转换传给 `inspect`，而 `inspect` 不必知道数据是否由 Arc 管理。把智能指针类型扩散到所有 API 会让实现细节成为不必要的接口约束。

## 析构发生在哪个线程

`Arc<T>` 的最后一个强引用可能在任意持有者线程中被 drop，因此 `T::drop` 也在那个线程执行。

这对资源设计有实际影响：

- 大对象的析构可能造成不可预测的尾延迟；
- 某些外部资源要求在指定线程释放；
- 析构若获取锁，必须分析锁顺序；
- 实时线程不应意外承担庞大对象图的递归清理；
- 不能假设创建者线程负责最终释放。

若释放线程有约束，应建立显式回收协议，例如把资源句柄发送回专用线程，而不是只依赖最后一个 `Arc` 自然离开作用域。

## panic 不会自动修复所有权环

正常栈展开会 drop 已初始化的局部值，使相应计数减少；但强引用环仍保持正计数。`Mutex` 可能因持锁线程 panic 而进入 poisoning 状态，这与 `Arc` 的计数安全是两个不同问题。

因此异常路径需要分别检查：

- clone 后是否在所有返回路径上自然 drop；
- 注册回调失败时是否移除已建立的强边；
- 后台任务 panic 后是否仍有句柄被永久保存；
- 锁 poisoning 的恢复策略是什么；
- 环是否依赖一段可能永远不执行的手工断开代码。

若正确释放依赖调用者记得手动清空某个强字段，数据结构本身通常没有完整表达所有权方向。

## 从引用计数代码恢复所有权图

审查一段 `Rc` 或 `Arc` 代码时，可以按以下顺序建立模型：

1. 哪个分配保存 `T` 与计数控制信息？
2. 每个 clone 创建了新的强边还是复制了 `T`？
3. 哪些字段、闭包和任务长期持有强指针？
4. 哪些关系只是观察，却错误地使用了强指针？
5. 最后一个强引用理论上在哪条控制流中释放？
6. 是否存在仅由强边组成的闭环？
7. `Weak::upgrade` 失败是否被作为正常状态处理？
8. 可变性由唯一性、`RefCell`、锁、原子值还是写时复制提供？
9. `Arc<T>` 中的 `T` 是否真的满足跨线程访问协议？
10. 计数查询是否被错误地用作并发判断？
11. `get_mut`、`make_mut` 或 `try_unwrap` 是否改变分配身份？
12. 裸指针往返是否保持每一份强计数的平衡？
13. 最后析构可能在哪个线程发生？
14. 性能成本来自分配、计数、缓存竞争还是同步原语？

将程序画成强边和弱边组成的有向图，通常比只跟踪变量名更容易发现泄漏与生命周期错误。

## 工程中的共享所有权检查

引入引用计数前，可以逐项检查：

1. 是否确实存在多个长期所有者，而不只是多个短期借用者？
2. 单线程场景是否误用了 `Arc`？
3. 跨线程场景是否误用了 `Rc`？
4. 是否错误地认为 `Arc` 自动提供内部可变性？
5. `Arc<T>` 的 `T` 是否满足所需 `Send`/`Sync` 边界？
6. 可变访问需要 `RefCell`、`Mutex`、`RwLock`、原子值还是整体替换？
7. 每一条反向边是否真的拥有目标？
8. 闭包和异步任务是否隐式捕获了强指针？
9. 所有强引用环是否都有明确的弱边？
10. `Weak::upgrade` 失败是否有领域语义？
11. 缓存是否应当只持有弱引用？
12. `strong_count` 是否只用于诊断，而非并发正确性？
13. `get_mut` 失败时是否错误地诉诸 unsafe？
14. `make_mut` 引起的身份变化是否可接受？
15. `try_unwrap` 失败后是否正确处理返回的原指针？
16. 并发消费是否需要 `Arc::into_inner` 的唯一成功保证？
17. `new_cyclic` 闭包内是否错误地尝试升级弱引用？
18. trait object 是否携带正确的 `Send + Sync` 约束？
19. `into_raw` 与 `from_raw` 是否严格一一对应？
20. 最后一个强引用的析构线程和延迟是否可接受？
21. 高频 clone/drop 是否造成原子计数缓存竞争？
22. arena、ID、消息传递或借用是否能更直接表达模型？

引用计数最适合表达“多个参与者共同决定对象何时死亡”。如果真正的问题是访问同步、对象查找或批量生命周期，应分别选择对应机制。

## 本章建立的共享所有权模型

`Rc<T>`、`Arc<T>` 与 `Weak<T>` 可以归纳为以下关系：

1. 强指针共同拥有 T，最后一个强指针释放时析构 T；
2. 弱指针不延长 T 的生命周期，只保留可判断目标是否存活的控制关系；
3. `Rc` 使用单线程引用计数，因此明确不实现 `Send` 和 `Sync`；
4. `Arc` 原子化计数更新，但不会自动让 T 的内部访问线程安全；
5. 共享所有权通常只提供 `&T`，可变性必须由唯一性或显式内部可变性协议提供；
6. `Weak::upgrade` 把目标可能已销毁写入 `Option`，失败是正常生命周期状态；
7. 对象图中的强边表达拥有，弱边表达不续命的观察；
8. 全强边循环不会造成内存不安全，却会让引用计数永远无法归零；
9. 缓存、订阅、反向链接和长生命周期闭包通常需要审查是否应使用 Weak；
10. `get_mut` 在真正无其他强弱指针时恢复独占访问；
11. `make_mut` 以写时复制或解除弱关联的方式建立独占修改条件；
12. `try_unwrap` 可在只剩一个强引用时取出 T，即使仍有弱引用；
13. `Arc::into_inner` 为所有 clone 的并发消费提供恰好一个成功者的保证；
14. `new_cyclic` 只允许在构造中保存自弱引用，闭包执行期间还不能升级；
15. `ptr_eq` 比较分配身份，普通相等比较 T 的值语义；
16. 裸指针转换把引用计数平衡责任移出类型系统，必须恰好恢复对应所有权；
17. 引用计数的成本来自分配、间接访问、计数更新、缓存竞争和组合的同步协议；
18. 最后一个 `Arc` 可以在任意持有线程析构 T，资源释放线程需要显式设计。

下一章将进入 `Cell<T>`、`RefCell<T>` 与 `UnsafeCell<T>`，分析为何共享引用默认禁止修改、内部可变性如何把部分借用证明移到运行时，以及所有安全内部可变性抽象最终必须围绕哪些底层不变量建立。

## 延伸阅读

- [Rust 标准库：`Rc<T>`](https://doc.rust-lang.org/std/rc/struct.Rc.html)
- [Rust 标准库：`std::rc::Weak<T>`](https://doc.rust-lang.org/std/rc/struct.Weak.html)
- [Rust 标准库：`Arc<T>`](https://doc.rust-lang.org/std/sync/struct.Arc.html)
- [Rust 标准库：`std::sync::Weak<T>`](https://doc.rust-lang.org/std/sync/struct.Weak.html)
- [Rust 标准库：`Rc::make_mut`](https://doc.rust-lang.org/std/rc/struct.Rc.html#method.make_mut)
- [Rust 标准库：`Arc::into_inner`](https://doc.rust-lang.org/std/sync/struct.Arc.html#method.into_inner)
- [Rust 标准库：`Rc::new_cyclic`](https://doc.rust-lang.org/std/rc/struct.Rc.html#method.new_cyclic)
- [Rust 标准库：`RefCell<T>`](https://doc.rust-lang.org/std/cell/struct.RefCell.html)
- [Rust 语言圣经：`Rc` 与 `Arc`](https://beatai.org/rust-course/advance/smart-pointer/rc-arc)
- [Rust 语言圣经：循环引用与自引用](https://beatai.org/rust-course/advance/circle-self-ref/circle-reference)
