\set ON_ERROR_STOP on

do $$
begin
  if pg_catalog.current_setting('slogi.queue_test_mode', true) is distinct from 'on' then
    raise exception 'cian_queue_test_mode_required';
  end if;
end;
$$;

begin;

create or replace function pg_temp.assert_true(p_condition boolean, p_message text)
returns void
language plpgsql
set search_path = pg_catalog
as $$
begin
  if p_condition is distinct from true then
    raise exception 'queue regression failed: %', p_message;
  end if;
end;
$$;

-- A known URL is an observation only, including hot rediscovery after six
-- hours and pending/retry/processing rows with live lifecycle state.
truncate table public.slogi_listing_fetch_queue restart identity;
insert into public.slogi_listing_fetch_queue (
  source, listing_url, external_id, priority, status, discovered_at,
  last_discovered_at, next_attempt_at, attempt_count, locked_at, locked_by,
  last_attempt_at, completed_at, last_error_code, diagnostic, created_at, updated_at
) values
  ('cian', 'https://www.cian.ru/rent/commercial/100000001', 'old-1', 'backfill', 'completed',
    '2026-08-28 00:00Z', '2026-08-28 00:00Z', '2026-08-28 00:00Z', 9, null, null,
    '2026-08-28 00:00Z', '2026-08-28 00:00Z', null, '{"sentinel":"completed"}', '2026-08-28 00:00Z', '2026-08-28 00:00Z'),
  ('cian', 'https://www.cian.ru/rent/commercial/100000002', 'old-2', 'hot', 'pending',
    '2026-08-28 00:00Z', '2026-08-28 00:00Z', '2026-08-29 12:00Z', 3, null, null,
    null, null, 'pending_sentinel', '{"sentinel":"pending"}', '2026-08-28 00:00Z', '2026-08-28 00:00Z'),
  ('cian', 'https://www.cian.ru/rent/commercial/100000003', 'old-3', 'hot', 'retry',
    '2026-08-28 00:00Z', '2026-08-28 00:00Z', '2026-08-29 13:00Z', 4, null, null,
    '2026-08-28 05:00Z', null, 'retry_sentinel', '{"sentinel":"retry"}', '2026-08-28 00:00Z', '2026-08-28 05:00Z'),
  ('cian', 'https://www.cian.ru/rent/commercial/100000004', 'old-4', 'backfill', 'processing',
    '2026-08-28 00:00Z', '2026-08-28 00:00Z', '2026-08-28 00:00Z', 5,
    '2026-08-29 05:55Z', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-08-29 05:55Z', null,
    'processing_sentinel', '{"sentinel":"processing"}', '2026-08-28 00:00Z', '2026-08-29 05:55Z');

select * from public.slogi_enqueue_listing_fetches(
  'cian', 'hot',
  '[{"listingUrl":"https://www.cian.ru/rent/commercial/100000001","externalId":"new-1"}]'::jsonb,
  '2026-08-28 06:00Z'
);
select * from public.slogi_enqueue_listing_fetches(
  'cian', 'backfill',
  '[
    {"listingUrl":"https://www.cian.ru/rent/commercial/100000002","externalId":"new-2"},
    {"listingUrl":"https://www.cian.ru/rent/commercial/100000003","externalId":"new-3"},
    {"listingUrl":"https://www.cian.ru/rent/commercial/100000004","externalId":"new-4"}
  ]'::jsonb,
  '2026-08-29 06:00Z'
);

