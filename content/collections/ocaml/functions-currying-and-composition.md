---
title: OCaml 函数组合：从柯里化到可读的数据管道
date: 2026-09-14
excerpt: 理解 OCaml 的自动柯里化、偏应用与参数顺序，掌握 pipeline、map、fold、bind 和闭包，并与 Kotlin 的扩展函数、Receiver、链式调用及 DSL 对照。
chapter: 语言与思维
chapterOrder: 3
---

上一章[《OCaml 类型系统：推导、多态与代数数据类型》](/collections/ocaml/type-inference-and-algebraic-data-types)从数据的形状出发，解释了类型推导、let 多态、variant 与模式匹配。

现在转向另一半：函数如何被拆分、传递与组合。

Kotlin 开发者并不陌生高阶函数。集合链、extension function、Receiver lambda、scope function 和 DSL 都建立在“函数是一等值”之上。OCaml 的不同之处不在于它也有 lambda，而在于三个默认选择：

- 多参数函数天然是柯里化的；
- API 的参数顺序通常为偏应用和管道服务；
- 数据处理更常通过普通函数组合，而不是把操作挂到 Receiver 上。

这使 OCaml 代码看起来像一条值的流动路径。要读懂它，不能只把 `|>` 翻译成 Kotlin 的 `.`，而要理解每一段管道实际上如何完成函数应用。

## 函数首先是值

下面三个绑定与其他值没有本质区别：

```ocaml
let answer = 42
let language = "OCaml"
let increment = fun value -> value + 1
```

`increment` 的值是一个函数，类型为：

```text
val increment : int -> int
```

函数可以被绑定、传入另一个函数、存进数据结构，也可以作为结果返回：

```ocaml
let apply transform value =
  transform value

let choose_transform enabled =
  if enabled then
    (fun value -> value + 1)
  else
    (fun value -> value)
```

推导结果分别是：

```text
val apply : ('a -> 'b) -> 'a -> 'b
val choose_transform : bool -> int -> int
```

第二个类型中的最后两个箭头很关键。它表示函数接收 `bool` 后返回 `int -> int`，并不是一个特殊的“二参数函数类型”。

## 多参数函数只是连续的一参数函数

最常见的写法：

```ocaml
let add left right =
  left + right
```

是下面形式的语法简写：

```ocaml
let add =
  fun left ->
    fun right ->
      left + right
```

因此它的类型：

```text
int -> int -> int
```

按右结合读取：

```text
int -> (int -> int)
```

调用 `add 10 20` 则按左结合解析：

```text
(add 10) 20
```

先把 `10` 传给 `add`，得到一个等待 `right` 的函数；再把 `20` 传给这个新函数。

### 柯里化函数与 tuple 参数函数不同

下面两个函数最终都能计算整数之和，但类型不同：

```ocaml
let curried_add left right =
  left + right

let tupled_add (left, right) =
  left + right
```

推导结果：

```text
val curried_add : int -> int -> int
val tupled_add : int * int -> int
```

`curried_add` 连续接收两个参数；`tupled_add` 只接收一个 tuple。

Kotlin 的普通多参数函数更接近 tupled 的调用体验，但 JVM 层面并没有自动创建 `Pair`：

```kotlin
fun add(left: Int, right: Int): Int =
    left + right
```

要在 Kotlin 中显式得到可逐步应用的函数，需要返回 lambda：

```kotlin
fun add(left: Int): (Int) -> Int =
    { right -> left + right }
```

OCaml 把后一种模型作为默认，因此偏应用不是特殊技巧，而是普通调用没有提供完全部参数时的自然结果。

## 偏应用：先固定上下文，再等待数据

定义一个带税率的计算函数：

```ocaml
let add_tax rate amount =
  amount +. (amount *. rate)
```

只提供税率，会得到新的函数：

```ocaml
let add_standard_tax =
  add_tax 0.13

let final_price =
  add_standard_tax 100.0
```

类型如下：

```text
val add_tax : float -> float -> float
val add_standard_tax : float -> float
```

`add_standard_tax` 已经捕获 `rate = 0.13`，以后只需要金额。

这会引导一种 API 设计习惯：

> 把较稳定、适合预先配置的参数放在前面，把最终流入的数据放在后面。

例如：

