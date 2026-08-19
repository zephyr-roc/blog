---
title: 初识 Nim：编译到 C 的高级语言
date: 2026-07-15
excerpt: Nim 有着 Python 般简洁的语法，却能编译为高效的 C 代码。它的宏系统让元编程变得真正实用。
---

## Nim 是什么？

Nim 是一门静态类型的编译型语言，语法灵感来自 Python，但性能直逼 C。它的独特之处在于：

- **编译为 C/C++/JavaScript**，几乎零运行时开销
- **强大的宏系统**，编译期代码生成
- **内存管理可选**，支持 GC 或手动内存管理

## 基础语法

```nim
# 类型推断
var name = "Nim"
let version = 2

# 过程（函数）
proc greet(who: string): string =
  "你好，" & who & "！"

echo greet("世界")  # 你好，世界！
```

## 序列与迭代

```nim
let numbers = @[1, 2, 3, 4, 5]

# 函数式风格
let evens = numbers.filter(n => n mod 2 == 0)
let doubled = evens.map(n => n * 2)

echo doubled  # @[4, 8]
```

## 为什么值得一学？

Nim 是那种让你感叹"原来语言还能这么设计"的存在。它的宏系统允许你在编译期操纵 AST，实现真正的零成本抽象——这在大多数语言里根本做不到。