select pg_temp.assert_true(
  (select status = 'completed' and external_id = 'new-1' and priority = 'hot'
    and last_discovered_at = '2026-08-28 06:00Z' and next_attempt_at = '2026-08-28 00:00Z'
    and attempt_count = 9 and completed_at = '2026-08-28 00:00Z'
    and diagnostic = '{"sentinel":"completed"}'::jsonb
   from public.slogi_listing_fetch_queue where listing_url like '%100000001'),
  'completed hot rediscovery after six hours changed lifecycle state'
);
select pg_temp.assert_true(
  (select status = 'pending' and next_attempt_at = '2026-08-29 12:00Z' and attempt_count = 3
    and last_error_code = 'pending_sentinel' and diagnostic = '{"sentinel":"pending"}'::jsonb
   from public.slogi_listing_fetch_queue where listing_url like '%100000002'),
  'pending duplicate changed backoff or attempts'
);
select pg_temp.assert_true(
  (select status = 'retry' and next_attempt_at = '2026-08-29 13:00Z' and attempt_count = 4
    and last_attempt_at = '2026-08-28 05:00Z' and last_error_code = 'retry_sentinel'
   from public.slogi_listing_fetch_queue where listing_url like '%100000003'),
  'retry duplicate changed backoff or attempts'
);
select pg_temp.assert_true(
  (select status = 'processing' and locked_at = '2026-08-29 05:55Z'
    and locked_by = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and attempt_count = 5
   from public.slogi_listing_fetch_queue where listing_url like '%100000004'),
  'processing duplicate changed lock or attempts'
);

-- Any pending/retry/processing row blocks terminal activation, even when no
-- nonterminal row is currently due.
select pg_temp.assert_true(
  (select pg_catalog.count(*) = 0 from public.slogi_claim_listing_fetch_queue(
    'cian', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 2,
    '2026-08-29 06:00Z', '2026-08-29 05:00Z'
  )),
  'nonterminal backlog did not block terminal revalidation'
);
select pg_temp.assert_true(
  (select status = 'completed' from public.slogi_listing_fetch_queue where listing_url like '%100000001'),
  'terminal row activated while nonterminal backlog existed'
);

-- New URLs insert once. Twenty-seven repeated observations have exact queue
-- delta zero while retaining twenty-seven observed-existing results.
truncate table public.slogi_listing_fetch_queue restart identity;
create temporary table first_enqueue_result on commit drop as
select * from public.slogi_enqueue_listing_fetches(
  'cian', 'hot',
  '[{"listingUrl":"https://www.cian.ru/rent/commercial/200000001","externalId":"200000001"}]'::jsonb,
  '2026-08-29 00:00Z'
);
select pg_temp.assert_true(
  (select pg_catalog.count(*) = 1 and pg_catalog.bool_and(queued_new) from first_enqueue_result)
  and (select pg_catalog.count(*) = 1 from public.slogi_listing_fetch_queue),
  'new URL did not create exactly one row'
);
create temporary table repeated_enqueue_result on commit drop as
with batch as (
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'listingUrl', 'https://www.cian.ru/rent/commercial/200000001',
    'externalId', '200000001'
  )) as items
  from pg_catalog.generate_series(1, 27)
)
select result.*
from batch
cross join lateral public.slogi_enqueue_listing_fetches(
  'cian', 'hot', batch.items, '2026-08-29 06:00Z'
) as result;
select pg_temp.assert_true(
  (select pg_catalog.count(*) = 27 and not pg_catalog.bool_or(queued_new) from repeated_enqueue_result)
  and (select pg_catalog.count(*) = 1 from public.slogi_listing_fetch_queue),
  'twenty-seven existing observations produced a queue delta'
);