```ocaml
let has_status expected order =
  order.status = expected

let is_paid =
  has_status Paid
```

如果反过来写成 `has_status order expected`，固定 `Paid` 就不够自然，也难以直接放进集合函数。

### 偏应用不是执行函数的一半

偏应用会创建一个新闭包，保存已经提供的参数。它不是“函数执行到一半后暂停”，也不是 Kotlin coroutine 的挂起。

```ocaml
let greet prefix name =
  prefix ^ ", " ^ name

let hello =
  greet "Hello"
```

`hello` 保存了 `prefix` 的词法环境，等到获得 `name` 时才计算字符串连接。

这有真实运行时成本：闭包需要保存环境，某些情况下会产生分配。编译器可能内联或消除它，但代码设计不能建立在“所有高阶抽象必然零成本”的假设上。

## 函数应用的优先级

OCaml 用空格表示函数应用：

```ocaml
let result =
  add 1 2
```

函数应用的优先级很高，所以：

```ocaml
f x + g y
```

等价于：

```ocaml
(f x) + (g y)
```

嵌套调用容易出现括号：

```ocaml
let length =
  String.length (String.trim input)
```

`|>` 与 `@@` 用来调整阅读方向。

### `|>`：把值送入右侧函数

```ocaml
let length =
  input
  |> String.trim
  |> String.length
```

`value |> f` 等价于 `f value`。所以上面的代码仍是两个普通函数调用，没有隐藏控制流。

它的类型可以简化理解为：

```text
(|>) : 'a -> ('a -> 'b) -> 'b
```

### `@@`：降低函数应用的括号层级

```ocaml
let length =
  String.length @@ String.trim input
```

`f @@ value` 等价于 `f value`，但 `@@` 的优先级较低，因此右侧表达式会先整体求值。

两者改变的是排版方向：

```ocaml
value |> transform
transform @@ value
```

`|>` 更适合从数据出发向下阅读，`@@` 更适合保持函数在前、减少尾部括号。不要为了使用运算符而混合两种方向；一段代码的阅读路径应当稳定。

## 参数顺序决定管道是否自然

标准库的 `List.map` 类型是：

```text
('a -> 'b) -> 'a list -> 'b list
```

转换函数在前，列表在后，因此可以先偏应用转换逻辑，再由管道传入列表：

```ocaml
let names =
  users
  |> List.filter (fun user -> user.active)
  |> List.map (fun user -> user.name)
```

展开后是：

```ocaml
let names =
  List.map
    (fun user -> user.name)
    (List.filter (fun user -> user.active) users)
```

管道没有改变语义，只把嵌套的“由内向外阅读”改成“由上向下阅读”。

自定义函数也应考虑这个方向：

```ocaml
let limit count values =
  values
  |> List.filteri (fun index _ -> index < count)

let visible_users =
  users
  |> List.filter (fun user -> user.active)
  |> limit 10
```

`count` 是配置，`values` 是管道数据，所以这个顺序自然。

但不能把“数据永远放最后”当成机械规则。参数顺序还要考虑：

- 哪些参数最常被偏应用；
- 哪个参数代表主要数据；
- 是否需要 labelled argument 消除同类型参数歧义；
- 标准库和领域 API 已形成什么惯例；
- 错误信息与调用点是否易读。

## labelled argument：按语义调用，而不是只靠位置

当多个参数类型相同，仅靠顺序很容易误用：

```ocaml
let transfer from_account to_account amount =
  (* ... *)
  ()
```

可以使用标签：

```ocaml
let transfer ~from_account ~to_account ~amount =
  (* ... *)
  ()

let () =
  transfer
    ~from_account:"checking"
    ~to_account:"saving"
    ~amount:100
```

标签属于函数类型的一部分。调用方可以改变 labelled argument 的书写顺序，语义仍然明确。

### 可选参数为何常跟一个 `()`

```ocaml
let connect ~host ~port ?(tls = true) () =
  Printf.sprintf
    "%s://%s:%d"
    (if tls then "https" else "http")
    host
    port
```

调用：

```ocaml
let secure =
  connect ~host:"ready-jump.top" ~port:443 ()

let local =
  connect ~host:"localhost" ~port:8080 ~tls:false ()
```

尾部 `()` 为可选参数提供明确的“参数输入结束点”。没有这个终止参数时，编译器可能无法判断调用者是否还会继续提供可选参数，从而保留一个尚未完成应用的函数。

