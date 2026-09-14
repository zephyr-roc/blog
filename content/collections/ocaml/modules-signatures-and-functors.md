---
title: OCaml 模块系统：签名、抽象类型与 Functor
date: 2026-09-14
excerpt: 从编译单元与 .mli 接口出发，理解 module、signature、抽象类型、with type 和 Functor，比较它们与 Kotlin interface、泛型及依赖注入的边界。
chapter: 抽象与类型
chapterOrder: 4
---

前面的章节一直在 core language 中工作：值、函数、record、variant 和模式匹配。它们足以写出清晰的局部逻辑，却还没有回答大型工程的问题：如何隐藏表示、约束实现、拆分编译单元，并复用一整组相互关联的类型与函数？

OCaml 的答案是模块系统。它不是 package 的同义词，也不是 class 的另一种拼写，而是一层建立在核心语言之上的“模块语言”。

## 文件首先是编译单元

假设项目中有：

```text
account.ml
account.mli
main.ml
```

`account.ml` 定义实现，编译后形成模块 `Account`；文件名被转换为首字母大写的模块名。

```ocaml
(* account.ml *)
type t = {
  id : int;
  balance : int;
}

let create id =
  { id; balance = 0 }

let deposit amount account =
  { account with
    balance = account.balance + amount
  }
```

调用方通过模块路径访问：

```ocaml
let account =
  Account.create 42
  |> Account.deposit 100
```

如果没有 `.mli`，编译器会从实现推导接口，模块内所有顶层定义原则上都可能公开。`.mli` 则显式声明调用方能看到的表面：

```ocaml
(* account.mli *)
type t

val create : int -> t
val deposit : int -> t -> t
val balance : t -> int
```

这里 `type t` 没有暴露 record 结构。调用方知道存在 `Account.t`，却不能构造、解构或直接修改其字段，只能使用模块公开的函数。

这不是运行时访问修饰符。表示隐藏在编译期完成，接口文件会生成 `.cmi`，其他编译单元依据它进行类型检查。

## signature 是模块的类型

核心语言中的值有类型：

```text
increment : int -> int
```

模块也有类型，称为 signature：

```ocaml
module type ACCOUNT = sig
  type t

  val create : int -> t
  val deposit : int -> t -> t
  val balance : t -> int
end
```

实现可以被签名约束：

```ocaml
module Account : ACCOUNT = struct
  type t = {
    id : int;
    balance : int;
  }

  let create id =
    { id; balance = 0 }

  let deposit amount account =
    { account with
      balance = account.balance + amount
    }

  let balance account =
    account.balance
end
```

编译器检查：

- 要求的类型和模块是否存在；
- 值的类型是否与签名兼容；
- 实现是否泄漏了本应抽象的表示；
- 类型等式是否能够成立。

实现可以包含签名未列出的辅助函数；它们在模块外不可见。

## 抽象类型保护不变量

如果公开 record：

```ocaml
type account = {
  id : int;
  balance : int;
}
```

任何调用方都能构造负余额：

```ocaml
let invalid =
  { id = 42; balance = -1_000_000 }
```

把表示藏在模块中：

```ocaml
module type ACCOUNT = sig
  type t
  type error =
    | Invalid_amount
    | Insufficient_balance

  val create : id:int -> t
  val deposit : amount:int -> t -> (t, error) result
  val withdraw : amount:int -> t -> (t, error) result
  val balance : t -> int
end
```

调用方无法绕过构造与转换函数。只要模块内部正确，所有可观察的 `t` 都满足不变量。

Kotlin 通常用 private constructor、私有字段和 companion factory 达到相似目的：

```kotlin
class Account private constructor(
    val id: Long,
    val balance: Long,
) {
    companion object {
        fun create(id: Long): Account =
            Account(id, 0)
    }
}
```

差别在抽象单位：

- Kotlin 把封装围绕对象类型组织；
- OCaml 签名可以同时隐藏多个类型，并约束一整组值、子模块和类型关系；
- Kotlin interface 主要描述对象实例具有什么成员；
- OCaml signature 描述整个模块提供哪些类型和值，不要求存在某个“实现对象”。

## manifest type：公开类型等式

并非所有类型都要隐藏。签名可以公开类型表示：

```ocaml
module type USER_ID = sig
  type t = int

  val of_int : int -> t
  val to_int : t -> int
end
```

`type t = int` 是 manifest type。调用方知道 `t` 与 `int` 相同，可以直接在需要 `int` 的地方使用。

如果只写：

```ocaml
type t
```

即使实现内部恰好使用 `int`，模块外也不能假设这个等式成立。

抽象程度应由边界需求决定：

