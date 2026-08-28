-- v76.1.7 forward-only shared password gate.
-- No password material is stored in PostgreSQL. Edge issues a signed bearer
-- grant after a one-time challenge and server-side password verification.

create table public.slogi_password_gate_config (
  singleton boolean not null default true,
  canonical_workspace_id uuid not null,
  enabled boolean not null default false,
  grant_version bigint not null default 1,
  grant_ttl_seconds integer not null default 15552000,
  revoked_before timestamptz null,
  updated_at timestamptz not null default now(),
  constraint slogi_password_gate_config_pkey primary key (singleton),
  constraint slogi_password_gate_config_singleton_check check (singleton),
  constraint slogi_password_gate_config_workspace_key unique (canonical_workspace_id),
  constraint slogi_password_gate_config_workspace_fkey foreign key (canonical_workspace_id)
    references public.slogi_shared_workspaces(id) on delete restrict,
  constraint slogi_password_gate_config_version_check check (grant_version > 0),
  constraint slogi_password_gate_config_ttl_check check (grant_ttl_seconds between 86400 and 31536000)
);

create table public.slogi_password_gate_grants (
  id uuid not null,
  user_id uuid not null,
  workspace_id uuid not null,
  token_hash text not null,
  grant_version bigint not null,
  issued_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  revoked_at timestamptz null,
  constraint slogi_password_gate_grants_pkey primary key (id),
  constraint slogi_password_gate_grants_token_hash_key unique (token_hash),
  constraint slogi_password_gate_grants_user_fkey foreign key (user_id)
    references auth.users(id) on delete cascade,
  constraint slogi_password_gate_grants_workspace_fkey foreign key (workspace_id)
    references public.slogi_shared_workspaces(id) on delete cascade,
  constraint slogi_password_gate_grants_token_hash_check check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint slogi_password_gate_grants_version_check check (grant_version > 0),
  constraint slogi_password_gate_grants_expiry_check check (expires_at > issued_at)
);

create index slogi_password_gate_grants_user_idx
  on public.slogi_password_gate_grants (user_id, expires_at desc);
create index slogi_password_gate_grants_active_idx
  on public.slogi_password_gate_grants (workspace_id, grant_version, expires_at)
  where revoked_at is null;

create table public.slogi_password_gate_challenges (
  user_id uuid not null,
  challenge_hash text not null,
  issued_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  used_at timestamptz null,
  constraint slogi_password_gate_challenges_pkey primary key (user_id),
  constraint slogi_password_gate_challenges_hash_key unique (challenge_hash),
  constraint slogi_password_gate_challenges_user_fkey foreign key (user_id)
    references auth.users(id) on delete cascade,
  constraint slogi_password_gate_challenges_hash_check check (challenge_hash ~ '^[0-9a-f]{64}$'),
  constraint slogi_password_gate_challenges_expiry_check check (expires_at > issued_at)
);

create table public.slogi_password_gate_rate_limits (
  scope_hash text not null,
  attempt_count integer not null default 0,
  window_started_at timestamptz not null default statement_timestamp(),
  cooldown_until timestamptz null,
  updated_at timestamptz not null default statement_timestamp(),
  constraint slogi_password_gate_rate_limits_pkey primary key (scope_hash),
  constraint slogi_password_gate_rate_limits_hash_check check (scope_hash ~ '^[0-9a-f]{64}$'),
  constraint slogi_password_gate_rate_limits_count_check check (attempt_count >= 0)
);

alter table public.slogi_password_gate_config owner to postgres;
alter table public.slogi_password_gate_grants owner to postgres;
alter table public.slogi_password_gate_challenges owner to postgres;
alter table public.slogi_password_gate_rate_limits owner to postgres;
alter table public.slogi_password_gate_config enable row level security;
alter table public.slogi_password_gate_grants enable row level security;
alter table public.slogi_password_gate_challenges enable row level security;
alter table public.slogi_password_gate_rate_limits enable row level security;
alter table public.slogi_password_gate_config no force row level security;
alter table public.slogi_password_gate_grants no force row level security;
alter table public.slogi_password_gate_challenges no force row level security;
alter table public.slogi_password_gate_rate_limits no force row level security;

