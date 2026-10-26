# Third-Party Notices

This notice identifies third-party fonts and software dependencies used or distributed with this project. It is an inventory aid, not a replacement for the original license texts. Each third-party work remains under its own license; nothing here relicenses third-party material under the project license.

## Fonts

### Baloo 2

Baloo 2 is by The Baloo 2 Project Authors and is distributed under the SIL Open Font License, Version 1.1 (OFL-1.1). The upstream project is [EkType/Baloo2](https://github.com/EkType/Baloo2). The license text is included at [src/static/fonts/baloo2/OFL.txt](src/static/fonts/baloo2/OFL.txt).

The project includes Baloo 2 font files and subsets under src/static/fonts/baloo2/ and docs/docs/public/fonts/. It also includes a project-generated bracket-glyph subset derived from Baloo 2 SemiBold in src/static/fonts/baloo2/comicine-brackets-600-subset-baloo2.ttf and an embedded copy in src/static/fonts-round75.css. These font files remain subject to OFL-1.1. Keep the font copyright and license notices with redistributed copies, do not sell the font software by itself, and follow the OFL requirements for modified fonts and reserved font names.

### Inter

Inter is by The Inter Project Authors, copyright 2016, and is distributed under OFL-1.1. The upstream project is [rsms/inter](https://github.com/rsms/inter); the self-hosted web-font subsets were sourced from @fontsource-variable/inter 5.3.0. The license text is included at [src/static/fonts/inter/LICENSE.txt](src/static/fonts/inter/LICENSE.txt).

Inter subsets are present under src/static/fonts/inter/ and docs/docs/public/fonts/. The upstream project identifies “Inter” as a Reserved Font Name. Redistribution or modification must follow the included OFL text and the upstream reserved-name conditions.

### Maple Mono NF CN

Maple Mono NF CN is by The Maple Mono Project Authors, copyright 2022, and is distributed under OFL-1.1. The upstream project is [subframe7536/maple-font](https://github.com/subframe7536/maple-font); the license text is included at [ops/fonts/OFL.txt](ops/fonts/OFL.txt).

The repository contains a build script for a gate-specific derivative that adds two Korean glyphs to Maple Mono NF CN Regular. The source font and generated font binaries are kept outside this Git repository; the generated web font is served from fonts.comicine.com. The derivative remains subject to OFL-1.1, including its notice, redistribution, and reserved-name terms.

## Software Dependencies

JavaScript packages and their recorded license expressions are listed in package-lock.json, ops/package-lock.json, and the corresponding package.json files. These packages provide test, build, type-checking, deployment, and CSS-generation tools; the Worker runtime has no third-party npm runtime dependency declared by this repository.

Python package versions are listed in ops/requirements.txt and requirements.lock. The lock file pins versions but does not provide a consolidated license inventory. Check each package's own license and notices when redistributing that package. Transitive dependency licenses remain applicable as well.

## Platform Marks in QR-Code Images

The QR-code images and their compositions in `src/static/qr-codes/` were created or supplied by the project author. That statement does not claim ownership of third-party names, logos, icons, or other marks incorporated into those images. The WeChat and QQ marks are associated with Tencent and its relevant rights holders; the Bilibili mark with Bilibili and its relevant rights holders; Instagram and WhatsApp with Meta Platforms, Inc. and its relevant rights holders; YouTube with Google LLC; LINE with LY Corporation and its relevant rights holders; KakaoTalk with Kakao Corp.; and Telegram with Telegram FZ-LLC and its relevant rights holders. Ownership and registration may vary by jurisdiction.

These marks appear only to identify the corresponding platforms or contact destinations. Their appearance does not imply any partnership, sponsorship, affiliation, authorization, endorsement, or official action by those platform operators or rights holders. No mark is relicensed by this notice. Any use remains subject to the rights holders' applicable terms and policies.

## Scope

This inventory covers the third-party fonts identified in the repository, describes the dependency manifests, and identifies platform marks used in QR-code images. It may not enumerate every transitive software component or every third-party mark referenced by project materials. The applicable third-party license and notice shipped with each component remain authoritative.