- 表示本身就是稳定协议时，可以公开；
- 表示未来可能改变或承载不变量时，应隐藏；
- 只为了制造包装感而隐藏所有基础类型，也会增加转换噪声。

## module type annotation 的两种效果

下面的约束会隐藏签名没有公开的表示：

```ocaml
module Account : ACCOUNT = struct
  type t = {
    id : int;
    balance : int;
  }
  (* ... *)
end
```

也可以使用 destructive substitution 或 `with type` 精确补充等式：

```ocaml
module type SERIALIZER = sig
  type t
  val encode : t -> string
  val decode : string -> (t, string) result
end

module User_serializer
  : SERIALIZER with type t = user =
struct
  type t = user
  (* ... *)
end
```

`with type t = user` 告诉外部：这里的 `t` 确实就是已有的 `user`，而不是一个无法与领域类型连接的抽象类型。

这类等式是阅读复杂模块错误的关键。许多报错并非函数类型不匹配，而是两个看起来相似的 `t` 没有被证明为同一个类型。

## include、open 与别名

`open` 只影响名称解析：

```ocaml
open Result

let value =
  map String.length result
```

它不会把定义复制进当前模块。大型文件中过度 `open` 会让名称来源模糊，更稳妥的选择包括：

```ocaml
let value =
  Result.map String.length result

let open Result in
map String.length result
```

局部 open 把影响限制在一个表达式。

`include` 则把另一个模块的定义纳入当前模块：

```ocaml
module Extended_result = struct
  include Result

  let tap_error inspect = function
    | Ok value -> Ok value
    | Error error as result ->
        inspect error;
        result
end
```

模块别名不会复制实现：

```ocaml
module R = Result
```

三者分别解决不同问题：

- `open`：省略名称前缀；
- `include`：扩展或转发模块接口；
- module alias：给模块路径另一个名字。

## 嵌套模块与命名空间

模块可以嵌套：

```ocaml
module Order = struct
  module Id = struct
    type t = Order_id of int
  end

  module Status = struct
    type t =
      | Draft
      | Paid
      | Cancelled
  end
end
```

使用路径：

```ocaml
let id : Order.Id.t =
  Order.Id.Order_id 42
```

OCaml 项目常通过库的 wrapped module 建立顶层命名空间。Dune 默认会将库中的模块包在库名之下，避免不同依赖的 `Util`、`Config` 相互冲突。

这与 Kotlin package 不完全相同。package 主要组织名字；module 还能携带抽象类型、值和子模块，并参与 Functor 参数化。

## Functor：接收模块，产生模块

Functor 是模块层的函数：

```ocaml
module type ORDERED = sig
  type t
  val compare : t -> t -> int
end

module Make_set (Element : ORDERED) = struct
  type element = Element.t
  type t = element list

  let empty = []

  let add value values =
    if List.exists
         (fun item -> Element.compare value item = 0)
         values
    then values
    else value :: values
end
```

应用 Functor：

```ocaml
module User_id = struct
  type t = int
  let compare = Int.compare
end

module User_id_set =
  Make_set (User_id)
```

`Make_set` 不只接收一个 compare 函数，而是接收一个模块：模块中包含类型 `t` 及其操作。结果模块中的 `element` 与输入模块的 `t` 保持类型关系。

标准库的 `Set.Make`、`Map.Make` 和 `Hashtbl.Make` 都体现了这种设计。

### 为什么不只传一组函数

可以把配置写成 record：

```ocaml
type 'a ordering = {
  compare : 'a -> 'a -> int;
}
```

对简单场景这往往足够。Functor 的额外价值在于：

- 参数可以携带抽象类型；
- 结果可以产生新的类型和子模块；
- signature 能约束多项关联定义；
- 组合在模块层完成，适合作为库结构；
- 类型等式由编译器持续追踪。

不要把每个依赖注入都改成 Functor。若只需要替换一个运行时行为，传函数或 record 更轻；当依赖包含类型、多个相互关联操作或需要生成完整模块时，Functor 才显示价值。

## applicative 与 generative

应用同一个普通 Functor 路径时，OCaml 通常保留 applicative 类型身份：相同 Functor 与相同参数路径产生兼容的抽象类型。

```ocaml
module A = F (X)
module B = F (X)
```

在条件满足时，`A.t` 与 `B.t` 可被认为相同。

如果使用 generative Functor：

```ocaml
module Fresh () : sig
  type t
  val create : int -> t
end = struct
  type t = int
  let create value = value
end

module A = Fresh ()
module B = Fresh ()
```

每次应用都会产生新的抽象类型身份，`A.t` 与 `B.t` 不兼容。

generativity 适合需要隔离实例的场景，例如会话标识、单位系统或资源域；它不是普通依赖注入的默认选择。

## first-class module：让模块进入值世界

