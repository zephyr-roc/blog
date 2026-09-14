---
title: OCaml 类型系统：推导、多态与代数数据类型
date: 2026-09-14
excerpt: 从约束生成与统一理解 OCaml 如何推导最一般类型，再进入 let 多态、value restriction、record、variant、递归类型与穷尽模式匹配。
chapter: 语言与思维
chapterOrder: 2
---

第一章[《OCaml：从“组织对象”转向“描述变换”》](/collections/ocaml/thinking-in-ocaml)建立了一个总体印象：OCaml 倾向于先描述数据的形状，再用函数表达形状之间的变换。

这一章继续追问两个更具体的问题：

1. 没有写参数类型时，编译器凭什么知道程序是安全的？
2. 为什么 variant 与模式匹配不只是更短的 sealed class，而是一套完整的建模方法？

答案分别是**类型约束的统一**与**代数数据类型**。二者结合后，OCaml 可以从很少的显式标注中推导出精确接口，并检查每一种数据形状是否都被处理。

## 类型推导不是猜测

先看一个没有任何类型标注的函数：

```ocaml
let add_one value =
  value + 1
```

编译器看到 `+` 时，就知道两侧操作数和结果都是 `int`。于是 `value` 必须是 `int`，整个函数的类型为：

```text
val add_one : int -> int
```

再看一个没有使用任何具体操作的函数：

```ocaml
let identity value =
  value
```

输入被原样返回，编译器没有理由把它限制成某个具体类型，因此得到：

```text
val identity : 'a -> 'a
```

`'a` 是类型变量。它不是 `Any`，也不是运行时才知道的动态类型，而是表示输入与输出必须为**同一个任意类型**。

```ocaml
let number = identity 42
let text = identity "OCaml"
```

两次调用分别把 `'a` 实例化为 `int` 和 `string`，但 `identity` 的实现仍只有一份。

### 推导的核心：生成约束，再统一类型

考虑下面的函数：

```ocaml
let apply_twice f value =
  f (f value)
```

可以暂时给未知部分起名字：

- `value` 的类型是 `'a`；
- 内层 `f value` 要成立，所以 `f` 必须接收 `'a`；
- 假设内层调用返回 `'b`，那么 `f : 'a -> 'b`；
- 外层再次把 `f` 用在 `'b` 上，所以 `f` 又必须接收 `'b`；
- 同一个 `f` 不能同时拥有互不相关的参数类型，因此统一得到 `'a = 'b`。

最终类型是：

```text
val apply_twice : ('a -> 'a) -> 'a -> 'a
```

这个过程称为 unification：编译器不断收集“两个类型必须相同”的约束，再求出满足全部约束的最一般解。

如果约束无法统一，程序就无法通过编译：

```ocaml
let broken value =
  value + String.length value
```

`+` 要求 `value : int`，`String.length` 又要求 `value : string`。不存在既是 `int` 又是 `string` 的类型，因此错误来自矛盾的约束，而不是编译器“没猜对”。

## 最一般类型：不要过早承诺

OCaml 推导的目标通常是 principal type，也就是满足实现的最一般类型。

```ocaml
let first left _right =
  left
```

它的类型不是 `int -> int -> int`，也不是 `string -> string -> string`，而是：

```text
val first : 'a -> 'b -> 'a
```

两个参数之间没有类型关系，第二个参数也不影响结果，所以使用两个不同的类型变量才是最精确的描述：

```ocaml
let number = first 42 "ignored"
let text = first "OCaml" true
```

“最一般”并不等于模糊。恰恰相反，它精确表达了实现**没有依赖哪些能力**。如果一个函数的类型是 `'a -> 'a`，它既无法把输入当成整数相加，也无法读取某个对象字段；在不使用副作用或危险逃逸的前提下，它能做的事情非常有限。

Kotlin 中对应的函数需要显式声明泛型：

```kotlin
fun <A, B> first(left: A, right: B): A = left
```

