# 名单目录（白名单 / 黑名单）

这里放门禁与封禁链路要用到的**名单文件**，方便直接改。
本目录**不进 docs.limooo.cn 的部署产物**（`ops/docs_deploy.sh` 只发 `site/docs/docs/`），
所以名单不会被公开。

## 文件一览

| 文件 | 谁生成 | 要不要手改 |
| --- | --- | --- |
| `mainland-asn-catalog.txt` | **自动**：`ops/fetch_china_asn.py` 从 [china-mainland-asn](https://github.com/xingpingcn/china-mainland-asn) 拉取（该源每日更新）。**上游全量快照（含教育网/科技网/其它）**，2026-10-12 由 `china-asn.txt` 改名 —— 它**不是白名单**，不参与任何放行判定 | ❌ **不要手改**，下次部署会被覆盖 |
| `whitelist.txt` | **自动**：`mainland-asn-catalog.txt` 里被 `WHITELIST_GROUPS` 选中的那部分 + `own-ips.txt` 合并而成（**当前 `WHITELIST_GROUPS` 为空**，所以只有手工条目） | ❌ 不要手改；要加 IP 请改 `own-ips.txt` |
| `own-ips.txt` | 手工 | ✅ **改这个**：你自己的固定 IP、需要完全放行的来源 |
| `robots.txt` | 手工（标准格式） | ✅ **改这个**：既是线上 `/robots.txt`，又是门禁爬虫放行名单（见下节） |
| `blocklist.txt` | 手工 + 自动拉回的受管段 | ✅ **改手写区**：要封的 IP / 网段 |

## 爬虫放行名单 = `robots.txt`（2026-10-12 从 `crawlers.txt` 合并过来）

站点对爬虫与 AI 工具是**开放**的。这里不再有自造格式的 `crawlers.txt`：
`docs/lists/robots.txt` 一份文件、两个身份 ——

1. `src/build.py` 把它**原样**发布成线上 `https://limooo.cn/robots.txt`（产物根目录，
   并在 `_routes.json` 里排除 Functions，所以拿到的永远是这份文件本身，不会被门禁页替换）；
2. `ops/check_gate_trust.py` 解析其中每一条**显式** `User-agent:`（`*` 除外），
   转小写生成 `functions/_data/gateTrust.ts` 的 `GATE_TRUST_CRAWLER_UAS`，
   这些 UA 免人机验证（匹配逻辑见 `functions/_lib/bots.ts`）。

所以**加一个爬虫 = 在 `robots.txt` 里加一行 `User-agent:`**，规则与放行一次改完，
不会再出现「改了内部名单、忘了构建器里那份文本」这类漂移。
`*` 组是「所有人」，**不**进放行名单（否则等于关掉门禁）；`Allow` / `Disallow` /
注释都不参与解析。`Google-Extended` / `Applebot-Extended` 是 robots.txt 专有 token
（没有对应 UA），留在文件里是为了声明 AI 训练偏好，匹配不到任何真实请求。

三层信任的强弱必须分清：

| 来源 | 免人机验证 | 免 D1 封禁 | 发 `__gate` cookie | 计访客 |
| --- | --- | --- | --- | --- |
| `IP-CIDR`（`whitelist.txt`） | ✅ | ✅ | ✅ | ✅ |
| Cloudflare verified bot | ✅ | ✅ | ✅ | ❌ |
| `robots.txt` 的显式 User-agent（UA 自报） | ✅ | ❌ | ❌ | ❌ |

**UA 是访客自报的**，所以第三行刻意是最弱的一档：它只区分「诚实的爬虫」与
「浏览器/未知来源」，不是身份认证；被封 IP 换个 UA 也解不了封。名单只收公认的、
有公开文档与联系方式的爬虫，**不要把 curl / python-requests / Go-http-client /
HeadlessChrome 这类通用客户端写进去**（它们无法与服务端脚本区分）。
匹配是**大小写不敏感的子串**，只取 `User-Agent` 前 512 字符；
条目至少 3 个字符、不允许重复或非法字符，且必须至少有一条显式条目
（`ops/check_gate_trust.py` 与 `src/build.py` 都会直接拒绝，构建即失败）。

## 白名单里放的是谁（重要）

**现在一个 ASN 都不放行**（`WHITELIST_GROUPS` 为空，2026-10-11 用户决定），
白名单里只剩 `own-ips.txt` 的手工条目。原因是上游**没有「家宽 / 蜂窝」这个维度**：
它只按运营商**公司**分类，三家运营商的名单里**家宽、蜂窝、IDC、企业专线是混在一起的**
（上游 [`config.py`](https://github.com/xingpingcn/china-mainland-asn/blob/main/config.py)
里只有公司名，没有 residential / mobile / datacenter 的标记）。按 ASN 全量放行等于
把 IDC 与企业专线一起放进来 —— 住宅代理、机房爬虫可能就在其中。

要恢复按运营商放行：把 `ops/fetch_china_asn.py` 的 `WHITELIST_GROUPS` 填回
`("chinanet", "cmcc", "unicom")` 即可。要更精细就人工判定哪些 ASN 属于家宽/蜂窝
（查 whois 注册信息、或凭已知的省级家宽 ASN 经验），写成一份显式清单交给
`own-ips.txt`。上游数据仍会照常拉取、写进 `mainland-asn-catalog.txt` 备查，只是不参与放行；
名字里的 catalog 就是提醒它「只是目录」，白名单永远是 `whitelist.txt`。

## 格式

白名单用一套语法（`#` 之后是注释，会被剥离；空行忽略）：

```
# 低风险 ASN（只有被 WHITELIST_GROUPS 选中的才进白名单；当前为空）
ASN/4134
ASN/4809

# 完全放行（单 IP 写 /32）
IP-CIDR/97.64.18.11/32
IP-CIDR/203.0.113.0/24

# 爬虫放行名单（robots.txt，标准语法）
User-agent: GPTBot
User-agent: ClaudeBot
Allow: /
Disallow: /api/
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
| 把白名单与 `robots.txt` 的爬虫放行名单生效到边缘（生成 `functions/_data/gateTrust.ts`） | `bash ops/ci_check.sh`（内含 `check_gate_trust.py --emit`） |
| 只调整爬虫放行名单 | 改 `robots.txt` 的 `User-agent:` 行，照常部署（构建会重新解析并原样发布同一份文件） |
| 关掉整份爬虫放行名单（不动文件） | 把 `config-contract.json` 的 `gate_trust.ua_allowlist_enabled` 改成 `false` 后重新 build |
| **黑名单双向对账**（D1 有而文件没有的拉回来，文件有而 D1 没有的推上去） | `python3 src/auto_block.py reconcile --dry-run` 先看差异，去掉 `--dry-run` 才写 |
| 只推不拉（旧行为） | `python3 src/auto_block.py d1 --dry-run` |
| 推给 Cloudflare IP List（维护命令，一般不用跑） | `python3 src/auto_block.py cf` |
| 查看/放宽边缘的 AI bot 策略（**不是**本目录的名单，是 Cloudflare 那一层） | `python3 ops/ai_bots.py --show` / `--apply` |

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

## 三个重要前提

1. **ASN 段当前对运行时无效**：`functions/_data/gateTrust.ts` 只带 `verified_bot`、
   `ua_allowlist_enabled` 与 `ip_cidrs`；ASN 的消费方是 **WAF 的 `js_challenge` 规则，
   而那条规则目前未启用**（`ops/waf/rules.snapshot.json` 记录
   `http_request_firewall_custom` 为空），并且 `WHITELIST_GROUPS` 也是空的。
   所以现在**改 ASN 不会立刻放宽或收紧线上门禁** —— 要同时改 `WHITELIST_GROUPS`
   并启用 WAF 规则才有效果。
2. **`robots.txt` 里的爬虫名单是「允许名单」，不是防火墙**：UA 可以随便伪造，
   它换来的是「不被 Turnstile 拦」，代价见上一节的三层表。反过来，它是一份
   **公开文件**（线上就在 `/robots.txt`），别往 `User-agent:` 里写不想让外人看到的东西
   —— 那些条目同时会成为门禁放行名单。真要不让某个来源进门，把它写进 `blocked_ips`
   （D1 权威）或 `blocklist.txt`。
3. **`blocklist.txt` 不是权威**：权威是 D1 的 `blocked_ips`。用上面的 `reconcile`
   双向对齐（或 `d1` 单向推）才算数。
