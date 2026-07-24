-- SLOGI: облачная синхронизация адресов, паспортов, смет, КП и файлов.
-- Выполните этот файл целиком в Supabase: SQL Editor -> New query -> Run.

begin;

create table if not exists public.slogi_user_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  locations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.slogi_attachments (
  user_id uuid not null references auth.users(id) on delete cascade,
  location_id text not null,
  attachment_type text not null,
  file_name text not null default 'Файл',
  mime_type text not null default 'application/octet-stream',
  storage_path text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, location_id, attachment_type)
);

alter table public.slogi_user_state enable row level security;
alter table public.slogi_attachments enable row level security;

-- Повторный запуск скрипта безопасен.
drop policy if exists "SLOGI state select own" on public.slogi_user_state;
drop policy if exists "SLOGI state insert own" on public.slogi_user_state;
drop policy if exists "SLOGI state update own" on public.slogi_user_state;
drop policy if exists "SLOGI state delete own" on public.slogi_user_state;

create policy "SLOGI state select own"
on public.slogi_user_state for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "SLOGI state insert own"
on public.slogi_user_state for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "SLOGI state update own"
on public.slogi_user_state for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "SLOGI state delete own"
on public.slogi_user_state for delete
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "SLOGI attachments select own" on public.slogi_attachments;
drop policy if exists "SLOGI attachments insert own" on public.slogi_attachments;
drop policy if exists "SLOGI attachments update own" on public.slogi_attachments;
drop policy if exists "SLOGI attachments delete own" on public.slogi_attachments;

create policy "SLOGI attachments select own"
on public.slogi_attachments for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "SLOGI attachments insert own"
on public.slogi_attachments for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "SLOGI attachments update own"
on public.slogi_attachments for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "SLOGI attachments delete own"
on public.slogi_attachments for delete
to authenticated
using ((select auth.uid()) = user_id);

-- Права для Data API. Доступ дополнительно ограничивается RLS-политиками выше.
revoke all on public.slogi_user_state from anon;
revoke all on public.slogi_attachments from anon;
grant select, insert, update, delete on public.slogi_user_state to authenticated;
grant select, insert, update, delete on public.slogi_attachments to authenticated;
grant all on public.slogi_user_state to service_role;
grant all on public.slogi_attachments to service_role;

-- Закрытое хранилище файлов, максимум 50 МБ на один файл.
insert into storage.buckets (id, name, public, file_size_limit)
values ('slogi-files', 'slogi-files', false, 52428800)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

drop policy if exists "SLOGI files select own" on storage.objects;
drop policy if exists "SLOGI files insert own" on storage.objects;
drop policy if exists "SLOGI files update own" on storage.objects;
drop policy if exists "SLOGI files delete own" on storage.objects;

create policy "SLOGI files select own"
on storage.objects for select
to authenticated
using (
  bucket_id = 'slogi-files'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

create policy "SLOGI files insert own"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'slogi-files'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

create policy "SLOGI files update own"
on storage.objects for update
to authenticated
using (
  bucket_id = 'slogi-files'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
)
with check (
  bucket_id = 'slogi-files'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

create policy "SLOGI files delete own"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'slogi-files'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

commit;
