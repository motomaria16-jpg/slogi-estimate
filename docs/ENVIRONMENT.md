# SLOGI Environment Baseline

## Current production

Supabase project ref:

badyvlegwumldciibxfe

---

## Environment model

v76.0.1 does not yet provide complete separation between:

- LOCAL
- STAGING
- PRODUCTION

This is recorded as technical debt.

No environment architecture redesign is performed during baseline freeze.

---

## Database ACL environment contract

Supabase platform default privileges grant broad rights to API roles for
new objects. The v76.0.1 baseline does not alter those platform-managed
defaults with `ALTER DEFAULT PRIVILEGES`.

Instead, the migration explicitly revokes and re-grants privileges on
the five existing SLOGI tables and two market identity sequences so a
clean environment reproduces the captured production object ACL without
depending on defaults for those objects.

The production snapshot includes broad authenticated table privileges
including PostgreSQL 17 `MAINTAIN`, plus `anon`/`authenticated` access
to market identity sequences. This is known security debt, not a
recommended configuration. It will be narrowed by a separate forward
migration after tag `v76.0.1`; the baseline migration must not be used
to harden production.

`information_schema.role_table_grants` does not expose `MAINTAIN` in the
captured environment. Complete verification requires the raw object ACL
or `aclexplode` together with
`has_table_privilege(role, table, 'MAINTAIN')`.

The final clean audit observed a version-specific difference between
production and the local Supabase 2.115.0 `postgres`-owned default ACL.
The `supabase_admin` defaults matched. This does not affect the five
tables or two sequences because their ACL is materialized explicitly;
the difference is recorded rather than changed.

RLS and the server-only market table contract are unchanged. Production
was read for fingerprinting only and was not modified by this baseline
materialization.

---

## Browser configuration

Public browser configuration may contain:

- Supabase public URL
- Supabase publishable/anon key
- Yandex Maps browser API key

These values must be distinguished from backend secrets.

The recovered v76 browser source intentionally contains the production
Supabase URL, a Supabase publishable key, and a Yandex browser API key.
They are public browser configuration, not backend secrets.

The factual Phase 0 code also reuses the browser Yandex key for its
direct geocoder path and may send it to the Edge fallback request. This
mixed credential path is preserved for the baseline and is not an
endorsement of the design.

---

## Backend secrets

Backend-only secrets include:

- BROWSERLESS_TOKEN
- YANDEX_GEOCODER_API_KEY

Optional:

- CIAN_COMMERCIAL_RENT_SEARCH_URL
- AVITO_COMMERCIAL_RENT_SEARCH_URL

Real secret values must never be committed to Git.

---

## Important distinction

Yandex Maps browser API key

is NOT the same credential as:

YANDEX_GEOCODER_API_KEY

The latter is the backend environment variable used by the Edge
Function. No value for it is committed to this repository.
