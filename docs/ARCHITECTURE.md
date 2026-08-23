# SLOGI — Architecture Baseline v76.0.1

## High-level architecture

Browser / GitHub Pages
        |
        +-- Core frontend
        |
        +-- Phase 0 frontend
        |
        +-- localStorage
        |
        +-- IndexedDB
                |
                v
          Application services
                |
                v
             Supabase
       +--------+--------+
       |        |        |
      Auth      DB     Storage
                |     slogi-files
                |
                v
          Edge Functions
       +--------------------+
       | search-listings    |
       | import-listing     |
       | geocode-address    |
       +--------------------+
                |
                v
         External services
       Yandex / CIAN /
       Avito / Browserless

---

## Phase 0 market discovery flow

available-spaces.html
        |
        v
available-spaces.js
        |
        v
search-listings
        |
        v
market listing results
        |
        v
geocode-address
        |
        v
ClusterService

---

## Single listing import flow

Listing URL
        |
        v
import-listing
        |
        v
normalized listing data
        |
        v
geocode-address
        |
        v
ClusterService
        |
        v
candidate object

---

## Cloud persistence

Current architecture contains local and remote state.

Locations are persisted through the current cloud synchronization layer.

Supabase production tables include:

- slogi_user_state
- slogi_workspace_state
- slogi_attachments

The current data architecture is intentionally preserved in v76.0.1.

No normalization of locations JSONB is performed during baseline freeze.

---

## Market persistence

Market data is stored in:

- slogi_market_listings
- slogi_market_price_history

RLS is enabled.

No pg_policies are currently present for these market tables.

The configuration is preserved as production baseline.

---

## Storage

Supabase Storage bucket:

slogi-files

Attachments metadata:

slogi_attachments