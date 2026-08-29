-- v76.1.13 forward-only bounded Cian queue revalidation.
-- Historical migrations remain frozen. This migration replaces only the
-- discovery enqueue and hydration claim functions introduced by v76.1.

-- Discovery records the latest observation of an existing canonical URL but
-- never mutates its queue lifecycle. Revalidation is exclusively claim-owned.
create or replace function public.slogi_enqueue_listing_fetches(
  p_source text,
  p_priority text,
  p_items jsonb,
  p_discovered_at timestamptz
)
returns table (listing_url text, queue_status text, queued_new boolean)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_item jsonb;
  v_url text;
  v_external_id text;
  v_status text;
  v_new boolean;
begin
  if p_source is distinct from 'cian' then
    raise exception using errcode = '22023', message = 'invalid_listing_source';
  end if;
  if p_priority is null or p_priority <> all (array['hot'::text, 'backfill'::text]) then
    raise exception using errcode = '22023', message = 'invalid_listing_priority';
  end if;
  if p_discovered_at is null
    or p_items is null
    or pg_catalog.jsonb_typeof(p_items) <> 'array'
    or pg_catalog.jsonb_array_length(p_items) > 500
  then
    raise exception using errcode = '22023', message = 'invalid_listing_queue_batch';
  end if;

  for v_item in select value from pg_catalog.jsonb_array_elements(p_items)
  loop
    v_url := pg_catalog.btrim(v_item ->> 'listingUrl');
    v_external_id := nullif(pg_catalog.btrim(v_item ->> 'externalId'), '');
    if v_url is null or v_url = '' or pg_catalog.length(v_url) > 2048 then
      raise exception using errcode = '22023', message = 'invalid_listing_url';
    end if;

    insert into public.slogi_listing_fetch_queue (
      source, listing_url, external_id, priority, status,
      discovered_at, last_discovered_at, next_attempt_at,
      created_at, updated_at
    ) values (
      p_source, v_url, v_external_id, p_priority, 'pending',
      p_discovered_at, p_discovered_at, p_discovered_at,
      p_discovered_at, p_discovered_at
    )
    on conflict on constraint slogi_listing_fetch_queue_source_url_key do nothing
    returning status into v_status;

    if found then
      v_new := true;
    else
      update public.slogi_listing_fetch_queue as q
      set
        external_id = coalesce(v_external_id, q.external_id),
        priority = p_priority,
        last_discovered_at = p_discovered_at
      where q.source = p_source and q.listing_url = v_url
      returning q.status into v_status;
      v_new := false;
    end if;

    return query select v_url, v_status, v_new;
  end loop;
end;
$$;

alter function public.slogi_enqueue_listing_fetches(text, text, jsonb, timestamptz) owner to postgres;
revoke all on function public.slogi_enqueue_listing_fetches(text, text, jsonb, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.slogi_enqueue_listing_fetches(text, text, jsonb, timestamptz)
  to service_role;

-- Drain every existing nonterminal cycle before admitting terminal
-- revalidation. The transaction advisory lock serializes the zero-backlog
-- transition so concurrent callers cannot each activate another batch.
create or replace function public.slogi_claim_listing_fetch_queue(
  p_source text,
  p_worker_id uuid,
  p_batch_limit integer,
  p_claimed_at timestamptz,
  p_stale_before timestamptz
)
returns setof public.slogi_listing_fetch_queue
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_limit integer;
  v_has_nonterminal boolean;
begin
  if p_source is distinct from 'cian' then
    raise exception using errcode = '22023', message = 'invalid_listing_source';
  end if;
  if p_worker_id is null or p_claimed_at is null or p_stale_before is null then
    raise exception using errcode = '22023', message = 'invalid_listing_claim';
  end if;
  v_limit := greatest(1, least(2, coalesce(p_batch_limit, 1)));

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('slogi_listing_fetch_queue:' || p_source, 0)
  );

  update public.slogi_listing_fetch_queue
  set
    status = 'retry',
    locked_at = null,
    locked_by = null,
    next_attempt_at = p_claimed_at,
    last_error_code = 'stale_processing_recovered',
    updated_at = p_claimed_at
  where source = p_source
    and status = 'processing'
    and locked_at <= p_stale_before;

  select exists (
    select 1
    from public.slogi_listing_fetch_queue as q
    where q.source = p_source
      and q.status = any (array['pending'::text, 'retry'::text, 'processing'::text])
  ) into v_has_nonterminal;

  if v_has_nonterminal then
    return query
    with candidates as (
      select q.id
      from public.slogi_listing_fetch_queue as q
      where q.source = p_source
        and q.status = any (array['pending'::text, 'retry'::text])
        and q.next_attempt_at <= p_claimed_at
      order by case q.priority when 'hot' then 0 else 1 end, q.next_attempt_at, q.id
      for update skip locked
      limit v_limit
    )
    update public.slogi_listing_fetch_queue as q
    set
      status = 'processing',
      locked_at = p_claimed_at,
      locked_by = p_worker_id,
      last_attempt_at = p_claimed_at,
      attempt_count = q.attempt_count + 1,
      updated_at = p_claimed_at
    from candidates
    where q.id = candidates.id
    returning q.*;
    return;
  end if;

  return query
  with candidates as (
    select q.id
    from public.slogi_listing_fetch_queue as q
    where q.source = p_source
      and (
        (
          q.status = 'completed'
          and q.completed_at is not null
          and q.completed_at <= p_claimed_at - interval '24 hours'
          and q.last_discovered_at > q.completed_at
        )
        or (
          q.status = 'discarded_unknown_date'
          and q.last_attempt_at is not null
          and q.last_attempt_at <= p_claimed_at - interval '7 days'
          and q.last_discovered_at > q.last_attempt_at
        )
        or (
          q.status = 'discarded_old'
          and q.priority = 'hot'
          and q.last_attempt_at is not null
          and q.last_attempt_at <= p_claimed_at - interval '7 days'
          and q.last_discovered_at > q.last_attempt_at
        )
        or (
          q.status = any (array['failed'::text, 'blocked'::text])
          and q.last_attempt_at is not null
          and q.last_attempt_at <= p_claimed_at - interval '24 hours'
          and q.next_attempt_at <= p_claimed_at
          and q.last_discovered_at > q.last_attempt_at
        )
      )
    order by case q.priority when 'hot' then 0 else 1 end, q.last_attempt_at, q.id
    for update skip locked
    limit v_limit
  )
  update public.slogi_listing_fetch_queue as q
  set
    status = 'processing',
    locked_at = p_claimed_at,
    locked_by = p_worker_id,
    last_attempt_at = p_claimed_at,
    next_attempt_at = p_claimed_at,
    attempt_count = 1,
    completed_at = null,
    updated_at = p_claimed_at
  from candidates
  where q.id = candidates.id
  returning q.*;
end;
$$;

alter function public.slogi_claim_listing_fetch_queue(text, uuid, integer, timestamptz, timestamptz) owner to postgres;
revoke all on function public.slogi_claim_listing_fetch_queue(text, uuid, integer, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.slogi_claim_listing_fetch_queue(text, uuid, integer, timestamptz, timestamptz)
  to service_role;
