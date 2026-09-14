---
title: OCaml 高级类型：开放变体、GADT 与存在类型
date: 2026-09-14
excerpt: 从 polymorphic variant 到 GADT、existential type、locally abstract type 与 extensible variant，理解类型信息如何随构造器被细化、隐藏或扩展。
chapter: 抽象与类型
chapterOrder: 5
---

普通 variant 擅长表达一组封闭分支：

```ocaml
type status =
  | Draft
  | Paid
  | Cancelled
```

但有些问题需要另一种能力：

- 不想先声明一个封闭类型，只想让多个函数共享若干标签；
- 不同构造器不仅携带不同数据，还决定整个值的结果类型；
- 希望把“某个未知类型及其专属操作”一起保存；
- 希望第三方模块以后增加新的构造器。

OCaml 为这些需求提供 polymorphic variant、GADT、存在类型和 extensible variant。它们都在扩展普通 ADT，却沿着不同方向扩展，不能混为一谈。

## 普通 variant 是名义且封闭的

两个声明即使构造器名字一样，也是不同类型：

```ocaml
type ui_state =
  | Loading
  | Ready

type job_state =
  | Loading
  | Ready
```

`ui_state` 与 `job_state` 由声明身份区分。构造器集合也在声明时封闭，其他模块不能随意增加第三个分支。

这带来强穷尽检查和清楚的所有权：看到类型声明，就能知道全部合法形状。多数领域模型应优先选择普通 variant。

## polymorphic variant：由标签集合形成结构类型

polymorphic variant 的标签以反引号开头，不需要预先声明：

```ocaml
let color_name = function
  | `Red -> "red"
  | `Green -> "green"
  | `Blue -> "blue"
```

编译器推导出一个标签集合类型，函数可以接收至少能匹配这些标签的值。与普通 variant 不同，它依靠标签结构而不是某个命名声明建立兼容性。

可以显式写出封闭集合：

```ocaml
type color = [
  | `Red
  | `Green
  | `Blue
]
```

标签也能携带数据：

```ocaml
type response = [
  | `Ok of string
  | `Not_found
  | `Error of int * string
]
```

### 上界与下界

polymorphic variant 类型中常出现 `[< ... ]` 与 `[> ... ]`。

```ocaml
let is_success = function
  | `Ok _ -> true
  | `Error _ -> false
```

推导结果可能表示输入标签不超过 `Ok` 与 `Error` 这组上界，因为函数只知道如何处理这两个标签。

构造一个标签：

```ocaml
let missing =
  `Not_found
```

则类型表示值至少包含 `Not_found` 这个可能性，其他上下文可以继续扩大集合。

这种开放性适合：

- 多个小函数各自只处理协议的一部分标签；
- 组合库希望避免共享一个中心 variant 声明；
- 错误集合沿调用链逐步合并；
- 结构兼容比名义身份更重要。

### 开放性的代价

普通 variant 新增构造器时，编译器能系统地找到未覆盖匹配。polymorphic variant 的集合可能由推导和上下界拼合，错误信息更复杂，拼错标签也可能形成一个新的合法标签，而不是引用失败。

因此，业务核心状态通常仍应使用普通 variant。polymorphic variant 更适合边界明确、组合收益真实的库 API，不应只因为省掉 `type` 声明就全面使用。

## GADT：构造器可以决定类型参数

普通参数化 variant 的每个构造器都产生相同形状的结果：

```ocaml
type 'a box =
  | Box of 'a
```

GADT 允许构造器返回不同的类型实例：

```ocaml
type _ expression =
  | Int : int -> int expression
  | Bool : bool -> bool expression
  | Add :
      int expression * int expression
      -> int expression
  | Equal :
      'a expression * 'a expression
      -> bool expression
```

这里：

- `Int 42` 的类型是 `int expression`；
- `Bool true` 的类型是 `bool expression`；
- `Add` 只接受两个整数表达式，结果仍是整数表达式；
- `Equal` 要求两侧结果类型相同，最终产生布尔表达式。

非法表达式无法构造：

```ocaml
(* Add (Int 1, Bool true) *)
```

它不是等到 evaluator 运行时才报类型错误，而是在构造语法树时就被拒绝。

