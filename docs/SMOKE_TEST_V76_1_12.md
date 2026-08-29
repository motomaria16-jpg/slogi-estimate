# SLOGI v76.1.12 Cian integrity hotfix — local evidence

Date: 2026-08-29. Base: exact v76.1.11 target
`c2593071d427419054a1feff9d504e1edc97e42e`. Scope: isolated manual worktree.
Production deployment: false. External production/provider calls: 0.

## Mandatory regressions

- real server-store partial-over-complete merge preserves existing reliable
  address, area, rent, coordinates and other non-null values, while current
  warnings/completeness and terminal one-shot partial metrics remain exact;
- complete hydration does not inherit the partial-only merge behavior;
- concurrent hydration mutation between page 1 and page 2 produces no gap or
  duplicate; post-snapshot rows are excluded by snapshot eligibility;
- API and UI drain all keyset pages, dual-deduplicate external ID and canonical
  URL, and have no two-page cap;
- exact inclusive 30-day boundary is filtered against the API snapshot after a
  simulated delayed drain;
- arbitrary geocode endpoint is rejected before fetch and before bearer use;
  the exact configured same-project Edge endpoint remains allowed;
- missing address, missing coordinates, geocoder failed and pending have
  separate DOM counters;
- marker count equals the coordinate-capable canonical set; 58/58 canonical
  cluster polygons load deterministically.

## Full relevant gate

- frontend/password/Cian/map/navigation/shared workspace/CAS: 56/56 PASS;
- Edge/listings/geocoder: 51/51 PASS;
- total deterministic tests: 107 PASS, 0 FAIL;
- root application JavaScript parse: 25/25 PASS;
- local browser desktop 1440×900, tablet 768×1024, mobile 390×844: PASS;
- browser fixture: 53 unique cards, 51 markers, 58 polygons, missing
  coordinates 2, missing address 1, failed geocode 1, pending 0;
- responsive horizontal overflow: 0; browser console errors/warnings: 0;
- external Browserless/Cian/provider/production calls: 0.

## Scope and canonical-LF SHA-256

- `hydrate-listings/index.ts`:
  `1864b5b51d5745f9ada08ae40e619edc2f060d244b055d4550bcdfef20859eda`;
- `search-listings/index.ts`:
  `666a1f2f012b0ed76f82c137ac1c69216b93c8cba7ddc1672b6dfcdfb7dff96e`;
- changed shared `server-store.ts`:
  `1635bac3261cf23097fed96c72e6444252a8e9a77713e290851924dd7a27f231`;
- changed shared Edge regression:
  `2261865ae4a76a1d25dabd236826ab88113dc8ebfde940846f46699c8c31b9a6`;
- `cian-listing-feed.js`:
  `bd4f5b3de7afd0c1017cde2f9e3dce9d8b12ea9d7309dd299ae275ba7ad48f41`;
- `cian-map-data.js`:
  `58deeb2eb306988fded521946d2341bba7032049027ed090b155f13bd83ca43d`;
- `cian-workspace.js`:
  `f17bb625273eb59b1e3756120c88787757314d73d396ffff7a926f30886316ea`;
- `phase0-config.js`:
  `d9c2edf86e80dbe9841f45b58a5e2ddb4ed1515bdcfedbe7014f6629ece5c6ac`;
- `phase0-services.js`:
  `92dab184efa46e51dc94e4d380794bfd090fd9c63926d065002946ca3d9d6143`.

`git diff --check`, protected-scope comparison, old-migration comparison and
high-confidence secret scan are release gates. Password-gate, migrations,
schedules, provider/Browserless, Vault/secrets, Auth/RLS/CAS remain byte-for-byte
unchanged from the exact base.
