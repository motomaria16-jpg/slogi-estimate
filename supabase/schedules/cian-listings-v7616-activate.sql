-- SLOGI v76.1.6: guarded cadence activation for the two existing Cian jobs.
-- Deploy search-listings, refresh-listings and hydrate-listings first while
-- these jobs are inactive. This script changes schedules/active state only;
-- it preserves the already-audited Vault-backed commands byte-for-byte.

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

commit;
