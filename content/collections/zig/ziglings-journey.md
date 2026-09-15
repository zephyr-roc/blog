---
title: 跟着 Ziglings 学 Zig
date: 2026-09-15
excerpt: 以 Ziglings 的破损小程序为线索，记录从编译错误到语言规则的亲手推导过程。
chapter: 跟着 Ziglings 学 Zig
chapterOrder: 8
---

> 本章由 Zephyr 亲自完成。这里先建立章节入口，不预先给出练习答案。

## 为什么从 Ziglings 开始

前两章已经建立了 Zig 的整体视角与类型基础。接下来会沿着 Ziglings 的练习顺序，通过修复一个个小程序，把声明、控制流、指针、错误处理和 comptime 从“读懂”变成“会用”。

本章保留真实的解题过程：先记录编译器给出的线索，再解释修改背后的规则，最后补上可以迁移到工程代码中的结论。

<!--
后续可按练习组追加小节，建议沿用以下骨架：

## 练习 N：主题

### 先看见什么

保留关键报错或行为，不必粘贴完整终端输出。

### 为什么会失败

解释语言规则，以及最初的直觉为什么不成立。

### 最小修改

只展示理解规则所需的代码差异，避免直接堆放整份答案。

### 带回工程里的结论

记录这道练习如何影响真实 API、数据结构或调试方法。
-->

## 学习记录

_待作者从第一组练习开始补充。_

## 入口

- [Ziglings 项目](https://codeberg.org/ziglings/exercises)
- [Zig Learn](https://ziglang.org/learn/)
- [Zig 0.16.0 Language Reference](https://ziglang.org/documentation/0.16.0/)

