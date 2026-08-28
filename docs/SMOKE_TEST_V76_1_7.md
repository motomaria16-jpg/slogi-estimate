# SLOGI v76.1.7 integrated candidate — local evidence

Date: 2026-08-28. Scope: isolated manual worktree candidate only. Production, Pages, external Cian/Browserless and owner password were not used.

## Database and catalog

- PostgreSQL 17 clean start applied all six migrations once: PASS;
- two consecutive `db reset --local` runs reapplied all six migrations: PASS;
- candidate used isolated ports/project ID; unrelated worktrees and local Supabase projects were not touched;
- transaction-scoped catalog/RLS E2E with final `ROLLBACK`: PASS;
- no grant, tamper, expiry, row revoke and version bump: shared state, Storage and CAS denied;
- valid grant: membership/state/Storage visible and CAS revision advanced exactly once;
- second anonymous user: exactly one membership in the configured canonical workspace;
- actual DB rate state: attempts 1–5 allowed, attempt 6 starts cooldown, another challenge remains blocked, consumed challenge replay denied;
- server-only gate tables: no direct anon/authenticated/service-role table privileges;
- deprecated access RPC execute removed; historical invite table retained and marked deprecated;
- only `20260828_7617_password_gate.sql` differs under migrations from the v76.1.6 base; the five older migrations are byte-for-byte unchanged in Git.

## Unit and regression suites

- frontend/Cian/map/navigation/password-gate/shared purge/CAS Node suite: 49/49 PASS;
- Edge/listings/release/geocoder TypeScript suite under Node 24: 44/44 PASS;
- total deterministic assertions in these suites: 93 PASS, 0 FAIL;
- all 25 root application JavaScript sources parse: PASS;
- local HTML links/assets, gate ordering and compact theme ordering: PASS;
- `git diff --check`: PASS.

Password tests generate a synthetic value only in memory at runtime. They cover correct/wrong, signed grant expiry/tamper, challenge replay, cooldown, cross-auth replay and canonical issue without forwarding the password to SQL.

## Edge load

Local Supabase Edge loaded all six release functions without provider access:

- `password-gate`, `search-listings`, `import-listing`, `geocode-address`: OPTIONS 200;
- `refresh-listings`, `hydrate-listings`: module load passed; a local anonymous POST returned the expected handler-level 401 before scheduler/provider logic;
- `search-listings` remained saved-row-only and `import-listing` retained its existing provider/import behavior behind the shared grant validator.

No production URL, external provider, Browserless, database write from the read path, or production scheduler was called.

## Browser desktop/tablet/mobile

Headless Chrome ran the real `team.html` and `available-spaces.html`, shared bootstrap, Cian client, map/cluster code and product styles with deterministic local server fixtures:

- desktop 1440×900, tablet 768×1024 and mobile 390×844: PASS;
- wrong password generic denial, input cleared: PASS;
- right password unlock and singleton workspace: PASS;
- same-device reload uses persistent server-validated grant: PASS;
- clean new device prompts again and reads the same remote state: PASS;
- copied grant under another anonymous identity: denied before data request;
- tampered, revoked and expired grants: gate returns and no data request follows;
- Retry-After cooldown UI, disabled button and countdown: PASS;
- Escape cannot close gate; initial product data requests before grant: 0;
- one user click → exactly one `unlock` HTTP request for every wrong/right/rate-limit case: PASS;
- forbidden invite/account UI: 0 controls/dialogs/routes;
- 53 recent Cian listings from two server pages: 53 rendered, 53 unique;
- 51 coordinate-capable listings: 51 map markers; honest missing-coordinate count: 2;
- canonical cluster polygons: 58; deterministic geometry remains covered by the Node suite;
- marker click selects exactly one matching card;
- compact header and source-heading hierarchy: PASS on all three viewports;
- horizontal overflow: 0 px; unexpected page/console errors: 0;
- external requests: 0.

## Scope protection and secrets

- the integrated compact design, 30-day Cian pagination, map/cluster, geocoder and password-gate regressions all pass together;
- password wrapping is limited to shared data, CAS, Storage, `search-listings` and `import-listing`; provider budgets and Cian discovery/hydration logic are unchanged;
- public client contains no service-role credential;
- `.env.example` contains names only and empty values;
- populated sensitive assignment scan: 347 tracked files, 0 findings; 0 untracked files; 0 ignored files after local-artifact cleanup;
- the exact owner-password byte scanner parses and fails closed when the protected variable is absent. It was intentionally not run as a successful scan because the owner password was unavailable; the owner must run it in a protected runner before activation.

The isolated local Supabase containers were stopped without backup after testing. Generated `.temp`/`.branches` artifacts, including ephemeral local development keys, were removed and were not committed.
