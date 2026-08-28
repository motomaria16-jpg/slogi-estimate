-- SLOGI v76.1.6 scheduler-only rollback.
-- Restores the previously verified once-daily UTC cadence without changing
-- commands, Vault records or cron history.

begin;

do $rollback$
declare
  v_discovery_id bigint;
  v_hydration_id bigint;
begin
  select jobid into v_discovery_id
  from cron.job
  where jobname = 'slogi-cian-daily-discovery'
    and command like '%/functions/v1/refresh-listings%';

  select jobid into v_hydration_id
  from cron.job
  where jobname = 'slogi-cian-daily-hydration'
    and command like '%/functions/v1/hydrate-listings%';

  if v_discovery_id is null or v_hydration_id is null
    or (select count(*) from cron.job where jobname in ('slogi-cian-daily-discovery', 'slogi-cian-daily-hydration')) <> 2
  then
    raise exception using errcode = 'P0001', message = 'cian_scheduler_contract_mismatch';
  end if;

  perform cron.alter_job(v_discovery_id, active => false);
  perform cron.alter_job(v_hydration_id, active => false);
  perform cron.alter_job(v_discovery_id, schedule => '10 3 * * *', active => true);
  perform cron.alter_job(v_hydration_id, schedule => '25 3 * * *', active => true);
end
$rollback$;

commit;

