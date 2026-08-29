# SLOGI v76.1.12 — Cian listing integrity hotfix

Base: exact released v76.1.11 target
`c2593071d427419054a1feff9d504e1edc97e42e`.

## Исправления

- Reliable recent partial hydration is still terminal `completed` once, but its
  real server-store upsert now preserves every existing reliable non-null
  listing value that is missing from the partial parse. Current
  `parseWarnings` and `parseCompleteness` remain honest; complete hydration
  keeps its previous merge semantics.
- The 30-day read uses a server snapshot, inclusive cutoff and immutable
  `first_seen_at/source/listing_url` keyset cursor. New rows after the snapshot
  are excluded, while hydration updates between pages cannot create an
  `updated_at + offset` gap or duplicate.
- The browser drains every cursor page, pins the API snapshot/cutoff for the
  whole session, sorts newest-first after the drain, and deduplicates by both
  source/external ID and canonical URL without a two-page cap.
- Browser bearer geocoding is allowed only through the exact configured
  same-project `/functions/v1/geocode-address` endpoint. The legacy direct
  browser-to-Yandex fallback and client API-key payload are removed.
- The UI reports missing address separately from missing coordinates and
  geocoder failed/pending state. Map markers are the coordinate-capable
  canonical listing set; all 58 canonical Polygon boundaries remain loaded.

## Не изменено

Password-gate, password/KDF/grant/rate limits, Auth, RLS/Storage/CAS, Vault and
secrets, database migrations, scheduler manifests, Cian provider, Browserless
policy/budget, import/discovery and unrelated UI are unchanged.

Production Supabase/Edge/database/schedules and external Cian/Browserless were
not called, changed or deployed by this release task.