Kotlin 的局部变量与返回值推导同样强大，但函数参数和类型参数承担 API 文档的职责，因此要求显式书写。OCaml 则可以直接从实现产生多态接口，并通过 `.mli` 签名文件决定最终对外暴露多少。

## let 多态：同一个绑定可以多次实例化

`identity` 能先处理整数、再处理字符串，是因为 `let` 绑定会在满足条件时被泛化：

```ocaml
let identity value = value

let answer = identity 42
let language = identity "OCaml"
```

可以把 `identity` 理解为拥有 `forall 'a. 'a -> 'a`，虽然普通 OCaml 源码不会这样书写全称量词。每次使用时，编译器为类型变量创建新的实例。

但函数参数不会自动获得同样的 let 多态：

```ocaml
let use_twice f =
  let number = f 42 in
  let text = f "OCaml" in
  number, text
```

这里 `f` 是 lambda-bound 参数。在同一次调用中，它首先被约束为接收 `int`，随后又被要求接收 `string`，因而无法通过类型检查。

这点很重要：OCaml 的经典 Hindley–Milner 核心提供的是 **let-polymorphism**，并不是任意位置都可以隐式拥有高阶多态。若确实需要“接收一个本身对所有类型都成立的函数”，就要使用 record 字段上的显式多态、对象方法或其他更高级的编码。

### 参数化多态不是子类型多态

Kotlin 开发者容易把 `'a` 类比成 `Any`，但两者语义完全不同：

```kotlin
fun inspect(value: Any): String = value.toString()
```

`Any` 表示某个共同父类型，函数可以调用 `Any` 提供的方法，并可能在运行时判断真实子类型。

```ocaml
let identity value = value
```

`'a` 表示对所有实例化类型都使用同一套逻辑。函数不知道 `'a` 是什么，不能凭空对它调用整数、字符串或对象操作。

参数化多态依靠的是“实现不关心具体类型”，子类型多态依靠的是“不同具体对象都承诺提供共同接口”。两者都能复用代码，但证明方式不同。

## 类型标注是约束，不是命令

可以主动写出类型标注：

```ocaml
let increment (value : int) : int =
  value + 1
```

标注会参与统一。如果实现与标注冲突，编译器拒绝代码；它不会像强制类型转换那样改变值。

```ocaml
let invalid (value : string) : int =
  value + 1
```

这里 `value + 1` 要求 `value : int`，与显式的 `string` 冲突。

在实践中，类型标注适合以下位置：

- 公共模块签名，用于稳定 API；
- record 字段重名导致推导含糊的位置；
- 希望错误尽早出现在边界，而不是传播到实现深处的位置；
- 教学、领域单位或安全边界需要强调语义的位置。

在每个局部变量上重复编译器已经知道的类型，通常只会增加噪声。

## value restriction：多态遇到可变状态

如果所有表达式都能无条件泛化，可变引用会破坏类型安全。设想下面这段伪装成“任意类型容器”的代码：

```ocaml
let cell = ref None
```

如果 `cell` 被赋予完全多态的 `'a option ref`，就可能先写入整数，再把同一份内容按字符串读出：

```ocaml
cell := Some 42;
(* 随后若把 !cell 当成 string option，类型安全就被破坏 *)
```

因此，OCaml 不会把这类绑定泛化为可在每次使用时自由实例化的类型。交互环境通常会显示弱类型变量：

```text
val cell : '_weak1 option ref
```

`'_weak1` 尚未确定，但它不是可反复实例化的多态变量。第一次具体使用会固定它：

```ocaml
cell := Some 42
(* 此后 cell 的元素类型固定为 int *)
```

再写入字符串就会产生类型错误。

### 非扩张表达式与扩张表达式

理解 value restriction 的实用方式，是区分绑定右侧是否可能在求值时创建带身份的状态或执行其他效果。

通常可以安全泛化的非扩张表达式包括：

