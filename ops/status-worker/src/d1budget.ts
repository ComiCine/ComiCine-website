/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * Account-level D1 daily usage, read from Cloudflare GraphQL Analytics (suggestion 21).
 *
 * The free plan allows **5,000,000 rows read and 100,000 rows written per day for the whole
 * account**. On 2026-09-17 production read 7,882,267 rows in one day; afterwards every D1
 * endpoint returned `APIError 7500` until UTC midnight, and the only way to see it was the
 * post-incident `wrangler d1 info` output. There was no early warning.
 *
 * Sources and costs:
 *   - `wrangler d1 info comicine` (`rows_read_24h` / `rows_written_24h`) is a manual check.
 *   - The GraphQL dataset `d1AnalyticsAdaptiveGroups` (`dimensions { date databaseId }`,
 *     `sum { rowsRead rowsWritten }`, retained for 31 days) is the only queryable source. One
 *     request per day costs one HTTPS call and **0 D1 reads**. The token needs **Account
 *     Analytics Read**; the status-worker reuses `CLOUDFLARE_API_TOKEN`.
 *
 * Measurement semantics:
 *   - The check is judged on the **last complete UTC day**. The daily cron runs at 03:47 UTC,
 *     when the current day bucket holds about four hours of data, so using it for the ratio
 *     would false-alarm every day.
 *   - The partial current day is returned only for an early warning: at least one third of the
 *     day has elapsed and it has already spent half of the read budget.
 *   - Totals sum every database in the account, because the limits are account-level, while
 *     `per_database` keeps the breakdown needed to find the guilty database.
 *   - GraphQL has minute-level latency and usage is only accounted when SQL executes, so a
 *     number can lag or undercount during a platform interruption. That is acceptable for a
 *     once-daily check; the alternative would be reading it on every request.
 *
 * Fail open: missing credentials, an HTTP error, a timeout, or a malformed response return
 * `null` and only log a warning. Nothing here throws, so the other daily checks are never
 * disturbed.
 */

export const D1_USAGE_URL = "https://api.cloudflare.com/client/v4/graphql";

/**
 * Hard free-plan limits (2026-09-17 incident and the Cloudflare D1 pricing page): per account,
 * not per database. Raised here only together with the plan, and the alert copy follows.
 */
export const D1_DAILY_READ_LIMIT = 5_000_000;
export const D1_DAILY_WRITE_LIMIT = 100_000;

/** Warn at 70% of either limit and treat 90% as critical. */
export const D1_WARN_RATIO = 0.7;
export const D1_CRITICAL_RATIO = 0.9;

/** Early warning for the partial current day: after a third of the day, 50% of the read budget. */
export const D1_EARLY_WARN_ELAPSED_RATIO = 1 / 3;
export const D1_EARLY_WARN_SPEND_RATIO = 0.5;

/** One request may wait up to 10 seconds; a transient failure is retried once after this delay. */
export const D1_USAGE_TIMEOUT_MS = 10_000;
export const D1_USAGE_RETRY_DELAY_MS = 1_000;

const DAY_SECONDS = 86_400;

export interface D1DatabaseUsage {
  database_id: string;
  rows_read: number;
  rows_written: number;
}

export interface D1UsageDay {
  /** `YYYY-MM-DD` in UTC. */
  day: string;
  rows_read: number;
  rows_written: number;
}

export interface D1Usage extends D1UsageDay {
  /** One entry per database, largest read count first, then by id for a stable order. */
  per_database: D1DatabaseUsage[];
  /** Partial current UTC day; never used for the threshold decision, only for the early warning. */
  today: D1UsageDay;
}

export interface D1BudgetEnv {
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
}

export interface D1BudgetAssessment {
  level: "ok" | "warn" | "critical";
  read_ratio: number;
  write_ratio: number;
  today_read_ratio: number;
  early_warning: boolean;
  day: string;
}

const USAGE_QUERY = `query ($accountTag: String!, $from: Date!, $to: Date!) {
  viewer {
    accounts(filter: {accountTag: $accountTag}) {
      d1AnalyticsAdaptiveGroups(limit: 100, filter: {date_geq: $from, date_leq: $to}) {
        dimensions { date databaseId }
        sum { rowsRead rowsWritten }
      }
    }
  }
}`;

interface UsageGroup {
  dimensions?: { date?: unknown; databaseId?: unknown };
  sum?: { rowsRead?: unknown; rowsWritten?: unknown };
}

/** Shape of the GraphQL envelope, narrowed without `any`; every level is optional until validated. */
interface UsagePayload {
  data?: {
    viewer?: {
      accounts?: Array<{ d1AnalyticsAdaptiveGroups?: unknown }>;
    };
  };
}

