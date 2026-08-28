# SLOGI v76.1.6 — School SLOGI and Cian 30-Day Feed

Date: 2026-08-28. Status: RELEASE GATE PASS. GitHub publication only; production activation remains separate.

## Local evidence

- canonical content commit: `fbee5df0a71110f6ecac4bf820992460742f97ab`;
- Cian feed pagination/filter/dedupe/read-safety tests: 8 passed, 0 failed;
- focused Cian Edge/ingestion tests: 18 passed, 0 failed;
- merged School SLOGI navigation/theme and Cian suites: 17 passed, 0 failed;
- synthetic pagination: 205 rows over five 50-row pages, without gaps or duplicates;
- exact 30-day boundary included; unknown, future, older and removed rows excluded;
- list reads triggered provider calls 0 and writes 0;
- old migrations changed 0; secrets found 0;
- production, direct Cian and Browserless calls during this hotfix gate: 0.

## Remaining production gate

GitHub/Pages publication does not deploy `search-listings`, `refresh-listings` or `hydrate-listings`, replace scheduler cadence, populate the 30-day backlog or prove production completeness. Those actions and the final read-only backlog/cursor/recent-count verification require separate owner authorization.
