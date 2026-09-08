---
title: 访问控制
date: 2026-09-08
excerpt: 通过声明、文件和模块来管理代码的可见性
chapter: 语言指南
chapterOrder: 28
---

> 本文迁移自 SwiftGG 中文版《The Swift Programming Language 6.2.3》的[“访问控制”](https://doc.swiftgg.team/documentation/the-swift-programming-language/accesscontrol/)，原文由 Apple Inc.、Swift 项目作者及 SwiftGG 译者贡献，依据 Apache License 2.0（含 Runtime Library Exception）发布。本站仅做 Markdown、链接与版式适配。

通过声明、文件和模块来管理代码的可见性

**访问控制**可以限制其它源文件或模块对你的代码的访问。这个特性让你能够隐藏代码的实现细节，并指定一个接口来让别人访问和使用你的代码。

你可以给单个类型（类、结构体和枚举）设置特定的访问级别，也可以给这些类型的属性、方法、构造器、下标等设置访问级别。协议可以被限制在特定的上下文中，全局常量、变量和函数也可以如此。

Swift 不仅提供了多种访问级别，还为典型场景提供了默认的访问级别，这样就减少了我们需要显式指定访问级别的情况。实际上，如果你在开发一个单 target 的应用程序，可能完全不需要显式指定访问级别。

> 注意: 为了简洁起见，代码里可以应用访问控制的各个部分（属性、类型、函数等）在接下来的内容中将被统称为“实体”。

## 模块、源文件和包

Swift 的访问控制模型是基于模块、源文件和包（packages）这三个概念的。

**模块**是代码分发的独立单元，例如将一个框架或应用程序作为一个整体构建和发布，并且可以通过 Swift 的 `import` 关键字被其他模块导入。

在 Swift 中，Xcode 的每个构建目标（例如应用程序或框架）都被视为一个独立的模块。如果你将应用程序中的部分代码打包成一个独立的框架——以便封装这些代码并在多个应用程序中重用，那么当这个框架被导入到某个应用程序或其他框架中使用时，你在框架中定义的所有内容都将属于这个独立的模块。

**源文件**是模块中的一个 Swift 源代码文件（实际上是应用程序或框架中的一个文件）。虽然通常会将不同的类型分别定义在不同的源文件中，但同一个源文件也可以包含多个类型、函数等的定义。

**包**是一组模块的集合，这些模块作为一个整体进行开发。选择哪些模块来构成一个包，是在我们所使用的构建系统中配置的，而不是在 Swift 源代码中。例如，如果使用 Swift Package Manager 构建代码，你会在 `Package.swift` 文件中使用 [PackageDescription][] 模块的 API 来定义包；如果使用 Xcode，你会在“Package Access Identifier”构建设置中指定包名。

[PackageDescription]: https://developer.apple.com/documentation/packagedescription

## 访问级别

Swift 为代码中的实体提供了六种不同的**访问级别**。这些访问级别取决于实体所在的源文件、源文件所属的模块，以及模块所属的包。

- *open* 和 *public* 允许实体被同一模块内的任意源文件使用，也可以在导入该模块的其他模块的源文件内使用。通常使用 open 或 public 访问级别来指定框架的公共接口。open 和 public 访问级别的区别将在下文中说明。
- *package* 允许实体被同一模块内的任意源文件使用，但不能在包外的源文件内使用。通常在包含多个模块的应用或框架中使用 package。
- *internal* 允许实体被同一模块内的任意源文件使用，但不能在模块外的源文件中使用。通常在定义应用或框架的内部结构体时使用 internal。
- *fileprivate* 将对实体的使用限制在定义它的源文件内。当某个功能的实现细节只需要在当前文件中使用时，可以使用 fileprivate 来隐藏这些实现细节。
- *private* 将对实体的使用限制在其声明的作用域内，以及同一文件中该声明的扩展（extension）内。当某个功能的实现细节只在单个声明内部使用时，可以使用 private 来隐藏这些实现细节。

open 是最高（限制最少）的访问级别，而 private 是最低（限制最多）的访问级别。

open 仅适用于类及类的成员，它与 public 的不同之处在于 open 允许模块外的代码进行继承和重写，如下文 [子类](/collections/swift/access-control#子类) 中所述。将类显式指定为 open 表明你已考虑到其他模块的代码将该类用作父类的影响，并为此相应地设计了类的代码。

### 访问级别的指导原则

Swift 的访问级别遵循一个指导原则：**实体的定义都不能依赖于访问级别更低（更严格）的其他实体**。

例如:

- 一个 public 的变量，其类型的访问级别不能是 internal，fileprivate 或 private，因为在 public 变量被使用的地方，这些类型可能无法访问。
- 函数的访问级别不能高于它的参数类型和返回类型的访问级别，因为函数可能会在这些类型不可用的情况下被调用。

这一指导原则对语言不同方面的具体影响将在下文中详细说明。

### 默认访问级别

在代码中，所有实体（除了一些本章稍后会提到的特例）如果没有显式指定访问级别，那么默认的访问级别是 internal。因此，在多数情况下你不需要在代码中显式指定访问级别。

### 单 Target 应用程序的访问级别

当你编写一个简单的单 target 应用程序时，这些代码通常都是只供自己使用，而不需要在应用模块之外使用。因为默认的 internal 访问级别已经满足了这个需求，所以无需额外指定访问级别。但是，你也可以将某些代码的访问级别指定为 fileprivate 或 private，以便在模块内隐藏这部分代码的实现细节。

### 框架的访问级别

当你开发框架时，应将框架的对外接口指定为 open 或 public，以便其他模块（如导入该框架的应用）可以查看和访问这些接口。这个对外接口就是框架的应用程序接口（application programming interface，即 API）。

> 注意: 框架的内部实现细节仍然可以使用默认的访问级别 internal，当你需要对框架内部其它部分隐藏细节时可以使用 private 或 fileprivate。对于框架的 API 部分，你就需要将它们设置为 open 或 public 了。

### 单元测试 Target 的访问级别

当你编写包含单元测试 target 的应用程序时，需要将应用程序中的代码暴露给该模块以便进行测试。默认情况下，只有指定为 open 或 public 的实体才能被其他模块访问。不过，如果你在导入产品模块时使用了 `@testable` 属性，并且在编译时启用了测试选项，那么单元测试 target 就可以访问所有 internal 实体。

## 访问控制语法

通过在实体声明的前面添加 [访问级别](/collections/swift/access-control#访问级别) 中列出的修饰符之一（例如 `public` 或 `private`）来定义该实体的访问级别。例如：

```swift
public class SomePublicClass {}
internal struct SomeInternalStruct() {}
private func somePrivateFunction() {}
```

上面的代码将 `SomePublicClass` 声明为 public，将 `SomeInternalStruct` 声明为 internal，将 `somePrivateFunction()` 声明为 private。如果你不写显式的访问级别，默认的访问级别修饰符是 `internal`，如 [默认访问级别](/collections/swift/access-control#默认访问级别) 中所述。例如，在下面的代码中，`SomeInternalStruct` 隐式地是 internal：

```swift
struct SomeInternalStruct() {}
```

## 自定义类型

如果想为一个自定义类型指定访问级别，在定义类型时进行指定即可。这个新类型就可以在其访问级别允许的地方使用。例如，你定义了一个 fileprivate 访问级别的类，那么该类只能在定义它的源文件中使用——可以作为属性的类型、函数的参数类型或函数的返回类型。

一个类型的访问级别也会影响该类型的成员（其属性、方法、构造器和下标）的默认访问级别。如果你将一个类型的访问级别定义为 `private` 或 `fileprivate`，那么该类型的成员的默认访问级别也会是 `private` 或 `fileprivate`。如果你将一个类型的访问级别定义为 `internal` 或 `public`（或者使用 `internal` 的默认访问级别，而不显式指定访问级别），那么该类型的成员的默认访问级别将是 `internal`。

> 重要提示: `public` 类型的成员默认具有 `internal` 访问级别，而不是 `public`。如果你想让某个成员是 `public`，必须显式地将其指定为 `public`。这样可以确保公共 API 都是你经过选择才发布的，避免错误地将内部使用的接口公开。

```swift
public class SomePublicClass {                   // 显式指定为 public 类
    public var somePublicProperty = 0            // 显式指定为 public 类成员
    var someInternalProperty = 0                 // 隐式指定为 internal 类成员
    fileprivate func someFilePrivateMethod() {}  // 显式指定为 fileprivate 类成员
    private func somePrivateMethod() {}          // 显式指定为 private 类成员
}

class SomeInternalClass {                        // 隐式指定为 internal 类
    var someInternalProperty = 0                 // 隐式指定为 internal 类成员
    fileprivate func someFilePrivateMethod() {}  // 显式指定为 fileprivate 类成员
    private func somePrivateMethod() {}          // 显式指定为 private 类成员
}

fileprivate class SomeFilePrivateClass {         // 显式指定为 fileprivate 类
    func someFilePrivateMethod() {}              // 隐式指定为 fileprivate 类成员
    private func somePrivateMethod() {}          // 显式指定为 private 类成员
}

private class SomePrivateClass {                 // 显式指定为 private 类
    func somePrivateMethod() {}                  // 隐式指定为 private 类成员
}
```



### 元组类型

元组类型的访问级别是由元组中访问级别最严格的类型决定的。例如，你构建了一个包含两种不同类型的元组，其中一个是 `internal` 访问级别，另一个是 `private` 访问级别，那么这个元组的访问级别将是 `private`。











> 注意: 元组类型不像类、结构体、枚举和函数那样有单独的定义。元组类型的访问级别是根据构成该元组类型的各个类型的访问级别自动确定的，不能显式指定。

### 函数类型

函数类型的访问级别是根据函数的参数类型和返回类型中最严格的访问级别计算得出的。如果函数计算出的访问级别与上下文默认值不匹配，则必须在函数定义中显式指定访问级别。

下面的例子定义了一个名为 `someFunction()` 的全局函数，并且没有明确地指定其访问级别。你可能会认为这个函数会具有 `internal` 的默认访问级别，但事实并非如此。实际上，`someFunction()` 按照下面这种写法将无法编译：

```swift
func someFunction() -> (SomeInternalClass, SomePrivateClass) {
    // 此处是函数实现部分
}
```



该函数的返回类型是一个元组类型，由上面 [自定义类型](/collections/swift/access-control#自定义类型) 中定义的两个自定义类组成。其中一个类被定义为 `internal`，另一个类被定义为 `private`。因此，这个元组类型的访问级别是 `private`（组成元组的类型中最严格的访问级别）。

因为函数的返回类型是 `private`，所以你必须在函数声明中使用 `private` 修饰符指定函数的访问级别，这样才能使函数声明有效：

```swift
private func someFunction() -> (SomeInternalClass, SomePrivateClass) {
    // 此处是函数实现部分
}
```



将 `someFunction()` 函数指定为 `public` 或 `internal`，或者使用默认的 `internal` 访问级别都是非法的，因为函数的 `public` 或 `internal` 使用者可能无法访问函数返回类型中的 `private` 类。

### 枚举类型

枚举成员的访问级别和其所属的枚举类型相同。你不能为单个枚举成员指定不同的访问级别。

在下面的例子中，`CompassPoint` 枚举被显式指定为 `public` 访问级别。因此，枚举成员 `north`、`south`、`east` 和 `west` 也具有 `public` 访问级别：

```swift
public enum CompassPoint {
    case north
    case south
    case east
    case west
}
```







#### 原始值和关联值

枚举定义中的原始值或关联值的类型，其访问级别至少不能低于该枚举的访问级别。例如，你不能在访问级别为 `internal` 的枚举中使用 `private` 类型作为原始值类型。

### 嵌套类型

嵌套类型的访问级别和包含它的类型的访问级别相同，除非包含它的类型是 `public`。定义在 `public` 类型中的嵌套类型，其访问级别默认是 `internal`。如果你想让这个嵌套类型拥有 `public` 访问级别，那么必须显式将其声明为 `public`。











## 子类

你可以继承同一模块中的所有有访问权限的类，也可以继承不同模块中被 `open` 修饰的类。子类的访问级别不得高于父类的访问级别。例如，你不能写一个 `public` 的子类来继承 `internal` 的父类。

此外，对于同一模块中定义的类，你可以重写在上下文中可访问的任意类成员（方法、属性、构造器或下标）。对于在其他模块中定义的类，你可以重写访问级别为 `open` 的任意类成员。

通过重写可以给子类的成员提供更高的访问级别。下面的例子中，类 `A` 是一个 `public` 类，它有一个 `fileprivate` 的方法 `someMethod()`。类 `B` 是 `A` 的子类，其访问级别降低为 `internal`。但是，类 `B` 将 `someMethod()` 的访问级别重写为 `internal`，其访问级别高于原来的访问级别：

```swift
public class A {
    fileprivate func someMethod() {}
}

internal class B: A {
    override internal func someMethod() {}
}
```



即使子类成员的访问级别高于父类成员，只要调用父类成员的操作发生在允许的访问级别上下文中（例如，在同一源文件中调用父类 `fileprivate` 成员，在同一模块内调用父类 `internal` 成员），那么子类成员调用访问权限较低的父类成员也是合法的：

```swift
public class A {
    fileprivate func someMethod() {}
}

internal class B: A {
    override internal func someMethod() {
        super.someMethod()
    }
}
```



因为父类 `A` 和子类 `B` 定义在同一个源文件中，所以子类 `B` 可以在重写的 `someMethod()` 方法中调用 `super.someMethod()`。

## 常量、变量、属性、下标

常量、变量或属性的访问级别不能高于其类型的访问级别。例如，如果一个属性的类型的访问级别是 `private`，那么不能将这个属性的访问级别指定为 `public`。同样，下标的访问级别不能高于其索引类型或返回类型的访问级别。

如果常量、变量、属性或下标的类型的访问级别是 `private`，那么也必须将它们的访问级别指定为 `private`：

```swift
private var privateInstance = SomePrivateClass()
```





### Getters 和 Setters

常量、变量、属性和下标的 `getter` 和 `setter` 会自动获得与它们所属的常量、变量、属性或下标相同的访问级别。

你可以为 `setter` 指定一个比对应 `getter` 更低的访问级别，以限制该变量、属性或下标的读写范围。你可以通过在 `var` 或 `subscript` 关键字之前写上 `fileprivate(set)`、`private(set)`、`internal(set)` 或 `package(set)` 来指定较低的访问级别。

> 注意: 这个规则同时适用于存储属性和计算属性。即使你没有为存储属性显式编写 `getter` 和 `setter`，Swift 仍会为你合成一个隐式的 `getter` 和 `setter`，用于访问该属性的存储内容。无论是隐式合成的 `setter`，还是像计算属性中显式编写的 `setter`，使用 `fileprivate(set)`、`private(set)`、`internal(set)` 和 `package(set)` 都可以改变 `setter` 的访问级别。

下面的例子定义了一个名为 `TrackedString` 的结构体，它记录了一个字符串属性被修改的次数：

```swift
struct TrackedString {
    private(set) var numberOfEdits = 0
    var value: String = "" {
        didSet {
            numberOfEdits += 1
        }
    }
}
```



`TrackedString` 结构体定义了一个用于存储 `String` 的属性 `value`，并将初始值设为 `""`（空字符串）。该结构体还定义了一个用于存储 `Int` 的属性 `numberOfEdits`，它用于记录属性 `value` 被修改的次数。这个功能是通过 `value` 属性上的 `didSet` 属性观察器实现的，每当给 `value` 赋新值时，`numberOfEdits` 都会递增。

结构体 `TrackedString` 和它的属性 `value` 都没有显式指定访问级别，所以它们都具有默认的访问级别 `internal`。然而，`numberOfEdits` 属性的访问级别被指定为 `private(set)`，这意味该属性的 `getter` 仍然具有 `internal` 的默认访问级别，但只能在 `TrackedString` 结构体内部进行赋值。这使得该属性只能在结构体内部修改，而在结构体的外部呈现为一个只读属性。





如果你创建一个 `TrackedString` 实例并多次修改它的字符串值，你就会看到 `numberOfEdits` 属性的值和修改次数一致：

```swift
var stringToEdit = TrackedString()
stringToEdit.value = "This string will be tracked."
stringToEdit.value += " This edit will increment numberOfEdits."
stringToEdit.value += " So will this one."
print("The number of edits is \(stringToEdit.numberOfEdits)")
// 打印“The number of edits is 3”。
```



虽然你可以从其他源文件中查询 `numberOfEdits` 属性的当前值，但不能从其他源文件中**修改**该属性。这个限制保护了 `TrackedString` 的编辑跟踪功能的实现细节，同时还提供了该功能方便的访问方式。

需要注意的是，你可以在必要时为 `getter` 和 `setter` 分别指定显式的访问级别。下面的例子将 `TrackedString` 结构体显式指定为了 `public` 访问级别。结构体的成员（包括 `numberOfEdits` 属性）拥有默认的访问级别 `internal`。你可以组合 `public` 和 `private(set)` 修饰符把结构体中的 `numberOfEdits` 属性的 `getter` 的访问级别设置为 `public`，而 `setter` 的访问级别设置为 `private`：

```swift
public struct TrackedString {
    public private(set) var numberOfEdits = 0
    public var value: String = "" {
        didSet {
            numberOfEdits += 1
        }
    }
    public init() {}
}
```











## 构造器

自定义构造器的访问级别可以低于或等于它所初始化的类型。唯一的例外是必要构造器（如 [必要构造器](/collections/swift/initialization#必要构造器) 中定义的）。必要构造器必须具有与其所属类相同的访问级别。

与函数和方法的参数一样，构造器的参数类型的访问级别不能比构造器自身的访问级别更严格。

### 默认构造器

如 [默认构造器](/collections/swift/initialization#默认构造器) 中所述，Swift 会为结构体和类自动生成一个不带参数的**默认构造器**，只要它们为所有存储型属性设置了默认初始值，并且未提供自定义的构造器。

默认构造器的访问级别与它所初始化的类型相同，除非该类型被定义为 `public`。对于 `public` 类型，默认构造器的访问级别将为 `internal`。如果你想让 `public` 类型在另一个模块中可以通过无参数构造器进行初始化，则必须在类型定义中显式提供一个 `public` 访问级别的无参数构造器。

### 结构体默认的成员逐一构造器

对于结构体类型，如果结构体中的任何一个存储属性是 `private`，则默认的成员逐一构造器的为 `private`。同样，如果任何存储属性是 `fileprivate`，则默认的成员逐一构造器为 `fileprivate`。否则，默认的成员逐一构造器为 `internal`。

与前面提到的默认构造器一样，如果你想让 `public` 结构体类型在其他模块中可以通过成员逐一构造器进行初始化，则必须在类型定义中显式提供一个 `public` 的成员逐一构造器。

## 协议

如果你想为协议类型显式指定访问级别，需要在定义协议时进行指定。这将限制该协议只能在特定的访问级别范围内被遵循。

协议定义中的每个要求都必须具有和该协议相同的访问级别。你不能将协议要求的访问级别设置为其他访问级别。这样才能确保遵循该协议的任何类型都能访问协议中的所有要求。



> 注意: 如果你定义了一个 `public` 协议，那么在实现该协议时，协议的所有要求也需要具有 `public` 访问级别。这点与其他类型不同，在其他类型中，如果类型的访问级别是 `public`，通常意味着该类型的成员具有 `internal` 访问级别。











### 协议继承

如果你定义了一个继承自其他协议的新协议，那么新协议的访问级别最高也只能与其继承的协议相同。例如，你不能定义一个继承自 `internal` 协议的 `public` 协议。

### 协议遵循

一个类型可以遵循比其自身访问级别更低的协议。例如，你可以定义一个 `public` 类型，使其可以在其他模块中使用，但该类型对 `internal` 协议的遵循只能在定义该 `internal` 协议的模块中使用。

遵循协议时的上下文访问级别是类型和协议中访问级别最低的那个。例如，如果一个类型是 `public` 的，但它遵循 `internal` 协议，那么这个类型对该协议遵循的上下文访问级别也是 `internal` 的。

当你编写或扩展一个类型让它遵循一个协议时，你必须确保该类型对协议每一个要求的实现至少与协议的访问级别一致。例如，如果一个 `public` 类型遵循一个 `internal` 协议，那么该类型对协议每一个要求的实现必须至少是 `internal`。

> 注意: Swift 和 Objective-C 一样，协议遵循是全局的。在同一程序中，一个类型不可能用两种不同的方式遵循同一个协议。

## 扩展

可以在访问级别允许的情况下对类、结构体或枚举进行扩展。在扩展中添加的类型成员具有与原始类型中声明的类型成员相同的默认访问级别。如果你扩展的是 `public` 或 `internal` 类型，那么任何新增的类型成员默认的访问级别是 `internal`。如果你扩展的是 `fileprivate` 类型，那么新增的类型成员默认的访问级别是 `fileprivate`。如果你扩展的是 `private` 类型，那么新增的类型成员默认的访问级别是 `private`。

或者，你可以使用显式的访问级别修饰符（例如 `private`）标记一个扩展，从而为扩展内定义的所有成员指定一个新的默认访问级别。在此扩展内，这个新的默认级别仍然可以被单个类型成员显式指定的访问级别所覆盖。

如果你使用扩展来遵循协议的话，就不能为扩展提供显式的访问级别修饰符。在这种情况下，协议自身的访问级别将被用作扩展中每个协议要求的实现的默认访问级别。









### 扩展的私有成员

扩展同一文件内的类，结构体或者枚举，扩展里的代码会表现得跟声明在原始类型里的一模一样。因此，你可以：

- 在原始声明中声明一个 `private` 成员，并在同一文件中的扩展中访问该成员。
- 在一个扩展中声明一个 `private` 成员，并在同一文件中的另一个扩展中访问该成员。
- 在扩展中声明一个 `private` 成员，并在同一文件中的原始声明中访问该成员。

这意味着你可以使用扩展来组织你的代码，无论你的类型是否包含 `private` 成员。例如，给定下面这样一个简单的协议：

```swift
protocol SomeProtocol {
    func doSomething()
}
```



你可以使用扩展来添加协议遵循，就像这样：

```swift
struct SomeStruct {
    private var privateVariable = 12
}

extension SomeStruct: SomeProtocol {
    func doSomething() {
        print(privateVariable)
    }
}
```



## 泛型

泛型类型或泛型函数的访问级别取决于它本身的访问级别和其类型参数的类型约束的访问级别，最终由这些访问级别中的最低者决定。

## 类型别名

在访问控制层面，你定义的任何类型别名都被视为独立的类型。类型别名的访问级别不可以高于其表示的类型的访问级别。例如，一个 `private` 类型别名可以作为 `private`、`fileprivate`、`internal`、`public` 或 `open` 类型的别名，但一个 `public` 类型别名不能作为 `internal`、`fileprivate` 或 `private` 类型的别名。

> 注意: 这条规则也适用于为满足协议遵循而将类型别名用于关联类型的情况。

---

[← 内存安全](/collections/swift/memory-safety) · [高级运算符 →](/collections/swift/advanced-operators)
