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
