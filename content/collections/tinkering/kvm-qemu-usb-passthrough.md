---
title: KVM/QEMU 的 USB 设备直通怎么选
date: 2026-08-24
excerpt: 从单个 U 盘、打印机到整块 USB 控制器，直通方式不同，热插拔、稳定性和宿主机占用也完全不同。
---

## 三种接法

KVM/QEMU 使用 USB 外设时，常见方案可以分成三层：

1. 把某个 USB 设备作为 `hostdev` 交给虚拟机。
2. 通过 SPICE/USB Redirection 临时重定向客户端设备。
3. 用 VFIO 把整块 USB 控制器作为 PCIe 设备直通。

如果只是偶尔接 U 盘、加密狗或打印机，单设备直通最简单；如果要求虚拟机稳定识别声卡、采集卡和一组反复插拔的设备，整控制器直通通常更省心。

## 单个 USB 设备直通

先查询设备：

```bash
lsusb
```

例如输出：

```text
Bus 003 Device 004: ID 0781:5583 SanDisk Corp. Ultra Fit
```

libvirt 可以按 vendor/product 匹配：

```xml
<hostdev mode="subsystem" type="usb" managed="yes">
  <source>
    <vendor id="0x0781"/>
    <product id="0x5583"/>
  </source>
</hostdev>
```

也可以按 Bus 和 Device 地址选择，但 USB 设备重新插拔后 Device 编号可能变化，不适合长期配置。

### 优点

- 配置简单，不需要开启 IOMMU。
- 宿主机不必放弃整块 USB 控制器。
- 适合 U 盘、读卡器、打印机和部分 USB 加密狗。

### 常见问题

- 相同 vendor/product 的设备不止一个时可能匹配错。
- 设备被宿主机驱动或桌面自动挂载占用，虚拟机无法接管。
- USB 声卡、摄像头、采集卡对时延和等时传输更敏感。
- 虚拟机关闭或设备重插后，自动重新连接行为取决于管理工具配置。

## USB Redirection

SPICE USB Redirection 的思路不是让服务器宿主机直接拥有设备，而是把运行远程桌面的客户端 USB 数据转发给虚拟机。

它适合远程临时接入 U 盘、智能卡等设备，但链路会受网络延迟和客户端软件影响，不适合高带宽采集卡或对实时性要求高的音频设备。

## 整块 USB 控制器直通

独立 PCIe USB 扩展卡可以通过 VFIO 整体交给虚拟机：

```bash
lspci -nn | grep -i usb
```

libvirt 配置与普通 PCIe 直通相同：

```xml
<hostdev mode="subsystem" type="pci" managed="yes">
  <source>
    <address domain="0x0000" bus="0x06" slot="0x00" function="0x0"/>
  </source>
</hostdev>
```

此时控制器下的端口、USB Hub 和热插拔都由虚拟机原生管理，兼容性最好。但宿主机不能再使用这块控制器，而且它必须位于可安全隔离的 IOMMU Group 中。

## 怎么选

| 场景 | 推荐方式 |
| --- | --- |
| 临时接一个 U 盘 | 单 USB 设备直通 |
| 远程桌面临时使用本地 USB | SPICE USB Redirection |
| 打印机、加密狗 | 单设备直通 |
| USB 声卡、采集卡 | 独立 USB 控制器直通 |
| 多设备频繁热插拔 | 独立 USB 控制器直通 |
| 宿主机必须继续使用其他 USB 口 | 单设备直通或增加扩展卡 |

参考：[QEMU 设备直通说明](https://qemu.readthedocs.io/en/master/system/device-emulation.html)、[libvirt Domain XML 文档](https://libvirt.org/formatdomain.html)。
