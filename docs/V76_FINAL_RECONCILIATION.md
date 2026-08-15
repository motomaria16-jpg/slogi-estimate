# SLOGI v76.0.1 — Final Reconciliation

## Source authorities

Frontend:
Recovered v76

Database:
Live Supabase production

Edge source:
Recovered v76 source files

Edge runtime:
Live Supabase production

Storage:
Live Supabase production

---

## Reconciliation matrix

| Component | Old Git | Recovered v76 | Production | Status |
|---|---|---|---|---|
| available-spaces | absent | present | browser component | Git drift |
| phase0 | absent/incomplete | present | browser component | Git drift |
| search-listings | absent | recovered | deployed | source recovered |
| import-listing | absent | recovered | deployed | JWT drift |
| geocode-address | absent | recovered | deployed | source recovered |
| slogi_user_state | partial/current | current | exists | match |
| slogi_workspace_state | newer | current | exists | match |
| slogi_attachments | current | current | exists | match |
| market listings | old baseline absent | current | exists | live current |
| price history | old baseline absent | current | exists | live current |
| slogi-files | documented | current | exists | match |

---

## Edge source fingerprints

search-listings:

970ca42bedba8579835f3ae3986400b242f9fefad9e043f6c709db819e0fa42c

import-listing:

784d300d803973c6383a5fd7b068d4c9f226783eef27ca6f3bdc2e89a3317677

geocode-address:

3abba2c902966a8392ce46baf22be3a33caee77575c35122742c0df2b1cf4e7f

These fingerprints identify the recovered baseline sources.

They do NOT prove that the current deployed Supabase bundles are
byte-identical unless the deployed source is independently compared.

---

## Runtime JWT configuration

| Function | Verify JWT |
|---|---|
| search-listings | OFF |
| import-listing | ON |
| geocode-address | OFF |

Status:

DRIFT

Resolution:

deferred to v76.1.