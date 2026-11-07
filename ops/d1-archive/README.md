<!--
Copyright (C) 2026-Present ComiCine
SPDX-License-Identifier: AGPL-3.0-or-later
Section 7 additional terms apply when the work is used under GNU AGPL v3.
See ADDITIONAL_TERMS.txt.
-->

# D1 disaster-recovery snapshots

## What this is and why it exists

`comicine-d1-archive` runs one cron, `0 0 * * *` (00:00 UTC), against R2 bucket
`comicine-analytics` through the `ARCHIVE` binding, in two independent stages: `d1_archive`
archives the previous UTC day of analytics detail into `analytics/YYYY_MM_DD/`, and
`config_backup` writes a schema and configuration snapshot into `backup/YYYY_MM_DD/` -- every
`CREATE` statement from `sqlite_master`, plus a verbatim copy of the tables that cannot be
rebuilt from anything else.

The second stage closes a real gap. The analytics archive covers four high-volume tables and the
status Worker's retention job only prunes; neither held a single configuration row, so a full
database loss would have taken `blocked_ips` (the authoritative block list), `apple_accounts`,
`auth_credentials`, `schema_version` (migration bookkeeping) and every table definition with it.
The only other route was a hand-run `wrangler d1 export`, and the newest dated from 2026-09-26.

The stages are separate `worker_runs` jobs on purpose (`config_backup`, never a relabelled
`d1_archive`), because `GET /?health=1` reports the latest run per job: a snapshot failing for a
week cannot hide behind a healthy archive. Each stage has its own `try`/`catch`, so one failure
never cancels the other, and one failing table never discards the rest.

## Layout

The day is the UTC day the snapshot was **taken**, not the day the data belongs to.

```text
backup/2026_11_07/
  ddl.sql             replayable schema: every CREATE statement, in replay order
  schema.jsonl.gz     every sqlite_master row, lossless
  <table>.jsonl.gz    one object per allowlisted table
  manifest.json       integrity record, written last
```

13 objects for the 10 tables allowlisted today -- `schema_version`, `blocked_ips`,
`apple_accounts`, `auth_credentials`, `probes`, `probe_state`, `retention_state`,
`blocklist_audit`, `worker_runs` and `probe_uptime_daily`. That is `CONFIG_TABLES` in
[`src/config-backup.ts`](src/config-backup.ts), nothing else: large, already-archived, derived
and self-healing tables are excluded on purpose, with the reason in the manifest.

`ddl.sql` omits engine and platform objects (`sqlite_*`, `_cf_*`) and lists them in its header;
`schema.jsonl.gz` keeps them verbatim. Rows are gzipped JSONL, one object per line, keys in
`SELECT *` order and rows ordered by the configured `orderBy` column (the primary key for most
tables), so a rerun on the same day normally produces identical bytes. Values come straight from
D1's response objects, which keeps `active` an integer `0`/`1`, keeps epoch timestamps integers,
and keeps `NULL` distinguishable from `''`.
The restore is exact or it is refused; nothing is stringified or defaulted.

## Manifest fields

| Field                      | Type     | Meaning |
| -------------------------- | -------- | --- |
| `job`                      | string   | Always `config_backup`. |
| `day`                      | string   | UTC run day, `YYYY_MM_DD`. |
| `prefix`                   | string   | `backup/<day>/`. |
| `generated_at`             | number   | Unix seconds when the run started. |
| `generated_at_iso`         | string   | The same instant in ISO 8601 UTC. |
| `keep_snapshots`           | number   | Rotation window in force for this run (14 days). |
| `d1_rows_read`             | number   | Measured rows read by this run, summed from each statement's `meta.rows_read`; also written to `worker_runs.added`. |
| `ddl_written`              | boolean  | `ddl.sql` was written. A failure there aborts the whole snapshot, so it is `true` in any manifest that exists. |
| `complete`                 | boolean  | `true` only when every allowlisted table was captured and the snapshot stage recorded no error. |
| `objects`                  | array    | One entry per payload object in the prefix, `{name, bytes, sha256}`, sorted ascending by name. `manifest.json` is excluded: a file cannot hash itself, so its presence is implied. |
| `schema_objects`           | number   | Number of `sqlite_master` rows captured, internal objects included. |
| `skipped_internal_objects` | string[] | Engine and platform objects omitted from `ddl.sql`, also listed in its header. |
| `tables`                   | array    | One entry per allowlisted table, `{name, rows, bytes, sha256, error}`. |
| `excluded_tables`          | array    | `{name, why}` for every table deliberately not captured. |
| `restore`                  | object   | `{ddl, data, apply}` command hints, matching the sequence below. |

