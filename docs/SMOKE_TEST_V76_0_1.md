# SLOGI v76.0.1 — CORE Smoke Test

Date: 2026-08-19

Tester: Codex release auditor (browser and API automation)

Evidence commit: content commit referenced by `VERSION.json`

Environment: isolated local Supabase project
`slogi-v76-0-1-maintain-4c14112e222c46588f83216fac3f22fd`
with frontend served strictly from `http://localhost:58080`.

No production Supabase connection or production credential was used.

---

| # | Test | Result | Notes |
|---|---|---|---|
| 01 | Site opens | PASS | HTTP localhost page loaded with the expected SLOGI title |
| 02 | Auth UI works | PASS | Email/password and login/create/reset controls rendered |
| 03 | Login works | PASS | Local user signed in and cloud synchronization completed |
| 04 | Main page loads | PASS | Summary, filters, object list and map rendered |
| 05 | Object list loads | PASS | Empty list rendered, then showed the created local object |
| 06 | Manual object creation | PASS | Local address, cluster, area, rent and room fields accepted |
| 07 | Save object | PASS | Save confirmation shown and object count changed to one |
| 08 | Reload persistence | PASS | Auth session and object survived a full reload |
| 09 | Open object | PASS | Saved object card reopened with persisted fields |
| 10 | Object card scroll | PASS | Scroll position changed from 0 to 254.4; scroll height 795 |
| 11 | Edit object | PASS | Rent changed to 365,000 and recalculated value was 3,042/m² |
| 12 | Status persistence | PASS | `Подошло` remained selected after reload |
| 13 | Next action persistence | NOT APPLICABLE | Factual v76 has no manual Next Action edit control |
| 14 | Map loads | PASS | Yandex controls, positive-size canvas and address marker rendered; no API-key or map errors |
| 15 | Cluster displays | PASS | Filled polygon overlays changed 58 → 0 → 58 across show/hide/show |
| 16 | Competitive analysis opens | PASS | Dialog, XLSX panel and filters rendered |
| 17 | Delete test object | PASS | Exactly one local object removed; reloaded UI returned to zero objects |
| 18 | Logout works | PASS | UI returned to the signed-out `ЛК / Войти` state |

Allowed results:

PASS

FAIL

BLOCKED

NOT APPLICABLE

---

## Release blocking failures

A failure blocks v76.0.1 if it causes:

- application startup failure
- authentication CORE failure
- inability to load objects
- inability to save objects
- data loss after reload
- cloud persistence failure
- critical navigation failure
- missing canonical source
- unreproducible database baseline
- missing required Edge Function source

---

## BETA failures

The following do not automatically block the baseline:

- CIAN anti-bot failure
- Avito anti-bot failure
- Browserless provider failure
- search-listings timeout
- partial marketplace results
- marketplace diagnostics warning

Provided that CORE functionality remains operational.

---

## Additional local evidence

- clean `db reset --local`: PASS;
- PostgreSQL catalog audit: PASS;
- effective, explicit and raw object ACL matched the production
  fingerprint, including `MAINTAIN` (`m` / `arwdDxtm`);
- Auth/RLS/Storage/Edge smoke: 22 PASS of 22;
- direct browser geocoding succeeded with localhost Referer and produced
  the address marker;
- server-side geocoder provider call: NOT APPLICABLE because the test
  key is browser Referer-restricted and was not weakened;
- JavaScript parse: 24 source files and 3 temporary runtime configs PASS;
- all three Edge Functions parsed and loaded in the local Edge Runtime;
- local HTML links: PASS, zero missing targets;
- tracked, untracked and ignored secret scan: PASS;
- test key values in repository: zero matches.

---

## Final decision

[x] CORE SMOKE GATE PASSED

[x] BASELINE FROZEN — READY FOR v76.1

The release gate was approved and local annotated tag `v76.0.1` records
the frozen baseline.
