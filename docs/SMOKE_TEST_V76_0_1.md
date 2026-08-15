# SLOGI v76.0.1 — CORE Smoke Test

Date:

Tester:

Commit:

Environment:

---

| # | Test | Result | Notes |
|---|---|---|---|
| 01 | Site opens | NOT RUN | |
| 02 | Auth UI works | NOT RUN | |
| 03 | Login works | NOT RUN | |
| 04 | Main page loads | NOT RUN | |
| 05 | Object list loads | NOT RUN | |
| 06 | Manual object creation | NOT RUN | |
| 07 | Save object | NOT RUN | |
| 08 | Reload persistence | NOT RUN | |
| 09 | Open object | NOT RUN | |
| 10 | Object card scroll | NOT RUN | |
| 11 | Edit object | NOT RUN | |
| 12 | Status persistence | NOT RUN | |
| 13 | Next action persistence | NOT RUN | |
| 14 | Map loads | NOT RUN | |
| 15 | Cluster displays | NOT RUN | |
| 16 | Competitive analysis opens | NOT RUN | |
| 17 | Delete test object | NOT RUN | |
| 18 | Logout works | NOT RUN | |

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

[ ] BASELINE FROZEN — READY FOR v76.1

[ ] BASELINE NOT READY