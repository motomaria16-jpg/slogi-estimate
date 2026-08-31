-- SLOGI v76.1.19: canonical premise selection fields for the search workspace.

alter table public.slogi_market_listings
  add column premise_type text null,
  add column has_basement_or_socle boolean not null default false;

alter table public.slogi_market_listings
  add constraint slogi_market_listings_premise_type_check
  check (
    premise_type is null
    or premise_type = any (array['office'::text, 'retail'::text, 'free_purpose'::text])
  );

create index slogi_market_listings_selection_idx
  on public.slogi_market_listings using btree (
    premise_type,
    has_basement_or_socle,
    floor,
    area
  );
