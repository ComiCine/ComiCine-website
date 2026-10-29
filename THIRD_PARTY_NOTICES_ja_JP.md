# 第三者表示

本書は、本プロジェクトで使用または配布される第三者のフォントおよびソフトウェア依存関係を確認するための一覧です。各原著作物のライセンス本文に代わるものではありません。第三者の著作物にはそれぞれのライセンスが適用され、本書によってプロジェクトのライセンスに変更されることはありません。

## フォント

### Delius Swash Caps

Delius Swash Caps は Natalia Raices がデザインしました。フォントソフトウェアの著作権は Natalia Raices（2010、2011）および Igino Marini（2011）に帰属し、SIL Open Font License Version 1.1（OFL-1.1）に基づきます。上流ソースは [google/fonts](https://github.com/google/fonts/tree/main/ofl/deliusswashcaps) です。ライセンス本文は [src/static/fonts/delius-swash-caps/OFL.txt](src/static/fonts/delius-swash-caps/OFL.txt) に含まれています。

プロジェクトには src/static/fonts/delius-swash-caps/ にセルフホストの WOFF2 サブセットが含まれ、ウェブサイトのワードマークと Copyright 記号・年の後に続く正確なブランド名 ComiCine に使用されます。Status Worker は同じサブセットを ops/status-worker/src/brand-font.ts に埋め込んでいます。再配布時は著作権表示とライセンス表示を保持し、フォントソフトウェア単体で販売せず、「Delia」「Delia Unicase」「Delius」「Delius Unicase」の予約フォント名を含む OFL-1.1 の条件に従ってください。

### Inter

Inter の著作権表示は The Inter Project Authors（Copyright 2016）で、OFL-1.1 に基づきます。上流プロジェクトは [rsms/inter](https://github.com/rsms/inter) です。セルフホストされる Web フォントのサブセットは @fontsource-variable/inter 5.3.0 に由来します。ライセンス本文は [src/static/fonts/inter/LICENSE.txt](src/static/fonts/inter/LICENSE.txt) に含まれています。

Inter のサブセットは src/static/fonts/inter/ および docs/docs/public/fonts/ にあります。上流プロジェクトは “Inter” を Reserved Font Name としています。再配布または改変の際は、同梱の OFL 本文と上流の予約名称に関する条件に従ってください。

### Maple Mono NF CN

Maple Mono NF CN の著作権表示は The Maple Mono Project Authors（Copyright 2022）で、OFL-1.1 に基づきます。上流プロジェクトは [subframe7536/maple-font](https://github.com/subframe7536/maple-font) です。ライセンス本文は [ops/fonts/OFL.txt](ops/fonts/OFL.txt) に含まれています。

リポジトリには、ゲート画面用に Maple Mono NF CN Regular へ韓国語グリフを 2 文字追加する派生フォントのビルドスクリプトがあります。元フォントと生成されたフォントバイナリは Git リポジトリ外に保管され、生成した Web フォントは fonts.comicine.com から配信されます。派生フォントにも、表示、再配布、予約フォント名に関する条項を含め、OFL-1.1 が適用されます。

## ソフトウェア依存関係

JavaScript パッケージと記録されたライセンス表記は package-lock.json、ops/package-lock.json、および対応する package.json にあります。これらはテスト、ビルド、型チェック、デプロイ、CSS 生成用のツールです。本リポジトリが宣言する Worker 実行時の npm 依存関係はありません。

Python パッケージのバージョンは ops/requirements.txt および requirements.lock に記録されています。ロックファイルはバージョンを固定しますが、ライセンスを集約していません。パッケージを再配布する場合は、各パッケージに付属するライセンスおよび表示を確認してください。推移的依存関係にも各ライセンスが適用されます。

## QR コード画像内のプラットフォーム標章

`src/static/qr-codes/` 内の QR コード画像およびその構成は、プロジェクトの作者が作成または提供したものです。この説明は、画像に含まれる第三者の名称、ロゴ、アイコンその他の標章に対する権利を主張するものではありません。WeChat および QQ の標章は Tencent および関連する権利者、Bilibili の標章は Bilibili および関連する権利者、Instagram および WhatsApp の標章は Meta Platforms, Inc. および関連する権利者、YouTube の標章は Google LLC、LINE の標章は LY Corporation および関連する権利者、KakaoTalk の標章は Kakao Corp.、Telegram の標章は Telegram FZ-LLC および関連する権利者に関係します。権利の帰属および登録状況は法域によって異なる場合があります。

これらの標章は、対応するプラットフォームまたは連絡先を識別する目的に限り表示されています。表示は、各プラットフォーム運営者または権利者との提携、後援、関係、許諾、推奨、または公式な関与を意味しません。本表示によって標章が再許諾されることはありません。使用には権利者の適用される条件およびポリシーが引き続き適用されます。

## 範囲

本一覧は、リポジトリ内で確認できた第三者フォントを記載し、ソフトウェア依存関係の参照先を示すとともに、QR コード画像内のプラットフォーム標章を明記します。すべての推移的依存関係やプロジェクト資料内で言及される第三者標章を網羅するものではありません。各コンポーネントに付属する第三者ライセンスと表示が引き続き適用されます。
