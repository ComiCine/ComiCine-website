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
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/** Fernet interoperability tests: the Python fixture and WebCrypto implementation decrypt each other's tokens. */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fernetDecrypt, fernetEncrypt } from "./fernet";

const TEST_KEY = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
const fixturePath = fileURLToPath(new URL("../../tests/fixtures/fernet_token.txt", import.meta.url));
const tsFixturePath = fileURLToPath(
  new URL("../../tests/fixtures/fernet_token_ts.txt", import.meta.url),
);

describe("fernet", () => {
  it("decrypts the Python-generated fixture", async () => {
    const token = readFileSync(fixturePath, "utf8").trim();
    expect(await fernetDecrypt(token, TEST_KEY)).toBe("hello-limooo");
  });

  /**
    * W5-3: `fernetEncrypt` base64url output **must retain `=` padding**.
   *
    * Production relies on TypeScript encryption and Python decryption:
    * `tracking.ts` writes `ip_enc`, and `ops/check_ip_rays.py` decrypts it with
    * `cryptography.fernet.Fernet.decrypt()` (which calls
    * `base64.urlsafe_b64decode` and raises `InvalidToken` when padding is
    * missing). Replacing `base64UrlEncode` with `crypto.ts`'s `toB64Url`, which
    * removes padding, would make every IP lookup report no record. The input
    * length of 100 (73 bytes) deterministically requires `==` padding because
    * AES-CBC ciphertext is always a multiple of 16 bytes.
   */
  it("keeps the base64 padding that Python's Fernet decoder requires", async () => {
    const token = await fernetEncrypt("8.8.8.8", TEST_KEY);
    expect(token).toContain("=");
    expect(token.length % 4).toBe(0);
  });

  it("decrypts the TS-generated fixture (the TS -> Python sample)", async () => {
    const token = readFileSync(tsFixturePath, "utf8").trim();
    expect(token).toContain("=");
    expect(await fernetDecrypt(token, TEST_KEY)).toBe("8.8.8.8");
  });

  it("encrypts and decrypts round-trip", async () => {
    const token = await fernetEncrypt("hello-limooo", TEST_KEY);
    expect(await fernetDecrypt(token, TEST_KEY)).toBe("hello-limooo");
  });

  it("rejects a wrong key", async () => {
    const token = await fernetEncrypt("hello-limooo", TEST_KEY);
    await expect(fernetDecrypt(token, "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWZ9")).rejects.toThrow();
  });
});
