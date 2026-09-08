---
title: Kotlin 语言基础：空安全、数据类与扩展函数
date: 2026-08-01
excerpt: 从空安全、值语义和扩展函数建立 Kotlin 的基础模型，理解语言如何在保持 JVM 互操作的同时减少样板代码与空指针风险。
chapter: 基础入门
chapterOrder: 1
---

Kotlin 的核心价值不是把 Java 语法缩短，而是把常见工程约束放进类型系统与语言约定。本章先建立三个最常用的基础：显式可空类型、值对象和无需继承的扩展函数。

## 空安全：让 null 进入类型系统

Kotlin 的类型系统将可空性纳入语言层面。`String` 永远不为 null，而 `String?` 则是显式可空类型。

```kotlin
val name: String = "Kotlin"   // 不可为 null
val opt: String? = null       // 可以为 null，编译器强制处理

println(opt?.length ?: 0)     // 安全调用 + Elvis 运算符
```

## 数据类：声明值语义

告别 Java 的 getter/setter 样板代码：

```kotlin
data class User(val id: Long, val name: String, val email: String)

// 自动生成 equals、hashCode、toString、copy
val user = User(1, "积雨云", "hi@example.com")
val updated = user.copy(name = "新名字")
```

## 扩展函数：在类型外定义操作

无需继承就能给已有类型添加方法：

```kotlin
fun String.isPalindrome(): Boolean =
    this == this.reversed()

println("racecar".isPalindrome()) // true
```

## 下一章

掌握基本类型表达后，下一章进入 [协程基础](/collections/kotlin/coroutines)，建立挂起、任务作用域与调度器的统一执行模型。
