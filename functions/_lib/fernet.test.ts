/**
 * Limooo - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present Limooo Studio
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
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
