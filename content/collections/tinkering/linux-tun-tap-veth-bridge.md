---
title: 一次分清 TUN、TAP、veth 和 Linux Bridge
date: 2026-08-23
excerpt: TUN 传 IP 包，TAP 传以太网帧，veth 像一根虚拟网线，而 Bridge 负责把这些端口连接成二层网络。
---

## 为什么总容易混

这些设备经常一起出现在 Docker、KVM、OpenWrt 和代理软件中，但它们并不是同一种东西。最简单的判断方式，是先问两个问题：

1. 它处理的是三层 IP 包，还是二层以太网帧？
2. 它是端点、网线，还是交换机？

## TUN：三层虚拟接口

TUN 读写的是 IP 数据包，不包含以太网头。用户态程序打开 `/dev/net/tun` 后，内核会把路由到该接口的 IP 包交给程序处理。

它适合：

- WireGuard、OpenVPN 等三层隧道。
- Clash/Mihomo 的 TUN 模式。
- 用户态路由器和 VPN。
- 只关心 IP，不需要广播和二层协议的场景。

可以把它理解成“连接内核协议栈和用户态程序的一条三层管道”。

## TAP：二层虚拟接口

TAP 读写完整的以太网帧，因此包含源 MAC、目标 MAC 和 EtherType。QEMU 常用 TAP 把虚拟机网卡连接到宿主机网络。

它适合：

- KVM/QEMU 虚拟机。
- 需要 DHCP 广播、ARP 或 VLAN 的二层隧道。
- 接入 Linux Bridge 的虚拟端口。

TAP 本身不是交换机。创建一个 TAP 设备后，通常还要把它加入某个 Bridge，或者交给用户态程序处理。

## veth：成对出现的虚拟网线

veth 总是成对创建，从一端进入的数据会从另一端出来。

```bash
ip link add veth-host type veth peer name veth-ns
```

容器网络常把一端留在宿主机，另一端移动到 Network Namespace：

```text
容器 eth0 ─ veth-ns ═══ veth-host ─ br0
```

它不负责学习 MAC，也不决定数据应该发往哪里；它只是把两个网络栈或网络设备连接起来。

## Linux Bridge：二层交换机

Bridge 可以接入物理网卡、TAP 和 veth。它维护转发表，根据目标 MAC 决定把帧发送到哪个端口；未知单播、广播和部分组播则可能被泛洪到多个端口。

```text
              ┌─ tap0 ─ 虚拟机
物理网卡 ─ br0 ├─ veth0 ─ 容器
              └─ tap1 ─ OpenWrt
```

因此这四者的关系可以压缩成一句话：

- TUN 是三层端点。
- TAP 是二层端点。
- veth 是成对的虚拟连接线。
- Bridge 是连接多个二层端口的交换机。

## 排障时看什么

```bash
ip -d link show
ip addr show
ip route show
bridge link
bridge fdb show
```

如果虚拟机拿不到 DHCP，先确认 TAP 是否已经加入正确的 Bridge；如果容器之间不通，确认 veth 两端是否存在、接口是否 UP；如果 TUN 代理没有流量，重点检查路由和策略规则，而不是 Bridge 的 MAC 表。

参考：[Linux 内核 TUN/TAP 文档](https://docs.kernel.org/networking/tuntap.html)、[Linux 内核 Bridge 文档](https://docs.kernel.org/networking/bridge.html)。
