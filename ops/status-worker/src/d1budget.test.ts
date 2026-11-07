/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * D1 daily budget check tests (suggestion 21).
 *
 * `readD1Usage` scans the Cloudflare GraphQL D1 dataset, and `assessD1Budget` is the only thing
 * standing between a 5,000,000 rows/day limit and another `APIError 7500` day. The tests pin down:
 *   - the 69/70/90 percent boundaries (warn, critical);
 *   - that a failed/misconfigured read returns null instead of throwing or alerting;
 *   - that every database is summed (the free-plan limit is account-level);
 *   - that the alert detail is readable English and never leaks the token.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  D1_CRITICAL_RATIO,
  D1_DAILY_READ_LIMIT,
  D1_DAILY_WRITE_LIMIT,
  D1_EARLY_WARN_ELAPSED_RATIO,
  D1_EARLY_WARN_SPEND_RATIO,
  D1_USAGE_RETRY_DELAY_MS,
  D1_WARN_RATIO,
  assessD1Budget,
  budgetAlertDetail,
  readD1Usage,
  type D1Usage,
} from "./d1budget";

const NOW = 1_800_000_000; // 2027-01-15 08:00:00 UTC
const TODAY = new Date((NOW - (NOW % 86400)) * 1000).toISOString().slice(0, 10);
const YESTERDAY = new Date((NOW - (NOW % 86400) - 86400) * 1000).toISOString().slice(0, 10);

function usage(overrides: Partial<D1Usage> = {}): D1Usage {
  return {
    day: YESTERDAY,
    rows_read: 3_900_000,
    rows_written: 29_000,
    per_database: [{ database_id: "db-main", rows_read: 3_900_000, rows_written: 29_000 }],
    today: { day: TODAY, rows_read: 10_000, rows_written: 1_000 },
    ...overrides,
  };
}