-- Exact TTL boundaries: 24h and 7d are inclusive, one microsecond younger is
-- not. Removed listings also require a post-removal observation.
truncate table public.slogi_listing_fetch_queue restart identity;
insert into public.slogi_listing_fetch_queue (
  source, listing_url, priority, status, discovered_at, last_discovered_at,
  next_attempt_at, attempt_count, last_attempt_at, completed_at, last_error_code
) values
  ('cian', 'https://www.cian.ru/rent/commercial/300000001', 'hot', 'completed',
    '2026-08-27 00:00Z', '2026-08-28 01:00Z', '2026-08-28 00:00Z', 8, '2026-08-28 00:00Z', '2026-08-28 00:00Z', null),
  ('cian', 'https://www.cian.ru/rent/commercial/300000002', 'hot', 'completed',
    '2026-08-27 00:00Z', '2026-08-28 01:00Z', '2026-08-28 00:00:00.000001Z', 8,
    '2026-08-28 00:00:00.000001Z', '2026-08-28 00:00:00.000001Z', null),
  ('cian', 'https://www.cian.ru/rent/commercial/300000003', 'backfill', 'discarded_unknown_date',
    '2026-08-20 00:00Z', '2026-08-22 01:00Z', '2026-08-22 00:00Z', 6, '2026-08-22 00:00Z', null, 'missing_or_invalid_freshness_date'),
  ('cian', 'https://www.cian.ru/rent/commercial/300000004', 'backfill', 'discarded_unknown_date',
    '2026-08-20 00:00Z', '2026-08-22 01:00Z', '2026-08-22 00:00:00.000001Z', 6,
    '2026-08-22 00:00:00.000001Z', null, 'missing_or_invalid_freshness_date'),
  ('cian', 'https://www.cian.ru/rent/commercial/300000005', 'hot', 'completed',
    '2026-08-27 00:00Z', '2026-08-28 00:00Z', '2026-08-28 00:00Z', 3,
    '2026-08-28 00:00Z', '2026-08-28 00:00Z', 'listing_removed');
create temporary table boundary_claim on commit drop as
select * from public.slogi_claim_listing_fetch_queue(
  'cian', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 2,
  '2026-08-29 00:00Z', '2026-08-28 23:00Z'
);
select pg_temp.assert_true(
  (select pg_catalog.count(*) = 2 and pg_catalog.bool_and(attempt_count = 1) from boundary_claim)
  and (select pg_catalog.count(*) = 2 from public.slogi_listing_fetch_queue where status = 'processing')
  and (select status = 'completed' from public.slogi_listing_fetch_queue where listing_url like '%300000002')
  and (select status = 'discarded_unknown_date' from public.slogi_listing_fetch_queue where listing_url like '%300000004')
  and (select status = 'completed' from public.slogi_listing_fetch_queue where listing_url like '%300000005'),
  'exact TTL boundary or removed-without-rediscovery contract failed'
);
select pg_temp.assert_true(
  (select pg_catalog.count(*) = 0 from public.slogi_claim_listing_fetch_queue(
    'cian', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 2,
    '2026-08-29 00:00Z', '2026-08-28 23:00Z'
  )),
  'second claim activated more terminal rows while first batch was processing'
);

-- discarded_old requires a current page-1/hot observation after seven days;
-- a deep-backfill observation is never sufficient.
truncate table public.slogi_listing_fetch_queue restart identity;
insert into public.slogi_listing_fetch_queue (
  source, listing_url, priority, status, discovered_at, last_discovered_at,
  next_attempt_at, attempt_count, last_attempt_at, last_error_code
) values
  ('cian', 'https://www.cian.ru/rent/commercial/400000001', 'backfill', 'discarded_old',
    '2026-08-20 00:00Z', '2026-08-23 00:00Z', '2026-08-22 00:00Z', 4, '2026-08-22 00:00Z', 'listing_older_than_30_days'),
  ('cian', 'https://www.cian.ru/rent/commercial/400000002', 'hot', 'discarded_old',
    '2026-08-20 00:00Z', '2026-08-23 00:00Z', '2026-08-22 00:00Z', 4, '2026-08-22 00:00Z', 'listing_older_than_30_days'),
  ('cian', 'https://www.cian.ru/rent/commercial/400000003', 'hot', 'discarded_old',
    '2026-08-20 00:00Z', '2026-08-23 00:00Z', '2026-08-22 00:00:00.000001Z', 4,
    '2026-08-22 00:00:00.000001Z', 'listing_older_than_30_days');
select pg_temp.assert_true(
  (select pg_catalog.count(*) = 1 and pg_catalog.bool_and(listing_url like '%400000002')
   from public.slogi_claim_listing_fetch_queue(
     'cian', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 2,
     '2026-08-29 00:00Z', '2026-08-28 23:00Z'
   )),
  'discarded_old deep/hot or exact seven-day contract failed'
);