- 常量；
- 变量；
- 函数；
- 仅由非扩张部分构成的 tuple、record 或构造器值。

```ocaml
let id = fun value -> value
```

函数值本身还没有执行函数体，也没有创建一个可被不同类型共享后再修改的单元，所以 `id : 'a -> 'a` 可以泛化。

函数调用一般属于扩张表达式：

```ocaml
let id =
  (fun f -> f) (fun value -> value)
```

虽然人类能看出结果仍是 identity，类型检查器不会对任意函数调用假设纯洁无副作用，因此可能保留弱类型变量。

最直接的修复常常是 eta-expansion，把结果重新写成显式函数值：

```ocaml
let id value =
  ((fun f -> f) (fun item -> item)) value
```

现在绑定右侧是函数，类型可以按预期泛化。

### relaxed value restriction

现代 OCaml 实际使用的是 relaxed value restriction。即使右侧是扩张表达式，只要未泛化的类型变量仅出现在协变位置，编译器仍可能安全地泛化它。

这说明“只有函数才能泛化”只是便于入门的近似，不是完整规则。真正的安全条件与类型变量出现的位置及可变性有关。阅读弱类型错误时，应先寻找：

1. 绑定右侧是否包含函数调用、引用、可变容器或其他效果；
2. 同一值是否可能被不同类型的使用共享；
3. 能否通过增加函数参数、拆分绑定或明确数据类型恢复安全关系。

与 Kotlin 相比，value restriction 显得陌生，是因为 Kotlin 泛型通常在声明处显式出现，而 JVM 对象的可变性也不会参与这种全局泛化。OCaml 让更多泛型关系由推导生成，因此必须明确规定推导何时可以把未知类型提升成真正的多态类型。

## 积类型：多个部分同时存在

代数数据类型中的“积”表示一个值同时包含多个组成部分。tuple 与 record 都是积类型。

```ocaml
let endpoint = "ready-jump.top", 443
```

它的类型是：

```text
string * int
```

如果第一个位置有三种可能，第二个位置有两种可能，那么组合后共有 `3 × 2` 种值，因此称为积类型。

tuple 适合局部、结构简单且各位置含义明显的数据。跨越函数或模块边界时，record 通常更清晰：

```ocaml
type endpoint = {
  host : string;
  port : int;
  tls : bool;
}

let production = {
  host = "ready-jump.top";
  port = 443;
  tls = true;
}
```

record 是名义类型：即使另一个 record 拥有相同字段和字段类型，只要它来自不同的类型声明，也不是同一个类型。

### record 更新不是原地修改

默认 record 字段不可变。所谓“更新”会构造新值：

```ocaml
let disable_tls endpoint =
  { endpoint with tls = false }
```

旧的 `endpoint` 仍然存在。只有字段被声明为 `mutable` 时，才能使用 `<-` 原地赋值：

```ocaml
type counter = {
  mutable value : int;
}

let increment counter =
  counter.value <- counter.value + 1
```

这与 Kotlin 的 `data class.copy` 表面相似，但默认方向不同。Kotlin 的 `val endpoint` 只固定引用，字段是否可变由类声明决定；OCaml 的 record 字段默认不可变，需要在类型定义中明确标出可变位置。

## 和类型：多种可能中恰好一种

variant 是“和类型”：一个值在多个构造器中选择一个。

```ocaml
type payment =
  | Cash
  | Card of {
      last_four : string;
      issuer : string;
    }
  | Transfer of string
```

如果 `Cash` 有一种取值，`Card` 的载荷有若干种组合，`Transfer` 又有若干个字符串值，那么 `payment` 的所有可能数量是各分支可能数量之和。

构造器携带的数据只在对应分支中存在：

```ocaml
let display_payment = function
  | Cash -> "现金"
  | Card { last_four; issuer } ->
      Printf.sprintf "%s 尾号 %s" issuer last_four
  | Transfer bank ->
      "转账：" ^ bank
```

