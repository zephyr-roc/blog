---
title: Kotlin 入门：为什么选择它？
date: 2026-08-01
excerpt: 从 Java 迁移到 Kotlin 的理由已经不需要反复讨论了——它更简洁、更安全，而且与现有 JVM 生态完全兼容。
---

## 为什么是 Kotlin？

Kotlin 由 JetBrains 在 2011 年发布，2017 年成为 Android 开发的官方推荐语言。它的设计目标从一开始就很明确：**比 Java 更简洁，比 Scala 更实用**。

### 空安全

Kotlin 的类型系统将可空性纳入语言层面。`String` 永远不为 null，而 `String?` 则是显式可空类型。

```kotlin
val name: String = "Kotlin"   // 不可为 null
val opt: String? = null       // 可以为 null，编译器强制处理

println(opt?.length ?: 0)     // 安全调用 + Elvis 运算符
```

### 数据类

告别 Java 的 getter/setter 样板代码：

```kotlin
data class User(val id: Long, val name: String, val email: String)

// 自动生成 equals、hashCode、toString、copy
val user = User(1, "积雨云", "hi@example.com")
val updated = user.copy(name = "新名字")
```

### 扩展函数

无需继承就能给已有类型添加方法：

```kotlin
fun String.isPalindrome(): Boolean =
    this == this.reversed()

println("racecar".isPalindrome()) // true
```

## 下一步

入门之后，协程是你最值得投入时间的特性——它彻底改变了你写异步代码的方式。
