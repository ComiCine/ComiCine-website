/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * Module mock for `functions/_lib/session`, shared by seven admin route tests (tasks/22 W5-15).
 *
 * Why this lives in `tests/` instead of `functions/_lib/__mocks__/`:
 * `tests/` is outside the Pages project's `functions/` root, so
 * `wrangler pages functions build` cannot see it. In an isolated comparison,
 * placing this file in `functions/_lib/` did not add it to the bundle when no
 * route imported it, but importing it from one route added it immediately
 * (179283 vs. 178926 bytes). Excluding files under `functions/` is therefore a
 * detail of the current Wrangler scan, not a guarantee; files under `tests/`
 * cannot be included in the production bundle by directory structure.
 * `vitest.config.ts` includes only `.test.ts` files under `functions/` and the
 * three Worker test trees, so this helper is not collected as a test (its name
 * also does not end in `.test.ts`).
 * To verify that the helper is not bundled, run
 * `npx wrangler pages functions build --outdir=<dir> --project-directory=.`
 * in this repository. The output is byte-for-byte identical to the pre-change
 * bundle apart from one comment containing Wrangler's temporary directory name,
 * and `grep -c createSessionModuleMock index.js` returns 0 (see tasks/22).
 *
 * Its behavior matches production `requireAdminSession` in
 * `functions/_lib/session.ts`:
 * `requireAuth` errors (`AuthSessionUnavailableError`, when the D1 revocation
 * table is unavailable) are delegated to `authUnavailableResponse()` (503 by
 * default; three test files override the body in `beforeEach` with the production
 * `{ error: "auth_sessions_unavailable" }` response).
 * Unauthenticated requests receive 401 with the localized unauthenticated
 * message and `Cache-Control: no-store`. Non-admin requests receive 403 with
 * `{ error: forbidden }` and `Cache-Control: no-store`; `forbidden` defaults to
 * the production read-only-account denial message. Authorized requests return
 * `{ session }`.
 *
 * When this mock was duplicated across seven files, its 503 branch was missing:
 * `auth_unavailable` was configured in `beforeEach` but never reached. Audit
 * W5-15 identified this dead configuration. Adding the catch makes
 * `mockRejectedValueOnce` exercise the D1-unavailable 503 response.
 *
 * Usage: dynamically import this helper inside the `vi.mock` factory, which
 * cannot reference variables from the outer scope.
 *
 * ```ts
 * vi.mock("../../_lib/session", async () => {
 *   const { createSessionModuleMock } = await import("../../../tests/helpers/admin-session");
 *   return createSessionModuleMock();
 * });
 * ```
 */

import { vi } from "vitest";

/** Same text as production `ADMIN_REQUIRED_MESSAGE`, the default denial for non-admin accounts. */
export const ADMIN_REQUIRED_MESSAGE = "只读账户，无写入权限";

/** Module mock for `functions/_lib/session`; call once per test file because module registries are isolated. */
export function createSessionModuleMock() {
  const requireAuth = vi.fn();
  // Match the original inline mock's plain-text 503 body; tests needing the production JSON body override it.
  const authUnavailableResponse = vi.fn(
    () => new Response("unavailable", { status: 503 }),
  );
  // Match production policy: delegate to the mocked requireAuth; return 401 for
  // unauthenticated requests, 403 for non-admins, and fail closed with 503 on errors.
  const requireAdminSession = vi.fn(
    async (env: unknown, request: Request, forbidden: string = ADMIN_REQUIRED_MESSAGE) => {
      let session: unknown;
      try {
        session = await requireAuth(env, request);
      } catch {
        return authUnavailableResponse();
      }
      if (!session) {
        return Response.json(
          { error: "未登录" },
          { status: 401, headers: { "Cache-Control": "no-store" } },
        );
      }
      if ((session as { role?: string }).role !== "admin") {
        return Response.json(
          { error: forbidden },
          { status: 403, headers: { "Cache-Control": "no-store" } },
        );
      }
      return { session };
    },
  );
  return { requireAuth, authUnavailableResponse, requireAdminSession };
}
