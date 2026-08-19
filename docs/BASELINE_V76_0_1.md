# SLOGI v76.0.1 — Technical Baseline Freeze

## Status

Release candidate for Technical Baseline Freeze.

The purpose of v76.0.1 is to capture the factual SLOGI v76
architecture and runtime state before further product development.

This release does not intentionally redesign business logic,
database architecture, marketplace search logic or UI/UX.

---

## Baseline principle

Freeze what actually exists.

Fix later.

---

## Authoritative sources

### Frontend

Recovered SLOGI v76 source.

### Database

Live Supabase production project:

badyvlegwumldciibxfe

### Edge Function source

Recovered exact v76 function sources stored in:

- supabase/functions/search-listings/index.ts
- supabase/functions/import-listing/index.ts
- supabase/functions/geocode-address/index.ts

### Edge runtime configuration

Live Supabase production configuration.

### Storage

Live Supabase production Storage.

---

## Production public tables

- slogi_attachments
- slogi_market_listings
- slogi_market_price_history
- slogi_user_state
- slogi_workspace_state

RLS is enabled on all five tables.

### Production object ACL

The v76.0.1 migration explicitly materializes the effective production
ACL for all five SLOGI tables and both market identity sequences. It
first revokes object-specific privileges from `anon`, `authenticated`
and `service_role`, then grants the captured production privileges.

For the three user-owned tables, `anon` has no table privileges;
`authenticated` and `service_role` have `SELECT`, `INSERT`, `UPDATE`,
`DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER` and `MAINTAIN`.

For both market tables, `anon` and `authenticated` have no table
privileges; `service_role` has all eight table privileges listed above.
All three API roles have `USAGE`, `SELECT` and `UPDATE` on both market
identity sequences.

`information_schema.role_table_grants` exposes the seven pre-PostgreSQL
17 table privileges but is not a complete source for `MAINTAIN` in this
environment. The production value is therefore also verified through
`raw_acl`/`aclexplode` and
`has_table_privilege(role, table, 'MAINTAIN')`. The expected API-role
table ACL is `arwdDxtm`.

This is an exact production snapshot, not a recommendation for new
schemas. Supabase platform default privileges remain platform-managed
and are not altered by the baseline migration.

---

## Market tables

Production contains:

- slogi_market_listings
- slogi_market_price_history

For these tables:

RLS = ENABLED

pg_policies = 0

No client access policies were added during the baseline freeze.

---

## Storage

Bucket:

slogi-files

Observed production configuration:

- file size limit: 50 MB
- allowed MIME types: Any
- policies: 4

---

## Edge Functions

### search-listings

Verify JWT: OFF

Observed deployments: 5

### import-listing

Verify JWT: ON

Observed deployments: 2

### geocode-address

Verify JWT: OFF

Observed deployments: 2

The inconsistency is intentionally preserved in v76.0.1.

Target fix:

v76.1 — Auth & Edge Stability.

---

## Secrets inventory

Confirmed live:

- YANDEX_GEOCODER_API_KEY

Required/referenced by recovered source:

- BROWSERLESS_TOKEN

Live presence:

NOT CONFIRMED

Optional:

- CIAN_COMMERCIAL_RENT_SEARCH_URL
- AVITO_COMMERCIAL_RENT_SEARCH_URL

Secret values are not part of this repository.

---

## CORE

The following capabilities are considered CORE:

- authentication
- personal account
- manual object creation
- object list
- object editing
- object card
- object deletion
- status
- derived next-action indicator (factual v76 has no manual edit control)
- cluster
- map
- competitive analysis
- cloud persistence
- attachments/files
- Phase 0 → Phase 1 workflow

---

## BETA

The following capabilities are explicitly BETA:

- automatic marketplace discovery
- search-listings
- CIAN scraping
- Avito scraping
- Browserless anti-block pipeline
- automatic market refresh

Failures limited to BETA do not automatically invalidate the baseline
unless they break CORE functionality.

---

## Known drift intentionally preserved

- import-listing Verify JWT = ON
- search-listings Verify JWT = OFF
- geocode-address Verify JWT = OFF
- environment-specific production URLs exist in frontend configuration
- Browserless production secret status is not fully confirmed
- several generations of CSS/JS coexist
- production table and sequence ACLs are broader than the intended
  future least-privilege model

These are not corrected in v76.0.1.

The broad authenticated table ACL, including `MAINTAIN`, and the
`anon`/`authenticated` sequence access are accepted post-freeze security
debt. Hardening will be implemented only by a forward migration after
tag `v76.0.1`; the baseline migration must not be repurposed to harden
production. RLS, the market server-only contract and product logic are
unchanged.

---

## Release gate

v76.0.1 may be tagged only after:

1. canonical recovered source is committed to Git;
2. baseline documentation is committed;
3. baseline schema snapshot is committed;
4. secret scan succeeds;
5. 18 CORE smoke tests are completed;
6. there are no baseline-blocking failures.

Current release-candidate evidence:

- recovered source committed to local Git;
- all seven Phase 0 source files match the preserved v76 package;
- all three Edge Function SHA-256 fingerprints match `VERSION.json`;
- database baseline materialized at
  `supabase/migrations/20260814_7601_baseline.sql`;
- database evidence and limitations recorded in
  `docs/V76_DATABASE_BASELINE_VALIDATION.md`;
- clean local Supabase apply and `db reset --local` passed with exact
  production object ACL, including `MAINTAIN`;
- tracked-file secret scan passed: no backend secret values or private
  key material found; committed Supabase/Yandex browser credentials are
  classified as public configuration;
- tracked, untracked and ignored secret scan passed with zero test-key
  matches;
- CORE smoke gate passed in the isolated localhost environment:
  17 PASS, 1 NOT APPLICABLE, 0 FAIL;
- Yandex map, controls, browser geocoding and cluster overlays passed
  without API-key errors;
- tag `v76.0.1` is intentionally absent pending explicit gate approval.

The candidate is not declared frozen until the release gate is approved
and the tag is created.

---

## Next release

v76.1 — Auth & Edge Stability

Planned scope:

- HTTP 401
- JWT contract
- Verify JWT consistency
- CORS
- Edge error contracts
- Browserless configuration
- search-listings stability
- import-listing stability
- geocode-address stability
