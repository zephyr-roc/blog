---
title: Kotlin 协程基础：挂起、作用域与调度器
date: 2026-08-10
excerpt: 协程不是线程，也不只是回调的语法糖。理解结构化并发，才能写出真正健壮的异步代码。
chapter: 并发进阶
chapterOrder: 2
---

## 挂起与恢复：协程不是线程

协程是可挂起、稍后恢复的计算。挂起时任务可以释放当前线程，恢复时也不保证回到原来的线程；`suspend` 描述的是调用协议，不等于自动切换后台线程。

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

## CoroutineScope 与 Job：任务归谁所有

Kotlin 协程的关键设计是**结构化并发**：子协程的生命周期被限制在父作用域内，父作用域取消时，所有子协程自动取消。

```kotlin
suspend fun fetchUserData(userId: Int): User = coroutineScope {
    val profile = async { fetchProfile(userId) }
    val posts   = async { fetchPosts(userId) }
    User(profile.await(), posts.await())
}
```

两个请求并发执行，但任何一个失败都会取消整个作用域——不会有泄漏的协程在后台游荡。

## Dispatcher：决定代码在哪执行

| 调度器 | 用途 |
|--------|------|
| `Dispatchers.Main` | UI 线程（Android/Compose） |
| `Dispatchers.IO` | 传统阻塞 I/O 的共享线程池 |
| `Dispatchers.Default` | CPU 密集型计算 |

调度器不决定任务寿命，`Job` 也不决定代码运行在哪个线程。二者都位于 `CoroutineContext` 中，但分别承担执行位置与生命周期职责。

## Flow：连续值的异步模型

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

## 下一章

结构化并发不只规定协程属于哪个作用域，还规定失败如何沿父子关系传播。下一章将深入 [Job、async 与监督](/collections/kotlin/await-join-supervision)：等待完成、读取结果和隔离失败是三件不同的事。
