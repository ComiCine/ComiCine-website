# 제3자 고지

이 문서는 프로젝트에서 사용하거나 배포하는 제3자 글꼴 및 소프트웨어 의존성을 확인하기 위한 목록입니다. 원래 라이선스 전문을 대체하지 않습니다. 각 제3자 저작물에는 해당 라이선스가 계속 적용되며, 이 문서로 프로젝트 라이선스가 적용되는 것은 아닙니다.

## 글꼴

### Baloo 2

Baloo 2의 저작권 표시는 The Baloo 2 Project Authors이며 SIL Open Font License 버전 1.1(OFL-1.1)에 따라 배포됩니다. 업스트림 프로젝트는 [EkType/Baloo2](https://github.com/EkType/Baloo2)입니다. 라이선스 전문은 [src/static/fonts/baloo2/OFL.txt](src/static/fonts/baloo2/OFL.txt)에 포함되어 있습니다.

프로젝트는 src/static/fonts/baloo2/ 및 docs/docs/public/fonts/에 Baloo 2 글꼴과 서브셋을 포함합니다. 또한 Baloo 2 SemiBold에서 파생해 생성한 괄호 글리프 서브셋이 src/static/fonts/baloo2/limooo-brackets-600-subset-baloo2.ttf와 src/static/fonts-round75.css의 임베디드 데이터에 포함되어 있습니다. 이 글꼴 파일에는 계속 OFL-1.1이 적용됩니다. 재배포할 때 저작권 및 라이선스 고지를 보존하고, 글꼴 소프트웨어 자체를 단독 판매하지 말며, 수정 글꼴과 예약 글꼴 이름에 관한 OFL 조건을 따라야 합니다.

### Inter

Inter의 저작권 표시는 The Inter Project Authors(2016)이며 OFL-1.1에 따라 배포됩니다. 업스트림 프로젝트는 [rsms/inter](https://github.com/rsms/inter)이고, 자체 호스팅 웹 글꼴 서브셋은 @fontsource-variable/inter 5.3.0에서 가져왔습니다. 라이선스 전문은 [src/static/fonts/inter/LICENSE.txt](src/static/fonts/inter/LICENSE.txt)에 포함되어 있습니다.

Inter 서브셋은 src/static/fonts/inter/ 및 docs/docs/public/fonts/에 있습니다. 업스트림 프로젝트는 “Inter”를 예약 글꼴 이름으로 지정합니다. 재배포하거나 수정할 때 포함된 OFL 전문과 업스트림의 예약 이름 조건을 따라야 합니다.

### Maple Mono NF CN

Maple Mono NF CN의 저작권 표시는 The Maple Mono Project Authors(2022)이며 OFL-1.1에 따라 배포됩니다. 업스트림 프로젝트는 [subframe7536/maple-font](https://github.com/subframe7536/maple-font)이고 라이선스 전문은 [ops/fonts/OFL.txt](ops/fonts/OFL.txt)에 포함되어 있습니다.

저장소에는 게이트 화면용으로 Maple Mono NF CN Regular에 한국어 글리프 2개를 추가하는 파생 글꼴 빌드 스크립트가 있습니다. 원본 글꼴과 생성된 글꼴 바이너리는 Git 저장소 외부에 보관되며, 생성된 웹 글꼴은 fonts.limooo.cn에서 제공합니다. 파생 글꼴에도 고지, 재배포 및 예약 글꼴 이름 조건을 포함한 OFL-1.1이 적용됩니다.

## 소프트웨어 의존성

JavaScript 패키지와 기록된 라이선스 식은 package-lock.json, ops/package-lock.json 및 해당 package.json에 있습니다. 이 패키지들은 테스트, 빌드, 타입 검사, 배포 및 CSS 생성 도구입니다. 이 저장소가 선언한 Worker 런타임 npm 의존성은 없습니다.

Python 패키지 버전은 ops/requirements.txt 및 requirements.lock에 기록되어 있습니다. 잠금 파일은 버전을 고정하지만 라이선스를 통합 정리하지는 않습니다. 패키지를 재배포할 경우 각 패키지의 라이선스와 고지를 확인하세요. 전이적 의존성에도 각각의 라이선스가 계속 적용됩니다.

## QR 코드 이미지에 표시된 플랫폼 표장

`src/static/qr-codes/`의 QR 코드 이미지와 그 구성은 프로젝트 작성자가 만들거나 제공했습니다. 이 설명은 이미지에 포함된 제3자의 이름, 로고, 아이콘 또는 기타 표장에 대한 권리를 주장하지 않습니다. WeChat 및 QQ 표장은 Tencent와 관련 권리자, Bilibili 표장은 Bilibili 및 관련 권리자, Instagram 및 WhatsApp 표장은 Meta Platforms, Inc. 및 관련 권리자, YouTube 표장은 Google LLC, LINE 표장은 LY Corporation 및 관련 권리자, KakaoTalk 표장은 Kakao Corp., Telegram 표장은 Telegram FZ-LLC 및 관련 권리자와 관련됩니다. 권리 귀속 및 등록 여부는 관할권에 따라 다를 수 있습니다.

이 표장들은 해당 플랫폼 또는 연락처를 식별하기 위한 목적으로만 표시됩니다. 표장의 표시가 플랫폼 운영자 또는 권리자와의 제휴, 후원, 관계, 허가, 보증 또는 공식적인 관여를 의미하지 않습니다. 이 고지로 표장을 재허가하지 않습니다. 모든 사용에는 권리자의 적용 가능한 약관과 정책이 계속 적용됩니다.

## 범위

이 목록은 저장소에서 확인한 제3자 글꼴을 다루고 소프트웨어 의존성 목록의 위치를 안내하며 QR 코드 이미지에 사용된 플랫폼 표장을 명시합니다. 모든 전이적 소프트웨어 구성 요소나 프로젝트 자료에서 언급하는 모든 제3자 표장을 빠짐없이 열거하지 않을 수 있습니다. 각 구성 요소에 포함된 제3자 라이선스와 고지가 계속 적용됩니다.
