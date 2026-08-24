# SLOGI v76.1.2 — Workspace CAS Conflict Hotfix

Status: local candidate evidence. Production deployment is not authorized by this document.

## Production evidence that triggered the hotfix

The v76.1.1 production backend smoke reached anonymous Auth, RLS, workspace join and the first compare-and-swap update. A deliberately stale revision then caused the request to time out after 25 seconds. Aggregated production logs recorded one HTTP request path with responses `200` and `400`, plus 28,775 PostgreSQL `workspace_revision_conflict` events using SQLSTATE `40001`.

SQLSTATE `40001` means serialization failure and is not appropriate for an expected application-level optimistic-concurrency conflict. Existing migration `20260823_7611_shared_workspace.sql` remains immutable.

## Forward-only correction

Migration `20260824_7612_workspace_cas_conflict.sql` recreates only `public.slogi_update_shared_workspace_state` and changes the stale-revision exception to `PT409`.

Preserved contracts:

- owner: `postgres`;
- `SECURITY DEFINER`;
- fixed `search_path = pg_catalog, public`;
- EXECUTE granted to `authenticated` only;
- state schema, RLS, memberships and product behavior unchanged.

## Local clean-apply evidence

Environment: isolated local Supabase CLI 2.115.0, Docker Engine 29.7.2, PostgreSQL 17. No production credentials, project link or remote database were used.

- clean reset from zero: PASS;
- applied migrations: `20260814`, `20260821`, `20260823`, `20260824`;
- function catalog contract: PASS;
- anonymous Auth session: PASS;
- member workspace read: PASS;
- winner CAS revision `0 -> 1`: PASS;
- stale CAS: HTTP `409`, code `PT409`, 11 ms: PASS;
- winner state preserved after conflict: PASS;
- local test data cleanup: PASS;
- PostgreSQL conflict ERROR records for the request: 1;
- retry flood comparable to production: absent.

Production migration, deployment, cron and Browserless were not invoked.
