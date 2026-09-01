-- SLOGI v76.1.16: sustainable Browserless Free cadence and quota recovery.
-- Browserless bills browser time and managed proxy traffic from one monthly
-- unit allowance. This keeps discovery daily and hydrates one hot card every
-- two hours: at most 14 Browserless sessions per UTC day.

begin;

do $activation$
declare
  v_discovery_id bigint;
  v_hydration_id bigint;
begin
  select jobid into v_discovery_id
  from cron.job
  where jobname = 'slogi-cian-daily-discovery'
    and command like '%/functions/v1/refresh-listings%'
    and command like '%source%cian%';

  select jobid into v_hydration_id
  from cron.job
  where jobname = 'slogi-cian-daily-hydration'
    and command like '%/functions/v1/hydrate-listings%'
    and command like '%source%cian%'
    and command not like '%batchSize%';

  if v_discovery_id is null or v_hydration_id is null
    or (select count(*) from cron.job where jobname in ('slogi-cian-daily-discovery', 'slogi-cian-daily-hydration')) <> 2
  then
    raise exception using errcode = 'P0001', message = 'cian_scheduler_contract_mismatch';
  end if;

  perform cron.alter_job(v_discovery_id, schedule => '10 3 * * *', active => false);
  perform cron.alter_job(v_hydration_id, schedule => '25 */2 * * *', active => false);
  perform cron.alter_job(v_discovery_id, active => true);
  perform cron.alter_job(v_hydration_id, active => true);
end
$activation$;

-- The current free allowance renews on 20 September 2026. Preserve provider-
-- failed rows instead of letting an exhausted external quota delete their
-- chance of being processed after the renewal.
update public.slogi_listing_fetch_queue
set
  status = 'retry',
  attempt_count = 0,
  next_attempt_at = greatest(now(), '2026-09-20 00:00:00+00'::timestamptz),
  locked_at = null,
  locked_by = null,
  completed_at = null,
  last_error_code = 'browserless_credits_exhausted',
  updated_at = now()
where source = 'cian'
  and status = 'failed'
  and last_error_code = 'browserless_http_401';

update public.slogi_listing_scan_state
set
  cooldown_until = greatest(now(), '2026-09-20 00:00:00+00'::timestamptz),
  last_discovery_error_code = case when last_discovery_error_code = 'browserless_http_401' then 'browserless_credits_exhausted' else last_discovery_error_code end,
  last_hydration_error_code = case when last_hydration_error_code = 'browserless_http_401' then 'browserless_credits_exhausted' else last_hydration_error_code end,
  updated_at = now()
where source = 'cian';

commit;