function graphql(rows: Array<{ date: string; id: string; read: number; written: number }>) {
  return Response.json({
    data: {
      viewer: {
        accounts: [
          {
            d1AnalyticsAdaptiveGroups: rows.map((row) => ({
              dimensions: { date: row.date, databaseId: row.id },
              sum: { rowsRead: row.read, rowsWritten: row.written },
            })),
          },
        ],
      },
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("readD1Usage", () => {
  it("returns null and makes no request without credentials", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(readD1Usage({}, NOW)).resolves.toBeNull();
    await expect(
      readD1Usage({ CLOUDFLARE_API_TOKEN: "t" }, NOW),
    ).resolves.toBeNull();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn.mock.calls.some((call) => String(call[0]).includes("missing_credentials"))).toBe(true);
  });

  it("sums every database for the last complete day and keeps today separate", async () => {
    const fetchMock = vi.fn(async () =>
      graphql([
        { date: YESTERDAY, id: "db-main", read: 3_000_000, written: 20_000 },
        { date: YESTERDAY, id: "db-sink", read: 40, written: 0 },
        { date: YESTERDAY, id: "db-main", read: 100_000, written: 1_000 },
        { date: TODAY, id: "db-main", read: 500_000, written: 5_000 },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await readD1Usage(
      { CLOUDFLARE_API_TOKEN: "secret-token", CLOUDFLARE_ACCOUNT_ID: "acct" },
      NOW,
    );

    expect(result).not.toBeNull();
    expect(result?.day).toBe(YESTERDAY);
    expect(result?.rows_read).toBe(3_100_040);
    expect(result?.rows_written).toBe(21_000);
    expect(result?.per_database).toEqual([
      { database_id: "db-main", rows_read: 3_100_000, rows_written: 21_000 },
      { database_id: "db-sink", rows_read: 40, rows_written: 0 },
    ]);
    expect(result?.today).toEqual({ day: TODAY, rows_read: 500_000, rows_written: 5_000 });

    // The request body carries the account and the two dates, not the token in the URL.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.cloudflare.com/client/v4/graphql");
    expect(String((init.headers as Record<string, string>).Authorization)).toContain("secret-token");
    const body = String(init.body);
    expect(body).toContain("d1AnalyticsAdaptiveGroups");
    expect(body).toContain(YESTERDAY);
    expect(body).toContain(TODAY);
    expect(JSON.stringify(result)).not.toContain("secret-token");
  });

  it("never throws and does not alert on a malformed response", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: null, errors: [{ message: "boom" }] })));
    await expect(
      readD1Usage({ CLOUDFLARE_API_TOKEN: "t", CLOUDFLARE_ACCOUNT_ID: "a" }, NOW),
    ).resolves.toBeNull();
  });

  it("retries a transient failure once and then gives up", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchMock = vi.fn(async () => new Response("nope", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const started = Date.now();
    await expect(
      readD1Usage({ CLOUDFLARE_API_TOKEN: "t", CLOUDFLARE_ACCOUNT_ID: "a" }, NOW),
    ).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(D1_USAGE_RETRY_DELAY_MS - 50);
  });

  it("does not retry a permanent failure such as a missing permission", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchMock = vi.fn(async () => new Response("forbidden", { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      readD1Usage({ CLOUDFLARE_API_TOKEN: "t", CLOUDFLARE_ACCOUNT_ID: "a" }, NOW),
    ).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("assessD1Budget", () => {
  it("keeps the 69/70 and 90 percent boundaries", () => {
    expect(assessD1Budget(usage({ rows_read: 3_450_000 }), NOW).level).toBe("ok");
    expect(assessD1Budget(usage({ rows_read: 3_500_000 }), NOW).level).toBe("warn");
    expect(assessD1Budget(usage({ rows_read: 4_500_000 }), NOW).level).toBe("critical");
    expect(D1_WARN_RATIO).toBe(0.7);
    expect(D1_CRITICAL_RATIO).toBe(0.9);
    expect(D1_DAILY_READ_LIMIT).toBe(5_000_000);
  });

  it("treats the write limit with the same thresholds", () => {
    const writes = usage({ rows_read: 0, rows_written: 70_000 });
    expect(assessD1Budget(writes, NOW).level).toBe("warn");
    expect(D1_DAILY_WRITE_LIMIT).toBe(100_000);
  });

  it("raises an early warning for a fast current day, but only after a third of the day", () => {
    // Half a day elapsed and half of the read budget already spent: warn even though yesterday was calm.
    const noon = NOW - (NOW % 86400) + 12 * 3600;
    const fast = usage({ rows_read: 1_000_000, today: { day: TODAY, rows_read: 2_500_000, rows_written: 1_000 } });
    const assessment = assessD1Budget(fast, noon);
    expect(assessment.early_warning).toBe(true);
    expect(assessment.level).toBe("warn");

    // Same spend, but only a quarter of the day has elapsed: no early warning.
    const earlyMorning = NOW - (NOW % 86400) + 6 * 3600;
    expect(assessD1Budget(fast, earlyMorning).early_warning).toBe(false);
    expect(assessD1Budget(fast, earlyMorning).level).toBe("ok");

    // An early warning never downgrades a critical day.
    const criticalToday = usage({
      rows_read: 4_600_000,
      today: { day: TODAY, rows_read: 2_500_000, rows_written: 1_000 },
    });
    expect(assessD1Budget(criticalToday, noon).level).toBe("critical");
    expect(D1_EARLY_WARN_ELAPSED_RATIO).toBeCloseTo(1 / 3);
    expect(D1_EARLY_WARN_SPEND_RATIO).toBe(0.5);
  });

  it("ignores the current day for the threshold decision", () => {
    const calmYesterdayBusyToday = usage({
      rows_read: 3_400_000,
      today: { day: TODAY, rows_read: 4_900_000, rows_written: 1_000 },
    });
    // Today is not complete, so a busy (but small) current day cannot by itself make the day critical.
    const assessment = assessD1Budget(calmYesterdayBusyToday, NOW);
    expect(assessment.level).toBe("warn"); // early warning, not critical
    expect(assessment.early_warning).toBe(true);
  });
});

describe("budgetAlertDetail", () => {
  it("states the day, level and percentages and never leaks the token", () => {
    const assessment = assessD1Budget(usage({ rows_read: 3_900_000 }), NOW);
    const detail = budgetAlertDetail(usage({ rows_read: 3_900_000 }), assessment);

    expect(detail).toContain(`day ${YESTERDAY}`);
    expect(detail).toContain("level=warn");
    expect(detail).toContain("rows_read 78% of 5000000 (3900000)");
    expect(detail).toContain("rows_written 29% of 100000 (29000)");
    expect(detail).toContain("db-main=3900000");
    expect(detail).not.toContain("secret");
  });

  it("caps the visible database breakdown at three entries", () => {
    const many = usage({
      per_database: [
        { database_id: "a", rows_read: 10, rows_written: 1 },
        { database_id: "b", rows_read: 9, rows_written: 1 },
        { database_id: "c", rows_read: 8, rows_written: 1 },
        { database_id: "d", rows_read: 7, rows_written: 1 },
      ],
    });
    const detail = budgetAlertDetail(many, assessD1Budget(many, NOW));
    expect(detail).toContain("(+1 more)");
    expect(detail).not.toContain("d=7");
  });
});
