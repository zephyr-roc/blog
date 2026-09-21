---
title: Project Amber：让 Java 逐步获得更好的数据表达能力
date: 2026-09-21
excerpt: 从记录类、封闭层级与模式匹配出发，理解 Project Amber 如何用渐进式语法演进改善 Java 的数据建模和局部推理，并区分已经定稿的能力与 JDK 27 仍处预览阶段的 primitive patterns。
chapter: 语言演进与类型表达
chapterOrder: 10
---

Project Amber 不是一个可以通过 JVM 参数打开的单独功能。它是一组持续多年的 Java 语言改进：把程序员常写、编译器本来就能推断的仪式性代码逐步变成语言能力，同时保留 Java 的名义类型、独立编译和既有生态。

这条路线已经把 records、sealed classes、pattern matching for `instanceof`、switch pattern matching 和 record patterns 带入正式 Java。到 JDK 27，Amber 仍在探索 primitive type patterns：相关能力仍是预览特性，不能因为前面几项已经定稿就把整条路线统称为“稳定功能”。

理解 Amber 的关键是把它看成一套协作的语言模型：先把数据形状表达清楚，再让编译器根据类型层级检查分支是否完整，最后让代码直接按数据结构分解和处理。

## Java 语言演进面对的具体问题

传统 Java 很擅长表达具有身份和生命周期的对象：用户、连接、线程、订单实体都可以有可变状态、稳定引用和多态行为。但对“由少数字段组成的一条数据”，常见代码往往需要额外写很多样板：

- 构造器逐字段赋值；
- `equals`、`hashCode`、`toString` 重复维护；
- 为一组有限实现建立层级，却无法告诉编译器这个层级已经封闭；
- 读取不同子类型时不断 `instanceof`、强转和访问字段；
- 新增一种实现后，多个 `if/else` 或 `switch` 可能漏改。

这些问题彼此有关。只有数据载体简洁还不够；若类型层级和分支关系仍不可见，编译器就不能帮助检查“所有情况都处理了吗”。Amber 因而逐步引入数据类、封闭层级与模式匹配，而不是一次性塞进一套全新的代数数据类型系统。

## Project Amber 已经带来的语言能力

| 能力 | 定稿版本 | 解决的问题 |
|---|---:|---|
| Pattern Matching for `instanceof`（JEP 394） | JDK 16 | 类型检查成功后直接绑定匹配变量 |
| Records（JEP 395） | JDK 16 | 用组件声明透明的数据载体 |
| Sealed Classes（JEP 409） | JDK 17 | 限定直接子类型，显式表达封闭层级 |
| Pattern Matching for `switch`（JEP 441） | JDK 21 | 按运行时类型分支并检查覆盖关系 |
| Record Patterns（JEP 440） | JDK 21 | 在匹配时解构 record 组件 |
| Unnamed Patterns and Variables（JEP 456） | JDK 22 | 对不使用的数据位置明确写 `_` |
| Compact Source Files and Instance Main Methods（JEP 512） | JDK 25 | 降低小型程序和教学示例的外围样板 |
| Primitive Types in Patterns（JEP 532） | JDK 27 预览 | 扩展模式匹配对 primitive 的表达范围 |

上表强调阶段，而不是把每项都看作同一类 feature。`record`、sealed hierarchy、switch patterns 已属于正式语言能力；primitive patterns 在 JDK 27 仍须按对应 JEP 的预览规则启用和评估。

## Record 让“数据载体”成为显式声明

```java
record Point(int x, int y) {}
```

这不是简单生成一组 getter 的宏。record 声明本身给出了它的状态描述：两个组件同时定义构造参数、访问器、标准相等性、哈希和字符串表示。紧凑构造器还可以在字段赋值前校验并规范化输入：

```java
record Range(int start, int end) {
    Range {
        if (end < start) {
            throw new IllegalArgumentException("end < start");
        }
    }
}
```

Record 的组件是浅层不可变的：组件引用不能重新赋值，不代表引用指向的对象也不可变。它仍是 identity class，仍然可以有引用身份，不能把 record 等同于 Valhalla 的 Value Object 或 C# 的 value type。

这条边界很有用：record 适合表达“类型的状态就是这些组件”，普通 class 则适合隐藏实现、维护复杂可变状态或有意控制身份与生命周期。使用 record 并不会自动让对象变小，也不会承诺数组中的 record 被扁平化。

## Sealed Classes 把开放继承改成可检查的边界

假设形状只有圆和矩形：

```java
sealed interface Shape permits Circle, Rectangle {}

record Circle(double radius) implements Shape {}
record Rectangle(double width, double height) implements Shape {}
```

普通接口可以在未来由任意模块增加实现。`sealed` 则让声明者列出直接子类型，并要求这些子类型选择 `final`、`sealed` 或 `non-sealed` 等后续继承策略。编译器因此能够知道此层级是否封闭。

