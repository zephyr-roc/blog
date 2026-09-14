---
title: OCaml 对象系统：结构子类型、继承与开放递归
date: 2026-09-14
excerpt: 理解 OCaml 的 object、class、结构化对象类型、self type、继承与开放递归，并与 Kotlin 的名义类型、interface 和 extension function 比较。
chapter: 抽象与类型
chapterOrder: 6
---

OCaml 明明拥有 class、object、继承、方法、多态和结构子类型，却很少被首先介绍为面向对象语言。

原因不是对象系统残缺，而是它没有垄断封装与复用：

- record 与 variant 负责大部分数据建模；
- 函数负责变换；
- module 与 signature 负责大型抽象边界；
- object 只在“具有身份、动态分派并持续扩展行为”的问题上出现。

这与 Kotlin 的默认重心恰好相反。Kotlin 的顶层函数和扩展函数很强，但框架、业务服务和 UI 组件仍主要围绕 class/interface 组织；OCaml 则要求对象证明自己确实比普通数据与模块更合适。

## 直接创建对象

对象可以不先声明 class：

```ocaml
let counter =
  object
    val mutable value = 0

    method value =
      value

    method increment =
      value <- value + 1
  end
```

调用方法使用 `#`：

```ocaml
counter#increment;
let current = counter#value
```

编译器推导对象类型：

```text
< increment : unit; value : int >
```

对象类型列出公开方法，而不是某个必须继承的类名。

## 对象类型是结构化的

下面的函数不关心对象来自哪个 class：

```ocaml
let describe item =
  item#name ^ ": " ^ string_of_int item#size
```

只要传入对象至少拥有兼容的 `name` 和 `size` 方法，就可以调用。函数类型会包含开放对象行：

```text
< name : string; size : int; .. > -> string
```

末尾的 `..` 表示对象还可以有更多方法。

Kotlin interface 是名义的：

```kotlin
interface SizedItem {
    val name: String
    val size: Int
}
```

即使另一个类恰好有同名成员，只要没有显式实现 `SizedItem`，就不能作为该接口使用。

结构子类型降低了“为了适配而声明接口”的成本，也带来另一种风险：同名方法可能碰巧结构兼容，却不一定共享相同语义。类型形状一致并不自动保证领域契约一致。

## class 是对象构造器

class 可以接收参数并反复创建对象：

```ocaml
class counter initial =
  object
    val mutable value = initial

    method value =
      value

    method increment =
      value <- value + 1

    method add amount =
      value <- value + amount
  end
```

实例化：

```ocaml
let first = new counter 0
let second = new counter 100
```

class 自身不是普通运行时对象，而是创建对象的模板。其类型描述构造参数、实例对象类型以及可继承的类类型信息。

### immutable instance variable

实例变量默认不可变：

```ocaml
class user id name =
  object
    val id = id
    val name = name

    method id = id
    method name = name
  end
```

只有显式 `val mutable` 才能通过 `<-` 修改。和 record 一样，可变性需要出现在声明处。

## self 与开放递归

对象可以给 self 绑定名字：

```ocaml
class greeter name =
  object (self)
    method name =
      name

    method greeting =
      "Hello, " ^ self#name
  end
```

`self#greeting` 内部调用 `self#name` 时使用动态分派。子类重写 `name` 后，继承来的 `greeting` 会看到新实现。

这称为 open recursion：父类方法对 self 的调用保持开放，可以被继承层级中的重写影响。

Kotlin 的普通虚方法也具有类似行为：

```kotlin
open class Greeter {
    open fun name(): String = "base"

    fun greeting(): String =
        "Hello, " + name()
}
```

这种能力很强，也意味着构造期间调用可重写方法存在风险：子类状态可能尚未初始化。OCaml 对象同样不应在初始化顺序尚未稳定时依赖复杂动态分派。

## 继承与方法重写

```ocaml
class loud_greeter name =
  object
    inherit greeter name as super

    method! greeting =
      String.uppercase_ascii
        super#greeting
  end
```

`inherit` 引入父类实现，`as super` 允许显式调用父实现。`method!` 表示有意覆盖已有方法；如果父类没有这个方法，编译器会提醒。

