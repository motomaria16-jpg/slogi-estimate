-- SLOGI v76.1.37: expanded, bounded Browserless cadence.
-- Discovery: 4 runs/day x 2 sessions. Hydration: 24 runs/day x 2 cards.
-- Combined hard ceiling: 56 Browserless sessions per UTC day.

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
    and command like '%source%cian%'
    and command not like '%avito%'
    and command not like '%ozon%';

  select jobid into v_hydration_id
  from cron.job
  where jobname = 'slogi-cian-daily-hydration'
    and command like '%/functions/v1/hydrate-listings%'
    and command like '%source%cian%'
    and command not like '%batchSize%'
    and command not like '%avito%'
    and command not like '%ozon%';

  if v_discovery_id is null or v_hydration_id is null
    or (select count(*) from cron.job where jobname in ('slogi-cian-daily-discovery', 'slogi-cian-daily-hydration')) <> 2
  then
    raise exception using errcode = 'P0001', message = 'cian_scheduler_contract_mismatch';
  end if;

  perform cron.alter_job(v_discovery_id, schedule => '10 0,6,12,18 * * *', active => false);
  perform cron.alter_job(v_hydration_id, schedule => '25 * * * *', active => false);
  perform cron.alter_job(v_discovery_id, active => true);
  perform cron.alter_job(v_hydration_id, active => true);
end
$activation$;

-- A purchased/refilled allowance should resume durable rows immediately. Only
-- the explicit credits-exhausted state is reset; authentication and parsing
-- failures remain visible and are not silently retried.
update public.slogi_listing_fetch_queue
set
  status = 'retry',
  attempt_count = 0,
  next_attempt_at = now(),
  locked_at = null,
  locked_by = null,
  completed_at = null,
  updated_at = now()
where source = 'cian'
  and status in ('failed', 'retry')
  and last_error_code = 'browserless_credits_exhausted';

update public.slogi_listing_scan_state
set
  cooldown_until = null,
  last_discovery_error_code = case
    when last_discovery_error_code = 'browserless_credits_exhausted' then null
    else last_discovery_error_code
  end,
  last_hydration_error_code = case
    when last_hydration_error_code = 'browserless_credits_exhausted' then null
    else last_hydration_error_code
  end,
  updated_at = now()
where source = 'cian';

commit;