Kotlin 的命名参数与默认参数在调用体验上更直接：

```kotlin
fun connect(
    host: String,
    port: Int,
    tls: Boolean = true,
): String = TODO()
```

OCaml 的 labelled/optional argument 仍处于柯里化函数模型之中，因此需要理解它们如何影响偏应用，而不只是把它们当作 Kotlin named argument 的不同拼写。

## 高阶函数：函数也可以定义控制骨架

`List.map` 不知道如何转换元素，只负责遍历结构；具体变换由调用者传入：

```ocaml
let lengths =
  ["OCaml"; "Kotlin"; "Rust"]
  |> List.map String.length
```

`List.filter` 保存满足谓词的元素：

```ocaml
let long_names =
  ["OCaml"; "Kotlin"; "Rust"]
  |> List.filter (fun name -> String.length name >= 5)
```

高阶函数的核心价值不是“少写循环”，而是分离两类变化：

- 结构如何被遍历；
- 每个元素如何被处理。

Kotlin 的集合 API 使用相同思想：

```kotlin
val longNames = listOf("OCaml", "Kotlin", "Rust")
    .filter { it.length >= 5 }
```

差异主要在表面组织。Kotlin 通过 Receiver 把 `filter` 表现为集合的方法；OCaml 通过模块函数 `List.filter predicate values` 表达，再利用偏应用与管道恢复从数据出发的阅读方向。

## `map`：保持结构，改变内部值

`map` 不只属于列表。它表达一种更一般的关系：保留外部结构，把内部 `'a` 转换为 `'b`。

```text
List.map   : ('a -> 'b) -> 'a list -> 'b list
Option.map : ('a -> 'b) -> 'a option -> 'b option
Result.map : ('a -> 'b) -> ('a, 'e) result -> ('b, 'e) result
```

列表保留元素顺序与数量，option 保留“存在或缺失”，result 保留“成功或失败”；只有成功承载的值被转换。

```ocaml
let normalized_name =
  maybe_name
  |> Option.map String.trim
  |> Option.map String.lowercase_ascii
```

如果 `maybe_name = None`，转换函数不会执行，结果仍是 `None`。

对应 Kotlin：

```kotlin
val normalizedName =
    maybeName
        ?.trim()
        ?.lowercase()
```

Kotlin 为 nullable 提供专用安全调用；OCaml 使用普通 `option` 上的高阶函数。两者的表面差异来自类型设计：一个把缺失嵌入类型修饰符，一个把它建模成普通 ADT。

## `fold`：把整个结构归约为一个结果

`List.fold_left` 的类型为：

```text
('acc -> 'a -> 'acc) -> 'acc -> 'a list -> 'acc
```

它接收：

1. 一个“累加器 × 当前元素 → 新累加器”的函数；
2. 初始累加器；
3. 待遍历列表。

```ocaml
let total =
  [10; 20; 30]
  |> List.fold_left
       (fun sum value -> sum + value)
       0
```

执行关系为：

```text
((0 + 10) + 20) + 30
```

累加器不必与元素同类型：

```ocaml
let index_by_id users =
  users
  |> List.fold_left
       (fun index user ->
         IntMap.add user.id user index)
       IntMap.empty
```

`fold` 可以构造 map、分组、验证、计算统计量或建立状态机。它是“遍历结构并携带状态”的通用骨架。

### `fold_left` 与 `fold_right` 不只是方向不同

`fold_right` 的组合顺序近似：

```text
10 + (20 + (30 + initial))
```

它的函数参数顺序也不同：

```text
List.fold_left  : ('acc -> 'a -> 'acc) -> 'acc -> 'a list -> 'acc
List.fold_right : ('a -> 'acc -> 'acc) -> 'a list -> 'acc -> 'acc
```

两者在操作不满足结合律时会得到不同结果；在 OCaml 标准 List 实现中，`fold_left` 是尾递归的，而 `fold_right` 对很长列表可能消耗调用栈。

不要为了函数式外观把所有循环都改成复杂 fold。若累加器包含多个难以命名的 tuple，或每一步充满分支，一个显式递归函数往往更容易说明不变量。

## `bind`：后一步依赖前一步的成功值

`map` 适合普通转换：

```text
'a -> 'b
```

