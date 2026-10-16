/**
 * Limooo - serverless personal website and admin system
 *
 * Copyright (C) 2026 Limooo <https://limooo.cn/>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Brand font subset (**generated artifact; do not edit manually**): Baloo 2 glyphs used by "Limooo Studio" only.
 *
 * Regenerate (requires fonttools + brotli; install them in a temporary local venv, not in the repository):
 *   python3 -m venv /tmp/ft-venv && /tmp/ft-venv/bin/pip install fonttools brotli
 *   /tmp/ft-venv/bin/pyftsubset site/src/static/fonts/baloo2/Baloo2-VariableFont_wght.ttf \
 *     --text="Limooo Studio" --flavor=woff2 --no-hinting --desubroutinize \
 *     --output-file=/tmp/baloo2-wordmark.woff2
 *   Then run: base64 -i /tmp/baloo2-wordmark.woff2 | tr -d '\n'
 *
 * Why the font is inlined: the status page runs on a separate Worker (status.limooo.cn), and
 * the main site's /static/fonts/** is cross-origin. Cross-origin @font-face requires CORS
 * headers, which the main site does not provide. The status page must remain readable and
 * styled when the main site is down, so the wordmark font must be bundled here.
 * The subset is 2.3 KB, about 3 KB after base64, much smaller than the main site's full Latin subset (37 KB).
 *
 * License: SIL OFL 1.1, the same font as the main site (`site/src/static/fonts/baloo2/OFL.txt`).
 * `unicode-range` lists only code points present in the subset; other text falls back through
 * the CSS font stack to ui-rounded / system-ui, avoiding missing-glyph boxes.
 */
export const BRAND_FONT_CSS =
  "@font-face{font-family:'Baloo 2';font-style:normal;font-display:swap;font-weight:100 900;" +
  "unicode-range:U+0020,U+004C,U+0053,U+0064,U+0069,U+006D,U+006F,U+0074,U+0075;" +
  "src:url(data:font/woff2;base64," +
  "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) format('woff2');}";