-- Failed/blocked rows need age, rediscovery and an expired cooldown.
truncate table public.slogi_listing_fetch_queue restart identity;
insert into public.slogi_listing_fetch_queue (
  source, listing_url, priority, status, discovered_at, last_discovered_at,
  next_attempt_at, attempt_count, last_attempt_at, last_error_code
) values
  ('cian', 'https://www.cian.ru/rent/commercial/500000001', 'hot', 'failed',
    '2026-08-27 00:00Z', '2026-08-28 01:00Z', '2026-08-29 00:00Z', 4, '2026-08-28 00:00Z', 'http_5xx'),
  ('cian', 'https://www.cian.ru/rent/commercial/500000002', 'hot', 'blocked',
    '2026-08-27 00:00Z', '2026-08-28 01:00Z', '2026-08-29 00:00:00.000001Z', 4, '2026-08-28 00:00Z', 'blocked'),
  ('cian', 'https://www.cian.ru/rent/commercial/500000003', 'hot', 'failed',
    '2026-08-27 00:00Z', '2026-08-28 00:00Z', '2026-08-28 00:00Z', 4, '2026-08-28 00:00Z', 'http_5xx');
select pg_temp.assert_true(
  (select pg_catalog.count(*) = 1 and pg_catalog.bool_and(listing_url like '%500000001')
   from public.slogi_claim_listing_fetch_queue(
     'cian', 'ffffffff-ffff-4fff-8fff-ffffffffffff', 2,
     '2026-08-29 00:00Z', '2026-08-28 23:00Z'
   )),
  'failed/blocked age, cooldown or rediscovery contract failed'
);

-- Attempts continue within retry, then reset to one only when a terminal row
-- begins a newly eligible revalidation cycle.
truncate table public.slogi_listing_fetch_queue restart identity;
select * from public.slogi_enqueue_listing_fetches(
  'cian', 'hot',
  '[{"listingUrl":"https://www.cian.ru/rent/commercial/600000001","externalId":"600000001"}]'::jsonb,
  '2026-08-28 00:00Z'
);
select * from public.slogi_claim_listing_fetch_queue(
  'cian', '11111111-1111-4111-8111-111111111111', 2,
  '2026-08-28 00:00Z', '2026-08-27 23:00Z'
);
select pg_temp.assert_true(
  (select attempt_count = 1 from public.slogi_listing_fetch_queue),
  'new URL first attempt was not one'
);
select pg_temp.assert_true(public.slogi_finish_listing_fetch_queue(
  1, '11111111-1111-4111-8111-111111111111', 'retry',
  '2026-08-28 00:00Z', '2026-08-28 00:15Z', 'timeout', '{"cycle":"retry"}'::jsonb
), 'retry finish CAS failed');
select * from public.slogi_claim_listing_fetch_queue(
  'cian', '22222222-2222-4222-8222-222222222222', 2,
  '2026-08-28 00:15Z', '2026-08-27 23:15Z'
);
select pg_temp.assert_true(
  (select attempt_count = 2 from public.slogi_listing_fetch_queue),
  'retry attempt budget reset inside the same cycle'
);
select pg_temp.assert_true(public.slogi_finish_listing_fetch_queue(
  1, '22222222-2222-4222-8222-222222222222', 'failed',
  '2026-08-28 00:15Z', null, 'http_5xx', '{"cycle":"terminal"}'::jsonb
), 'failed finish CAS failed');
select * from public.slogi_enqueue_listing_fetches(
  'cian', 'hot',
  '[{"listingUrl":"https://www.cian.ru/rent/commercial/600000001","externalId":"600000001"}]'::jsonb,
  '2026-08-28 01:00Z'
);
select * from public.slogi_claim_listing_fetch_queue(
  'cian', '33333333-3333-4333-8333-333333333333', 2,
  '2026-08-29 00:15Z', '2026-08-28 23:15Z'
);
select pg_temp.assert_true(
  (select status = 'processing' and attempt_count = 1 from public.slogi_listing_fetch_queue),
  'new terminal revalidation cycle did not reset attempt budget to one'
);

