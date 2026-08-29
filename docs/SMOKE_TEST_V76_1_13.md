# SLOGI v76.1.13 Cian queue-convergence hotfix — local evidence

Date: 2026-08-29. Base: exact annotated `v76.1.12` target
`a5c3b39540ca8fd77b262f6a23c9e758cfea4cf1`. Canonical content commit:
`4dda6b348fe9c7c5fe887383848f65d56fa356d1`. Scope: isolated manual worktree.
Production deployment: false. External production/provider calls: 0.

## Queue contract and database gate

- clean Supabase/PostgreSQL 17 start plus two consecutive local resets applied
  all seven migrations: PASS;
- guarded SQL boundary/CAS/catalog/RLS/ACL suite after each reset: PASS twice;
- duplicate completed hot row after six hours stayed terminal;
- pending/retry/processing duplicates preserved backoff, lock and attempts;
- any nonterminal row blocked terminal activation;
- exact 24-hour and seven-day boundaries were inclusive; one microsecond
  younger was ineligible;
- removed without post-removal rediscovery stayed terminal;
- deep-backfill discarded-old stayed terminal; hot rediscovery after seven days
  entered revalidation;
- one new URL produced one row; 27 known observations produced queue delta 0;
- retry attempt count continued 1→2 inside a cycle and reset to 1 only for a
  new terminal revalidation cycle;
- two simultaneous database clients claimed `2 + 0`, two unique rows, one lock
  owner, with no duplicate;
- transaction advisory serialization, `FOR UPDATE SKIP LOCKED`, CAS finish,
  fixed search path, postgres ownership and service-role-only RPC execute ACL:
  PASS;
- queue table RLS/ACL audit: PASS;
- deterministic q6h discovery/hourly-two hydration simulation drained a
  48-row backlog and remained at zero without rediscovery growth;
- static daily provider budget: 4×2 discovery + 24×2 hydration = 56.

## Repository, Edge and browser gate

- frontend/password/Cian/map/navigation/shared workspace/CAS: 63/63 PASS;
- Edge/listings/geocoder: 51/51 PASS;
- total deterministic tests: 114 PASS, 0 FAIL;
- root application JavaScript parse: 25/25 PASS;
- cursor pages 2→3→4, old-only reset 4→2 and empty reset 2→2: PASS;
- local Edge module load: four OPTIONS 200 plus protected refresh/hydrate
  handler-level 401 before provider logic: PASS;
- password-gate browser fixture on desktop 1440×900, tablet 768×1024 and
  mobile 390×844: PASS;
- fixture output: 53 unique Cian cards, 51 markers and 58 canonical polygons;
- horizontal overflow: 0; unexpected browser console errors: 0;
- Avito inactive; direct Cian/Browserless/production requests: 0.

## Scope, review and exact hashes

- independent diff/check review: PASS after closing real concurrent-claim and
  empty-deep-page coverage gaps; remaining release blockers: 0;
- `git diff --check`: PASS;
- historical migrations and hydrate/schedule/provider/Browserless/password-gate
  protected scope: unchanged from the exact base;
- high-confidence secret scan: 363 repository files, 0 findings;
- forward migration:
  `89ac414668b66bd618557fa88ae6b622c37816401aaeb75d98eb181e777c2321`;
- `refresh-listings/index.ts`:
  `9e5ca72766f579c0521c3415659a9ead675793a8ab6bcd90622283bae36b0020`;
- shared Edge release regression:
  `3ceeb7e550af4ea2e93210f4862d39a82bfb96b45b48ba39e3b5877d0f2c695f`;
- deterministic convergence regression:
  `b007832a239945891991e123629ac930bd3830f87500b0c3b5ef45ae8f8e4e37`;
- guarded SQL regression:
  `f03742337e62480b2539a6cc916258783459c3702e931e25a7e2be50737c45ce`;
- two-client concurrency regression:
  `99bbb7c599b5d1064ae2ee28e8b5d4c97847ceff13f48614d0b9392df7ed54ed`.

No production Supabase, Edge, cron, secrets, Vault or Auth changes are part of
this release.
