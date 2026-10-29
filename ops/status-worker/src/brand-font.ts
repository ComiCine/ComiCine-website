/**
 * ComiCine status-page wrapper code around embedded Baloo 2 and Delius Swash Caps subsets.
 *
 * Copyright (C) 2026-Present ComiCine (wrapper code only)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Additional terms under Section 7 apply to ComiCine's wrapper code.
 * See ADDITIONAL_TERMS.txt.
 *
 * The embedded fonts are third-party material licensed under SIL OFL 1.1;
 * see site/src/static/fonts/baloo2/OFL.txt and site/src/static/fonts/delius-swash-caps/OFL.txt.
 *
 * Regenerate the Baloo 2 subset from the bundled variable font with fonttools + brotli:
 *   pyftsubset site/src/static/fonts/baloo2/Baloo2-VariableFont_wght.ttf \
 *     --text="ComiCine" --flavor=woff2 --output-file=/tmp/comicine-baloo2-wordmark.woff2
 * The Delius subset is already bundled at site/src/static/fonts/delius-swash-caps/.
 * To refresh this file, base64-encode both subset files and replace their matching data URLs below.
 */

/** Generated Baloo 2 subset for the ComiCine navigation wordmark. */
const BALOO_BRAND_FONT_CSS =
  "@font-face{font-family:'Baloo 2';font-style:normal;font-display:swap;font-weight:100 900;" +
  "unicode-range:U+0020,U+0043,U+0065,U+0069,U+006D,U+006E,U+006F;" +
  "src:url(data:font/woff2;base64," +
  "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" +
  "/L9xkTsB" +
  ") format('woff2');}";

