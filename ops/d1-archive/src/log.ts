/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * Structured single-line JSON run logging, matching logRun in ops/sync-worker/src/index.ts.
 *
 * Keep this in a module because d1-archive now has two jobs (d1_archive / config_backup), each
 * following the same rule: log successes with console.log and failures with console.error.
 * Duplicating the rule would allow drift, potentially moving failures out of the error stream and
 * silently breaking failure visibility.
 *
 * outcome==='failed' uses console.error, so `wrangler tail` and the Workers Logs panel can search
 * for `"outcome":"failed"`.
 */
import { runStartedAt } from "../../sync-worker/src/runlog";

export function logRun(job: string, fields: Record<string, unknown> & { outcome?: string }): void {
  const payload: { event: string; ts: number; job: string; outcome?: string } & Record<
    string,
    unknown
  > = { event: job, ts: runStartedAt(), job, ...fields };
  const line = JSON.stringify(payload);
  if (payload.outcome === "failed") console.error(line);
  else console.log(line);
}