function isoDay(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function warnReason(reason: string): void {
  console.warn(JSON.stringify({ event: "d1_budget_query_failed", reason }));
}

/** Non-negative whole row counts; anything else is treated as a malformed row and skipped. */
function toCount(value: unknown): number | null {
  const count = typeof value === "number" ? value : Number(value);
  return Number.isFinite(count) && count >= 0 ? Math.floor(count) : null;
}

/** Only transient failures are retried: a 401/403/404 will not change within a second. */
function retryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function summarizeUsage(payload: unknown, yesterday: string, today: string): D1Usage | null {
  const groups = (payload as UsagePayload | null)?.data?.viewer?.accounts?.[0]
    ?.d1AnalyticsAdaptiveGroups;
  if (!Array.isArray(groups)) return null;

  const perDatabase = new Map<string, D1DatabaseUsage>();
  let yesterdayRead = 0;
  let yesterdayWritten = 0;
  let todayRead = 0;
  let todayWritten = 0;

  for (const group of groups as UsageGroup[]) {
    const date = typeof group?.dimensions?.date === "string" ? group.dimensions.date : "";
    const databaseId =
      typeof group?.dimensions?.databaseId === "string"
        ? group.dimensions.databaseId.trim()
        : "";
    const rowsRead = toCount(group?.sum?.rowsRead);
    const rowsWritten = toCount(group?.sum?.rowsWritten);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !databaseId || rowsRead === null || rowsWritten === null) {
      continue;
    }
    if (date === yesterday) {
      yesterdayRead += rowsRead;
      yesterdayWritten += rowsWritten;
      const database = perDatabase.get(databaseId) ?? {
        database_id: databaseId,
        rows_read: 0,
        rows_written: 0,
      };
      database.rows_read += rowsRead;
      database.rows_written += rowsWritten;
      perDatabase.set(databaseId, database);
    } else if (date === today) {
      todayRead += rowsRead;
      todayWritten += rowsWritten;
    }
  }

  return {
    day: yesterday,
    rows_read: yesterdayRead,
    rows_written: yesterdayWritten,
    per_database: [...perDatabase.values()].sort(
      (left, right) =>
        right.rows_read - left.rows_read || left.database_id.localeCompare(right.database_id),
    ),
    today: { day: today, rows_read: todayRead, rows_written: todayWritten },
  };
}

/**
 * Read account-level D1 usage for the last complete UTC day and the partial current day.
 *
 * Returns `null` on missing credentials, a network/HTTP failure, or any malformed response.
 * Never throws and never logs the token or account id.
 */
export async function readD1Usage(
  env: D1BudgetEnv,
  now: number = Math.floor(Date.now() / 1000),
): Promise<D1Usage | null> {
  const token = (env.CLOUDFLARE_API_TOKEN ?? "").trim();
  const accountId = (env.CLOUDFLARE_ACCOUNT_ID ?? "").trim();
  if (!token || !accountId) {
    warnReason("missing_credentials");
    return null;
  }

  const todayStart = now - (now % DAY_SECONDS);
  const yesterday = isoDay(todayStart - DAY_SECONDS);
  const today = isoDay(todayStart);
  const body = JSON.stringify({
    query: USAGE_QUERY,
    variables: { accountTag: accountId, from: yesterday, to: today },
  });

  let lastReason = "unknown";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), D1_USAGE_TIMEOUT_MS);
    try {
      const response = await fetch(D1_USAGE_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body,
        signal: controller.signal,
      });
      if (!response.ok) {
        lastReason = `http_${response.status}`;
        if (attempt === 0 && retryableStatus(response.status)) {
          await sleep(D1_USAGE_RETRY_DELAY_MS);
          continue;
        }
        warnReason(lastReason);
        return null;
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        // A 2xx with an unparseable body is not transient; retrying would only add load.
        warnReason("invalid_json");
        return null;
      }
      const usage = summarizeUsage(payload, yesterday, today);
      if (!usage) {
        warnReason("unexpected_payload");
        return null;
      }
      return usage;
    } catch (err) {
      lastReason = controller.signal.aborted ? "timeout" : `network_error: ${String(err).slice(0, 80)}`;
      if (attempt === 0) {
        await sleep(D1_USAGE_RETRY_DELAY_MS);
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  warnReason(lastReason);
  return null;
}

/**
 * Decide the alert level from the last complete day, then apply the current-day early warning.
 * `now` is epoch seconds; it is used only to know how much of today has elapsed.
 */
export function assessD1Budget(usage: D1Usage, now: number): D1BudgetAssessment {
  const readRatio = usage.rows_read / D1_DAILY_READ_LIMIT;
  const writeRatio = usage.rows_written / D1_DAILY_WRITE_LIMIT;
  const worst = Math.max(readRatio, writeRatio);
  let level: D1BudgetAssessment["level"] =
    worst >= D1_CRITICAL_RATIO ? "critical" : worst >= D1_WARN_RATIO ? "warn" : "ok";

  const todayReadRatio = usage.today.rows_read / D1_DAILY_READ_LIMIT;
  // Seconds already elapsed in the current UTC day, as a fraction of a whole day.
  const elapsedRatio = (now % DAY_SECONDS) / DAY_SECONDS;
  const earlyWarning =
    elapsedRatio >= D1_EARLY_WARN_ELAPSED_RATIO && todayReadRatio >= D1_EARLY_WARN_SPEND_RATIO;
  if (earlyWarning && level === "ok") level = "warn";

  return {
    level,
    read_ratio: readRatio,
    write_ratio: writeRatio,
    today_read_ratio: todayReadRatio,
    early_warning: earlyWarning,
    day: usage.day,
  };
}

/** One English alert line: evaluated day, level, both ratios, per-database read breakdown. */
export function budgetAlertDetail(usage: D1Usage, assessment: D1BudgetAssessment): string {
  const readPercent = Math.round(assessment.read_ratio * 100);
  const writePercent = Math.round(assessment.write_ratio * 100);
  const top = usage.per_database
    .slice(0, 3)
    .map((database) => `${database.database_id}=${database.rows_read}`);
  const rest = usage.per_database.length - top.length;
  const breakdown = top.length
    ? ` · databases: ${top.join(", ")}${rest > 0 ? ` (+${rest} more)` : ""}`
    : "";
  const early = assessment.early_warning
    ? ` · early warning: today ${Math.round(assessment.today_read_ratio * 100)}% of the read budget`
    : "";
  return (
    `day ${usage.day} · level=${assessment.level} · ` +
    `rows_read ${readPercent}% of ${D1_DAILY_READ_LIMIT} (${usage.rows_read}) · ` +
    `rows_written ${writePercent}% of ${D1_DAILY_WRITE_LIMIT} (${usage.rows_written})` +
    breakdown +
    early
  );
}
