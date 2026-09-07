---
title: Kotlin 协程：结构化并发
date: 2026-08-10
excerpt: 协程不是线程，也不只是回调的语法糖。理解结构化并发，才能写出真正健壮的异步代码。
chapter: 并发进阶
chapterOrder: 2
---

## 什么是协程？

协程（Coroutine）是 Kotlin 实现异步编程的核心机制。与线程不同，协程是**轻量的**——你可以同时运行数十万个协程而不耗尽内存。

```kotlin
import kotlinx.coroutines.*

fun main() = runBlocking {
    val job = launch {
        delay(1000L)
        println("世界")
    }
    println("你好，")
    job.join()
}
// 输出：你好，
//       世界
```

## 结构化并发

Kotlin 协程的关键设计是**结构化并发**：子协程的生命周期被限制在父作用域内，父作用域取消时，所有子协程自动取消。

```kotlin
suspend fun fetchUserData(userId: Int): User = coroutineScope {
    val profile = async { fetchProfile(userId) }
    val posts   = async { fetchPosts(userId) }
    User(profile.await(), posts.await())
}
```

两个请求并发执行，但任何一个失败都会取消整个作用域——不会有泄漏的协程在后台游荡。

## Flow：异步数据流

`Flow` 是协程世界的响应式流：

```kotlin
fun temperatureReadings(): Flow<Double> = flow {
    while (true) {
        emit(readSensor())
        delay(1000L)
    }
}

temperatureReadings()
    .filter { it > 30.0 }
    .collect { temp -> println("高温警告：$temp°C") }
```

## 调度器

| 调度器 | 用途 |
|--------|------|
| `Dispatchers.Main` | UI 线程（Android/Compose） |
| `Dispatchers.IO` | 网络、数据库、文件 IO |
| `Dispatchers.Default` | CPU 密集型计算 |

## 下一章

结构化并发不只规定协程必须属于某个作用域，还规定失败如何沿父子关系传播。下一章将深入 [`await`、`join` 与监督作用域](/collections/kotlin/await-join-supervision)：等待一个任务、读取一个结果，以及隔离一个失败，是三件不同的事。