revoke all on public.slogi_password_gate_config from public, anon, authenticated, service_role;
revoke all on public.slogi_password_gate_grants from public, anon, authenticated, service_role;
revoke all on public.slogi_password_gate_challenges from public, anon, authenticated, service_role;
revoke all on public.slogi_password_gate_rate_limits from public, anon, authenticated, service_role;

create or replace function public.slogi_request_device_grant()
returns text
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select coalesce(
    (coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb ->> 'x-slogi-device-grant'),
    ''
  );
$$;

create or replace function public.slogi_has_active_password_gate_grant(p_workspace_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, extensions
as $$
  select exists (
    select 1
    from public.slogi_password_gate_grants as gate_grant
    join public.slogi_password_gate_config as gate_config
      on gate_config.singleton
     and gate_config.enabled
     and gate_config.canonical_workspace_id = gate_grant.workspace_id
     and gate_config.grant_version = gate_grant.grant_version
    join public.slogi_shared_workspaces as workspace
      on workspace.id = gate_grant.workspace_id and workspace.disabled_at is null
    where gate_grant.user_id = auth.uid()
      and (p_workspace_id is null or gate_grant.workspace_id = p_workspace_id)
      and gate_grant.revoked_at is null
      and gate_grant.expires_at > statement_timestamp()
      and (gate_config.revoked_before is null or gate_grant.issued_at >= gate_config.revoked_before)
      and gate_grant.token_hash = encode(
        extensions.digest(public.slogi_request_device_grant(), 'sha256'), 'hex'
      )
  );
$$;

create or replace function public.slogi_password_gate_context()
returns table (workspace_id uuid, grant_version bigint, grant_ttl_seconds integer)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select config.canonical_workspace_id, config.grant_version, config.grant_ttl_seconds
  from public.slogi_password_gate_config as config
  join public.slogi_shared_workspaces as workspace
    on workspace.id = config.canonical_workspace_id and workspace.disabled_at is null
  where config.singleton and config.enabled;
$$;

create or replace function public.slogi_create_password_gate_challenge(
  p_user_id uuid,
  p_challenge_hash text,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_user_id is null or p_challenge_hash !~ '^[0-9a-f]{64}$'
     or p_expires_at <= statement_timestamp()
     or p_expires_at > statement_timestamp() + interval '10 minutes'
     or not exists (select 1 from public.slogi_password_gate_context())
     or not exists (
       select 1 from auth.users as auth_user
       where auth_user.id = p_user_id and auth_user.is_anonymous is true and auth_user.deleted_at is null
     ) then
    raise exception using errcode = 'PT401', message = 'access_denied';
  end if;

  insert into public.slogi_password_gate_challenges (
    user_id, challenge_hash, issued_at, expires_at, used_at
  ) values (
    p_user_id, p_challenge_hash, statement_timestamp(), p_expires_at, null
  )
  on conflict (user_id) do update
    set challenge_hash = excluded.challenge_hash,
        issued_at = excluded.issued_at,
        expires_at = excluded.expires_at,
        used_at = null;
  return true;
end;
$$;

create or replace function public.slogi_begin_password_gate_attempt(
  p_user_id uuid,
  p_challenge_hash text,
  p_scope_hashes text[]
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_challenge public.slogi_password_gate_challenges%rowtype;
  v_scope text;
  v_limit public.slogi_password_gate_rate_limits%rowtype;
  v_now timestamptz := statement_timestamp();
  v_count integer;
  v_wait integer := 0;
  v_cooldown integer;
begin
  if p_user_id is null or p_challenge_hash !~ '^[0-9a-f]{64}$'
     or coalesce(cardinality(p_scope_hashes), 0) not between 1 and 3 then
    raise exception using errcode = 'PT401', message = 'access_denied';
  end if;
  if exists (select 1 from unnest(p_scope_hashes) as scope(value) where value !~ '^[0-9a-f]{64}$') then
    raise exception using errcode = 'PT401', message = 'access_denied';
  end if;

  select challenge.* into v_challenge
  from public.slogi_password_gate_challenges as challenge
  where challenge.user_id = p_user_id
  for update;
  if not found or v_challenge.challenge_hash <> p_challenge_hash
     or v_challenge.used_at is not null or v_challenge.expires_at <= v_now then
    raise exception using errcode = 'PT401', message = 'access_denied';
  end if;
  update public.slogi_password_gate_challenges set used_at = v_now where user_id = p_user_id;

  for v_scope in select distinct value from unnest(p_scope_hashes) as scope(value) order by value loop
    insert into public.slogi_password_gate_rate_limits (scope_hash, attempt_count, window_started_at, updated_at)
    values (v_scope, 0, v_now, v_now)
    on conflict (scope_hash) do nothing;
    select rate.* into v_limit
    from public.slogi_password_gate_rate_limits as rate
    where rate.scope_hash = v_scope
    for update;

    if v_limit.cooldown_until is not null and v_limit.cooldown_until > v_now then
      v_wait := greatest(v_wait, ceil(extract(epoch from v_limit.cooldown_until - v_now))::integer);
    else
      v_count := case when v_limit.window_started_at <= v_now - interval '15 minutes'
        then 1 else v_limit.attempt_count + 1 end;
      if v_count > 5 then
        v_cooldown := least(900, (30 * power(2, least(v_count - 6, 5)))::integer);
        v_wait := greatest(v_wait, v_cooldown);
        update public.slogi_password_gate_rate_limits
        set attempt_count = v_count,
            window_started_at = case when v_limit.window_started_at <= v_now - interval '15 minutes' then v_now else v_limit.window_started_at end,
            cooldown_until = v_now + make_interval(secs => v_cooldown),
            updated_at = v_now
        where scope_hash = v_scope;
      else
        update public.slogi_password_gate_rate_limits
        set attempt_count = v_count,
            window_started_at = case when v_limit.window_started_at <= v_now - interval '15 minutes' then v_now else v_limit.window_started_at end,
            cooldown_until = null,
            updated_at = v_now
        where scope_hash = v_scope;
      end if;
    end if;
  end loop;
  return v_wait;
end;
$$;

create or replace function public.slogi_clear_password_gate_limits(p_scope_hashes text[])
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if coalesce(cardinality(p_scope_hashes), 0) not between 1 and 3
     or exists (select 1 from unnest(p_scope_hashes) as scope(value) where value !~ '^[0-9a-f]{64}$') then
    raise exception using errcode = '22023', message = 'invalid_rate_scope';
  end if;
  delete from public.slogi_password_gate_rate_limits where scope_hash = any (p_scope_hashes);
  return true;
end;
$$;

create or replace function public.slogi_issue_password_gate_grant(
  p_user_id uuid,
  p_grant_id uuid,
  p_token_hash text,
  p_expires_at timestamptz,
  p_grant_version bigint
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_config public.slogi_password_gate_config%rowtype;
  v_existing_workspace_id uuid;
begin
  select config.* into v_config
  from public.slogi_password_gate_config as config
  join public.slogi_shared_workspaces as workspace
    on workspace.id = config.canonical_workspace_id and workspace.disabled_at is null
  where config.singleton and config.enabled
  for update of config;
  if not found or p_user_id is null or p_grant_id is null
     or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_grant_version <> v_config.grant_version
     or p_expires_at <= statement_timestamp() + interval '1 minute'
     or p_expires_at > statement_timestamp() + make_interval(secs => v_config.grant_ttl_seconds + 60)
     or not exists (
       select 1 from auth.users as auth_user
       where auth_user.id = p_user_id and auth_user.is_anonymous is true and auth_user.deleted_at is null
     ) then
    raise exception using errcode = 'PT401', message = 'access_denied';
  end if;

  select member.workspace_id into v_existing_workspace_id
  from public.slogi_shared_workspace_members as member
  where member.user_id = p_user_id;
  if v_existing_workspace_id is not null and v_existing_workspace_id <> v_config.canonical_workspace_id then
    raise exception using errcode = 'PT409', message = 'workspace_membership_conflict';
  end if;
  if v_existing_workspace_id is null then
    insert into public.slogi_shared_workspace_members (workspace_id, user_id)
    values (v_config.canonical_workspace_id, p_user_id);
  end if;

  update public.slogi_password_gate_grants
  set revoked_at = statement_timestamp()
  where user_id = p_user_id and revoked_at is null;
  insert into public.slogi_password_gate_grants (
    id, user_id, workspace_id, token_hash, grant_version, issued_at, expires_at
  ) values (
    p_grant_id, p_user_id, v_config.canonical_workspace_id, p_token_hash,
    p_grant_version, statement_timestamp(), p_expires_at
  );
  return v_config.canonical_workspace_id;
end;
$$;

create or replace function public.slogi_validate_password_gate_grant(
  p_user_id uuid,
  p_grant_id uuid,
  p_token_hash text
)
returns table (workspace_id uuid, expires_at timestamptz, grant_version bigint)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select gate_grant.workspace_id, gate_grant.expires_at, gate_grant.grant_version
  from public.slogi_password_gate_grants as gate_grant
  join public.slogi_password_gate_config as gate_config
    on gate_config.singleton and gate_config.enabled
   and gate_config.canonical_workspace_id = gate_grant.workspace_id
   and gate_config.grant_version = gate_grant.grant_version
  join public.slogi_shared_workspace_members as member
    on member.workspace_id = gate_grant.workspace_id and member.user_id = gate_grant.user_id
  where gate_grant.id = p_grant_id
    and gate_grant.user_id = p_user_id
    and gate_grant.token_hash = p_token_hash
    and gate_grant.revoked_at is null
    and gate_grant.expires_at > statement_timestamp()
    and (gate_config.revoked_before is null or gate_grant.issued_at >= gate_config.revoked_before);
$$;

create or replace function public.slogi_revoke_password_gate_grant(
  p_user_id uuid,
  p_grant_id uuid,
  p_token_hash text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.slogi_password_gate_grants
  set revoked_at = coalesce(revoked_at, statement_timestamp())
  where id = p_grant_id and user_id = p_user_id and token_hash = p_token_hash;
  return found;
end;
$$;

alter function public.slogi_request_device_grant() owner to postgres;
alter function public.slogi_has_active_password_gate_grant(uuid) owner to postgres;
alter function public.slogi_password_gate_context() owner to postgres;
alter function public.slogi_create_password_gate_challenge(uuid, text, timestamptz) owner to postgres;
alter function public.slogi_begin_password_gate_attempt(uuid, text, text[]) owner to postgres;
alter function public.slogi_clear_password_gate_limits(text[]) owner to postgres;
alter function public.slogi_issue_password_gate_grant(uuid, uuid, text, timestamptz, bigint) owner to postgres;
alter function public.slogi_validate_password_gate_grant(uuid, uuid, text) owner to postgres;
alter function public.slogi_revoke_password_gate_grant(uuid, uuid, text) owner to postgres;

revoke all on function public.slogi_request_device_grant() from public, anon, authenticated, service_role;
revoke all on function public.slogi_has_active_password_gate_grant(uuid) from public, anon, authenticated, service_role;
revoke all on function public.slogi_password_gate_context() from public, anon, authenticated, service_role;
revoke all on function public.slogi_create_password_gate_challenge(uuid, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.slogi_begin_password_gate_attempt(uuid, text, text[]) from public, anon, authenticated, service_role;
revoke all on function public.slogi_clear_password_gate_limits(text[]) from public, anon, authenticated, service_role;
revoke all on function public.slogi_issue_password_gate_grant(uuid, uuid, text, timestamptz, bigint) from public, anon, authenticated, service_role;
revoke all on function public.slogi_validate_password_gate_grant(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.slogi_revoke_password_gate_grant(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.slogi_request_device_grant() to authenticated;
grant execute on function public.slogi_has_active_password_gate_grant(uuid) to authenticated;
grant execute on function public.slogi_password_gate_context() to service_role;
grant execute on function public.slogi_create_password_gate_challenge(uuid, text, timestamptz) to service_role;
grant execute on function public.slogi_begin_password_gate_attempt(uuid, text, text[]) to service_role;
grant execute on function public.slogi_clear_password_gate_limits(text[]) to service_role;
grant execute on function public.slogi_issue_password_gate_grant(uuid, uuid, text, timestamptz, bigint) to service_role;
grant execute on function public.slogi_validate_password_gate_grant(uuid, uuid, text) to service_role;
grant execute on function public.slogi_revoke_password_gate_grant(uuid, uuid, text) to service_role;

-- Replace shared-workspace RLS with membership + current device grant.
drop policy if exists "SLOGI shared members select own" on public.slogi_shared_workspace_members;
create policy "SLOGI shared members select own" on public.slogi_shared_workspace_members
for select to authenticated using (
  auth.uid() = user_id and public.slogi_has_active_password_gate_grant(workspace_id)
);
drop policy if exists "SLOGI shared state select member" on public.slogi_shared_workspace_state;
create policy "SLOGI shared state select member" on public.slogi_shared_workspace_state
for select to authenticated using (
  public.slogi_has_active_password_gate_grant(workspace_id)
  and exists (select 1 from public.slogi_shared_workspace_members as member
    where member.workspace_id = slogi_shared_workspace_state.workspace_id and member.user_id = auth.uid())
);

drop policy if exists "SLOGI shared attachments select member" on public.slogi_shared_workspace_attachments;
drop policy if exists "SLOGI shared attachments insert member" on public.slogi_shared_workspace_attachments;
drop policy if exists "SLOGI shared attachments update member" on public.slogi_shared_workspace_attachments;
drop policy if exists "SLOGI shared attachments delete member" on public.slogi_shared_workspace_attachments;
create policy "SLOGI shared attachments select member" on public.slogi_shared_workspace_attachments
for select to authenticated using (public.slogi_has_active_password_gate_grant(workspace_id)
  and exists (select 1 from public.slogi_shared_workspace_members as member where member.workspace_id = slogi_shared_workspace_attachments.workspace_id and member.user_id = auth.uid()));
create policy "SLOGI shared attachments insert member" on public.slogi_shared_workspace_attachments
for insert to authenticated with check (updated_by = auth.uid() and public.slogi_has_active_password_gate_grant(workspace_id)
  and exists (select 1 from public.slogi_shared_workspace_members as member where member.workspace_id = slogi_shared_workspace_attachments.workspace_id and member.user_id = auth.uid()));
create policy "SLOGI shared attachments update member" on public.slogi_shared_workspace_attachments
for update to authenticated using (public.slogi_has_active_password_gate_grant(workspace_id)
  and exists (select 1 from public.slogi_shared_workspace_members as member where member.workspace_id = slogi_shared_workspace_attachments.workspace_id and member.user_id = auth.uid()))
with check (updated_by = auth.uid() and public.slogi_has_active_password_gate_grant(workspace_id)
  and exists (select 1 from public.slogi_shared_workspace_members as member where member.workspace_id = slogi_shared_workspace_attachments.workspace_id and member.user_id = auth.uid()));
create policy "SLOGI shared attachments delete member" on public.slogi_shared_workspace_attachments
for delete to authenticated using (public.slogi_has_active_password_gate_grant(workspace_id)
  and exists (select 1 from public.slogi_shared_workspace_members as member where member.workspace_id = slogi_shared_workspace_attachments.workspace_id and member.user_id = auth.uid()));

-- Gate frozen legacy per-user rows without deleting or rewriting them.
drop policy if exists "SLOGI attachments select own" on public.slogi_attachments;
drop policy if exists "SLOGI attachments insert own" on public.slogi_attachments;
drop policy if exists "SLOGI attachments update own" on public.slogi_attachments;
drop policy if exists "SLOGI attachments delete own" on public.slogi_attachments;
create policy "SLOGI attachments select own" on public.slogi_attachments for select to authenticated using (auth.uid() = user_id and public.slogi_has_active_password_gate_grant());
create policy "SLOGI attachments insert own" on public.slogi_attachments for insert to authenticated with check (auth.uid() = user_id and public.slogi_has_active_password_gate_grant());
create policy "SLOGI attachments update own" on public.slogi_attachments for update to authenticated using (auth.uid() = user_id and public.slogi_has_active_password_gate_grant()) with check (auth.uid() = user_id and public.slogi_has_active_password_gate_grant());
create policy "SLOGI attachments delete own" on public.slogi_attachments for delete to authenticated using (auth.uid() = user_id and public.slogi_has_active_password_gate_grant());

drop policy if exists "SLOGI state select own" on public.slogi_user_state;
drop policy if exists "SLOGI state insert own" on public.slogi_user_state;
drop policy if exists "SLOGI state update own" on public.slogi_user_state;
drop policy if exists "SLOGI state delete own" on public.slogi_user_state;
create policy "SLOGI state select own" on public.slogi_user_state for select to authenticated using (auth.uid() = user_id and public.slogi_has_active_password_gate_grant());
create policy "SLOGI state insert own" on public.slogi_user_state for insert to authenticated with check (auth.uid() = user_id and public.slogi_has_active_password_gate_grant());
create policy "SLOGI state update own" on public.slogi_user_state for update to authenticated using (auth.uid() = user_id and public.slogi_has_active_password_gate_grant()) with check (auth.uid() = user_id and public.slogi_has_active_password_gate_grant());
create policy "SLOGI state delete own" on public.slogi_user_state for delete to authenticated using (auth.uid() = user_id and public.slogi_has_active_password_gate_grant());

drop policy if exists "SLOGI workspace select own" on public.slogi_workspace_state;
drop policy if exists "SLOGI workspace insert own" on public.slogi_workspace_state;
drop policy if exists "SLOGI workspace update own" on public.slogi_workspace_state;
drop policy if exists "SLOGI workspace delete own" on public.slogi_workspace_state;
create policy "SLOGI workspace select own" on public.slogi_workspace_state for select to authenticated using (auth.uid() = user_id and public.slogi_has_active_password_gate_grant());
create policy "SLOGI workspace insert own" on public.slogi_workspace_state for insert to authenticated with check (auth.uid() = user_id and public.slogi_has_active_password_gate_grant());
create policy "SLOGI workspace update own" on public.slogi_workspace_state for update to authenticated using (auth.uid() = user_id and public.slogi_has_active_password_gate_grant()) with check (auth.uid() = user_id and public.slogi_has_active_password_gate_grant());
create policy "SLOGI workspace delete own" on public.slogi_workspace_state for delete to authenticated using (auth.uid() = user_id and public.slogi_has_active_password_gate_grant());

-- Preserve CAS/PT409 semantics and add the same server-side grant predicate.
create or replace function public.slogi_update_shared_workspace_state(
  p_workspace_id uuid, p_expected_revision bigint, p_state jsonb
)
returns table (workspace_id uuid, state jsonb, revision bigint, updated_at timestamptz)
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_user_id uuid := auth.uid();
begin
  if v_user_id is null or p_workspace_id is null then raise exception using errcode = 'PT401', message = 'access_denied'; end if;
  if p_expected_revision is null or p_expected_revision < 0 then raise exception using errcode = '22023', message = 'invalid_workspace_revision'; end if;
  if p_state is null or jsonb_typeof(p_state) <> 'object' or octet_length(p_state::text) > 1048576 then raise exception using errcode = '22023', message = 'invalid_workspace_state'; end if;
  if not public.slogi_has_active_password_gate_grant(p_workspace_id)
     or not exists (select 1 from public.slogi_shared_workspace_members as member where member.workspace_id = p_workspace_id and member.user_id = v_user_id) then
    raise exception using errcode = 'PT401', message = 'access_denied';
  end if;
  return query update public.slogi_shared_workspace_state as workspace_state
    set state = p_state, revision = workspace_state.revision + 1, updated_at = statement_timestamp(), updated_by = v_user_id
    where workspace_state.workspace_id = p_workspace_id and workspace_state.revision = p_expected_revision
    returning workspace_state.workspace_id, workspace_state.state, workspace_state.revision, workspace_state.updated_at;
  if not found then raise exception using errcode = 'PT409', message = 'workspace_revision_conflict'; end if;
end;
$$;
alter function public.slogi_update_shared_workspace_state(uuid, bigint, jsonb) owner to postgres;
revoke all on function public.slogi_update_shared_workspace_state(uuid, bigint, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.slogi_update_shared_workspace_state(uuid, bigint, jsonb) to authenticated;

-- Both legacy user paths and shared workspace paths require the grant header.
drop policy if exists "SLOGI files select own" on storage.objects;
drop policy if exists "SLOGI files insert own" on storage.objects;
drop policy if exists "SLOGI files update own" on storage.objects;
drop policy if exists "SLOGI files delete own" on storage.objects;
create policy "SLOGI files select own" on storage.objects for select to authenticated using (bucket_id='slogi-files' and (storage.foldername(name))[1]=auth.uid()::text and public.slogi_has_active_password_gate_grant());
create policy "SLOGI files insert own" on storage.objects for insert to authenticated with check (bucket_id='slogi-files' and (storage.foldername(name))[1]=auth.uid()::text and public.slogi_has_active_password_gate_grant());
create policy "SLOGI files update own" on storage.objects for update to authenticated using (bucket_id='slogi-files' and (storage.foldername(name))[1]=auth.uid()::text and public.slogi_has_active_password_gate_grant()) with check (bucket_id='slogi-files' and (storage.foldername(name))[1]=auth.uid()::text and public.slogi_has_active_password_gate_grant());
create policy "SLOGI files delete own" on storage.objects for delete to authenticated using (bucket_id='slogi-files' and (storage.foldername(name))[1]=auth.uid()::text and public.slogi_has_active_password_gate_grant());

drop policy if exists "SLOGI shared files select member" on storage.objects;
drop policy if exists "SLOGI shared files insert member" on storage.objects;
drop policy if exists "SLOGI shared files update member" on storage.objects;
drop policy if exists "SLOGI shared files delete member" on storage.objects;
create policy "SLOGI shared files select member" on storage.objects for select to authenticated using (
  bucket_id='slogi-files' and (storage.foldername(name))[1]='workspace'
  and (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and public.slogi_has_active_password_gate_grant(((storage.foldername(name))[2])::uuid)
  and exists (select 1 from public.slogi_shared_workspace_members as member
    where member.user_id=auth.uid() and member.workspace_id=((storage.foldername(name))[2])::uuid)
);
create policy "SLOGI shared files insert member" on storage.objects for insert to authenticated with check (
  bucket_id='slogi-files' and (storage.foldername(name))[1]='workspace'
  and (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and public.slogi_has_active_password_gate_grant(((storage.foldername(name))[2])::uuid)
  and exists (select 1 from public.slogi_shared_workspace_members as member
    where member.user_id=auth.uid() and member.workspace_id=((storage.foldername(name))[2])::uuid)
);
create policy "SLOGI shared files update member" on storage.objects for update to authenticated using (
  bucket_id='slogi-files' and (storage.foldername(name))[1]='workspace'
  and (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and public.slogi_has_active_password_gate_grant(((storage.foldername(name))[2])::uuid)
  and exists (select 1 from public.slogi_shared_workspace_members as member
    where member.user_id=auth.uid() and member.workspace_id=((storage.foldername(name))[2])::uuid)
) with check (
  bucket_id='slogi-files' and (storage.foldername(name))[1]='workspace'
  and (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and public.slogi_has_active_password_gate_grant(((storage.foldername(name))[2])::uuid)
  and exists (select 1 from public.slogi_shared_workspace_members as member
    where member.user_id=auth.uid() and member.workspace_id=((storage.foldername(name))[2])::uuid)
);
create policy "SLOGI shared files delete member" on storage.objects for delete to authenticated using (
  bucket_id='slogi-files' and (storage.foldername(name))[1]='workspace'
  and (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and public.slogi_has_active_password_gate_grant(((storage.foldername(name))[2])::uuid)
  and exists (select 1 from public.slogi_shared_workspace_members as member
    where member.user_id=auth.uid() and member.workspace_id=((storage.foldername(name))[2])::uuid)
);

-- Forward-deprecate invitations without dropping history or existing memberships/state.
update public.slogi_shared_workspace_invites
set revoked_at = coalesce(revoked_at, statement_timestamp())
where revoked_at is null;
revoke execute on function public.slogi_create_shared_workspace_invite(uuid, text, timestamptz, integer) from service_role;
revoke execute on function public.slogi_accept_shared_workspace_invite(uuid, text) from service_role;
revoke execute on function public.slogi_revoke_shared_workspace_invite(uuid, uuid) from service_role;
revoke execute on function public.slogi_join_shared_workspace_member(text, uuid) from service_role;
revoke execute on function public.slogi_create_shared_workspace(text) from service_role;
comment on table public.slogi_shared_workspace_invites is 'Deprecated v76.1.5 history; all active rows were forward-revoked by v76.1.7.';
comment on table public.slogi_password_gate_config is 'Server-only singleton access-gate configuration. Seeded explicitly during activation.';
comment on table public.slogi_password_gate_grants is 'Server-only signed device-grant metadata; only token digests are persisted.';