## 模式匹配会细化类型

求值器可以承诺：输入是什么结果类型的表达式，就返回什么类型的值。

```ocaml
let rec evaluate
  : type result.
    result expression -> result
  = function
  | Int value ->
      value
  | Bool value ->
      value
  | Add (left, right) ->
      evaluate left + evaluate right
  | Equal (left, right) ->
      evaluate left = evaluate right
```

`: type result.` 引入 locally abstract type。进入函数体时，`result` 被视为一个抽象类型；匹配构造器后，编译器在各分支中获得新的类型等式：

- 匹配 `Int` 后知道 `result = int`；
- 匹配 `Bool` 后知道 `result = bool`；
- 匹配 `Add` 后知道两个子表达式和返回值都是 `int`；
- 匹配 `Equal` 后知道返回值是 `bool`，两侧共享某个类型。

普通 variant 匹配主要拆数据，GADT 匹配还会带来类型证明。

### Kotlin sealed class 为什么不完全等价

Kotlin 可以写：

```kotlin
sealed interface Expression<T>

data class IntValue(
    val value: Int,
) : Expression<Int>

data class BoolValue(
    val value: Boolean,
) : Expression<Boolean>
```

但在通用 `evaluate(expression: Expression<T>): T` 中，JVM 泛型擦除、Kotlin 智能转换与类型参数细化并不能自然给出与 GADT 相同的证明能力，往往需要 visitor、受控 cast 或重新组织接口。

Kotlin sealed hierarchy 很适合封闭状态；GADT 更擅长建立“构造器出现时，某个类型等式随之成立”的 typed AST、协议状态和解释器。

## 类型证据：把等式做成值

可以定义类型相等证据：

```ocaml
type (_, _) equal =
  | Refl : ('a, 'a) equal
```

只有两侧类型确实相同时，才能构造 `Refl`。匹配它后，编译器知道两个抽象类型相等：

```ocaml
let cast
  : type left right.
    (left, right) equal ->
    left ->
    right
  =
  fun proof value ->
    match proof with
    | Refl -> value
```

这不是绕过类型系统的 cast。调用方必须提供真正的等式证明；`Refl` 分支让类型检查器确认返回 `value` 是安全的。

这类技巧常见于 typed heterogeneous storage、序列化描述、编译器 IR 和协议状态机，但不应进入普通 CRUD 代码。

## 存在类型：隐藏具体类型，保留可用操作

有时需要把不同类型的值放进同一个列表，但又不能丢失如何处理它们的信息。

GADT 构造器可以封装一个未知类型：

```ocaml
type printable =
  | Printable :
      'a * ('a -> string)
      -> printable
```

创建异构列表：

```ocaml
let values = [
  Printable (42, string_of_int);
  Printable (true, string_of_bool);
  Printable ("OCaml", Fun.id);
]
```

消费时：

```ocaml
let render
    (Printable (value, show)) =
  show value
```

每个 `Printable` 内部存在某个类型 `'a`，但容器外不知道它具体是什么。构造器同时保存 `'a` 的值和只适用于该 `'a` 的函数，所以仍能安全使用。

可以把它理解为：

> 存在某个类型，它是什么被隐藏了，但这里有与它配套的数据和能力。

Kotlin 常用泛型接口和对象实现达到类似效果：

```kotlin
interface Printable {
    fun render(): String
}
```

对象把类型和行为封装在一起；OCaml 存在类型则把未知类型与操作函数显式打包。

## locally abstract type：在函数内部固定一个未知类型

使用 first-class module 时，经常需要声明一个局部抽象类型：

```ocaml
module type SHOW = sig
  type t
  val show : t -> string
end

let render
    (type item)
    (module Show : SHOW
      with type t = item)
    (value : item) =
  Show.show value
```

`(type item)` 创建一个仅在函数内部使用的抽象类型名；`with type t = item` 把模块内部类型与值参数连接起来。

普通 `'a` 适合表达可统一的类型变量；locally abstract type 适合递归 GADT、first-class module 和需要在局部建立类型等式的场景。

## polymorphic recursion：递归调用改变类型实例

