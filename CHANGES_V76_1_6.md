# SLOGI v76.1.6 — Cian 30-day completeness hotfix

Status: released on GitHub. Production scheduler, Edge and data are unchanged by publication.

## School SLOGI shell

- shared desktop/mobile navigation and visual theme are unified across active product pages;
- invite action remains integrated without restoring personal-account or workspace-code UI;
- removed legacy tool routes remain absent and local href/src integrity is preserved.

## Fixed locally

- frontend loads every read-only `search-listings` page instead of stopping after the first 100 saved rows;
- stable snapshot/order, exact total, partial/error/empty states and canonical dedupe prevent silent gaps or duplicates;
- the exact 30-day boundary is included; unknown-date, future, old and removed rows are excluded;
- existing cluster, area, rent and price-per-m² filters apply to the complete loaded set;
- discovery advances one durable backfill page per six-hour slot without an artificial terminal page;
- hydration keeps the safe two-card/concurrency-one budget per run, with hourly slots so the durable queue can drain progressively;
- the inactive scheduler example contains only Cian and the immutable hydration body `{ "source": "cian" }`.

## Production gate still required

Deploying the three changed Edge functions and replacing scheduler cadence require separate authorization. After activation, a read-only backlog/cursor/recent-count verification must prove ingestion completeness before the product is described as showing every qualifying Cian listing.