通常模块与普通值位于不同层。first-class module 可以把满足某个签名的模块打包成值：

```ocaml
module type SHOW = sig
  type t
  val value : t
  val show : t -> string
end

let render
    (module Item : SHOW) =
  Item.show Item.value
```

构造并传入：

```ocaml
let output =
  render
    (module struct
      type t = int
      let value = 42
      let show = string_of_int
    end)
```

这允许在运行时把模块放进列表、配置或选择分支，但类型与打包/解包会更复杂。若只需要传递一个行为，普通函数仍然更清楚。

## Kotlin 泛型与 Functor 的差别

Kotlin 可以用 interface 与泛型建立工厂：

```kotlin
interface Ordering<T> {
    fun compare(left: T, right: T): Int
}

class SetFactory<T>(
    private val ordering: Ordering<T>,
)
```

这种做法围绕运行时对象和泛型实例组织。OCaml Functor 的参数是编译期模块，能够同时携带类型成员和多个值。

大致对应关系如下：

| 需求 | Kotlin 常用机制 | OCaml 常用机制 |
|---|---|---|
| 隐藏构造 | private constructor / internal | abstract type in signature |
| 描述能力 | interface | module type 或函数类型 |
| 参数化值 | generic function/class | 参数化函数 |
| 参数化一组类型与操作 | interface + generic + object | Functor |
| 运行时替换实现 | interface object / DI container | 函数、record、first-class module |
| 编译时生成专门模块 | 较少直接对应 | Functor application |
| 命名空间 | package/object | compilation unit/module |

Functor 不比 interface “更高级”；它优化的是另一种变化轴。Kotlin 擅长对许多运行时实例做动态替换，OCaml 模块系统擅长表达编译期组件及其类型关系。

## 模块设计的常见失误

### 每个小函数都包一层 module type

签名应保护稳定边界或抽象表示。对只有两个无状态辅助函数的内部模块强行写完整 signature，只会制造跳转。

### 只为依赖注入使用大型 Functor

如果测试只需要替换时钟或随机数，传入 `unit -> time`、函数 record，往往比把整个服务 Functor 化更清晰。

### 滥用 `include`

`include` 会扩大当前模块的公开表面，也可能让未来依赖升级时意外暴露新名称。库 API 中应明确检查被 include 的签名。

### 到处 `open`

短名字很舒服，但来源消失后，重构与审查会变难。模块路径本身就是有价值的语义信息。

### 抽象类型没有提供足够操作

隐藏表示之后，模块必须公开完成实际任务所需的观察与转换函数。过度封装会迫使调用方来回序列化，或者增加不安全的 `to_raw` 后门。

## 一套实用的模块边界

可以按以下顺序判断：

1. 单个普通函数能否表达依赖？能就先用函数；
2. 多个行为是否共享同一数据？考虑 record；
3. 是否需要隐藏表示并维护不变量？使用 module + signature；
4. 依赖是否同时携带抽象类型与多项操作？考虑 Functor；
5. 是否需要在运行时选择整套实现？考虑 first-class module；
6. 每次实例化是否必须产生不兼容类型？才使用 generative Functor；
7. 对外接口能否比实现更小？用 `.mli` 主动约束。

## 结论：模块系统管理的是类型关系

OCaml 模块系统的价值不只是拆文件。它可以：

- 让文件成为独立编译单元；
- 用 signature 描述整个模块的类型；
- 通过抽象类型隐藏表示并保护不变量；
- 用 manifest type 与 `with type` 暴露必要等式；
- 用 Functor 参数化一组关联类型和操作；
- 用 generativity 创建隔离的类型身份；
- 用 first-class module 在需要时连接编译期模块与运行时值。

Kotlin 以 class/interface 为中心时，封装、动态分派与对象生命周期自然聚合在一起；OCaml 把“值的行为”和“模块的抽象”拆成两层。理解这一点后，就不会把 Functor 当成复杂的泛型类，也不会为了模仿依赖注入框架而过度使用它。

## 下一章

下一章进入高级类型与可扩展性：polymorphic variant、GADT、existential type、locally abstract type 和 extensible variant，理解 OCaml 如何表达普通 variant 无法保持的精细类型关系。

## 延伸阅读

- [OCaml 官方教程：Modules](https://ocaml.org/docs/modules)
- [OCaml 官方教程：Functors](https://ocaml.org/docs/functors)
- [OCaml 官方教程：First-Class Modules](https://ocaml.org/docs/first-class-modules)
- [OCaml Manual：The Module System](https://ocaml.org/manual/5.5/moduleexamples.html)
- [Real World OCaml：Files, Modules, and Programs](https://dev.realworldocaml.org/files-modules-and-programs.html)
