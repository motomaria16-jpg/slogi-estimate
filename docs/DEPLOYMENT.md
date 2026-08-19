# SLOGI v76.0.1 Deployment

## Purpose

Reproduce the factual v76.0.1 baseline.

---

## 1. Repository

Clone the repository.

Before release-gate approval, use branch:

`chore/v76-0-1-baseline-recovery`

After the approved release tag exists, checkout:

`v76.0.1`

---

## 2. Supabase

Create or select target Supabase project.

Production baseline reference:

badyvlegwumldciibxfe

Do not reuse production credentials in development.

---

## 3. Database

For a clean environment only:

review and apply:

supabase/migrations/20260814_7601_baseline.sql

IMPORTANT:

This migration is a baseline snapshot.

Do not blindly apply it to the existing production project.

---

## 4. Storage

Create/configure:

slogi-files

Baseline:

- 50 MB max file size
- MIME types: Any
- reproduce baseline policies

---

## 5. Secrets

Configure backend secrets:

BROWSERLESS_TOKEN

YANDEX_GEOCODER_API_KEY

Optional:

CIAN_COMMERCIAL_RENT_SEARCH_URL

AVITO_COMMERCIAL_RENT_SEARCH_URL

Never commit actual values.

---

## 6. Edge Functions

Deploy:

search-listings

import-listing

geocode-address

---

## 7. Reproduce JWT settings

v76.0.1 production baseline:

search-listings:
verify_jwt = false

import-listing:
verify_jwt = true

geocode-address:
verify_jwt = false

Do not "correct" these settings while reproducing v76.0.1.

---

## 8. Frontend

Deploy static frontend.

Confirm production Supabase configuration.

Confirm browser Yandex Maps configuration.

---

## 9. Validation

Run:

docs/SMOKE_TEST_V76_0_1.md

Only after all blocking tests pass may the release be considered
successfully reproduced.