不需要让 `last_four` 在现金支付中成为 `None`，也不需要维护 `type = CARD` 时某些字段必须非空的跨字段约定。

### Kotlin sealed hierarchy 与 OCaml variant

Kotlin 可以建立等价的封闭层级：

```kotlin
sealed interface Payment {
    data object Cash : Payment

    data class Card(
        val lastFour: String,
        val issuer: String,
    ) : Payment

    data class Transfer(
        val bank: String,
    ) : Payment
}
```

两者都能表达封闭分支，也都能配合穷尽分支检查。主要差异不在能力有无，而在默认建模重心：

- Kotlin 的每个分支仍是一个类型，可以拥有成员、实现多个接口并参与对象体系；
- OCaml 构造器首先是数据形状，行为通常集中在处理这些形状的函数中；
- Kotlin 通过智能类型转换访问分支成员；
- OCaml 模式在确认构造器的同时直接解构载荷；
- OCaml 可以非常自然地匹配多个值形成的状态矩阵。

如果各分支需要持续增加自己独有的行为，对象分派可能更合适；如果需要不断增加覆盖全部分支的分析与变换，variant 加模式匹配通常更集中。

## 递归类型：让数据定义自身的结构

类型可以递归引用自己。标准列表在概念上可以写成：

```ocaml
type 'a sequence =
  | Empty
  | Item of 'a * 'a sequence
```

一棵二叉树可以定义为：

```ocaml
type 'a tree =
  | Leaf
  | Node of {
      value : 'a;
      left : 'a tree;
      right : 'a tree;
    }
```

函数结构可以直接对应类型结构：

```ocaml
let rec size = function
  | Leaf -> 0
  | Node { left; right; _ } ->
      1 + size left + size right
```

类型定义告诉我们树只有两种形状，`size` 也只有两个需要处理的分支。这种“数据递归，函数也递归”的对应关系称为 structural recursion。

再定义一个保持树形状、只转换元素的函数：

```ocaml
let rec map_tree transform = function
  | Leaf -> Leaf
  | Node { value; left; right } ->
      Node {
        value = transform value;
        left = map_tree transform left;
        right = map_tree transform right;
      }
```

编译器推导出：

```text
val map_tree : ('a -> 'b) -> 'a tree -> 'b tree
```

这个签名非常有信息量：

- 树中原始元素类型是 `'a`；
- 转换函数把 `'a` 变成 `'b`；
- 输出树保持结构，但元素类型变成 `'b`；
- 实现不依赖 `'a` 或 `'b` 的具体能力。

## 模式匹配同时完成判断与解构

模式不是只用于 variant 的 switch。它可以描述常量、tuple、record、list、构造器以及它们的嵌套组合。

```ocaml
type status =
  | Pending
  | Paid of string
  | Cancelled of string

type order = {
  id : int;
  status : status;
}

let describe = function
  | { id; status = Pending } ->
      Printf.sprintf "订单 %d 等待支付" id
  | { id; status = Paid transaction_id } ->
      Printf.sprintf "订单 %d 已支付：%s" id transaction_id
  | { id; status = Cancelled reason } ->
      Printf.sprintf "订单 %d 已取消：%s" id reason
```

一个模式同时完成三件事：

1. 判断值是否具有该形状；
2. 提取其中需要的部分；
3. 通过形状收窄后续表达式中的类型关系。

### 多值匹配把规则写成矩阵

状态转换往往由“当前状态 × 输入事件”共同决定：

```ocaml
type event =
  | Pay of string
  | Cancel of string
  | Retry

type transition_error =
  | Already_finished
  | Nothing_to_retry

let transition status event =
  match status, event with
  | Pending, Pay transaction_id ->
      Ok (Paid transaction_id)
  | Pending, Cancel reason ->
      Ok (Cancelled reason)
  | Pending, Retry ->
      Error Nothing_to_retry
  | (Paid _ | Cancelled _), _ ->
      Error Already_finished
```