它不是运行时 sum type 标签，也不会使任意第三方接口自动封闭。编译器仍需按模块、包、源码可见性与编译版本规则检查 permits 列表。若允许某个分支 `non-sealed`，该分支又重新打开，穷举分析自然要把它当作一个开放区域。

封闭层级最直接的价值，是让模式匹配可以根据已知子类型检查穷举性；它还能帮助 API 设计者明确扩展点，让“可以扩展”和“有意不允许扩展”不再只靠文档约定。

## Pattern Matching 把类型测试和使用绑定在一起

旧式写法把一次逻辑拆为测试、强转和取值：

```java
if (value instanceof String) {
    String text = (String) value;
    return text.length();
}
```

`instanceof` pattern 将它收在一个作用域规则内：

```java
if (value instanceof String text) {
    return text.length();
}
```

`text` 只在编译器能够证明匹配成功的控制流区域中可用。它不是把变量“无条件声明到外层”，也不是动态语言式的隐式类型猜测；确定作用域仍由 Java 的流分析规则决定。

这很重要，因为模式匹配不仅缩短代码，还把一条证明写进语法：只有满足类型模式的路径才拥有匹配变量。编译器可沿 `&&`、否定、提前返回等控制流推断变量可用范围，同时拒绝无法证明匹配成功的路径。

## Switch Patterns 把有限类型层级变成决策表

```java
static double area(Shape shape) {
    return switch (shape) {
        case Circle c -> Math.PI * c.radius() * c.radius();
        case Rectangle r -> r.width() * r.height();
    };
}
```

因为 `Shape` 是 sealed，编译器可以检查这些分支是否覆盖所有许可子类型。之后如果加入 `Triangle`，原代码在重新编译时就能暴露缺失分支；这比运行到某个不常见输入才抛出默认异常更容易维护。

模式 switch 的编译器还会检查分支遮蔽和支配关系。若一个宽泛的 `case Shape s` 已经匹配所有输入，后面的 `case Circle c` 就不可达；编译器会拒绝这种顺序，而不是让阅读者自己猜哪条分支先执行。

穷举性依赖编译器实际能观察到的类型闭合信息。开放类层级、`non-sealed` 分支、旧版 class file 和跨模块兼容，都会影响 exhaustiveness 的证明。因此默认分支有时仍有意义：它可以表示面对未来未知值的兼容策略，而不是随手掩盖遗漏。

## Record Patterns 把“识别后取字段”合成结构化匹配

Record patterns 进一步把类型测试和组件解构放在一起：

```java
static String describe(Object value) {
    return switch (value) {
        case Point(int x, int y) -> "(" + x + ", " + y + ")";
        case null -> "missing";
        default -> "other";
    };
}
```

嵌套 record pattern 可以沿数据形状继续解构：

```java
record Address(String city, String street) {}
record Person(String name, Address address) {}

static String cityOf(Object value) {
    return switch (value) {
        case Person(String name, Address(String city, _)) -> city;
        default -> "unknown";
    };
}
```

这里的 `_` 是 unnamed pattern，表示这个分量被有意忽略。它比创建一个从来不用的变量更能表达意图，也避免将来加入 lint 警告时把真正误写和有意忽略混在一起。

Pattern matching 没有改变 record 的数据所有权，也没有变更其组件 getter 的语义。它只是让消费端描述“我关心哪一种结构、哪些分量”，再由编译器验证类型与控制流。

## `null` 是模式设计的一部分

Java `switch` 传统上对 null selector 抛出 `NullPointerException`。Pattern switch 允许显式 `case null`，让缺失状态进入同一决策表；没有该分支时，仍要按照对应语言规则处理 null，不能假定 pattern 自动把 null 变成“不匹配”。

这和 sealed hierarchy 的穷举是两件事：

- 穷举回答“所有许可子类型都覆盖了吗”；
- null 分支回答“空引用是否有单独业务含义”。

不要用一个宽泛 `default` 混淆二者。对网络输入、数据库字段或反序列化对象，null 可能是缺失、非法、未加载或未授权，不同含义应由 API 显式决定。

## Primitive Patterns 仍是预览能力

JDK 27 的 JEP 532 继续探索 primitive 类型如何参与 patterns、`instanceof` 与 `switch`。它要解决的不只是“让 `int` 能写在 case 标签里”，还涉及：

- primitive widening、boxing 与 unboxing 的转换规则；
- 浮点边界、NaN 和数值相等的语义；
- null 与 primitive wrapper 的互操作；
- 模式穷举分析遇到数值类型时能证明什么；
- 旧 API 接收 `Object`、新代码按 primitive 匹配时的运行时成本。

在预览语法中，primitive pattern 可以让程序按 primitive 类型和绑定值表达分支；具体语法与转换规则必须以目标 JDK 的 JEP 532 为准。预览特性需要使用该发行版的 preview 编译和运行选项，且未来版本仍可能调整。正式应用不应把它描述成所有 JDK 都支持的稳定语法。