const COPYRIGHT_FONT_CSS =
  "@font-face{font-family:'Delius Swash Caps';font-style:normal;font-display:swap;font-weight:400;" +
  "unicode-range:U+0020,U+002D,U+0030-0039,U+0043,U+0050,U+0065,U+0069,U+006D-006F,U+0072-0074,U+00A9;" +
  "src:url(data:font/woff2;base64," +
  "d09GMgABAAAAAAn8AA4AAAAAEIQAAAmoAAEAgwAAAAAAAAAAAAAAAAAAAAAAAAAAGhYbgw4cIAZgAHwRCAqTFI94ATYCJANg" +
  "CzIABCAFhCYHIBu/DVGUJ9ZMih8JZZs+mg8kSZEkyY19pH/7/3HOvy9JLUW0LbJPKTrwDpNiXljb4FqKTiwBZsnEBNn5TFzS" +
  "9psIz/9ztO7/7WKRJZhAgRTlCa0WDu624ugqPmfe2LrSw62LD8P//7VW9y9qIeKNEIlkQqWkeaOXv5j8wXRmcG0mGTp9E9E9" +
  "iobMoVQajZAap4OKbE7Ah2g/QilXTwYIgA0DgUGWy4tNAEi+1LB5fQbYrRsGjWCHAABvjRGrln4jiAElARxzTMyD8JdwkM1k" +
  "2BiwsAkm4Tl8BN/AT/ATEiMZikLpgHGBx0JANIwkkcnYkhFenggmSEKYFhnBJiPH7Jw6zGWwa3qyVBCy+QSHxSXKwF4DSYgV" +
  "VmCzURsBs1ZFkhlDZEVJ4kMIWh3btLpzxjEXpw6cmXAZ0FZAoIgsjK+s5io+mEzBLgfU5fc2sHushm3OSOxkEXCNwLEl8zzK" +
  "3ICoJj0hHEMG0v5wZ4YiwytpoliNCcpar0l6nl7T6pOxuo7WgQBgtxgLAKsGe6NPUPuLBIxwADotcqBp0z8AGkoT+Fv//QTg" +
  "SpAdGNVX7o4SBhzD4WI4iqMI7ULGgYYQvWKoeBm0WnToNWji//8BeAMionv0f/X8xpxXeZirmczRHMqBGCG1pGNRfvY+WcEi" +
  "DB8biPuHEbFTfVnKvawMWOcMopz2uuvzycQSZVBEoDDaVezhJJG4SkJFnnLJDJKMD5SIZ4R4eYolTq9KT3FSbju9jWRJg44l" +
  "2R3MTin3Pmce4VnLaIuVsbA8beaa9PQ4O8lYEdJsCuTHWdkOZvpV8FRw6rSUm6D5EUpKcRNAL2Qg9HA5dWvq1dSUFTEWkuVJ" +
  "dtJzCc5M8/xlLV+npzigr/Mac3Ifki1+inZKObcJM5d6jbEYnpOs7IjHQcpK7dIJTQY9DbTvJtL/CGLQxhdy38JsvWWlqGtS" +
  "DmgecvYT9Hij1IoMfJeB5cn9tFJhlXJbSWFBzBS32c2NDsjUjZN7CcY3RXr4ZhXz9nItJMvrptndWIPFytNMZa8NvjZ1nruW" +
  "6HLQy+vUNLU39UzVU8vR5RWaM1rRbmAMPLDLKp+9On+1LwZo3tlSzkod26k8huLVWVjN9W0UdHH82pSrzK2z2fEYfYG7hphR" +
  "i2T5ETPTDn7GbQaZAQbLqLWKMZyurnZDb6ZdNrGyI4iypNxkrJRhb8CjXYduck3ldths5LN/oShaf8cM9Dgb9LKN5XV3OCvz" +
  "0hqGrIizLl1qMTzEnYCtnJ/1WALruMhjJHuJ6QqdnmYRZWC4BTrY7bf5MMt12TyJqEOTppSSLDOSihxiYaa4CXofnEN4t1eZ" +
  "dqNt/mSOx3p5yrXX+RO6EktNtU+lXuOeHEvgJGk20fx9050557o5efOD43UMlqAtr99lgPkXkV1lA8fpB2bXC+Y2g47eL+Uu" +
  "OTriQ1DlaZJlpNEGhgPdMvJ0zTMept15OvmKlHt0R51IsmUvGatltXmEX2UZfZN7Cpr1nX6dWLMRjrl+7vS5K4aPdYQXD7/b" +
  "+EZgTuk/eXNLbOX3vSfHe078ZDxxFPzf8SmHTu+qEGJo6u+/2wOjs/9U7FjvfKszYH5B0joPh4WhxFwxLFlwVwjXO/Z+6ivE" +
  "JKEO808uvJyo+dhpL7EgosxLnZ0eXpbW4W6nsgscbJxuN47ltGuyFndU1kDn415iK54UJrtdUUnXO3fMObF4Va/u3+8CbDyc" +
  "z7pkqddMP1vXXJFF+AU6/Wk376dS+7Kq3IoBfCtBEIq/XP6CHz7UIOISgbu7Hyaz3N1xAr+SB2/hCPPYVO1Y4heXUdgwuClF" +
  "FZXkSsx/MSI75X1oVeafqKEUcR3zYHp4NRFcgaOyRr1jVnRRZ//IQ2aDqZzpDLfH3B+d4BOzt9X0ri2r5rJjGu0CgqQ23QVk" +
  "FREeu5VYvRcfSkFA8uzCY2y3xscvdmD/QTvTluqomMbe5ZeH1r6dUpxcMv5LRdfKqtql+oa12kbQPu4n9hNJ4S5+swu3tv3g" +
  "UX/0hqcqWLTx95edhHrY+OcIvp9Q58N7K39OLurvrD7cU22KLzqzs3BlMT1433QsXsWMNu9KD5qbU8rzV+ir7Ai/vrMgV12b" +
  "ry6YADhx9eG/e/cmbnjPHruhv9HqC8nZKVn8wj3jtWPXT6zRNq6q6FoBi/96Vy+YnVaqM83WUxUe9hFuZ4M9Y/N9o/9+h+pa" +
  "eRnW3jRG6txKC+T/SQM2VTevqzXV9udc+ADuJXdj+WMfxH9pqiGmwq9elY/tUgmfF9hP00adLktCDDu984Z+4aE11yM0VfMf" +
  "+EpFkkmtbMHeju78hY1U8kJflGetzvN38HbHeyHpKb280TatbnlpqLa14ueofDtBdnXTwpIkt++knv05Ge3zN+AtGh+5sNRZ" +
  "LKuc23+wqWL9gjwY/JgZIbvrEjRLcSNaTLwgXqgL1b0fA5GHRGJXsELe4NQkdMdkfm8m4eeyostqK/occ7A3ZvmHrXQeudga" +
  "Pnp4kMNWZYWq4jWpNH1xW0J+xlfai8K52+D7BDlvEspaa03OuQu8T+7iLi3VD4OXqgGufvBI9eBK97+yb7y3dMfj0W3vL9v+" +
  "CDZ9gl2a+6ttUVaqKj1tbbyPnqVUIZRPmsrWm1oDe9dmGA07Noz6yOu2O+gnTsvjskKDopu8jX5ffcMqYhq1rD5shreP3V8/" +
  "VDQdmJU6FHbnZGwaSG7KEPqm2uLtcFrgGpQX7EvRoGlbdbr6BOpVF6oxkxZXq5SweDsz29vV00MULItL1w4ExkZ5jotkcoes" +
  "wFkFuYH7mkyxC4lzF4UtSjs8415u2vGOfpxXG3a8nVcMPjsASPcx6kQBEJ+x/sJugjxre2B3IYUMbFL9w7zbaNy1Qz/V2Sf9" +
  "KpbiXwAAPFz2Wf7gjP+v/v9EHMTfAgAx7F9H+a/JJZ6RwFyhYnJtK3wH0HkydIX03gAptRpk7QthHQfxnQ7yToWUToOU+gq8" +
  "WgOJpJjV54HDT0FAe4DCB5Ax6IHMzjDfTw1htQ0y6x74Vim49C+ggQAozCNUSbAXHLMQ+V144FASiKYqEY+oShyPsaugeFxh" +
  "xU0lwHgB9xp7KqGw2gMZepnM069Dm3aDlAI1mUlJLUJkJyfE+ERaxRoManQz0UCyMnRo0WIgXp/EqJ92NNr0WNEtrECv4yli" +
  "UXN08HYZwtHCxnAXzTSyYRgRZZvocZaSSqahbWOIM7OKdpT0jFtnDbO3YJjtCCGNjCE3yc03DKU9RRuEbnKG/jMxOVprAqXk" +
  "1ISzzA3HjwEWHTmUHoTFiIAmiemRHs0UumcFuDqj/0upAQAA" +
  ") format('woff2');}";

export const BRAND_FONT_CSS = BALOO_BRAND_FONT_CSS + COPYRIGHT_FONT_CSS;
