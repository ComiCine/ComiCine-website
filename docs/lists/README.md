# 名单目录（白名单 / 黑名单）

这里放门禁与封禁链路要用到的**名单文件**，方便直接改。
本目录**不进 docs.limooo.cn 的部署产物**（`ops/docs_deploy.sh` 只发 `site/docs/docs/`），
所以名单不会被公开。

## 文件一览

| 文件 | 谁生成 | 要不要手改 |
| --- | --- | --- |
| `china-asn.txt` | **自动**：`ops/fetch_china_asn.py` 从 [china-mainland-asn](https://github.com/xingpingcn/china-mainland-asn) 拉取（该源每日更新）。**含上游全部分组（5231 个，含教育网/科技网/其它）** | ❌ **不要手改**，下次部署会被覆盖 |
| `whitelist.txt` | **自动**：`china-asn.txt` 里**只取三家运营商**的那部分 + `own-ips.txt` 合并而成 | ❌ 不要手改；要加 IP 请改 `own-ips.txt` |
| `own-ips.txt` | 手工 | ✅ **改这个**：你自己的固定 IP、需要完全放行的来源 |
| `blocklist.txt` | 手工 + 自动拉回的受管段 | ✅ **改手写区**：要封的 IP / 网段 |

## 白名单里放的是谁（重要）

**只有中国电信 / 中国联通 / 中国移动三家**（`WHITELIST_GROUPS`，2026-10-11 定），
当前 **319** 个 ASN。上游的 `cernet`（教育网 2101 个）、`cstnet`（科技网 1 个）、
`other`（其它 2810 个）**不并进白名单** —— 白名单是「信任来源」，
把 2101 个高校 ASN 放进去等于放行全部校园网。那三组仍会写进 `china-asn.txt` 存证。

⚠️ **上游没有「家宽 / 蜂窝」这个维度。** 它只按运营商**公司**分类，所以这三家的名单里
**家宽、蜂窝、IDC、企业专线是混在一起的** —— 上游的
[`config.py`](https://github.com/xingpingcn/china-mainland-asn/blob/main/config.py)
里只有公司名，没有 residential / mobile / datacenter 的标记。

所以「只给家宽和蜂窝设低危」这件事**无法从上游自动得到**。要精确到那个粒度，只能：

1. 人工判定哪些 ASN 属于家宽/蜂窝（查 whois 注册信息、或凭已知的省级家宽 ASN 经验），
   把关掉的那些**从白名单里排除**；或
2. 接受「三家运营商全集」这个近似 —— 代价是**会连带放行 IDC 与企业专线**
   （住宅代理、机房爬虫可能就在其中）。

现在的实现是方案 2。要收紧就往 `own-ips.txt` 的反面走：把它改成一份**显式的家宽/蜂窝
ASN 清单**（`ASN/4134 # 电信家宽`），并让 `fetch_china_asn.py` 只用它、不再并运营商全量
—— 那需要改一行 `WHITELIST_GROUPS`（改成空）与合并逻辑。

## 格式

三个名单文件用的是同一套语法（`#` 之后是注释，会被剥离；空行忽略）：

```
# 低风险 ASN（只对 china-asn.txt / own-ips.txt 有意义）
ASN/4134
ASN/4809

# 完全放行（单 IP 写 /32）
IP-CIDR/97.64.18.11/32
IP-CIDR/203.0.113.0/24
```

`blocklist.txt` 用**裸** IP / CIDR（它由 `src/auto_block.py` 解析，语法不同）：

```
1.2.3.4          # 单 IP
5.6.7.0/24       # 网段
```

## 改完之后

| 你要的效果 | 命令 |
| --- | --- |
| 刷新 ASN 名单 + 重新合并白名单（**部署时会自动做**） | `bash ops/fetch_china_asn.py` |
| 把白名单生效到边缘（生成 `functions/_data/gateTrust.ts`） | `bash ops/ci_check.sh`（内含 `check_gate_trust.py --emit`） |
| **黑名单双向对账**（D1 有而文件没有的拉回来，文件有而 D1 没有的推上去） | `python3 src/auto_block.py reconcile --dry-run` 先看差异，去掉 `--dry-run` 才写 |
| 只推不拉（旧行为） | `python3 src/auto_block.py d1 --dry-run` |
| 推给 Cloudflare IP List（维护命令，一般不用跑） | `python3 src/auto_block.py cf` |

## 黑名单对账（`reconcile`）怎么工作

```
python3 src/auto_block.py reconcile --dry-run
  [d1] dry-run: +0 -0 pull=1
    < 58.222.33.0/24  # would pull from D1
```

- **+N**：文件里有、D1 没有 → 推上去（`INSERT … ON CONFLICT`，并置 `active=1`）
- **-N**：文件里删掉、D1 还有 → 从 D1 删（**只删 `source` 是 `auto_block`/`blocklist.txt`
  的行**，admin 来源的不动）
- **pull=N**：D1 活跃、文件里没有 → **写回文件的受管段**

`blocklist.txt` 因此分成两区：**手写区**（`# ── 以下是 D1 blocked_ips 的活跃行` 这一行
之前，永远原样保留）与**受管段**（那一行之后，每次对账整体重写，带 `source` 标注）。

⚠️ **拉回文件只增不减**：绝不因为「D1 少了某条」就从文件里删掉它 —— 调用方无法区分
「管理员有意解封」与「还没同步」。删除由 D1 侧的软删除（`active=0`）记录，
**文件是快照，不是删除指令**。

## 两个重要前提

1. **ASN 段当前对运行时无效**：`functions/_data/gateTrust.ts` 只带 `verified_bot` 与
   `ip_cidrs`；ASN 的消费方是 **WAF 的 `js_challenge` 规则，而那条规则目前未启用**
   （`ops/waf/rules.snapshot.json` 记录 `http_request_firewall_custom` 为空）。
   所以现在**改 ASN 不会立刻放宽或收紧线上门禁** —— 生效要等 WAF 规则启用。
2. **`blocklist.txt` 不是权威**：权威是 D1 的 `blocked_ips`。用上面的 `reconcile`
   双向对齐（或 `d1` 单向推）才算数。