多继承在语法上可行：

```ocaml
class combined =
  object
    inherit first_behavior
    inherit second_behavior
  end
```

但名称冲突、初始化顺序和状态关系会迅速变复杂。能用组合表达时，不应因为语言允许就建立深继承树。

## private method 与 virtual class

私有方法只能在对象内部调用：

```ocaml
class token raw =
  object (self)
    method private normalized =
      String.trim raw

    method render =
      "[" ^ self#normalized ^ "]"
  end
```

virtual class 声明尚未实现的方法：

```ocaml
class virtual shape =
  object (self)
    method virtual area : float

    method describe =
      Printf.sprintf "area=%f" self#area
  end
```

包含 virtual method 的 class 不能直接实例化，子类必须补齐实现。

这类似 Kotlin abstract class，但 OCaml 对象最终仍参与结构类型系统。调用方可以只要求 `< area : float; .. >`，不必知道对象是否继承 `shape`。

## object coercion：显式收窄可见方法

假设对象拥有额外方法：

```ocaml
class file =
  object
    method read = "content"
    method close = ()
  end
```

可以把它收窄为只暴露 `read` 的对象类型：

```ocaml
let readable =
  (new file :> < read : string >)
```

`:>` 是对象子类型 coercion。它不复制对象，只在类型层缩小可见能力。

这与 Kotlin 把具体类赋给接口变量相似，但 Kotlin 依赖显式 implements 关系；OCaml 依据方法结构判断是否允许 coercion。

## self type 与返回自身

方法返回 self 时，类型可能保留为开放的 self type：

```ocaml
class point initial_x initial_y =
  object
    val x = initial_x
    val y = initial_y

    method x = x
    method y = y
    method move dx dy =
      {< x = x + dx; y = y + dy >}
  end
```

`{< ... >}` 使用 functional object update 创建对象副本，并替换指定实例变量。它保留动态 self type，使子类调用继承方法时仍能得到子类兼容结果。

不过，对只包含数据的不可变 point，record 往往更简单：

```ocaml
type point = {
  x : int;
  y : int;
}

let move dx dy point =
  {
    x = point.x + dx;
    y = point.y + dy;
  }
```

选择 object 应来自动态分派或开放扩展需求，而不是因为数据“看起来像实体”。

## 多态方法

普通对象方法中的类型变量可能被整个对象类型固定。若希望一个方法在每次调用时独立实例化，需要显式声明多态方法：

```ocaml
class identity =
  object
    method apply : 'a. 'a -> 'a =
      fun value -> value
  end
```

于是同一对象可以：

```ocaml
let id = new identity

let number = id#apply 42
let text = id#apply "OCaml"
```

`'a.` 是显式全称量化。它比普通泛型方法更接近“这个方法对所有类型都成立”的契约。

高级对象类型、self type 与多态方法叠加后，错误信息会明显变厚。只有当动态对象确实需要通用方法时才应使用，不要把模块级参数化硬塞进对象。

## object、record、module 如何选择

### record + 函数

适合：

- 数据分支稳定；
- 变换是主要关注点；
- 希望使用模式匹配；
- 默认不可变；
- 不需要运行时动态分派。

### module + signature

适合：

- 隐藏表示；
- 一整组类型与函数构成组件；
- 依赖包含类型成员；
- 编译期组合比运行时实例替换更重要。

### object

适合：

- 多个运行时实例各自具有身份和状态；
- 调用方只关心方法结构；
- 需要动态分派；
- 行为比数据分支更容易扩展；
- 开放递归或对象替换确实简化设计。

一条实用判断是：

> 如果删除对象身份后，问题仍然只是“某种数据经过函数得到另一种数据”，优先使用 record/variant；如果调用必须根据运行时实例选择行为，object 才更自然。

## expression problem：两种扩展方向

假设有多个形状和多个操作。

variant 风格：

```ocaml
type shape =
  | Circle of float
  | Rectangle of float * float

let area = function
  | Circle radius ->
      Float.pi *. radius *. radius
  | Rectangle (width, height) ->
      width *. height
```