`objects` and `tables` are the integrity record:

- `bytes` is the exact stored length; `sha256` is the lowercase hex SHA-256 of those exact stored
  bytes. Both describe the object as R2 stores it, not the text inside it.
- A captured table appears in both arrays with the same `bytes` and `sha256`; `rows` is the
  JSONL line count, i.e. the number of rows the restore inserts.
- A failed table has `rows: 0`, `bytes: 0`, `sha256: null`, the error text, **no** entry in
  `objects`, and forces `complete` to `false`. A captured table has `error: null`.
- `objects` holds 12 entries for the current 13-object prefix: everything except `manifest.json`.
- `complete` covers the snapshot stage only; rotation runs after the manifest is written, so a
  retention failure lands in the `config_backup` row of `worker_runs`.

`d1_rows_read` is measured, not estimated: adding `probe_uptime_daily` took the daily read from
428 to roughly 503 rows, about 0.01% of the 5,000,000 rows/day free-plan limit, and that table is
bounded by 90 days times the probe count. `worker_runs` and `blocklist_audit` grow without bound,
so the number drifts up; past about 2,000 rows, window those two tables. The rule is in AGENTS.md.

## Object bytes and checksums

Payload objects carry a content type only (`application/gzip`, `text/plain; charset=utf-8`,
`application/json`) and **no** `contentEncoding`. `analytics/` objects do declare it, and both the
R2 REST API and `wrangler r2 object get` then inflate them on download while keeping the name
(measured on 2026-10-11: a 624-byte object arrived as 1,290 bytes of plain JSONL). For `backup/`
the bytes on disk are the stored bytes, which is what makes `sha256` and `restore.py` work.

- Download every object unchanged; do not decompress, rename or add files. `restore.py` never
  contacts R2 or D1 -- it reads the local directory it is given, and a file set that differs from
  the manifest is refused rather than partially rendered.
- A client that inflates a `.jsonl.gz` on the way to disk changes the bytes, so the SHA-256 no
  longer matches. Re-download with `wrangler r2 object get ... --file`; never use
  `--allow-incomplete` to silence it.
- `sha256` covers whatever is stored: the gzip stream for `.jsonl.gz` and the UTF-8 text for
  `ddl.sql`. Gzip is detected by magic bytes, not by filename.
- `manifest.json` itself is not hashed; its integrity rests on parsing, the required fields and
  the cross-checks against the payload objects.

## Restoring

The target must be a **fresh** database: by default the rendered SQL is plain `INSERT` plus the
original DDL, so it neither replaces existing rows nor tolerates an existing schema.

`restore.py` refuses to render unless all of these hold:

- `manifest.json` exists in `--dir`, parses as a JSON object, and has `complete: true`.
- The integrity fields are present and valid: `complete`, `objects` entries with
  `name`/`bytes`/`sha256`, and `tables` entries with `name`/`rows`/`bytes`/`sha256`/`error`.
- The directory's file set is exactly the manifest's `objects` names plus `manifest.json`; only
  the `--out` file being written is tolerated on top of that.
- `ddl.sql` and `schema.jsonl.gz` are both listed in `objects`.
- Every file's size and SHA-256 match its `objects` entry.
- Every `tables` entry matches its object (name, `bytes`, `sha256`), and its `rows` equals the
  parsed JSONL line count.

Any failure prints English `FATAL:` lines on stderr, writes no output file, and exits 1.

