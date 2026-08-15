# SLOGI v76.0.1 — CORE Smoke Test

Date:

Tester:

Commit:

Environment:

---

| # | Test | Result | Notes |
|---|---|---|---|
| # | Test | Result | Notes |
|---|---|---|---|
| 01 | Site opens | PASS | |
| 02 | Auth UI works | PASS | |
| 03 | Login works | PASS | |
| 04 | Main page loads | PASS | |
| 05 | Object list loads | PASS | |
| 06 | Manual object creation | PASS | |
| 07 | Save object | PASS | |
| 08 | Reload persistence | PASS | |
| 09 | Open object | PASS | |
| 10 | Object card scroll | PASS | |
| 11 | Edit object | PASS | |
| 12 | Status persistence | PASS | |
| 13 | Next action persistence | NOT APPLICABLE | Factual v76 has no manual Next Action edit control |
| 14 | Map loads | PASS | |
| 15 | Cluster displays | PASS | |
| 16 | Competitive analysis opens | PASS | |
| 17 | Delete test object | PASS | |
| 18 | Logout works | PASS | |

Allowed results:

PASS

FAIL

BLOCKED

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

## Final decision

[x] CORE SMOKE GATE PASSED

[ ] BASELINE FROZEN — READY FOR v76.1