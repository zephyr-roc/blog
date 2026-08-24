---
title: 虚拟机 OpenWrt 的双网卡拓扑怎么搭
date: 2026-08-22
excerpt: WAN 负责接入，LAN 负责管理和转发。把 MacVTap、Linux Bridge 与宿主机管理地址放对位置，才能避免拔线即失联。
---

## 目标拓扑

让虚拟机中的 OpenWrt 充当主路由时，最重要的是把 WAN 和 LAN 的职责拆开：

```text
运营商
  │
物理 WAN 网卡
  │
MacVTap / PCI 直通
  │
OpenWrt WAN
OpenWrt LAN
  │
Linux Bridge
  ├── 物理 LAN 网卡 ── 交换机 / AP
  └── 宿主机管理地址
```

WAN 只用于 OpenWrt 拨号或获取上级网络；LAN 网桥则承载内网、宿主机管理以及其他虚拟机。

## WAN 为什么适合 MacVTap 或直通

WAN 一般不要求宿主机直接参与通信。使用 MacVTap 时，OpenWrt 可以通过物理网卡访问外部网络，宿主机不会自动获得 WAN 地址。

PCI Passthrough 的隔离更彻底，虚拟机能直接控制网卡，但要求 IOMMU 分组合理，并且宿主机将无法继续使用该设备。切换直通通常还涉及解绑宿主机驱动，不适合在没有备用管理链路时冒险操作。

如果 NAS 管理界面只支持 MacVTap，它仍然可以作为 WAN 的实用方案。

## LAN 为什么更适合 Linux Bridge

LAN 需要同时连接 OpenWrt、宿主机、物理交换机和其他虚拟机。Linux Bridge 正好承担二层交换机的角色。

宿主机的管理 IP 应配置在网桥上，例如 `br-lan`，而不是配置在已经作为 Bridge 端口的物理网卡上：

```bash
ip link add br-lan type bridge
ip link set eno2 master br-lan
ip link set br-lan up
ip link set eno2 up
```

实际环境中应通过系统网络配置工具持久化，避免远程执行临时命令后失联。

## 为什么拔掉 LAN 网线后宿主机也没网

即使 Linux Bridge 是软件设备，物理端口的链路状态仍会影响真实数据路径。如果宿主机默认网关在 OpenWrt 后面，而 OpenWrt LAN 到交换机/AP 的链路被拔掉，宿主机虽然还挂在 `br-lan` 上，但通往其他终端和管理电脑的物理路径已经断开。

另一个常见原因是：

- 宿主机管理 IP 仍在物理接口，而不是 Bridge 上。
- 网络管理服务看到物理接口无 Carrier 后，自动撤销地址或路由。
- OpenWrt 虚拟机尚未启动，宿主机的默认网关因此不存在。
- 管理电脑与宿主机其实依赖同一台外部交换机，拔线后没有备用路径。

所以“Bridge 是软件设备”并不代表它能在物理链路断开后凭空提供外部连接。

## 更稳妥的做法

- 为宿主机保留一个独立管理接口，或配置不经过 OpenWrt 的应急管理网络。
- 先确认宿主机能通过 LAN Bridge 管理，再调整 WAN 的 MacVTap/直通。
- 不要在唯一 SSH 链路上直接修改网卡归属。
- 给 OpenWrt 虚拟机设置自动启动，并确保启动顺序早于依赖它联网的服务。
- 记录原始接口、Bridge、IP 和默认路由，准备可回滚配置。

## 快速检查

```bash
ip -br link
ip -br addr
ip route
bridge link
bridge fdb show
```

重点确认三件事：宿主机地址是否在 `br-lan`、OpenWrt LAN 的虚拟网卡是否加入同一 Bridge、默认路由是否指向 OpenWrt 的 LAN 地址。

参考：[Linux 内核 Bridge 文档](https://docs.kernel.org/networking/bridge.html)、[libvirt 网络格式文档](https://libvirt.org/formatnetwork.html)。
