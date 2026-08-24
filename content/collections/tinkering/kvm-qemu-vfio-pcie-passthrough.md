---
title: 用 VFIO 给 KVM 虚拟机直通 PCIe 设备
date: 2026-08-21
excerpt: 显卡、网卡、HBA 和 NVMe 直通的核心不是一条 vfio-pci 命令，而是 IOMMU Group、驱动解绑和可回退的管理链路。
---

## VFIO 在做什么

PCIe 直通让虚拟机直接驱动物理设备。VFIO 负责把设备安全地暴露给 QEMU，并借助 IOMMU 限制设备 DMA 能访问的内存范围。

所以开启 VT-x/AMD-V 还不够，平台还需要支持并启用 Intel VT-d 或 AMD-Vi/IOMMU。

## 先检查 IOMMU Group

```bash
find /sys/kernel/iommu_groups/ -type l
```

也可以查看某个 PCI 地址所在的组：

```bash
readlink /sys/bus/pci/devices/0000:06:00.0/iommu_group
```

IOMMU Group 是 VFIO 的最小安全所有权单位。如果目标网卡与宿主机仍要使用的 SATA 控制器落在同一组，不能只凭界面勾选其中一个就认为隔离安全。

显卡常同时包含 VGA 和 HDMI Audio 两个 Function，也通常需要一起交给虚拟机。

## 确认设备与当前驱动

```bash
lspci -nnk -s 06:00.0
```

关注 PCI 地址、Vendor/Device ID 和当前绑定的内核驱动。

在启动虚拟机前，设备必须从宿主机原驱动解绑并交给 `vfio-pci`。使用 libvirt 的 `managed="yes"` 时，libvirt 可以负责启动前 detach、关机后 reattach，但前提是设备没有被宿主机关键服务占用。

## libvirt 配置

```xml
<hostdev mode="subsystem" type="pci" managed="yes">
  <driver name="vfio"/>
  <source>
    <address domain="0x0000" bus="0x06" slot="0x00" function="0x0"/>
  </source>
</hostdev>
```

如果直通多 Function 设备，应把每个 Function 都加入虚拟机。

## 最容易踩的坑

### 宿主机仍在使用设备

把唯一的管理网卡直通后，SSH 会立即中断；把宿主机正在显示桌面的显卡直通后，图形会话可能崩溃。开始前必须准备第二张网卡、串口、IPMI 或本地回退方式。

### IOMMU Group 不干净

ACS Override 可以人为拆组，但它不能创造硬件原本不存在的隔离能力。对于存储控制器、生产环境和不可信虚拟机，不应把它当作默认解法。

### 设备无法复位

部分消费级 GPU、采集卡或老旧 PCIe 设备不支持可靠的 Function Level Reset。虚拟机第一次启动正常，重启后设备消失，往往就是复位问题。解决方向通常是更新固件、冷启动宿主机、换插槽或更换设备。

### 固件与启动模式不匹配

GPU 直通常用 UEFI/OVMF 和 Q35 机型。虚拟机固件、显卡 ROM、Resizable BAR 和宿主机启动显卡选择都会影响结果。

## 哪些设备适合直通

- 独立显卡和音频 Function。
- 额外的物理网卡。
- HBA/SAS/SATA 控制器。
- NVMe 控制器。
- 独立 USB 控制器。
- 部分采集卡和计算加速卡。

直通后的设备通常无法被宿主机同时使用，也可能限制虚拟机热迁移和快照能力。先问清楚是否真的需要“原生设备语义”，再决定是否牺牲灵活性。

参考：[Linux 内核 VFIO 文档](https://docs.kernel.org/driver-api/vfio.html)、[libvirt Domain XML 文档](https://libvirt.org/formatdomain.html)。
