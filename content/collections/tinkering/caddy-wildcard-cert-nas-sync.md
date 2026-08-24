---
title: 用 Caddy 申请通配符证书并同步到 NAS
date: 2026-08-24
excerpt: Caddy 通过 DNS-01 自动续期根域名与通配符证书，NAS 定时只读拉取、校验并原子替换为本地服务证书。
---

## 想解决什么

家里的 NAS、路由器和各种自托管服务通常只在内网开放，但仍然希望使用浏览器信任的 HTTPS。逐个服务申请证书很麻烦，更合适的做法是：

1. 让一台长期在线的服务器运行 Caddy。
2. Caddy 通过 DNS-01 申请并自动续期证书。
3. 将证书复制到一个独立、只读的导出目录。
4. NAS 定时拉取，校验无误后替换本地服务证书。
5. 只有证书发生变化时才重载服务。

这里使用 Cloudflare DNS 举例，其他 DNS 服务商只需要替换对应的 Caddy DNS Provider。

> `*.example.com` 不包含根域名 `example.com`，因此应同时申请这两个名称。

## 准备支持 DNS-01 的 Caddy

Caddy 官方发行版不一定包含具体 DNS 服务商模块。使用 Cloudflare 时，可以通过 `xcaddy` 构建：

```bash
xcaddy build   --with github.com/caddy-dns/cloudflare
```

安装后确认模块存在：

```bash
caddy list-modules | grep dns.providers.cloudflare
```

Cloudflare API Token 建议只授权目标 Zone，并给予：

- `Zone.Zone:Read`
- `Zone.DNS:Edit`

不要把 Global API Key 直接写进 Caddyfile。

## 配置 Token

如果 Caddy 由 systemd 管理，创建只允许 root 读取的环境文件：

```bash
sudo install -m 600 /dev/null /etc/caddy/caddy.env
sudo sh -c 'printf "%s\n" "CF_API_TOKEN=替换为你的Token" > /etc/caddy/caddy.env'
```

为 Caddy 服务添加环境文件：

```bash
sudo systemctl edit caddy
```

写入：

```ini
[Service]
EnvironmentFile=/etc/caddy/caddy.env
```

然后重新加载 systemd：

```bash
sudo systemctl daemon-reload
```

## 申请根域名和通配符证书

Caddyfile 示例：

```caddyfile
example.com, *.example.com {
    tls {
        dns cloudflare {env.CF_API_TOKEN}
    }

    respond "certificate endpoint" 200
}
```

先检查格式和配置：

```bash
sudo caddy fmt --overwrite /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
```

再平滑加载：

```bash
sudo systemctl reload caddy
sudo journalctl -u caddy -f
```

通配符证书必须使用 DNS-01。Caddy 会临时创建 `_acme-challenge` TXT 记录，验证完成后自动清理，并在证书接近到期时续期。

Caddy 的数据目录不能当作缓存随意清理。使用官方 systemd 服务时，默认数据通常位于：

```text
/var/lib/caddy/.local/share/caddy
```

其中保存了证书、私钥和 ACME 状态。

## 为什么不让 NAS 直接读取 Caddy 数据目录

直接给远程账号开放 Caddy 数据目录会带来几个问题：

- NAS 能看到不相关域名的私钥。
- Caddy 的内部目录布局并不是服务间交换证书的稳定 API。
- 远程同步过程中可能刚好碰到证书更新。
- 很难对“只允许读取这一张证书”做权限隔离。

更稳妥的方式是在 Caddy 服务器上生成一个独立导出目录，只发布 NAS 需要的证书。

## 在 Caddy 服务器上导出证书

创建目录和专用组：

```bash
sudo groupadd --system certsync
sudo install -d -o root -g certsync -m 750 /srv/cert-export
```

创建 `/usr/local/sbin/export-caddy-cert.sh`：

