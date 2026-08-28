# SLOGI v76.1.11 Cian partial-recent hotfix — local evidence

Date: 2026-08-29. Base: exact v76.1.10 target
`1695900d720f8ad192e55f51bd49eed783500b36`. Scope: isolated manual worktree.
Production evidence was supplied before this task; release checks made zero
production/provider calls and changed no production system.

## Production evidence classification

- nonterminal queue rows: 132;
- hydration runs with recurrent `partial_listing`: 5/8;
- prior rejection point: completeness before freshness;
- production deployment in this release task: false.

No production identifiers, password or secret values are recorded.

## Focused regression contract

- removed handling remains first and terminal;
- reliable recent partial with missing address/area/rent persists exactly once;
- missing values remain `null`; existing warnings/completeness are preserved;
- queue status: `completed`; diagnostic: `partial_listing_persisted`; retry: 0;
- run metrics: `parsed=1`, `partial=1`, exact inserted/updated counters;
- exact inclusive 30-day partial boundary persists;
- unknown-date partial persists 0, retries only under the existing
  `unknownDateMaxAttempts`, then becomes terminal `discarded_unknown_date`;
- old partial persists 0 and becomes terminal `discarded_old`;
- complete recent listing remains completed with `partial=0` and unchanged
  counters;
- provider calls per claimed item remain one; retry flood: absent.

## Full relevant gate

- frontend/password/Cian/map/navigation/shared workspace/CAS: 51/51 PASS;
- Edge/listings/geocoder: 49/49 PASS;
- total deterministic tests: 100 PASS, 0 FAIL;
- repository browser E2E plus local desktop 1440×900, tablet 768×1024 and
  mobile 390×844: PASS;
- responsive horizontal overflow: 0; browser console errors: 0;
- root application JavaScript parse: 25/25 PASS;
- external Browserless/Cian/provider/production calls: 0.

## Scope, secrets and exact hashes

- `git diff --check`: PASS;
- tracked/untracked/ignored inventory: 355/0/0;
- high-confidence secret findings: 0;
- old migrations, scheduler, provider, Browserless, password-gate,
  frontend/map/geocoder: unchanged;
- canonical-LF `hydrate-listings` SHA-256:
  `49718dd05943fdf838a9dbf90481f3ca95da156040d1ec5da0041fc03215d5da`;
- canonical-LF Edge regression SHA-256:
  `d7239d7ae918a2547809bdff9f95defc04111b44842df1c274342818396cfaf9`.
