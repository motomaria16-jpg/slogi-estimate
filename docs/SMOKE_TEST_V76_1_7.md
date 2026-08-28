# SLOGI v76.1.7 password gate — local evidence

Date: 2026-08-28. Scope: isolated local candidate only. Production, Pages, external Cian/Browserless and owner password were not used.

## Database and catalog

- PostgreSQL 17 clean start applied all six migrations: PASS;
- clean `db reset --local` reapplied all six migrations: PASS;
- candidate used isolated ports/project ID; an existing unrelated local Supabase remained running and untouched;
- transaction-scoped catalog/RLS E2E with final `ROLLBACK`: PASS;
- no grant, tamper, expiry, row revoke and version bump: shared state, Storage and CAS denied;
- valid grant: membership/state/Storage visible and CAS revision advanced exactly once;
- second anonymous user: exactly one membership in the configured canonical workspace;
- server-only gate tables: no direct anon/authenticated/service-role table privileges;
- deprecated access RPC execute removed; historical table retained and marked deprecated.

## Unit and regression suites

- frontend/Cian/navigation/password-gate/shared purge Node suite: 33/33 PASS;
- existing CAS source regression: 7/7 PASS;
- Edge/listings/release TypeScript suite under Node 24: 36/36 PASS;
- total deterministic assertions in these suites: 76 PASS, 0 FAIL;
- root JavaScript parse: PASS;
- local links/theme ordering: PASS;
- `git diff --check`: PASS.

Password tests generate their synthetic value only in memory at runtime. They cover correct/wrong, signed grant expiry/tamper, challenge replay, cooldown, cross-auth replay and canonical issue without forwarding password to SQL.

## Edge load

Local Supabase Edge loaded the changed/user-facing handlers:

- `password-gate`: OPTIONS 200;
- `search-listings`: OPTIONS 200;
- `import-listing`: OPTIONS 200;
- unchanged `geocode-address`: OPTIONS 200.

Existing scheduled refresh/hydrate paths remained JWT/cron protected and their unchanged logic passed the 36-test release suite. No provider or external network request was made.

## Browser desktop/mobile

Headless Chrome ran the real `team.html`, shared bootstrap and product styles with a deterministic server fixture:

- desktop 1440×900 and mobile 390×844: PASS;
- wrong password generic denial, input cleared: PASS;
- right password unlock and singleton workspace: PASS;
- same-device reload uses persistent server-validated grant: PASS;
- clean new device prompts again and reads the same remote state: PASS;
- copied grant under another anonymous identity: denied before data request;
- tampered and revoked/expired grant: gate returns and no data request follows;
- Retry-After cooldown UI, disabled button and countdown: PASS;
- Escape cannot close gate; initial product data requests before grant: 0;
- one user click → exactly one `unlock` HTTP request for every wrong/right/rate-limit case: PASS;
- forbidden access UI: 0 controls/dialogs/routes;
- horizontal overflow: 0 px on both viewports;
- unexpected page/console errors: 0;
- external requests: 0.

## Scope protection and secrets

- `cian-workspace.js`, `phase0-services.js`, School theme, map/cluster assets, Avito and Ozon behavior have no content diff;
- public client contains no `service_role`;
- `.env.example` contains names only and empty values;
- repository scans found no populated gate secret assignment or frontend password comparison/hardcode;
- exact owner-password byte scan was intentionally not run in this delegated environment because the value was not available to the process. `tests/owner-secret-absence-scan.mjs` fails closed without protected injection and reports only a zero count on success; owner must run it before production activation.

The local Supabase containers were stopped without backup after testing. Generated `.temp`/`.branches` artifacts, including ephemeral local development keys, were removed; they are reproducible and were not committed.