```sh
DAY=2026_11_07
SRC="comicine-analytics/backup/$DAY"
DEST="/tmp/comicine-restore-$DAY"
mkdir -p "$DEST"

for f in ddl.sql schema.jsonl.gz manifest.json \
         schema_version.jsonl.gz blocked_ips.jsonl.gz apple_accounts.jsonl.gz \
         auth_credentials.jsonl.gz probes.jsonl.gz probe_state.jsonl.gz \
         retention_state.jsonl.gz blocklist_audit.jsonl.gz worker_runs.jsonl.gz \
         probe_uptime_daily.jsonl.gz; do
  wrangler r2 object get "$SRC/$f" --remote --file "$DEST/$f"
done

# inspect: complete must be true, every object listed with its size and hash
python3 -c 'import json,sys; m=json.load(open(sys.argv[1])); print(m["day"], m["complete"]); [print(o["name"], o["bytes"], o["sha256"][:16]) for o in m["objects"]]' "$DEST/manifest.json"

# render schema and rows into one replayable file
python3 ops/d1-archive/restore.py --dir "$DEST" --out "$DEST/restore.sql"

# apply to a fresh database (comicine for production)
wrangler d1 execute <database> --remote --file "$DEST/restore.sql"

# verify: compare with tables[].rows in the manifest
python3 -c 'import json,sys; m=json.load(open(sys.argv[1])); [print(t["name"], t["rows"]) for t in m["tables"]]' "$DEST/manifest.json"
wrangler d1 execute <database> --remote --command "SELECT COUNT(*) FROM blocked_ips; SELECT COUNT(*) FROM schema_version"
```

`--data-only` emits `INSERT`s only, for a schema that already exists. `--replace` renders
`INSERT OR REPLACE` and idempotent DDL (`CREATE ... IF NOT EXISTS`), so the script can be re-run
against a populated database; without it the DDL is untouched, which is why the target must be
fresh. `--allow-incomplete` is the rescue bypass, described below. `--out` defaults to `-`.

The rendered file holds account and credential rows, so it is created with mode 0600 and `--out`
refuses to follow a symlink. Delete it when done. Python 3.11 or newer, standard library only;
exit codes 0 (rendered), 1 (unusable snapshot), 2 (bad arguments).

## Failure modes

- **Refused: no `complete: true`, or no manifest at all.** A legacy archive has no `complete`,
  no `bytes` and no `sha256`, and lists object names as plain strings; it is rejected by default
  rather than silently accepted. A snapshot with a failed table is refused for the same reason.
- **Refused: file set, size, SHA-256 or row count mismatch.** A partial download, an extra file,
  an inflated gzip stream or a truncated object; re-download the prefix instead of skipping it.
- **Fatal even with `--allow-incomplete`:** unparseable JSONL or gzip, a missing `ddl.sql`,
  invalid identifiers in the manifest or in row keys, `manifest.json`, `ddl.sql` or a table
  object being a symlink, an object resolving outside the directory, and column sets that differ
  between lines of one table. The manifest is untrusted input; the flag never relaxes these.
- **Usage error: `--out` points at a snapshot object.** Writing the rendered SQL over `ddl.sql`,
  `manifest.json` or a table export would destroy the input, so it is refused before anything is
  read. Pick `restore.sql`, or write the output outside `--dir`.
- **`--allow-incomplete`.** Skips the completeness requirement and the per-file verification that
  a legacy or damaged snapshot cannot satisfy, prints `WARNING:` lines naming what it skipped,
  and renders anyway. Use it only to rescue rows: a checksum mismatch on an otherwise complete
  download is a download problem to fix, not a failure to route around, and because nothing was
  verified the result must be reconciled by hand.

## Retention

Rotation keeps the newest 14 `backup/YYYY_MM_DD/` prefixes and deletes older ones as whole
snapshots, never object by object -- a `ddl.sql` without its rows is worse than no backup. It is
time-based rather than completeness-based: an incomplete day still occupies one of the 14 slots
and ages out like any other, so a broken table cannot pin the bucket.

Only `backup/YYYY_MM_DD/`-shaped prefixes are eligible, so hand-placed objects under `backup/`
are never rotated. The listing uses `prefix: "backup/"` and every key is re-checked before
deletion, which puts `analytics/` structurally out of reach; that prefix has no R2-side rotation
because D1 prunes its source tables instead.

## Related docs

- [`../cloudflare/README.md`](../cloudflare/README.md) -- Cloudflare inventory, the shared
  `?health=1` shape, the `analytics/` prefixes, and the D1 migration and rollback order.
- [`AGENTS.md`](../../../AGENTS.md) -- repository conventions this file follows (English `.md`
  and output, no decorative separators) and the D1 read budget; it lives outside Git.
- [`restore.py`](restore.py), [`src/config-backup.ts`](src/config-backup.ts) and
  [`wrangler.toml`](wrangler.toml) -- restore entry point, writer, cron and bindings.
