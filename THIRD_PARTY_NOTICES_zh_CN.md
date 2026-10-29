# 第三方声明

本文件列出本项目使用或随项目分发的第三方字体与软件依赖，供查阅之用，不替代原始许可证文本。各第三方作品继续遵守其自身许可证；本文件不会将第三方材料改许可为项目许可证。

## 字体

### Delius Swash Caps

Delius Swash Caps 由 Natalia Raices 设计。字体软件版权属于 Natalia Raices（2010、2011）和 Igino Marini（2011），依据 SIL Open Font License 第 1.1 版（OFL-1.1）发布。上游来源为 [google/fonts](https://github.com/google/fonts/tree/main/ofl/deliusswashcaps)；许可证文本位于 [src/static/fonts/delius-swash-caps/OFL.txt](src/static/fonts/delius-swash-caps/OFL.txt)。

项目在 src/static/fonts/delius-swash-caps/ 中包含自托管的 WOFF2 子集，用于网站字标中的准确品牌名称 ComiCine，以及 Copyright 符号和年份之后的 ComiCine 字样。状态 Worker 在 ops/status-worker/src/brand-font.ts 中嵌入该子集。再分发时须保留版权及许可证声明，不得单独出售字体软件，并须遵守 OFL-1.1，包括保留字体名称 “Delia”“Delia Unicase”“Delius” 和 “Delius Unicase”。

### Inter

Inter 的版权声明为 The Inter Project Authors，版权年份为 2016，依据 OFL-1.1 提供。上游项目为 [rsms/inter](https://github.com/rsms/inter)；本站托管的网页字体子集来源于 @fontsource-variable/inter 5.3.0。仓库内许可证副本位于 [src/static/fonts/inter/LICENSE.txt](src/static/fonts/inter/LICENSE.txt)。

Inter 字体子集位于 src/static/fonts/inter/ 和 docs/docs/public/fonts/。上游项目将 “Inter” 标明为保留字体名称。再分发或修改字体时须遵守随附 OFL 文本及上游关于保留名称的条件。

### Maple Mono NF CN

Maple Mono NF CN 的版权声明为 The Maple Mono Project Authors，版权年份为 2022，依据 OFL-1.1 提供。上游项目为 [subframe7536/maple-font](https://github.com/subframe7536/maple-font)；仓库内许可证副本位于 [ops/fonts/OFL.txt](ops/fonts/OFL.txt)。

仓库包含一个构建脚本，用于生成适配门禁页面的字体衍生版本，该版本为 Maple Mono NF CN Regular 添加两个韩文字形。源字体和生成的字体文件保存在 Git 仓库之外；生成的网页字体由 fonts.comicine.com 提供。该衍生字体仍须遵守 OFL-1.1，包括声明、再分发和保留字体名称等条件。

## 软件依赖

JavaScript 软件包及其记录的许可证标识列于 package-lock.json、ops/package-lock.json 及对应的 package.json。这些软件包用于测试、构建、类型检查、部署和 CSS 生成；本仓库声明的 Worker 运行时没有第三方 npm 运行时依赖。

Python 软件包版本列于 ops/requirements.txt 和 requirements.lock。锁定文件记录版本，但不提供汇总的许可证清单。再分发某个软件包时，应查阅该软件包自带的许可证和声明；传递依赖的许可证也继续适用。

## 二维码图片中的平台标识

`src/static/qr-codes/` 中的二维码图片及其图像编排由项目作者创作或提供。此说明不表示项目主张其中第三方名称、Logo、图标或其他标识的权利。WeChat 和 QQ 标识与腾讯及其相关权利人有关；Bilibili 标识与哔哩哔哩及其相关权利人有关；Instagram 和 WhatsApp 标识与 Meta Platforms, Inc. 及其相关权利人有关；YouTube 标识与 Google LLC 有关；LINE 标识与 LY Corporation 及其相关权利人有关；KakaoTalk 标识与 Kakao Corp. 有关；Telegram 标识与 Telegram FZ-LLC 及其相关权利人有关。具体权利归属和注册情况可能因司法管辖区而异。

这些标识仅用于识别对应的平台或联系入口。其出现不表示相关平台运营方或权利人与本项目存在合作、赞助、关联、授权或背书，也不表示相关平台实施或认可了任何官方行为。本声明不对任何标识进行再许可。任何使用仍须遵守权利人的适用条款及政策。

## 范围

本清单覆盖仓库中已确认的第三方字体、说明软件依赖清单的位置，并标明二维码图片中使用的平台标识；它未必逐项列出所有传递软件依赖或项目材料中提及的所有第三方标识。各组件随附的第三方许可证及声明仍是适用依据。
