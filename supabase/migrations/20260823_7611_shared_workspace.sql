-- v76.1.0 forward-only shared workspace schema.
-- Workspace access is granted to authenticated anonymous Supabase users only
-- after a server-side code verification step. Raw workspace codes are never
-- stored in PostgreSQL.

create table public.slogi_shared_workspaces (
  id uuid not null default gen_random_uuid(),
  code_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  disabled_at timestamptz null,
  constraint slogi_shared_workspaces_pkey primary key (id),
  constraint slogi_shared_workspaces_code_hash_key unique (code_hash),
  constraint slogi_shared_workspaces_code_hash_check check (code_hash ~ '^[0-9a-f]{64}$')
);

create table public.slogi_shared_workspace_members (
  workspace_id uuid not null,
  user_id uuid not null,
  joined_at timestamptz not null default now(),
  constraint slogi_shared_workspace_members_pkey primary key (workspace_id, user_id),
  constraint slogi_shared_workspace_members_user_key unique (user_id),
  constraint slogi_shared_workspace_members_workspace_fkey
    foreign key (workspace_id) references public.slogi_shared_workspaces(id) on delete cascade,
  constraint slogi_shared_workspace_members_user_fkey
    foreign key (user_id) references auth.users(id) on delete cascade
);

create table public.slogi_shared_workspace_state (
  workspace_id uuid not null,
  state jsonb not null default '{}'::jsonb,
  revision bigint not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid null,
  constraint slogi_shared_workspace_state_pkey primary key (workspace_id),
  constraint slogi_shared_workspace_state_workspace_fkey
    foreign key (workspace_id) references public.slogi_shared_workspaces(id) on delete cascade,
  constraint slogi_shared_workspace_state_updated_by_fkey
    foreign key (updated_by) references auth.users(id) on delete set null,
  constraint slogi_shared_workspace_state_object_check check (jsonb_typeof(state) = 'object'),
  constraint slogi_shared_workspace_state_revision_check check (revision >= 0)
);

create table public.slogi_shared_workspace_attachments (
  workspace_id uuid not null,
  location_id text not null,
  attachment_type text not null,
  file_name text not null,
  mime_type text not null,
  storage_path text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid not null,
  constraint slogi_shared_workspace_attachments_pkey
    primary key (workspace_id, location_id, attachment_type),
  constraint slogi_shared_workspace_attachments_storage_path_key unique (storage_path),
  constraint slogi_shared_workspace_attachments_workspace_fkey
    foreign key (workspace_id) references public.slogi_shared_workspaces(id) on delete cascade,
  constraint slogi_shared_workspace_attachments_updated_by_fkey
    foreign key (updated_by) references auth.users(id) on delete cascade,
  constraint slogi_shared_workspace_attachments_location_check
    check (length(btrim(location_id)) between 1 and 200),
  constraint slogi_shared_workspace_attachments_type_check
    check (length(btrim(attachment_type)) between 1 and 100),
  constraint slogi_shared_workspace_attachments_path_check
    check (storage_path ~ '^workspace/[0-9a-f-]{36}/')
);

create index slogi_shared_workspace_members_user_idx
  on public.slogi_shared_workspace_members using btree (user_id);
create index slogi_shared_workspace_state_updated_idx
  on public.slogi_shared_workspace_state using btree (updated_at desc);
create index slogi_shared_workspace_attachments_location_idx
  on public.slogi_shared_workspace_attachments using btree (workspace_id, location_id);

alter table public.slogi_shared_workspaces owner to postgres;
alter table public.slogi_shared_workspace_members owner to postgres;
alter table public.slogi_shared_workspace_state owner to postgres;
alter table public.slogi_shared_workspace_attachments owner to postgres;

alter table public.slogi_shared_workspaces enable row level security;
alter table public.slogi_shared_workspace_members enable row level security;
alter table public.slogi_shared_workspace_state enable row level security;
alter table public.slogi_shared_workspace_attachments enable row level security;
alter table public.slogi_shared_workspaces no force row level security;
alter table public.slogi_shared_workspace_members no force row level security;
alter table public.slogi_shared_workspace_state no force row level security;
alter table public.slogi_shared_workspace_attachments no force row level security;

create policy "SLOGI shared members select own"
on public.slogi_shared_workspace_members
for select to authenticated
using ((select auth.uid()) = user_id);

create policy "SLOGI shared state select member"
on public.slogi_shared_workspace_state
for select to authenticated
using (exists (
  select 1
  from public.slogi_shared_workspace_members as member
  where member.workspace_id = slogi_shared_workspace_state.workspace_id
    and member.user_id = (select auth.uid())
));

create policy "SLOGI shared attachments select member"
on public.slogi_shared_workspace_attachments
for select to authenticated
using (exists (
  select 1 from public.slogi_shared_workspace_members as member
  where member.workspace_id = slogi_shared_workspace_attachments.workspace_id
    and member.user_id = (select auth.uid())
));

create policy "SLOGI shared attachments insert member"
on public.slogi_shared_workspace_attachments
for insert to authenticated
with check (
  updated_by = (select auth.uid())
  and exists (
    select 1 from public.slogi_shared_workspace_members as member
    where member.workspace_id = slogi_shared_workspace_attachments.workspace_id
      and member.user_id = (select auth.uid())
  )
);

create policy "SLOGI shared attachments update member"
on public.slogi_shared_workspace_attachments
for update to authenticated
using (exists (
  select 1 from public.slogi_shared_workspace_members as member
  where member.workspace_id = slogi_shared_workspace_attachments.workspace_id
    and member.user_id = (select auth.uid())
))
with check (
  updated_by = (select auth.uid())
  and exists (
    select 1 from public.slogi_shared_workspace_members as member
    where member.workspace_id = slogi_shared_workspace_attachments.workspace_id
      and member.user_id = (select auth.uid())
  )
);

