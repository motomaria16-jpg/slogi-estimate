# Cian 30-day completeness activation — v76.1.6

Status: local gate passed; production activation intentionally not executed.

## Root cause of the two-card result

The published Pages bundle already removes the browser-side first-page cap,
but the production ingestion deployment remains on the v76.1.5 contract:
discovery runs once daily and hydration runs once daily with a hard batch of
two. That contract can hydrate no more than two queue items per day and keeps
revisiting the first discovery page instead of advancing a durable deep-page
cursor often enough. Removing only a UI limit therefore cannot establish
30-day completeness.

The single authorized current production inventory attempt did not execute
SQL: the local request serializer produced HTTP 400 before the read-only query
could run. It made no writes and is not repeated. Current production counts are
therefore `N/A`. The last independently verified aggregate evidence before
v76.1.6 was one recent complete Cian row, 25 market rows, 56 queue rows and two
scan-run rows; the owner's current observation is two visible cards. These are
historical/observed values, not a fresh completeness proof.

## Released contracts already present in v76.1.6

- `search-listings` reads saved rows only, uses exact counts, a stable snapshot,
  stable newest-first ordering and server pagination. The rolling cutoff is
  inclusive at exactly 30 days; unknown, future, old and removed rows are
  excluded.
- `cian-listing-feed.js` follows `hasMore/nextPage` until exhaustion, preserves
  the first snapshot, detects page/total drift and deduplicates by stable
  source/external-id with canonical-URL fallback.
- Existing cluster, area, monthly-rent and price-per-square-metre filters are
  applied after the complete saved result is loaded. No read path invokes
  Browserless or performs persistence.
- Discovery makes exactly two sequential Browserless calls per run: hot page 1
  and one durable cursor page. The cursor advances without an artificial page
  ceiling and resets only when the deep page is empty or already terminal-old.
- Hydration claims at most two due queue items hourly with `SKIP LOCKED` and a
  visibility timeout. Partial/transient rows remain durable and continue in a
  later slot; old/unknown terminal states are explicit.

## Exact activation artifacts

Release target: `06ee1659f7caf234df85de662424fe1d1159bb03` (`v76.1.6`).

| Artifact | SHA-256 |
|---|---|
| `supabase/functions/search-listings/index.ts` | `4c1786ebcdabef464ebca46a8e45e15d7ce53de7997adf5838c38637060bc440` |
| `supabase/functions/refresh-listings/index.ts` | `5c4302c6610844578a98612d81f2e6d8da5a9d47fdb5e9a59fabb5a91c40f35a` |
| `supabase/functions/hydrate-listings/index.ts` | `caca462aea57471ff63e5c99250ef4635152e1e165b43d618511ec1854c6373d` |
| `cian-listing-feed.js` | `7de56afe874ca7a4a86365cd137a86f481c5ece2c51ecd10b8a201da95bd4954` |
| `cian-workspace.js` | `87259d6e7ef3c3755eb835717a2bb3821ca1e183afbeb35418fd5e8580b01d83` |
| `supabase/schedules/cian-listings-v7616-activate.sql` | `8e7f139cbb63bf9cd18ae28bf06135a3477c36a5ddfc053f2473513ce080621c` |
| `supabase/schedules/cian-listings-v7616-rollback.sql` | `9015c68e7734fb9d25a4ee5495004afd3730ac85c6039f4d51b252244b269e3e` |

## Fail-closed production order for the integration agent

1. Read-only guard: exact project, release/function hashes, Cian-only source,
   current business fingerprints, exact two active legacy job names/targets,
   and Vault references present without exposing values.
2. Deactivate only `slogi-cian-daily-discovery` and
   `slogi-cian-daily-hydration`.
3. Deploy only `search-listings`, `refresh-listings` and `hydrate-listings` from
   the combined integration target; verify source hashes and JWT configuration.
4. Apply `cian-listings-v7616-activate.sql`. It preserves commands and changes
   only cadence/active state: discovery `10 0,6,12,18 * * *` UTC; hydration
   `25 * * * *` UTC.
5. Read-only verify jobs, scan state, queue/run terminal states and saved-market
   fingerprints. On any drift, deactivate both jobs and use the rollback file;
   do not retry an ambiguous mutation.
6. Let the bounded backfill proceed. Do not launch an uncontrolled crawl.

Rollback first deactivates both jobs, then restores the verified legacy UTC
cadence: discovery `10 3 * * *`; hydration `25 3 * * *`. It does not delete
history, queue rows or Vault entries. A function rollback, if required, must use
the separately retained v76.1.5 artifacts and is outside the scheduler SQL.

## Hard budget and completeness horizon

- Discovery: 4 runs/day × 2 calls = **8 Browserless calls/day**.
- Hydration: 24 runs/day × 2 cards = **48 Browserless calls/day**.
- Combined hard ceiling: **56 Browserless smart-scrape call units/day**, with
  retry count zero inside each provider call. Monetary cost depends on the
  owner's Browserless plan and is not inferred here.
- For `P` unvisited discovery pages and `B` due queue rows, the optimistic lower
  bound is `max(ceil(P/4), ceil(B/48))` days. Cooldowns, blocked pages, partial
  parses and unknown dates can extend it; durable state prevents silent loss.

## Honest completion criterion

It is valid to say “all available matching Cian listings from the last 30 days
are loaded” only after two stable read-only snapshots show all of the following:

1. the discovery cursor has reached an empty or old-only deep page after the
   new activation, with no intervening failed/blocked discovery terminal state;
2. due `pending`, `processing` and `retry` queue counts are zero (stale
   processing is also zero), and the last hydration terminal state is `ok` or
   `empty`;
3. saved recent rows exclude unknown-date, future, older-than-30-day and removed
   records, and contain no duplicate stable identity/canonical URL;
4. paginating `search-listings` under one snapshot returns exactly `meta.total`
   unique rows, ends with `hasMore=false`, and the UI reports that same total;
5. the user's current filters applied to that complete saved set return the
   displayed set without gaps or duplicates.

Until those five predicates pass, the correct product state is “backfill in
progress” rather than a claim of immediate completeness.