如果转换本身也可能失败：

```text
'a -> ('b, 'e) result
```

使用 `Result.map` 会产生嵌套结果：

```text
(('b, 'e) result, 'e) result
```

`Result.bind` 会在前一步成功时继续，并把失败直接保留：

```text
Result.bind :
  ('a, 'e) result ->
  ('a -> ('b, 'e) result) ->
  ('b, 'e) result
```

例如：

```ocaml
type validation_error =
  | Empty_name
  | Invalid_email

let validate_name name =
  let normalized = String.trim name in
  if normalized = "" then
    Error Empty_name
  else
    Ok normalized

let validate_email email =
  if String.contains email '@' then
    Ok email
  else
    Error Invalid_email

let create_user name email =
  validate_name name
  |> Result.bind (fun valid_name ->
       validate_email email
       |> Result.map (fun valid_email ->
            { name = valid_name; email = valid_email }))
```

如果名称失败，不再验证邮箱；如果邮箱失败，不构造用户；只有两步都成功才得到 `Ok user`。

### let operator：把依赖链写成顺序代码

可以为 `Result.bind` 定义 let operator：

```ocaml
let ( let* ) result next =
  Result.bind result next

let create_user name email =
  let* valid_name = validate_name name in
  let* valid_email = validate_email email in
  Ok {
    name = valid_name;
    email = valid_email;
  }
```

这段代码仍没有异常式的隐式跳转。每个 `let*` 都由当前作用域中的运算符定义展开；在这里，`Error` 被原样传播，`Ok value` 才进入后续函数。

Kotlin 可以用扩展函数、sealed result、Arrow，或在受控边界使用异常建立相似流程。OCaml let operator 的特别之处是语法本身不绑定某个具体抽象：`let*` 的含义由局部定义或模块决定，可以服务 Result、Option、异步计算或解析器。

这很强，也可能被滥用。若一个代码库为相似符号赋予不同语义，阅读成本会迅速上升；应建立清楚的模块与命名约定。

## 函数组合：把两段变换连接起来

可以定义一个组合运算符：

```ocaml
let ( >> ) first second value =
  value
  |> first
  |> second
```

类型为：

```text
val ( >> ) : ('a -> 'b) -> ('b -> 'c) -> 'a -> 'c
```

然后：

```ocaml
let normalize =
  String.trim
  >> String.lowercase_ascii

let normalized =
  normalize "  OCaml  "
```

组合得到的新函数没有提到中间值。它强调变换关系，而不是一次具体执行。

### point-free 不是成熟度指标

可以继续把参数全部消掉：

```ocaml
let active_names =
  List.filter is_active
  >> List.map name_of
```

当函数名足够清楚、组合链很短时，这很简洁；当存在多个相似类型、错误分支或调试点时，显式参数更容易读：

```ocaml
let active_names users =
  users
  |> List.filter is_active
  |> List.map name_of
```

“point-free”只是一种表达形式，不代表更函数式、更高级或更高效。好的代码应优先展示业务数据如何移动。

## 闭包：函数携带词法环境

函数可以引用定义位置周围的绑定：

```ocaml
let greater_than threshold =
  fun value ->
    value > threshold

let greater_than_ten =
  greater_than 10
```

返回函数捕获 `threshold`。即使 `greater_than` 的调用已经结束，`greater_than_ten` 仍保存需要的环境。

捕获不可变值通常容易推理；捕获可变引用则会让多次调用共享状态：

```ocaml
let make_counter () =
  let count = ref 0 in
  fun () ->
    count := !count + 1;
    !count

let next = make_counter ()

let first = next ()   (* 1 *)
let second = next ()  (* 2 *)
```

这段代码用闭包封装私有状态，在某些场景非常实用。但函数类型仍只是 `unit -> int`，看不出它会修改内部引用。OCaml 的普通函数类型不追踪副作用，因此纯度是一种设计纪律，而不是由类型系统普遍证明的性质。

Kotlin lambda 同样可以捕获外部变量：

```kotlin
fun makeCounter(): () -> Int {
    var count = 0
    return { ++count }
}
```

两门语言都需要警惕：看起来只是一个值的函数，可能隐藏共享状态、I/O 或异常。高阶函数提升了组合能力，但不会自动带来引用透明性。