增加新操作很容易：再写一个覆盖全部构造器的函数。增加新形状则要修改所有匹配。

object 风格：

```ocaml
class type shape =
  object
    method area : float
  end

class circle radius =
  object
    method area =
      Float.pi *. radius *. radius
  end
```

增加新形状很容易：实现相同方法即可。增加所有对象都要支持的新操作，则要修改接口与每个实现。

这不是哪种范式更先进，而是变化轴不同：

- 数据分支稳定、操作常增加：variant 更自然；
- 操作接口稳定、实现种类常增加：object 更自然。

Kotlin 的 sealed class 与 interface 同样面对这个取舍，只是日常框架更偏向对象一侧。

## 对象系统为何不是 OCaml 主流中心

### 模式匹配无法直接穷尽对象种类

对象集合是开放的，编译器不能枚举未来所有实现。领域状态若需要穷尽审计，variant 更合适。

### 模块已经承担大型抽象

很多语言用 class 的静态成员、嵌套类型和接口组合解决的问题，OCaml module/signature/Functor 已经能更直接地表达。

### 结构类型可能让接口过于偶然

只要方法形状一致就兼容，适配方便，但大型领域有时更需要一个明确的名义身份。module signature 或显式 wrapper 可以让语义边界更清楚。

### 对象语法形成另一套概念体系

method、instance variable、class type、self type、coercion、private、virtual 和 inheritance 与核心函数/模块系统叠加后，会增加项目语言表面积。若收益只是少写一个参数，不值得。

## 与 Kotlin 的直接对照

| 维度 | Kotlin | OCaml |
|---|---|---|
| 类型关系 | class/interface 名义关系 | object type 结构关系 |
| 方法调用 | `value.method()` | `value#method` |
| 属性 | property 是核心语言能力 | 通常用无参数 method 暴露 |
| 扩展函数 | 静态解析，不改变真实成员 | 通常直接写普通函数 |
| 封装 | visibility + class/package/module | object visibility + module signature |
| 多态 | interface/abstract/open class | 结构对象类型、class type |
| 继承 | 单类继承 + 多接口 | 支持多继承，但应谨慎 |
| 模式匹配 | sealed hierarchy 可穷尽 | object 开放；variant 才是穷尽主力 |
| 依赖注入 | 构造器、interface、DI 框架 | 函数、record、Functor、first-class module 或 object |

Kotlin 的优势是统一：绝大多数开发者熟悉同一套对象模型，IDE 与框架也围绕它构建。OCaml 的优势是选择更精确：数据、模块和动态对象并不需要挤进同一个 class 概念。

## 常见误用

- 为每个 record 同时创建 getter 对象，失去模式匹配和简单值语义；
- 把 module signature 能解决的单例组件改成只有一个实例的 class；
- 用继承复用几行代码，却引入隐含初始化和 self dispatch；
- 认为结构兼容就代表领域语义兼容；
- 在构造期间调用可能被重写的方法；
- 使用 object 之后仍在外部依赖具体 class 名，既没有获得开放性，也增加了概念。

## 结论：对象是选择，不是默认宇宙

OCaml 对象系统提供了少见的组合：

- 直接对象表达式；
- 结构化对象类型；
- class 与 class type；
- 继承、重写和开放递归；
- 显式对象 coercion；
- self type 与 functional update；
- 多态方法。

它不是不完整的 Kotlin OOP，反而在结构子类型和 self type 上非常强。但 OCaml 的整体设计拒绝把所有抽象都归结为对象：封闭状态交给 variant，数据变换交给函数，编译期组件交给 module，运行时动态行为才交给 object。

学会 OCaml 对象系统的最终目的，不是以后到处使用 `class`，而是准确知道什么时候不用它。

## 下一章

下一章进入可变性、异常与资源生命周期：分析 `ref`、mutable record、array、循环、异常、backtrace 与 `Fun.protect`，理解 OCaml 如何在函数式核心外建立受控命令式边界。

## 延伸阅读

- [OCaml 官方教程：Objects](https://ocaml.org/docs/objects)
- [OCaml Manual：Classes and Objects](https://ocaml.org/manual/5.5/objectexamples.html)