create policy "SLOGI shared attachments delete member"
on public.slogi_shared_workspace_attachments
for delete to authenticated
using (exists (
  select 1 from public.slogi_shared_workspace_members as member
  where member.workspace_id = slogi_shared_workspace_attachments.workspace_id
    and member.user_id = (select auth.uid())
));

revoke all on public.slogi_shared_workspaces from public, anon, authenticated, service_role;
revoke all on public.slogi_shared_workspace_members from public, anon, authenticated, service_role;
revoke all on public.slogi_shared_workspace_state from public, anon, authenticated, service_role;
revoke all on public.slogi_shared_workspace_attachments from public, anon, authenticated, service_role;

grant select on public.slogi_shared_workspace_members to authenticated;
grant select on public.slogi_shared_workspace_state to authenticated;
grant select, insert, update, delete on public.slogi_shared_workspace_attachments to authenticated;
grant select, insert, update, delete on public.slogi_shared_workspaces to service_role;
grant select, insert, update, delete on public.slogi_shared_workspace_members to service_role;
grant select, insert, update, delete on public.slogi_shared_workspace_state to service_role;
grant select, insert, update, delete on public.slogi_shared_workspace_attachments to service_role;

create or replace function public.slogi_create_shared_workspace(p_code_hash text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_workspace_id uuid;
begin
  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'invalid_workspace_code_hash';
  end if;
  insert into public.slogi_shared_workspaces (code_hash)
  values (p_code_hash)
  returning id into v_workspace_id;
  insert into public.slogi_shared_workspace_state (workspace_id, state)
  values (v_workspace_id, '{"locations":[],"workspace":{}}'::jsonb);
  return v_workspace_id;
end;
$$;

create or replace function public.slogi_join_shared_workspace_member(p_code_hash text, p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_workspace_id uuid;
begin
  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' or p_user_id is null then
    raise exception using errcode = 'P0001', message = 'workspace_not_available';
  end if;
  select workspace.id into v_workspace_id
  from public.slogi_shared_workspaces as workspace
  where workspace.code_hash = p_code_hash and workspace.disabled_at is null;
  if v_workspace_id is null then
    raise exception using errcode = 'P0001', message = 'workspace_not_available';
  end if;
  insert into public.slogi_shared_workspace_members (workspace_id, user_id)
  values (v_workspace_id, p_user_id)
  on conflict (user_id) do update
    set workspace_id = excluded.workspace_id, joined_at = now();
  return v_workspace_id;
end;
$$;

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
    raise exception using errcode = '40001', message = 'workspace_revision_conflict';
  end if;
end;
$$;

alter function public.slogi_create_shared_workspace(text) owner to postgres;
alter function public.slogi_join_shared_workspace_member(text, uuid) owner to postgres;
alter function public.slogi_update_shared_workspace_state(uuid, bigint, jsonb) owner to postgres;
revoke all on function public.slogi_create_shared_workspace(text) from public, anon, authenticated, service_role;
revoke all on function public.slogi_join_shared_workspace_member(text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.slogi_update_shared_workspace_state(uuid, bigint, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.slogi_create_shared_workspace(text) to service_role;
grant execute on function public.slogi_join_shared_workspace_member(text, uuid) to service_role;
grant execute on function public.slogi_update_shared_workspace_state(uuid, bigint, jsonb) to authenticated;

-- Existing storage bucket remains unchanged. Workspace objects use the path
-- workspace/<workspace-uuid>/<location-id>/<attachment-type>.
create policy "SLOGI shared files select member"
on storage.objects
for select to authenticated
using (
  bucket_id = 'slogi-files'
  and (storage.foldername(name))[1] = 'workspace'
  and exists (
    select 1 from public.slogi_shared_workspace_members as member
    where member.user_id = (select auth.uid())
      and member.workspace_id = case
        when (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then ((storage.foldername(name))[2])::uuid else null end
  )
);

create policy "SLOGI shared files insert member"
on storage.objects
for insert to authenticated
with check (
  bucket_id = 'slogi-files'
  and (storage.foldername(name))[1] = 'workspace'
  and exists (
    select 1 from public.slogi_shared_workspace_members as member
    where member.user_id = (select auth.uid())
      and member.workspace_id = case
        when (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then ((storage.foldername(name))[2])::uuid else null end
  )
);

create policy "SLOGI shared files update member"
on storage.objects
for update to authenticated
using (
  bucket_id = 'slogi-files'
  and (storage.foldername(name))[1] = 'workspace'
  and exists (
    select 1 from public.slogi_shared_workspace_members as member
    where member.user_id = (select auth.uid())
      and member.workspace_id = case
        when (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then ((storage.foldername(name))[2])::uuid else null end
  )
)
with check (
  bucket_id = 'slogi-files'
  and (storage.foldername(name))[1] = 'workspace'
  and exists (
    select 1 from public.slogi_shared_workspace_members as member
    where member.user_id = (select auth.uid())
      and member.workspace_id = case
        when (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then ((storage.foldername(name))[2])::uuid else null end
  )
);

create policy "SLOGI shared files delete member"
on storage.objects
for delete to authenticated
using (
  bucket_id = 'slogi-files'
  and (storage.foldername(name))[1] = 'workspace'
  and exists (
    select 1 from public.slogi_shared_workspace_members as member
    where member.user_id = (select auth.uid())
      and member.workspace_id = case
        when (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then ((storage.foldername(name))[2])::uuid else null end
  )
);