```bash
#!/usr/bin/env bash
set -euo pipefail

CERT_ROOT="/var/lib/caddy/.local/share/caddy/certificates"
EXPORT_DIR="/srv/cert-export"
CHECK_HOST="nas.example.com"

cert_file="$(
  find "$CERT_ROOT" -type f -name '*.crt' -print0 |
    while IFS= read -r -d '' candidate; do
      if openssl x509 -in "$candidate" -noout -checkhost "$CHECK_HOST" >/dev/null 2>&1; then
        printf '%s\n' "$candidate"
      fi
    done |
    head -n 1
)"

if [[ -z "$cert_file" ]]; then
  echo "没有找到可用于 $CHECK_HOST 的证书" >&2
  exit 1
fi

key_file="${cert_file%.crt}.key"

if [[ ! -f "$key_file" ]]; then
  echo "没有找到对应私钥：$key_file" >&2
  exit 1
fi

cert_pub="$(
  openssl x509 -in "$cert_file" -pubkey -noout |
    openssl pkey -pubin -outform DER 2>/dev/null |
    sha256sum |
    cut -d' ' -f1
)"
key_pub="$(
  openssl pkey -in "$key_file" -pubout -outform DER 2>/dev/null |
    sha256sum |
    cut -d' ' -f1
)"

if [[ "$cert_pub" != "$key_pub" ]]; then
  echo "证书与私钥不匹配" >&2
  exit 1
fi

if ! openssl x509 -in "$cert_file" -checkend 604800 -noout; then
  echo "证书将在七天内过期，拒绝发布" >&2
  exit 1
fi

install -o root -g certsync -m 640 "$cert_file" "$EXPORT_DIR/fullchain.pem.new"
install -o root -g certsync -m 640 "$key_file" "$EXPORT_DIR/privkey.pem.new"

mv -f "$EXPORT_DIR/fullchain.pem.new" "$EXPORT_DIR/fullchain.pem"
mv -f "$EXPORT_DIR/privkey.pem.new" "$EXPORT_DIR/privkey.pem"
```

赋予执行权限并测试：

```bash
sudo chmod 750 /usr/local/sbin/export-caddy-cert.sh
sudo /usr/local/sbin/export-caddy-cert.sh
sudo openssl x509 -in /srv/cert-export/fullchain.pem -noout -subject -issuer -dates
```

这里通过 `nas.example.com` 检查通配符是否可用，不依赖 Caddy 内部证书目录的具体命名。

## 定时更新导出目录

创建 `/etc/systemd/system/export-caddy-cert.service`：

```ini
[Unit]
Description=Export Caddy certificate for NAS
After=caddy.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/export-caddy-cert.sh
```

创建 `/etc/systemd/system/export-caddy-cert.timer`：

```ini
[Unit]
Description=Periodically export Caddy certificate

[Timer]
OnBootSec=5min
OnUnitActiveSec=6h
Persistent=true

[Install]
WantedBy=timers.target
```

启用定时器：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now export-caddy-cert.timer
systemctl list-timers export-caddy-cert.timer
```

Caddy 自己负责续期；这个 Timer 只是定期把最新结果发布到受限目录。

## 创建只读同步账号

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin certsync
sudo usermod -aG certsync certsync
```

将 NAS 的 SSH 公钥写入该账号的 `authorized_keys`。生产环境还应通过 `sshd_config`、防火墙或 `authorized_keys` 的 `from=` 限制来源地址，并确保该账号只能读取 `/srv/cert-export`。

如果系统的 rsync over SSH 要求账号具有可用 Shell，可以改用受限 Shell或在 `authorized_keys` 中绑定固定命令，不要给它 sudo 权限。

## NAS 定时拉取并校验

以下脚本假设最终证书目录是 `/volume1/docker/certs/example.com`。创建 `/volume1/scripts/sync-caddy-cert.sh`：

