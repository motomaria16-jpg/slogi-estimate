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
- next action
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

These are not corrected in v76.0.1.

---

## Release gate

v76.0.1 may be tagged only after:

1. canonical recovered source is committed to Git;
2. baseline documentation is committed;
3. baseline schema snapshot is committed;
4. secret scan succeeds;
5. 18 CORE smoke tests are completed;
6. there are no baseline-blocking failures.

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