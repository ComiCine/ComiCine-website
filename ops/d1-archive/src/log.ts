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