这比连续嵌套两个 `when` 更接近一张规则表。每一行声明一个合法或非法组合，新增状态或事件后，穷尽检查会帮助定位缺失的单元格。

### guard 是补充条件，不应掩盖数据模型

模式后可以使用 `when` 增加 guard：

```ocaml
let classify = function
  | amount when amount < 0 -> "invalid"
  | 0 -> "zero"
  | _ -> "positive"
```

guard 很方便，但编译器通常无法证明任意布尔条件覆盖了哪些值。因此，大量相互重叠的 guard 会削弱穷尽检查的价值。

如果条件代表稳定的领域状态，应优先考虑把它提升为 variant 构造器；如果只是数值范围、权限查询或临时判断，guard 才更自然。

## 穷尽与冗余：编译器检查规则表

当匹配遗漏某些形状时，OCaml 会报告非穷尽警告：

```ocaml
let unsafe_head = function
  | head :: _ -> head
```

空列表 `[]` 没有被处理。比起用通配符压住警告，更诚实的签名是返回 `option`：

```ocaml
let head = function
  | [] -> None
  | first :: _ -> Some first
```

推导类型为：

```text
val head : 'a list -> 'a option
```

类型现在明确告诉调用者：列表可能没有首元素。

反过来，永远无法命中的分支会产生冗余警告：

```ocaml
let is_empty = function
  | [] -> true
  | _ -> false
  | _ :: _ -> false
```

第二个 `_` 已经覆盖所有剩余输入，第三个分支不可达。冗余通常表示规则顺序错误、复制粘贴残留，或开发者误解了数据形状。

在生产项目中，应认真对待这两类警告。穷尽警告是“某些合法输入没有规则”，冗余警告是“某条规则永远不可能发生”。它们都属于领域模型反馈，而不只是代码风格问题。

## 用类型消除非法状态

假设一个订单结构直接包含多个 option：

```ocaml
type weak_order = {
  paid_at : float option;
  transaction_id : string option;
  cancel_reason : string option;
}
```

这个类型允许许多业务上矛盾的组合：

- 有 `paid_at` 却没有 `transaction_id`；
- 同时存在支付信息与取消原因；
- 三个字段都为空，但无法区分草稿与支付中。

可以把状态改写为 variant：

```ocaml
type payment_info = {
  paid_at : float;
  transaction_id : string;
}

type order_state =
  | Draft
  | Processing
  | Paid of payment_info
  | Cancelled of string

type order = {
  id : int;
  state : order_state;
}
```

现在：

- `Paid` 必然携带完整支付信息；
- `Cancelled` 必然携带原因；
- 一个订单不可能同时已支付又已取消；
- `Draft` 与 `Processing` 是不同构造器，不需要额外布尔值。

Kotlin 同样可以通过 sealed interface 建立这个模型。OCaml 的提醒不是“Kotlin 做不到”，而是：不要因为 class 和 nullable 很方便，就把本应封闭的状态关系重新降级成字段约定。

## 类型别名与新类型不是一回事

类型别名不会创建新的类型：

```ocaml
type user_id = int
type order_id = int
```

`user_id` 和 `order_id` 仍然都只是 `int`，可以互相传递。别名主要用于提高可读性或缩短复杂类型。

如果要阻止混用，需要构造器建立真正的新类型：

```ocaml
type user_id = User_id of int
type order_id = Order_id of int

let load_user (User_id id) =
  id
```

此时把 `Order_id 42` 传给 `load_user` 会被编译器拒绝。

Kotlin 的 `typealias` 同样只创建别名；`@JvmInline value class` 则更接近带独立静态身份、并尽量消除包装成本的新类型。两门语言都在提醒：结构相同不代表语义相同，尤其是 ID、货币、时间单位与协议字段。

## 从 Kotlin 迁移思维时的几个陷阱

### 把每个 variant 构造器都当成类

