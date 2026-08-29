# SLOGI v76.1.13 — Cian Queue Convergence

Release date: 2026-08-29. Base: annotated `v76.1.12` target
`a5c3b39540ca8fd77b262f6a23c9e758cfea4cf1`.

## Fixed

- Cian discovery now inserts a new canonical URL once and treats every known
  URL as an observation only. Rediscovery no longer resets status, retry time,
  lock ownership, completion time or attempt count.
- Hydration drains pending/retry/processing backlog before terminal rows can
  enter revalidation.
- With an empty nonterminal queue, at most two eligible terminal rows enter a
  new cycle, with attempt count reset to one. Concurrent claims are serialized.
- Completed, partial and removed rows require a post-terminal rediscovery and
  an exact 24-hour TTL. Unknown-date discards require seven days and
  rediscovery. Old discards additionally require a current hot/page-1
  observation. Failed/blocked rows require 24 hours, rediscovery and expired
  cooldown.
- Refresh observability reports known URLs as `observedExisting`; the retained
  historical `queued_existing` database column is explicitly treated as an
  observed-existing count, not queue growth.

## Unchanged contracts

- Discovery remains four runs/day × two Browserless calls; hydration remains
  24 runs/day × two one-call items: static maximum 56 calls/day.
- Browserless strategy, retries, concurrency, scheduler, hydrate implementation,
  providers, password gate, Vault, Auth and production configuration are unchanged.
- The saved-listing read path remains cursor-based and returns the inclusive
  rolling 30-day set across pages 2..N; empty and old-only cursor reset behavior
  remains intact.
- Avito stays inactive. The release process performs no direct Cian,
  Browserless or production Supabase calls.

## Database

Adds the forward-only migration
`supabase/migrations/20260829_7618_cian_bounded_revalidation.sql`. Historical
migrations are unchanged. Migration canonical-LF SHA-256:
`89ac414668b66bd618557fa88ae6b622c37816401aaeb75d98eb181e777c2321`.
