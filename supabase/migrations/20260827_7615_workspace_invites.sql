-- v76.1.5 forward-only workspace invite links.
-- Raw invite tokens are generated and handled only by Edge/browser memory.
-- PostgreSQL stores only a keyed HMAC-SHA-256 digest produced by Edge.

create table public.slogi_shared_workspace_invites (
  id uuid not null default gen_random_uuid(),
  workspace_id uuid not null,
  token_hash text not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  max_uses smallint not null default 5,
  use_count smallint not null default 0,
  last_used_at timestamptz null,
  revoked_at timestamptz null,
  constraint slogi_shared_workspace_invites_pkey primary key (id),
  constraint slogi_shared_workspace_invites_token_hash_key unique (token_hash),
  constraint slogi_shared_workspace_invites_workspace_fkey
    foreign key (workspace_id) references public.slogi_shared_workspaces(id) on delete cascade,
  constraint slogi_shared_workspace_invites_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete cascade,
  constraint slogi_shared_workspace_invites_token_hash_check
    check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint slogi_shared_workspace_invites_expiry_check
    check (expires_at > created_at),
  constraint slogi_shared_workspace_invites_max_uses_check
    check (max_uses between 1 and 5),
  constraint slogi_shared_workspace_invites_use_count_check
    check (use_count between 0 and max_uses)
);

create index slogi_shared_workspace_invites_workspace_idx
  on public.slogi_shared_workspace_invites (workspace_id, created_at desc);
create index slogi_shared_workspace_invites_expiry_idx
  on public.slogi_shared_workspace_invites (expires_at)
  where revoked_at is null;

alter table public.slogi_shared_workspace_invites owner to postgres;
alter table public.slogi_shared_workspace_invites enable row level security;
alter table public.slogi_shared_workspace_invites no force row level security;

-- There are intentionally no RLS policies and no direct client/table grants.
revoke all on public.slogi_shared_workspace_invites
  from public, anon, authenticated, service_role;