普通递归函数在所有递归调用中通常使用同一个类型实例。某些 GADT 算法需要递归到不同实例，必须显式声明多态递归签名。

```ocaml
type _ nested =
  | Value : 'a -> 'a nested
  | List : 'a nested list -> 'a list nested

let rec depth
  : type item.
    item nested -> int
  = function
  | Value _ -> 1
  | List values ->
      1 +
      List.fold_left
        (fun maximum value ->
          Int.max maximum (depth value))
        0
        values
```

显式 `: type item.` 让每次递归调用可以重新实例化局部抽象类型。没有标注时，推导器通常无法自动建立这种高阶递归关系。

## extensible variant：允许后来增加构造器

普通 variant 封闭；extensible variant 明确允许扩展：

```ocaml
type command = ..

type command +=
  | Quit
  | Help

type command +=
  | Load of string
```

异常类型 `exn` 就是最典型的可扩展 variant：不同模块都能声明新异常构造器。

开放带来一个必然代价：匹配无法静态枚举未来所有构造器，因此通常需要兜底分支。

```ocaml
let execute = function
  | Quit -> `Stop
  | Help -> `Continue
  | Load path -> load path
  | _ -> `Unknown
```

适合 extensible variant 的场景包括插件命令、开放协议注册和框架扩展点。不应把它用于本应穷尽审计的订单状态或权限状态。

## 四种变体如何选择

| 需求 | 选择 |
|---|---|
| 有限且由一个领域拥有的分支 | 普通 variant |
| 通过标签结构组合若干开放集合 | polymorphic variant |
| 构造器决定类型参数并提供类型细化 | GADT |
| 第三方模块需要新增构造器 | extensible variant |
| 隐藏某个具体类型并保存对应操作 | existential package |

它们并不是从简单到高级的升级路径。每一种牺牲和获得的能力不同：

- 普通 variant 的穷尽性最清楚；
- polymorphic variant 减少中心声明，但推导更复杂；
- GADT 提供强证明能力，但通常需要更多类型标注；
- extensible variant 支持开放扩展，却无法封闭匹配；
- 存在类型方便异构封装，却主动隐藏了具体类型。

## GADT 的真实使用边界

GADT 特别适合：

- typed AST 与解释器；
- SQL、格式化、序列化等类型安全 DSL；
- 协议状态机与资源状态证明；
- 运行时类型表示；
- 异构容器；
- 消除一类原本需要不安全 cast 的代码。

它不适合：

- 仅有几个普通业务状态的 sealed model；
- 单纯为了减少两个 if；
- 团队无法承担复杂类型错误的模块；
- 可以用普通 variant + 明确验证更简单表达的问题。

与 Rust typestate 相似，GADT 可以把更多约束提升到编译期；与 Rust 不同，它不追踪所有权和生命周期。类型索引证明的是你编码进去的关系，不会自动证明资源独占或线程安全。

## 结论：高级类型是在移动信息边界

这些机制的共同点不是“更抽象”，而是重新决定类型信息在哪里存在：

- polymorphic variant 让标签集合由使用位置组合；
- GADT 让构造器携带类型等式；
- existential type 隐藏具体类型，同时保存使用能力；
- locally abstract type 给未知类型一个局部、稳定的名字；
- extensible variant 把构造器集合的所有权开放给其他模块。

类型越精细，编译器能证明的关系越多，API 使用者需要理解的概念也越多。最成熟的设计不是尽可能使用 GADT，而是在普通 ADT 无法准确表达时，才支付高级类型的复杂度。

## 下一章

下一章专门讨论 OCaml 的对象系统：结构化对象类型、class、继承、开放递归与多态方法，并解释为什么 OCaml 明明拥有强大的 OOP，却仍然不是一门以对象为默认组织方式的语言。

## 延伸阅读

- [OCaml Manual：Polymorphic Variants](https://ocaml.org/manual/5.5/polyvariant.html)
- [OCaml Manual：Generalized Algebraic Datatypes](https://ocaml.org/manual/5.5/gadts.html)
- [OCaml Manual：Extensible Variant Types](https://ocaml.org/manual/5.5/extensiblevariants.html)
- [Real World OCaml：GADTs](https://dev.realworldocaml.org/gadts.html)
