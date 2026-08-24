---
title: KVM/QEMU 接入物理硬盘的三种方式
date: 2026-08-20
excerpt: 传整块磁盘、传分区，还是把 SATA/HBA 控制器整体直通？区别在于性能、SMART、热插拔和宿主机能否继续管理设备。
---

## 先区分三种层级

给虚拟机使用物理存储，不只有“硬盘直通”一种做法：

1. 把宿主机块设备作为虚拟磁盘后端。
2. 把某个分区作为虚拟磁盘后端。
3. 用 VFIO 把 SATA、SAS/HBA 或 NVMe 控制器整体直通。

层级越靠近硬件，虚拟机看到的设备越真实，但宿主机能做的管理越少，迁移和快照也越困难。

## 方式一：传入整块块设备

先用稳定标识找到磁盘：

```bash
ls -l /dev/disk/by-id/
```

不要长期依赖 `/dev/sdb` 这种名称，它可能在重启或插拔后变化。libvirt 示例：

```xml
<disk type="block" device="disk">
  <driver name="qemu" type="raw" cache="none" io="native"/>
  <source dev="/dev/disk/by-id/ata-Samsung_SSD_SERIAL"/>
  <target dev="vdb" bus="virtio"/>
</disk>
```

虚拟机看到的是 VirtIO 块设备，实际数据写入整块物理盘。性能和配置复杂度比较平衡，适合把一块独占数据盘交给普通 Linux/Windows 虚拟机。

### 注意

- 宿主机不能同时挂载这块盘上的文件系统。
- 配错 `source dev` 会直接破坏其他磁盘数据。
- SMART、休眠和厂商专用命令不一定完整透传。
- 传统宿主机快照工具不能自动覆盖盘外的数据。

## 方式二：传入单个分区

```xml
<disk type="block" device="disk">
  <driver name="qemu" type="raw" cache="none"/>
  <source dev="/dev/disk/by-id/ata-DISK_SERIAL-part2"/>
  <target dev="vdc" bus="virtio"/>
</disk>
```

它可以让宿主机保留同一硬盘上的其他分区，但风险也更集中：虚拟机不拥有真实分区表，一些依赖整盘布局、引导扇区或磁盘标识的工具会表现异常。

除非明确知道应用只需要一个独立文件系统，否则整盘通常比单分区更容易理解和恢复。

## 方式三：直通存储控制器

把 HBA、SATA 控制器或 NVMe PCIe Function 通过 VFIO 交给虚拟机后，虚拟机直接加载真实硬件驱动。

优点：

- 能看到真实磁盘型号、序列号和 SMART。
- 更接近裸机的错误处理、热插拔和队列行为。
- ZFS、TrueNAS、软 RAID 等系统可以直接管理磁盘。

代价：

- 控制器及其连接的所有磁盘都从宿主机消失。
- 必须检查 IOMMU Group。
- 直通主板集成 SATA 控制器可能连宿主机系统盘一起带走。
- 虚拟机迁移、休眠和快照能力受到限制。

对于 NAS 虚拟机，更推荐额外安装一张独立 HBA，再把整张 HBA 直通；不要在唯一的板载 SATA 控制器上冒险拆分。

## VirtIO Block 还是 VirtIO SCSI

- `virtio-blk` 路径简单，单盘场景常用。
- `virtio-scsi` 适合磁盘数量较多、需要 SCSI 语义或更灵活热插拔的场景。
- 控制器 VFIO 直通则绕过 VirtIO 存储设备模型，由虚拟机直接驱动物理控制器。

## 上线前检查

```bash
lsblk -o NAME,SIZE,MODEL,SERIAL,FSTYPE,MOUNTPOINTS
findmnt
lsof /dev/disk/by-id/你的设备
```

确认目标盘没有被宿主机挂载、没有进入 mdraid/LVM/ZFS 存储池，也不是系统盘。第一次启动前备份分区表和重要数据，并确保虚拟机异常退出时不会被宿主机自动挂载。

参考：[libvirt Domain XML 文档](https://libvirt.org/formatdomain.html)、[libvirt Storage 文档](https://libvirt.org/storage.html)、[QEMU Zoned Storage 文档](https://qemu.readthedocs.io/en/v8.1.5/devel/zoned-storage.html)。
