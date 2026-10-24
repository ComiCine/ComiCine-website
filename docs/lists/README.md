<!--
Copyright (C) 2026-Present Limooo Studio
SPDX-License-Identifier: AGPL-3.0-or-later
Additional terms under Section 7 apply.
See ADDITIONAL_TERMS.md.
-->

# 名单目录（白名单 / 黑名单）

这里存放门禁与封禁链路使用的名单。本目录不进入 docs.limooo.cn 的部署产物。

## 文件一览

| 文件 | 来源 | 如何维护 |
| --- | --- | --- |
| `own-ips.txt` | 手工 | 编辑固定 IP、CIDR 或需要手动登记的 ASN。 |
| `whitelist.txt` | `ops/sync_whitelist.py` 从 `own-ips.txt` 生成 | 不要手改。部署时自动生成；也可单独运行同步脚本。 |
| `robots.txt` | 手工，标准 robots.txt 格式 | 同时作为线上 `/robots.txt` 规则和门禁爬虫 User-Agent 名单。 |
| `blocklist.txt` | 手写区 + D1 拉回的受管段 | 要新增封禁时编辑手写区；D1 `blocked_ips` 是唯一权威。 |

名单不再从外部 ASN 目录抓取。`ASN/<number>` 仍可作为手工白名单条目，但完整部署不会自动更改 Cloudflare 区域级 ASN Access Rules；需要操作时显式运行 `bash ops/waf_whitelist.sh --apply`。

## 爬虫放行名单 = `robots.txt`

`docs/lists/robots.txt` 一份文件、两个用途：

1. `src/build.py` 将爬虫规则发布到线上 `https://limooo.cn/robots.txt`，并按契约追加 Sitemap 行。
2. `ops/check_gate_trust.py` 解析每条显式 `User-agent:`（`*` 除外），生成 `functions/_data/gateTrust.ts` 中的 `GATE_TRUST_CRAWLER_UAS`。这些 User-Agent 只免人机验证，不免 D1 封禁、不签发 `__gate` cookie，也不计入访客。

新增爬虫时，只需在 `robots.txt` 添加一条 `User-agent:`。`Allow`、`Disallow` 与注释不参与门禁名单解析。`Google-Extended` / `Applebot-Extended` 是 robots.txt 专用标记，没有对应的请求 User-Agent。

User-Agent 由访客自行声明，不是身份认证。只登记有公开文档与联系方式的爬虫，不要添加 `curl`、`python-requests`、`Go-http-client` 或 `HeadlessChrome` 等通用客户端标记。

| 来源 | 免人机验证 | 免 D1 封禁 | 发 `__gate` cookie | 计访客 |
| --- | --- | --- | --- | --- |
| `IP-CIDR`（`whitelist.txt`） | 是 | 是 | 是 | 是 |
| Cloudflare verified bot | 是 | 是 | 是 | 否 |
| `robots.txt` 显式 User-Agent | 是 | 否 | 否 | 否 |

## 格式

白名单每行一条，`#` 后为注释，空行忽略：

```text
# 固定 IP 或网段
IP-CIDR/97.64.18.11/32
IP-CIDR/203.0.113.0/24
# IPv4 只接受 /24–/32；IPv6 只接受 /64–/128

# 手工 ASN 条目（仅供手动运行的 WAF 同步脚本使用）
ASN/64500
```

白名单同步会解析 IP 地址和 CIDR，并拒绝短于 IPv4 `/24`、IPv6 `/64` 的前缀，
避免误把过大的地址范围设为完全信任。ASN 仅接受 `1` 至 `4294967295`。

`blocklist.txt` 使用裸 IP / CIDR，与白名单语法不同：

```text
1.2.3.4
5.6.7.0/24
```

## 改完之后

| 目标 | 命令 |
| --- | --- |
| 从 `own-ips.txt` 重新生成白名单 | `python3 ops/sync_whitelist.py` |
| 生成门禁边缘副本并运行构建检查 | `bash ops/ci_check.sh` |
| 更新爬虫名单 | 编辑 `robots.txt` 后正常部署 |
| 手动将 ASN 条目同步到 Cloudflare 区域 | `bash ops/waf_whitelist.sh --dry-run`，确认后运行 `bash ops/waf_whitelist.sh --apply` |
| 封禁名单双向对账 | 先运行 `python3 src/auto_block.py reconcile --dry-run`；确认后去掉 `--dry-run` |
| 只推送封禁条目 | `python3 src/auto_block.py d1 --dry-run` |
| 查看或更新边缘 AI bot 策略 | `python3 ops/ai_bots.py --show` / `--apply` |

## 黑名单对账

`python3 src/auto_block.py reconcile --dry-run` 会显示文件与 D1 的差异：

- **+N**：文件有、D1 没有，将写入 D1。
- **-N**：文件没有、D1 仍有，将从 D1 软删除仅由 `auto_block` / `blocklist.txt` 管理的记录；管理员来源不动。
- **pull=N**：D1 有活跃记录、文件没有，将其拉回文件受管段。

`blocklist.txt` 分为手写区和受管段。受管段由 D1 活跃记录生成；手写区在受管标记之前并原样保留。文件是审计快照，不是封禁权威，也不会因 D1 软删除而自动删掉手写条目。

## 维护约定

1. `whitelist.txt` 是生成结果；信任 IP 的来源应编辑 `own-ips.txt`。
2. `robots.txt` 是公开文件，其中显式 User-Agent 同时会被门禁解析为爬虫放行标记。
3. `blocklist.txt` 是 D1 `blocked_ips` 的快照；变更后通过 `reconcile` 与 D1 对账。