```bash
#!/usr/bin/env bash
set -euo pipefail

REMOTE="certsync@cert.example.com:/srv/cert-export/"
TARGET="/volume1/docker/certs/example.com"
STAGING="${TARGET}/.incoming"

mkdir -p "$STAGING"
chmod 700 "$STAGING"

rsync -az --delete "$REMOTE" "$STAGING/"

openssl x509   -in "$STAGING/fullchain.pem"   -noout   -checkhost "nas.example.com"

openssl x509   -in "$STAGING/fullchain.pem"   -checkend 604800   -noout

cert_pub="$(
  openssl x509 -in "$STAGING/fullchain.pem" -pubkey -noout |
    openssl pkey -pubin -outform DER 2>/dev/null |
    sha256sum |
    cut -d' ' -f1
)"
key_pub="$(
  openssl pkey -in "$STAGING/privkey.pem" -pubout -outform DER 2>/dev/null |
    sha256sum |
    cut -d' ' -f1
)"

if [[ "$cert_pub" != "$key_pub" ]]; then
  echo "证书与私钥不匹配" >&2
  exit 1
fi

new_sum="$(sha256sum "$STAGING/fullchain.pem" "$STAGING/privkey.pem")"
old_sum="$(
  sha256sum "$TARGET/fullchain.pem" "$TARGET/privkey.pem" 2>/dev/null || true
)"

if [[ "$new_sum" == "$old_sum" ]]; then
  echo "证书没有变化"
  exit 0
fi

install -m 600 "$STAGING/fullchain.pem" "$TARGET/fullchain.pem.new"
install -m 600 "$STAGING/privkey.pem" "$TARGET/privkey.pem.new"
mv -f "$TARGET/fullchain.pem.new" "$TARGET/fullchain.pem"
mv -f "$TARGET/privkey.pem.new" "$TARGET/privkey.pem"

# 按实际服务选择一种重载方式：
# docker kill --signal HUP nginx
# docker compose -f /volume1/docker/app/compose.yaml restart reverse-proxy
# systemctl reload nginx

echo "证书已更新"
```

注意：直接比较包含文件路径的 `sha256sum` 输出会因为目录不同而始终不相等。实际使用时可以只比较哈希字段，或者将新旧文件分别计算后再拼接。更稳妥的比较写法是：

```bash
digest() {
  sha256sum "$1" | cut -d' ' -f1
}

new_sum="$(digest "$STAGING/fullchain.pem"):$(digest "$STAGING/privkey.pem")"
old_sum="$(
  if [[ -f "$TARGET/fullchain.pem" && -f "$TARGET/privkey.pem" ]]; then
    printf '%s:%s'       "$(digest "$TARGET/fullchain.pem")"       "$(digest "$TARGET/privkey.pem")"
  fi
)"
```

用这段替换脚本中的 `new_sum` 和 `old_sum`。

## NAS 定时任务

确认脚本手动执行成功后，再加入计划任务。例如每六小时的第 25 分钟执行：

```cron
25 */6 * * * /volume1/scripts/sync-caddy-cert.sh >> /volume1/logs/cert-sync.log 2>&1
```

错开 Caddy 服务器导出任务，可以减少刚好读到更新中间状态的概率。由于导出和安装都使用临时文件加 `mv`，即使同步时发生续期，也不会拿到半个 PEM 文件。

## 最后检查

```bash
openssl x509 -in fullchain.pem -noout -subject -issuer -dates
openssl x509 -in fullchain.pem -noout -checkhost nas.example.com
openssl x509 -in fullchain.pem -checkend 2592000 -noout
```

还要实际连接服务确认它已经加载新证书：

```bash
openssl s_client   -connect nas.example.com:443   -servername nas.example.com   -showcerts </dev/null
```

这套结构的关键是职责分离：Caddy 管申请和续期，导出脚本只发布经过校验的证书，NAS 只读同步并负责重载自己的服务。即使以后迁移 NAS，只要复制同步脚本、SSH Key 和目标目录即可继续使用。

参考：[Caddy 通配符证书配置](https://caddyserver.com/docs/caddyfile/patterns)、[Caddy 自动 HTTPS](https://caddyserver.com/docs/automatic-https)、[Caddy 数据目录约定](https://caddyserver.com/docs/conventions)、[Cloudflare DNS Provider](https://github.com/caddy-dns/cloudflare)。
