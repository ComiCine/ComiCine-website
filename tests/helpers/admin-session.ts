/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * Module mock for `functions/_lib/session`, shared by the admin route tests (tasks/22 W5-15).
 *
 * Why this lives in `tests/` instead of `functions/_lib/__mocks__/`:
 * `tests/` is outside the Pages project's `functions/` root, so
 * `wrangler pages functions build` cannot see it. In an isolated comparison,
 * placing this file in `functions/_lib/` did not add it to the bundle when no
 * route imported it, but importing it from one route added it immediately
 * (179283 vs. 178926 bytes). Excluding files under `functions/` is therefore a
 * detail of the current Wrangler scan, not a guarantee; files under `tests/`
 * cannot be included in the production bundle by directory structure.
 * `vitest.config.ts` includes only `.test.ts` files under `functions/`, the docs
 * theme, and the three Worker test trees, so this helper is not collected as a
 * test (its name also does not end in `.test.ts`).
 * To verify that the helper is not bundled, run
 * `npx wrangler pages functions build --outdir=<dir> --project-directory=.`
 * in this repository. The output is byte-for-byte identical to the pre-change
 * bundle apart from one comment containing Wrangler's temporary directory name,
 * and `grep -c createSessionModuleMock index.js` returns 0 (see tasks/22).
 *
 * The mock mirrors production `requireAdminSession` in `functions/_lib/session.ts`
 * instead of copying its denial responses:
 * - 503: delegates to the real `authUnavailableResponse()`, so the status code,
 *   the `{ error: "auth_sessions_unavailable" }` body, and `Cache-Control:
 *   no-store` all come from production.
 * - 403: uses the real `ADMIN_REQUIRED_MESSAGE` as the default denial.
 * - 401: production keeps `{ error: "Not authenticated" }` inline with no export
 *   to import, so this file keeps the single test-side copy in
 *   `UNAUTHENTICATED_ERROR`; `functions/_lib/admin-session-mock.test.ts` asserts
 *   the mock's 401/403/503 responses equal production's, which fails if the copy
 *   drifts.
 *
 * `createSessionModuleMock` takes the real module (obtained with `vi.importActual`
 * inside each `vi.mock` factory), so the denial copy and the 503 response cannot
 * become independent copies again.
 *
 * When this mock was duplicated across seven files, its 503 branch was missing:
 * `auth_unavailable` was configured in `beforeEach` but never reached. Audit
 * W5-15 identified this dead configuration. Adding the catch makes
 * `mockRejectedValueOnce` exercise the D1-unavailable 503 response.
 *
 * Usage: import this helper dynamically inside the `vi.mock` factory, which
 * cannot reference variables from the outer scope, and pass the actual module:
 *
 * ```ts
 * vi.mock("../../_lib/session", async () => {
 *   const actual = await vi.importActual<typeof import("../../_lib/session")>("../../_lib/session");
 *   const { createSessionModuleMock } = await import("../../../tests/helpers/admin-session");
 *   return createSessionModuleMock(actual);
 * });
 * ```
 */

import { vi } from "vitest";

/**
 * The production surface this mock mirrors. `vi.importActual` supplies the real
 * module, so only the fields used for the denial defaults are required here.
 */
export interface SessionModuleSource {
  ADMIN_REQUIRED_MESSAGE: string;
  authUnavailableResponse(): Response;
}

/**
 * Test-side copy of production's inline 401 body.
 *
 * Production has no exported constant for it (`functions/_lib/session.ts`,
 * `requireAdminSession`). The parity test in `functions/_lib/` asserts this
 * value against the real 401 response; do not compare it with a hand-written
 * literal anywhere else.
 */
export const UNAUTHENTICATED_ERROR = "Not authenticated";

/** Module mock for `functions/_lib/session`; call once per test file because module registries are isolated. */
export function createSessionModuleMock(actual: SessionModuleSource) {
  const requireAuth = vi.fn();
  // Production's response, not a copy: status, JSON body, and no-store stay aligned.
  const authUnavailableResponse = vi.fn(() => actual.authUnavailableResponse());
  // Match production policy: delegate to the mocked requireAuth; return 401 for
  // unauthenticated requests, 403 for non-admins, and fail closed with 503 on errors.
  const requireAdminSession = vi.fn(
    async (env: unknown, request: Request, forbidden: string = actual.ADMIN_REQUIRED_MESSAGE) => {
      let session: unknown;
      try {
        session = await requireAuth(env, request);
      } catch {
        return authUnavailableResponse();
      }
      if (!session) {
        return Response.json(
          { error: UNAUTHENTICATED_ERROR },
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