构造器可以携带数据，但它首先不是“拥有方法的微型对象”。先把跨分支的变换写成普通函数，通常更符合 OCaml 的阅读方式。

### 用 `_` 消灭编译器提醒

通配符适合真正不关心的开放剩余输入。对封闭领域状态过早使用 `_`，会让新增构造器悄悄落入旧逻辑，失去穷尽检查带来的变更传播。

### 认为没有类型标注就没有稳定 API

推导类型同样是精确契约。模块签名还能显式收窄实现暴露的类型与值。是否写标注和是否拥有静态接口是两回事。

### 把 `'a` 当成 `Any`

`'a` 通常表达参数化多态，不提供共同父类方法。看到类型变量时，应问“这些位置必须保持什么关系”，而不是“运行时实际是哪种子类”。

### 为了纯函数拒绝所有可变状态

OCaml 的目标不是宗教式纯粹。哈希表、数组、缓存、I/O buffer 和性能敏感算法都可能合理使用可变状态。关键是把可变性限制在明确模块内，对外仍提供容易推理的接口。

## 一套类型驱动的建模流程

面对一个新领域，可以按下面的顺序设计：

1. **列出互斥状态**：哪些情况只能存在一个？用 variant 表达；
2. **确定每个状态的数据**：只把字段放进确实需要它的构造器；
3. **识别同时存在的组成部分**：用 record 或 tuple 表达积；
4. **区分缺失与失败**：缺失使用 `option`，可恢复失败使用带领域错误的 `result`；
5. **写核心变换函数**：让输入和输出类型先表达规则，不急着引入副作用；
6. **检查匹配警告**：确认是否真的覆盖所有合法形状；
7. **最后选择可变边界**：只在身份、I/O 或性能确实需要时引入 mutable state；
8. **用模块签名封装表示**：不让调用方依赖内部构造细节。

这种流程不会自动产生好设计，但能让许多矛盾更早变成类型错误，而不是在线上数据中表现为“不可能出现”的字段组合。

## 结论：类型是数据关系的推导结果

OCaml 类型系统的力量并不只来自“严格”，而来自它能从实现中恢复关系：

- unification 把表达式产生的局部约束合并起来；
- principal type 保留实现真正具有的最大通用性；
- let 多态让同一份无关具体类型的逻辑安全复用；
- value restriction 阻止多态与共享可变状态组合后破坏安全；
- record 表达同时存在的数据；
- variant 表达互斥的数据形状；
- recursive type 与 structural recursion 让函数结构对应数据结构；
- 穷尽与冗余检查把模式匹配变成可由编译器审计的规则表。

对 Kotlin 开发者而言，最值得带走的不是“以后都用 OCaml”，而是更敏锐地识别两件事：哪些 nullable 字段其实是一组互斥状态，哪些对象方法其实只是数据之间的纯变换。

当这些关系先被正确建模，语言的简洁才有意义。否则，无论使用 OCaml 的短语法还是 Kotlin 的优雅 DSL，都只是在更漂亮地维护隐含约定。

## 下一章

下一章将进入函数与组合：深入自动柯里化、偏应用、参数顺序、pipeline、`map` / `fold` / `bind`，并讨论 OCaml 如何在没有 Kotlin Receiver 与 extension function 的情况下构造可读的领域操作。

## 延伸阅读

- [OCaml 官方教程：Data Types and Matching](https://ocaml.org/docs/basic-data-types)
- [OCaml 官方教程：Basic Data Types](https://ocaml.org/docs/basic-data-types)
- [OCaml Programming: Correct + Efficient + Beautiful—Type Inference](https://cs3110.github.io/textbook/chapters/data/type_inference.html)
- [Real World OCaml：Variables and Functions](https://dev.realworldocaml.org/variables-and-functions.html)
- [OCaml Manual：Polymorphism and Its Limitations](https://ocaml.org/manual/5.3/polymorphism.html)