-- Catalog/RLS/ACL audit for the two replaced RPCs and their queue table.
select pg_temp.assert_true(
  (select pg_catalog.bool_and(owner.rolname = 'postgres' and proc.prosecdef)
   from pg_catalog.pg_proc as proc
   join pg_catalog.pg_namespace as ns on ns.oid = proc.pronamespace
   join pg_catalog.pg_roles as owner on owner.oid = proc.proowner
   where ns.nspname = 'public'
     and proc.proname = any (array['slogi_enqueue_listing_fetches', 'slogi_claim_listing_fetch_queue'])
  ),
  'function owner or SECURITY DEFINER drifted'
);
select pg_temp.assert_true(
  (select pg_catalog.bool_and('search_path=pg_catalog, public' = any (proc.proconfig))
   from pg_catalog.pg_proc as proc
   join pg_catalog.pg_namespace as ns on ns.oid = proc.pronamespace
   where ns.nspname = 'public'
     and proc.proname = any (array['slogi_enqueue_listing_fetches', 'slogi_claim_listing_fetch_queue'])
  ),
  'function search_path drifted'
);
select pg_temp.assert_true(
  not pg_catalog.has_function_privilege('anon', 'public.slogi_enqueue_listing_fetches(text,text,jsonb,timestamptz)', 'execute')
  and not pg_catalog.has_function_privilege('authenticated', 'public.slogi_enqueue_listing_fetches(text,text,jsonb,timestamptz)', 'execute')
  and pg_catalog.has_function_privilege('service_role', 'public.slogi_enqueue_listing_fetches(text,text,jsonb,timestamptz)', 'execute')
  and not pg_catalog.has_function_privilege('anon', 'public.slogi_claim_listing_fetch_queue(text,uuid,integer,timestamptz,timestamptz)', 'execute')
  and not pg_catalog.has_function_privilege('authenticated', 'public.slogi_claim_listing_fetch_queue(text,uuid,integer,timestamptz,timestamptz)', 'execute')
  and pg_catalog.has_function_privilege('service_role', 'public.slogi_claim_listing_fetch_queue(text,uuid,integer,timestamptz,timestamptz)', 'execute')
  and not exists (
    select 1
    from pg_catalog.pg_proc as proc
    cross join lateral pg_catalog.aclexplode(proc.proacl) as acl
    where proc.oid = any (array[
      'public.slogi_enqueue_listing_fetches(text,text,jsonb,timestamptz)'::pg_catalog.regprocedure,
      'public.slogi_claim_listing_fetch_queue(text,uuid,integer,timestamptz,timestamptz)'::pg_catalog.regprocedure
    ])
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ),
  'function execute ACL is not service-role-only'
);
select pg_temp.assert_true(
  (select relrowsecurity and not relforcerowsecurity
   from pg_catalog.pg_class
   where oid = 'public.slogi_listing_fetch_queue'::pg_catalog.regclass)
  and not pg_catalog.has_table_privilege('anon', 'public.slogi_listing_fetch_queue', 'select')
  and not pg_catalog.has_table_privilege('authenticated', 'public.slogi_listing_fetch_queue', 'select')
  and pg_catalog.has_table_privilege('service_role', 'public.slogi_listing_fetch_queue', 'select,insert,update')
  and not pg_catalog.has_table_privilege('service_role', 'public.slogi_listing_fetch_queue', 'delete')
  and not exists (
    select 1
    from pg_catalog.pg_class as class
    cross join lateral pg_catalog.aclexplode(class.relacl) as acl
    where class.oid = 'public.slogi_listing_fetch_queue'::pg_catalog.regclass
      and acl.grantee = 0
  ),
  'queue RLS or table ACL drifted'
);

rollback;