## `unit`：明确“这个调用主要为了效果”

只有一个值 `()` 的 `unit` 类型，常出现在副作用函数中：

```ocaml
let log message =
  print_endline message
```

类型为：

```text
val log : string -> unit
```

它不是“没有返回类型”。函数仍然返回一个确定值 `()`，只是这个结果不携带业务信息。

需要显式触发效果、推迟初始化或重复执行时，常把 `unit` 作为参数：

```ocaml
let load_config () =
  (* 每次调用时读取配置 *)
  read_config_file "config.toml"
```

如果写成：

```ocaml
let config =
  read_config_file "config.toml"
```

读取会在绑定求值时发生一次，`config` 保存的是结果，不是可再次执行的操作。

Kotlin 的 `Unit` 具有相似角色，但 `fun loadConfig()` 的空参数列表是语言中普通的方法形式。OCaml 中的 `()` 是一个真实参数，体现“一参数函数”的统一模型。

## Kotlin Receiver 与 OCaml 普通函数

Kotlin 可以让函数在特定 Receiver 上调用：

```kotlin
fun String.normalized(): String =
    trim().lowercase()

val name = "  OCaml  ".normalized()
```

Receiver lambda 还能建立嵌套作用域和类型安全 DSL：

```kotlin
fun route(block: Route.() -> Unit) {
    Route().apply(block)
}
```

OCaml 通常把相同能力表达为模块中的普通函数：

```ocaml
module Name = struct
  type t = string

  let normalize value =
    value
    |> String.trim
    |> String.lowercase_ascii
end

let name =
  Name.normalize "  OCaml  "
```

或放进管道：

```ocaml
let name =
  "  OCaml  "
  |> Name.normalize
```

区别可以概括为：

| 维度 | Kotlin | OCaml |
|---|---|---|
| 操作发现 | 通过 Receiver 和 IDE 补全接近成员方法 | 通过模块名与函数签名查找 |
| 调用外观 | `value.transform()` | `transform value` 或 `value |> transform` |
| 部分应用 | 需要 lambda 或函数引用适配 | 柯里化函数自然支持 |
| DSL 作用域 | Receiver lambda、scope control、context parameter | 高阶函数、variant、module 与组合子 |
| 扩展约束 | extension 静态解析，不真正修改类型 | 普通函数不伪装成成员 |
| 优化工具 | `inline`、reified、JVM/JIT | 原生编译器内联、专门优化，但语义不保证零分配 |

Kotlin 的优势是调用点自然、工具发现性强，尤其适合大型框架 API；OCaml 的优势是函数关系更显式，操作不需要依附对象，也更容易被偏应用和组合。

## 一个完整的领域管道

下面构造一个订单导入流程：

```ocaml
type raw_order = {
  order_no : string;
  amount_text : string;
}

type order = {
  order_no : string;
  amount : int;
}

type import_error =
  | Empty_order_no
  | Invalid_amount of string
  | Non_positive_amount of int

let ( let* ) result next =
  Result.bind result next

let validate_order_no value =
  let normalized = String.trim value in
  if normalized = "" then
    Error Empty_order_no
  else
    Ok normalized

let parse_amount value =
  match int_of_string_opt value with
  | None -> Error (Invalid_amount value)
  | Some amount -> Ok amount

let validate_positive amount =
  if amount > 0 then
    Ok amount
  else
    Error (Non_positive_amount amount)

let import_order raw =
  let* order_no =
    validate_order_no raw.order_no
  in
  let* amount =
    raw.amount_text
    |> String.trim
    |> parse_amount
  in
  let* positive_amount =
    validate_positive amount
  in
  Ok {
    order_no;
    amount = positive_amount;
  }
```

这里有三种组合关系：

- 普通纯变换用 `|>` 串联；
- 结构内部转换可以用 `map`；
- 后一步可能失败且依赖前一步的值时使用 `bind` / `let*`。

类型最终为：

```text
val import_order :
  raw_order -> (order, import_error) result
```

调用方仅凭签名就能知道输入、成功值和全部领域错误类型。流程没有共享可变 builder，也不需要把每一步塞进 `OrderImporter` 的私有方法；真正的边界由数据类型和函数签名形成。

