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