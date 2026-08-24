---
title: 使用 ADB 精简澎湃 OS 系统应用
date: 2026-08-24
excerpt: 无需 ROOT，通过 ADB 移除澎湃 OS 中的快应用、云控、分析、质量服务、广告服务和系统浏览器。
cover: /covers/hyperos-adb.svg
---

## 前言

澎湃 OS 预装了一些平时用不到、又可能在后台运行的系统组件。这次记录如何在不 ROOT 的情况下，通过 ADB 为当前用户卸载它们。

这里的命令只执行到“应用卸载”为止，不涉及系统参数修改、性能模式或超频。动手前请先备份重要数据，并确认电脑上已经安装 ADB。

> `pm uninstall --user 0` 只会为主用户移除应用，不会抹掉系统分区中的安装包。系统升级或恢复出厂设置后，应用可能重新出现。

## 准备工作

先在手机上打开开发者选项：

1. 进入“设置 → 我的设备 → 全部参数与信息”。
2. 连续点击“OS 版本”七次。
3. 返回“设置 → 更多设置 → 开发者选项”。
4. 打开“USB 调试”和“USB 调试（安全设置）”。

用数据线连接电脑，手机出现 USB 调试授权提示时选择允许。然后在电脑终端检查连接：

```bash
adb devices
```

看到设备序列号和 `device` 状态后，进入手机的 ADB Shell：

```bash
adb shell
```

下面的卸载命令都在这个 Shell 中执行。每条命令返回 `Success`，代表该应用已为当前用户卸载。

## 应用卸载

### 小米快应用框架

```bash
pm uninstall --user 0 com.miui.hybrid
```

如果不使用快应用，可以移除这个框架。卸载后也可以在系统设置中搜索“快应用”，确认入口是否已经消失。

### 小米云控（Joyose）

```bash
pm uninstall --user 0 com.xiaomi.joyose
```

Joyose 与部分设备的游戏调度、性能及功耗策略有关，是否卸载存在争议。如果经常玩游戏，或卸载后出现性能、温控异常，建议恢复它。

### 小米分析

```bash
pm uninstall --user 0 com.miui.analytics
```

用于系统数据分析与统计；不需要相关服务时可以移除。

### 小米质量服务

```bash
pm uninstall --user 0 com.miui.daemon
```

用于收集系统质量及诊断信息；不需要时可以移除。

### 小米内置广告服务

```bash
pm uninstall --user 0 com.miui.systemAdSolution
```

这是系统广告相关组件。移除后仍建议在各系统应用设置中关闭“个性化推荐”等开关。

### 系统浏览器

先安装并确认其他浏览器可以正常使用，再执行：

```bash
pm uninstall --user 0 com.android.browser
```

这条是原页面五项之外额外加入的系统浏览器卸载命令。

## 一次执行全部命令

确认六个组件都不需要后，可以逐行粘贴执行：

```bash
pm uninstall --user 0 com.miui.hybrid
pm uninstall --user 0 com.xiaomi.joyose
pm uninstall --user 0 com.miui.analytics
pm uninstall --user 0 com.miui.daemon
pm uninstall --user 0 com.miui.systemAdSolution
pm uninstall --user 0 com.android.browser
```

## 如何恢复

如果卸载后发现功能异常，可以用系统分区中保留的安装包恢复对应应用。把 `PACKAGE_NAME` 换成上面的包名：

```bash
cmd package install-existing --user 0 PACKAGE_NAME
```

例如恢复 Joyose：

```bash
cmd package install-existing --user 0 com.xiaomi.joyose
```

本文根据[澎湃 OS 优化工具教程](https://xiaomi.wxlnk.com/)整理，只总结到应用卸载部分，并按实际使用补充了浏览器卸载与恢复说明。
