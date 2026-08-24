---
title: Linux Bridge 和 MacVTap 到底有什么区别
date: 2026-08-24
excerpt: 都能让虚拟机接入物理网络，但一个像宿主机里的交换机，另一个更像直接挂在物理网卡上的虚拟端口。
cover: /covers/linux-bridge-macvtap-v2.svg
---

## 先说结论

如果希望宿主机、虚拟机和局域网设备之间容易互通，优先使用 **Linux Bridge**；如果只想让虚拟机直接进入物理网络，追求更简单的数据路径，又不要求宿主机通过同一接口访问虚拟机，可以考虑 **MacVTap**。

两者都工作在二层，但拓扑和限制并不相同。

## Linux Bridge：宿主机里的软件交换机

Linux Bridge 可以理解成内核中的二层交换机。物理网卡、虚拟机的 TAP 设备和 veth 都能作为端口加入网桥，网桥根据 MAC 地址学习结果转发以太网帧。

典型拓扑如下：

```text
宿主机 IP
   │
  br0 ─── eth0 ─── 物理交换机
   │
 tap0
   │
 虚拟机
```

配置时，宿主机的 IP 通常应该放在 `br0` 上，而不是继续放在已经加入网桥的 `eth0` 上。

```bash
ip link add br0 type bridge
ip link set eth0 master br0
ip link set br0 up
ip link set eth0 up
```

### 优点

- 宿主机与虚拟机可以直接通信。
- 可以连接多台虚拟机、容器和物理接口。
- 容易叠加 VLAN、STP、过滤和抓包。
- 网络拓扑直观，适合作为虚拟化平台的 LAN。

### 代价

- 需要正确迁移宿主机 IP、路由和 DHCP 配置。
- 配错物理接口或管理地址时，可能让宿主机暂时失联。
- 数据会经过网桥转发层，不过在一般家用和服务器场景中，性能通常不是决定性问题。

## MacVTap：MacVLAN 加 TAP

MacVTap 把 MacVLAN 的二层虚拟接口与 TAP 的字符设备结合起来，让 QEMU/KVM 可以直接使用。数据包不经过传统的宿主机网桥，而是通过下层物理网卡进入外部网络。

```text
虚拟机 ─── macvtap0 ─── eth0 ─── 物理交换机
宿主机 ──────────────────┘
```

这种结构配置简单，也少了一层显式的软件网桥。但它有一个很容易踩到的限制：**宿主机通常不能通过同一块下层物理网卡直接访问 MacVTap 虚拟机**。虚拟机访问局域网和互联网可能完全正常，唯独宿主机访问它失败。

这不是防火墙偶发故障，而是 MacVTap/MacVLAN 数据路径本身的限制。libvirt 官方文档也明确提醒，如果需要宿主机与虚拟机互通，应增加第二张连接到隔离网络的虚拟网卡，或者改用宿主机网桥。

### 常见模式

- `bridge`：同一下层接口上的 MacVLAN 端口可以相互通信。
- `private`：不同端口彼此隔离。
- `vepa`：帧交给外部交换机处理，是否能绕回取决于交换机能力。
- `passthru`：更接近将一个下层接口专用于单个虚拟端口。

这里的 `bridge` 模式并不等于 Linux Bridge，也不会自动解决宿主机到虚拟机的通信问题。

## 怎么选

| 需求 | 推荐 |
| --- | --- |
| 宿主机需要直接管理虚拟机 | Linux Bridge |
| 多台虚拟机组成同一 LAN | Linux Bridge |
| 需要 VLAN、抓包和灵活转发 | Linux Bridge |
| 虚拟机只需访问外部网络 | MacVTap |
| 不想在宿主机创建网桥 | MacVTap |
| OpenWrt 虚拟机的 LAN 口 | Linux Bridge |
| OpenWrt 虚拟机的独立 WAN 口 | MacVTap 或 PCI 直通 |

对于“虚拟机 OpenWrt 做主路由”的场景，我更倾向于：WAN 使用独立 MacVTap 或直通网卡，LAN 使用 Linux Bridge，并把宿主机的管理地址放在 LAN 网桥上。这样职责最清楚，也方便从内网管理宿主机。

参考：[Linux 内核 Bridge 文档](https://docs.kernel.org/networking/bridge.html)、[libvirt 网络格式文档](https://libvirt.org/formatnetwork.html)。