Amber 此处体现了一种设计原则：先确定模式的含义、转换和穷举规则，再逐步扩大可匹配的类型集合。给每种类型添加看似方便的语法很容易，保证它能和 Java 的 overload、boxing、null、泛型及旧字节码共存要困难得多。

## Amber 的推进方式：小步预览，逐项定稿

Java 语言版本每半年发布一次。Amber 会把足够独立的能力拆成 JEP，在 preview 中收集使用反馈，再修订、再次预览或定稿。一个 feature 多次 preview 不一定意味着“没人做完”；它也可能说明设计触及类型系统、语法兼容或跨版本迁移，团队选择继续验证而不是冻结错误的规则。

实际观察版本状态时要逐项看 JEP：

| 状态 | 代码与发布含义 |
|---|---|
| Final / delivered | 已并入目标 JDK 的正式语言或库规范 |
| Preview | 有意让开发者试用并反馈；通常需 preview 编译选项 |
| Incubator | API 仍在孵化模块中，主要用于验证库设计 |
| Draft / design note | 设计尚未承诺进入某个发布版本 |

项目网页描述的是长期方向，不是一个版本号。记录类已经 final，并不能推导 Amber 的其他 proposal 也 final；同样，preview JEP 也不表示整个 Project Amber 都是实验性的。

## 和 Kotlin 的相似处与边界

Kotlin 提供 `data class`、`sealed class/interface` 和 `when`，在源码层面更早、更统一地鼓励代数数据建模。Java Amber 的 records、sealed types 与 pattern switch 看起来相近，但各自受不同语言模型约束：

| 维度 | Kotlin | Java Amber |
|---|---|---|
| 数据载体 | `data class` 自动生成组件操作 | `record` 是独立的名义类形态，组件构成其状态描述 |
| 封闭层级 | `sealed` 类型下的继承规则由 Kotlin 规范管理 | `sealed` 由 permits、模块/包和子类修饰共同约束 |
| 分支匹配 | `when` 可结合类型、值与属性条件 | `switch` pattern 与 Java 的类型系统、控制流分析整合 |
| 演进节奏 | 同一语言规范可较快协同推出相关语法 | Java 通过 preview、独立编译和旧 class file 兼容渐进演进 |
| 缺失值 | nullable type 是类型系统一等部分 | Java 引用仍允许 null，需显式分支或约定 |

Kotlin 的 `data class` 也仍是 JVM identity object，除非使用特定 inline/value class 语义；Java `record` 同样不等于 Valhalla Value Object。语法相似不代表对象布局、身份和 nullability 一样。

对 Java 团队而言，Amber 的价值更可能体现在大型既有代码库的局部迁移：先用 record 让 DTO 状态描述集中，再封闭真正封闭的类型层级，再把脆弱的强转链改成可穷举的模式 switch。开放扩展点继续保留普通接口与 class，不必为了“现代化”把所有对象改成 record。

## 迁移时应检查什么

- **API 演进**：向 sealed hierarchy 增加子类型会要求调用方重新审查穷举 switch。
- **数据语义**：record 的相等性基于组件，适合值相等的载体；不适合依赖 identity 的实体。
- **浅不可变**：组件若指向可变集合，record 本身不会自动复制或冻结集合。
- **null 策略**：switch 的 null 分支应反映业务规则，不要把 null 当成普通 default。
- **预览部署**：预览 class file 与运行时版本紧密相关；不要未经验证就跨生产服务分发。
- **构造兼容**：语言语法简化不改变反射、序列化框架和二进制库需要遵守的版本边界。

## 结论：Amber 在改进 Java 描述数据的方式

Project Amber 已交付的记录类、sealed types 与模式匹配，让 Java 可以更直接地描述“数据由什么组成”“实现集合是否封闭”“每种形状怎么处理”。新能力不是简单减少行数；编译器也因此能检查变量作用域、模式支配和分支覆盖。

JDK 27 的 primitive patterns 仍在预览，进一步说明 Java 语言特性需要经过类型转换、null、兼容性和控制流规则的共同验证。把稳定 JEP 与 preview proposal 分清，才能既使用已经成熟的能力，也不把未来方向写成今天的语言事实。

## 延伸阅读

- [Project Amber](https://openjdk.org/projects/amber/)
- [JEP 394：Pattern Matching for `instanceof`](https://openjdk.org/jeps/394)
- [JEP 395：Records](https://openjdk.org/jeps/395)
- [JEP 409：Sealed Classes](https://openjdk.org/jeps/409)
- [JEP 440：Record Patterns](https://openjdk.org/jeps/440)
- [JEP 441：Pattern Matching for `switch`](https://openjdk.org/jeps/441)
- [JEP 456：Unnamed Variables & Patterns](https://openjdk.org/jeps/456)
- [JEP 512：Compact Source Files and Instance Main Methods](https://openjdk.org/jeps/512)
- [JEP 532：Primitive Types in Patterns, `instanceof`, and `switch` (Fifth Preview)](https://openjdk.org/jeps/532)