create or replace function public.slogi_create_shared_workspace_invite(
  p_user_id uuid,
  p_token_hash text,
  p_expires_at timestamptz,
  p_max_uses integer default 5
)
returns table (invite_id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_workspace_id uuid;
begin
  if p_user_id is null
     or p_token_hash is null
     or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_expires_at is null
     or p_expires_at <= statement_timestamp() + interval '5 minutes'
     or p_expires_at > statement_timestamp() + interval '7 days'
     or p_max_uses is null
     or p_max_uses < 1
     or p_max_uses > 5 then
    raise exception using errcode = 'P0001', message = 'invite_not_available';
  end if;

  if not exists (
    select 1
    from auth.users as auth_user
    where auth_user.id = p_user_id
      and auth_user.is_anonymous is true
      and auth_user.deleted_at is null
  ) then
    raise exception using errcode = 'P0001', message = 'invite_not_available';
  end if;

  select member.workspace_id into v_workspace_id
  from public.slogi_shared_workspace_members as member
  join public.slogi_shared_workspaces as workspace on workspace.id = member.workspace_id
  where member.user_id = p_user_id
    and workspace.disabled_at is null;

  if v_workspace_id is null then
    raise exception using errcode = 'P0001', message = 'invite_not_available';
  end if;

  return query
  insert into public.slogi_shared_workspace_invites (
    workspace_id, token_hash, created_by, expires_at, max_uses
  ) values (
    v_workspace_id, p_token_hash, p_user_id, p_expires_at, p_max_uses::smallint
  )
  returning id, slogi_shared_workspace_invites.expires_at;
end;
$$;

create or replace function public.slogi_accept_shared_workspace_invite(
  p_user_id uuid,
  p_token_hash text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_invite public.slogi_shared_workspace_invites%rowtype;
  v_existing_workspace_id uuid;
begin
  if p_user_id is null or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'P0001', message = 'invite_not_available';
  end if;

  if not exists (
    select 1
    from auth.users as auth_user
    where auth_user.id = p_user_id
      and auth_user.is_anonymous is true
      and auth_user.deleted_at is null
  ) then
    raise exception using errcode = 'P0001', message = 'invite_not_available';
  end if;

  select invite.* into v_invite
  from public.slogi_shared_workspace_invites as invite
  join public.slogi_shared_workspaces as workspace on workspace.id = invite.workspace_id
  where invite.token_hash = p_token_hash
    and workspace.disabled_at is null
  for update of invite;

  if not found
     or v_invite.revoked_at is not null
     or v_invite.expires_at <= statement_timestamp() then
    raise exception using errcode = 'P0001', message = 'invite_not_available';
  end if;

  select member.workspace_id into v_existing_workspace_id
  from public.slogi_shared_workspace_members as member
  where member.user_id = p_user_id;

  if v_existing_workspace_id is not null then
    if v_existing_workspace_id = v_invite.workspace_id then
      return true;
    end if;
    raise exception using errcode = 'P0001', message = 'invite_not_available';
  end if;

  if v_invite.use_count >= v_invite.max_uses then
    raise exception using errcode = 'P0001', message = 'invite_not_available';
  end if;

  insert into public.slogi_shared_workspace_members (workspace_id, user_id)
  values (v_invite.workspace_id, p_user_id);

  update public.slogi_shared_workspace_invites as invite
  set use_count = invite.use_count + 1,
      last_used_at = statement_timestamp()
  where invite.id = v_invite.id;

  return true;
exception
  when unique_violation then
    raise exception using errcode = 'P0001', message = 'invite_not_available';
end;
$$;

create or replace function public.slogi_revoke_shared_workspace_invite(
  p_user_id uuid,
  p_invite_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_invite public.slogi_shared_workspace_invites%rowtype;
begin
  if p_user_id is null or p_invite_id is null then
    raise exception using errcode = 'P0001', message = 'invite_not_available';
  end if;

  select invite.* into v_invite
  from public.slogi_shared_workspace_invites as invite
  where invite.id = p_invite_id
  for update;

  if not found
     or v_invite.created_by <> p_user_id
     or not exists (
       select 1 from public.slogi_shared_workspace_members as member
       where member.workspace_id = v_invite.workspace_id
         and member.user_id = p_user_id
     ) then
    raise exception using errcode = 'P0001', message = 'invite_not_available';
  end if;

  if v_invite.revoked_at is null then
    update public.slogi_shared_workspace_invites
    set revoked_at = statement_timestamp()
    where id = v_invite.id;
  end if;
  return true;
end;
$$;

alter function public.slogi_create_shared_workspace_invite(uuid, text, timestamptz, integer) owner to postgres;
alter function public.slogi_accept_shared_workspace_invite(uuid, text) owner to postgres;
alter function public.slogi_revoke_shared_workspace_invite(uuid, uuid) owner to postgres;

revoke all on function public.slogi_create_shared_workspace_invite(uuid, text, timestamptz, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.slogi_accept_shared_workspace_invite(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.slogi_revoke_shared_workspace_invite(uuid, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.slogi_create_shared_workspace_invite(uuid, text, timestamptz, integer)
  to service_role;
grant execute on function public.slogi_accept_shared_workspace_invite(uuid, text)
  to service_role;
grant execute on function public.slogi_revoke_shared_workspace_invite(uuid, uuid)
  to service_role;

-- The legacy raw-code join RPC is disabled only in this rollout migration.
-- Existing memberships and shared state are unaffected.
revoke execute on function public.slogi_join_shared_workspace_member(text, uuid)
  from service_role;

comment on table public.slogi_shared_workspace_invites is
  'Server-only v76.1.5 invite metadata. Raw tokens are never persisted.';
comment on function public.slogi_create_shared_workspace_invite(uuid, text, timestamptz, integer) is
  'Creates a seven-day, at-most-five-use invite for an existing anonymous member.';
comment on function public.slogi_accept_shared_workspace_invite(uuid, text) is
  'Atomically validates and consumes an invite for a real anonymous Auth user.';
comment on function public.slogi_revoke_shared_workspace_invite(uuid, uuid) is
  'Revokes an invite only for its still-current member creator.';