在 Kotlin 中，可以用 data class、sealed error 和扩展函数写出同样清晰的结构。区别仍不是“能不能”，而是默认路径：Kotlin 会诱导链式对象 API，OCaml 会诱导模块函数、偏应用和显式结果组合。

## 常见的组合失误

### 管道过长，没有领域名称

```ocaml
input
|> String.trim
|> String.lowercase_ascii
|> String.split_on_char ','
|> List.filter ...
|> List.map ...
|> List.fold_left ...
```

当管道开始承担多条业务规则，应把阶段命名：

```ocaml
let normalize_input = ...
let parse_fields = ...
let validate_fields = ...
let build_model = ...
```

管道擅长展示主流程，不应成为隐藏所有细节的单条巨型表达式。

### 为偏应用牺牲调用可读性

如果函数有多个相同类型参数，纯靠位置优化偏应用可能让调用点难以辨认。使用 labelled argument，或封装一个语义明确的配置 record。

### 混淆 `map` 与 `bind`

普通函数返回裸值时用 `map`；函数返回相同结构时用 `bind`。出现 `result result` 或 `option option`，通常意味着本该使用 `bind`。

### 把所有状态藏进闭包

闭包适合局部封装，但复杂、长期存在且需要观测的状态更适合显式 record、模块或状态机。隐藏状态会削弱函数签名的说明力。

### 迷恋自定义运算符

少量稳定的 `let*` 或组合运算符可以降低噪声；大量项目私有符号会让代码像另一门语言。若普通函数名更清楚，就使用普通函数名。

## 一套实用的函数设计顺序

设计 OCaml 函数时，可以依次检查：

1. **输入与输出是否纯粹**：先写最小的核心变换；
2. **哪些参数更稳定**：适合偏应用的配置放在前面；
3. **主要数据从哪里流入**：让它适合放在管道末端参数；
4. **同类型参数是否易混淆**：必要时使用 label；
5. **转换是否保留结构**：保留 List/Option/Result 外形时考虑 `map`；
6. **后一步是否返回同类上下文**：避免嵌套时考虑 `bind`；
7. **是否只是归约结构**：明确累加器后使用 `fold`；
8. **管道是否过长**：为具有领域意义的阶段命名；
9. **闭包捕获了什么**：特别检查 mutable state 和大型对象；
10. **副作用是否位于边界**：让核心规则保持容易测试。

## 结论：组合来自类型关系，不来自链式外观

OCaml 的函数式风格不是给每个值加一串漂亮的 `|>`。它建立在更基础的关系上：

- 柯里化把多参数函数统一为连续的一参数函数；
- 偏应用固定上下文，产生更专门的操作；
- 参数顺序决定 API 能否自然复用；
- pipeline 只改变阅读方向，不改变函数应用；
- `map` 转换上下文内部的值；
- `fold` 把结构归约为结果；
- `bind` 串联依赖前一步成功值的计算；
- 闭包携带环境，也可能携带隐藏状态；
- `unit` 让以副作用为目的的调用仍拥有明确类型。

Kotlin 通过 Receiver、extension 和链式调用，让操作像值自身的能力；OCaml 通过模块函数、柯里化和管道，让值显式穿过一组变换。Kotlin 更擅长构造自然的框架表面，OCaml 更擅长展示函数之间的输入输出关系。

真正值得学习的不是哪一种外观更优雅，而是分清三件事：当前步骤是普通转换、结构内映射，还是带上下文的依赖计算。分清之后，`map`、`fold`、`bind` 与普通函数就不再是一堆函数式术语，而是几种不同的数据关系。

## 下一章

下一章将进入模块系统：从 `.ml` / `.mli`、module、signature 与抽象类型开始，再解释 Functor 如何参数化整个模块，以及它与 Kotlin interface、泛型、object 和依赖注入的根本差异。

## 延伸阅读

- [OCaml 官方教程：Higher Order Functions](https://ocaml.org/docs/higher-order-functions)
- [OCaml 官方教程：Labelled and Optional Arguments](https://ocaml.org/docs/labels)
- [OCaml 官方教程：Pipelines](https://ocaml.org/docs/pipelines)
- [Real World OCaml：Lists and Patterns](https://dev.realworldocaml.org/lists-and-patterns.html)
- [OCaml Programming: Correct + Efficient + Beautiful—Higher-Order Programming](https://cs3110.github.io/textbook/chapters/hop/higher_order.html)
