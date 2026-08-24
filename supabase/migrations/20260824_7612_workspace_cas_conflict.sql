-- v76.1.2 forward-only hotfix.
--
-- SQLSTATE 40001 means serialization_failure and may be retried by database
-- infrastructure. A normal optimistic-concurrency miss is an application-level
-- conflict, so expose it as an explicit PostgREST HTTP 409 instead.

create or replace function public.slogi_update_shared_workspace_state(
  p_workspace_id uuid,
  p_expected_revision bigint,
  p_state jsonb
)
returns table (workspace_id uuid, state jsonb, revision bigint, updated_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null or p_workspace_id is null then
    raise exception using errcode = 'P0001', message = 'workspace_not_available';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception using errcode = '22023', message = 'invalid_workspace_revision';
  end if;
  if p_state is null or jsonb_typeof(p_state) <> 'object' or octet_length(p_state::text) > 1048576 then
    raise exception using errcode = '22023', message = 'invalid_workspace_state';
  end if;
  if not exists (
    select 1 from public.slogi_shared_workspace_members as member
    where member.workspace_id = p_workspace_id and member.user_id = v_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'workspace_not_available';
  end if;

  return query
  update public.slogi_shared_workspace_state as workspace_state
  set state = p_state,
      revision = workspace_state.revision + 1,
      updated_at = now(),
      updated_by = v_user_id
  where workspace_state.workspace_id = p_workspace_id
    and workspace_state.revision = p_expected_revision
  returning workspace_state.workspace_id, workspace_state.state,
            workspace_state.revision, workspace_state.updated_at;

  if not found then
    raise exception using errcode = 'PT409', message = 'workspace_revision_conflict';
  end if;
end;
$$;

alter function public.slogi_update_shared_workspace_state(uuid, bigint, jsonb) owner to postgres;
revoke all on function public.slogi_update_shared_workspace_state(uuid, bigint, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.slogi_update_shared_workspace_state(uuid, bigint, jsonb)
  to authenticated;

comment on function public.slogi_update_shared_workspace_state(uuid, bigint, jsonb) is
  'Workspace state compare-and-swap. Revision conflicts return PostgREST HTTP 409 without serialization retries.';
