# SLOGI Technical Debt Register

## CRITICAL — baseline

### TD-C01 — Source-of-truth drift

Status:

OPEN until recovered v76 is committed to canonical Git.

Target:

v76.0.1

---

### TD-C02 — Edge Function source outside canonical Git

Status:

OPEN until all three recovered functions are committed.

Target:

v76.0.1

---

### TD-C03 — Production schema baseline

Status:

OPEN until reproducible baseline SQL snapshot is committed.

Target:

v76.0.1

---

### TD-C04 — Missing release identity

Status:

OPEN until canonical release commit and tag v76.0.1 exist.

Target:

v76.0.1

---

### TD-C05 — JWT configuration inconsistency

Current production:

geocode-address = OFF

import-listing = ON

search-listings = OFF

Status:

OPEN

Target:

v76.1

---

# HIGH

## TD-H01 — Edge authentication contract

Different Edge Functions use inconsistent JWT configuration.

Target:

v76.1

---

## TD-H02 — Browserless runtime configuration uncertainty

BROWSERLESS_TOKEN presence in production has not been fully confirmed.

Target:

v76.1

---

## TD-H03 — Hardcoded environment configuration

Production endpoints are present directly in frontend configuration.

Target:

future environment hardening.

---

## TD-H04 — No complete LOCAL / STAGING / PRODUCTION separation

Target:

future deployment hardening.

---

## TD-H05 — Cloud concurrency limitations

Current architecture does not provide a complete distributed,
record-level optimistic locking strategy across devices.

Target:

v76.2 Data Integrity.

---

## TD-H06 — Observability

No unified production trace / correlation ID / structured monitoring
contract exists across browser and Edge Functions.

Target:

future stability release.

---

# MEDIUM

- accumulated CSS generations
- coexistence of legacy JS modules
- legacy pages
- historical SQL setup files
- manual deployment history
- floating external dependencies

---

# UX

Known UI/UX debt is intentionally deferred to:

v76.4 — UI/UX Hardening