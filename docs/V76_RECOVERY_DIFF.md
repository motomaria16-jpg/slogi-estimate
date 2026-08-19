# SLOGI v76 Recovery Diff

## Historical Git state

Repository:

motomaria16-jpg/slogi-estimate

Historical main HEAD observed during recovery:

4e25fa5d4e691d05f8659893dccf47139a4fa1f3

The historical Git state did not contain the complete factual v76.

---

## Files recovered outside historical Git

At minimum:

- available-spaces.html
- available-spaces.css
- available-spaces.js
- phase0.css
- phase0-app.js
- phase0-config.js
- phase0-services.js

Edge Functions:

- search-listings/index.ts
- import-listing/index.ts
- geocode-address/index.ts

---

## Recovery classification

Recovered files must be classified as:

NEW
REPLACE OLD
COEXIST
LEGACY

Do not remove legacy files during baseline freeze unless absence of
runtime dependency has been proven.

---

## Baseline objective

After v76.0.1:

Git repository becomes the canonical source of SLOGI v76 baseline.