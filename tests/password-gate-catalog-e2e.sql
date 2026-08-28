\set ON_ERROR_STOP on

begin;

insert into auth.users (id, aud, role, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_anonymous)
values
  ('11111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', '{}', '{}', now(), now(), true),
  ('22222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', '{}', '{}', now(), now(), true);

insert into public.slogi_shared_workspaces (id, code_hash)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', repeat('a', 64));
insert into public.slogi_shared_workspace_state (workspace_id, state)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '{"fixture":true}');
insert into public.slogi_shared_workspace_members (workspace_id, user_id)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111');
insert into public.slogi_password_gate_config (
  singleton, canonical_workspace_id, enabled, grant_version, grant_ttl_seconds
) values (true, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true, 1, 86400);
insert into public.slogi_password_gate_grants (
  id, user_id, workspace_id, token_hash, grant_version, issued_at, expires_at
) values (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  encode(extensions.digest('fixture-device-grant', 'sha256'), 'hex'),
  1, statement_timestamp(), statement_timestamp() + interval '1 hour'
);
insert into storage.objects (bucket_id, name, owner)
values (
  'slogi-files',
  'workspace/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/fixture/source',
  '11111111-1111-4111-8111-111111111111'
);

do $$
begin
  if has_table_privilege('anon', 'public.slogi_password_gate_config', 'select')
     or has_table_privilege('authenticated', 'public.slogi_password_gate_grants', 'select')
     or has_table_privilege('service_role', 'public.slogi_password_gate_challenges', 'select') then
    raise exception 'server-only gate tables expose direct privileges';
  end if;
  if has_function_privilege('service_role', 'public.slogi_accept_shared_workspace_invite(uuid,text)', 'execute')
     or has_function_privilege('service_role', 'public.slogi_create_shared_workspace_invite(uuid,text,timestamptz,integer)', 'execute')
     or has_function_privilege('service_role', 'public.slogi_join_shared_workspace_member(text,uuid)', 'execute') then
    raise exception 'deprecated join surface remains executable';
  end if;
  if to_regclass('public.slogi_shared_workspace_invites') is null
     or obj_description('public.slogi_shared_workspace_invites'::regclass) not like 'Deprecated v76.1.5 history%' then
    raise exception 'invite history was not retained and marked deprecated';
  end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select set_config('request.headers', '{}', true);

do $$
begin
  if (select count(*) from public.slogi_shared_workspace_members) <> 0
     or (select count(*) from public.slogi_shared_workspace_state) <> 0
     or (select count(*) from storage.objects where bucket_id = 'slogi-files') <> 0 then
    raise exception 'workspace data bypassed the missing device grant';
  end if;
  begin
    perform public.slogi_update_shared_workspace_state(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 0, '{"bypass":true}'::jsonb
    );
    raise exception 'CAS bypassed the missing device grant';
  exception when sqlstate 'PT401' then null;
  end;
end;
$$;

select set_config('request.headers', '{"x-slogi-device-grant":"fixture-device-grant"}', true);
do $$
begin
  if (select count(*) from public.slogi_shared_workspace_members) <> 1
     or (select count(*) from public.slogi_shared_workspace_state) <> 1
     or (select count(*) from storage.objects where bucket_id = 'slogi-files') <> 1 then
    raise exception 'valid device grant did not unlock the canonical workspace';
  end if;
  perform public.slogi_update_shared_workspace_state(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 0, '{"cas":true}'::jsonb
  );
  if (select revision from public.slogi_shared_workspace_state) <> 1 then
    raise exception 'CAS revision contract changed';
  end if;
end;
$$;

select set_config('request.headers', '{"x-slogi-device-grant":"fixture-device-tamper"}', true);
do $$
begin
  if (select count(*) from public.slogi_shared_workspace_state) <> 0
     or (select count(*) from storage.objects where bucket_id = 'slogi-files') <> 0 then
    raise exception 'tampered grant reached workspace data';
  end if;
end;
$$;

reset role;
update public.slogi_password_gate_grants
set issued_at = statement_timestamp() - interval '2 hours',
    expires_at = statement_timestamp() - interval '1 hour'
where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select set_config('request.headers', '{"x-slogi-device-grant":"fixture-device-grant"}', true);
do $$
begin
  if (select count(*) from public.slogi_shared_workspace_state) <> 0
     or (select count(*) from storage.objects where bucket_id = 'slogi-files') <> 0 then
    raise exception 'expired grant reached workspace data';
  end if;
  begin
    perform public.slogi_update_shared_workspace_state(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 1, '{"expired":true}'::jsonb
    );
    raise exception 'expired grant reached CAS';
  exception when sqlstate 'PT401' then null;
  end;
end;
$$;

reset role;
update public.slogi_password_gate_grants
set issued_at = statement_timestamp(),
    expires_at = statement_timestamp() + interval '1 hour',
    revoked_at = statement_timestamp()
where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select set_config('request.headers', '{"x-slogi-device-grant":"fixture-device-grant"}', true);
do $$
begin
  if (select count(*) from public.slogi_shared_workspace_state) <> 0 then
    raise exception 'revoked grant reached workspace data';
  end if;
end;
$$;

reset role;
update public.slogi_password_gate_grants
set revoked_at = null, grant_version = 1, expires_at = statement_timestamp() + interval '1 hour'
where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
update public.slogi_password_gate_config set grant_version = 2 where singleton;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select set_config('request.headers', '{"x-slogi-device-grant":"fixture-device-grant"}', true);
do $$
begin
  if (select count(*) from public.slogi_shared_workspace_state) <> 0 then
    raise exception 'old grant version reached workspace data';
  end if;
end;
$$;

reset role;
update public.slogi_password_gate_config set grant_version = 1 where singleton;
select public.slogi_issue_password_gate_grant(
  '22222222-2222-4222-8222-222222222222',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  encode(extensions.digest('second-fixture-grant', 'sha256'), 'hex'),
  statement_timestamp() + interval '1 hour',
  1
);
do $$
begin
  if (select count(*) from public.slogi_shared_workspace_members
      where user_id = '22222222-2222-4222-8222-222222222222') <> 1
     or (select workspace_id from public.slogi_shared_workspace_members
      where user_id = '22222222-2222-4222-8222-222222222222')
        <> 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid then
    raise exception 'grant issue did not auto-join exactly one canonical workspace';
  end if;
end;
$$;

rollback;
select 'password_gate_catalog_e2e_ok' as result;
