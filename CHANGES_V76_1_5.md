# SLOGI v76.1.5 — Invite Links Hotfix

Status: released on GitHub. Production activation is not authorized by this document.

## Product change

- ручной ввод workspace code полностью удалён из frontend;
- новый пользователь подключается по `#invite=...`, fragment удаляется до Auth/Edge requests;
- без membership/invite показывается «Нужна ссылка-приглашение»;
- действующий member явно создаёт ссылку «Пригласить коллегу», видит expiry и может отозвать её до закрытия dialog;
- existing anonymous session/membership по-прежнему подключается автоматически, без личного кабинета.

## Security change

- forward migration: `supabase/migrations/20260827_7615_workspace_invites.sql`;
- raw 256-bit token никогда не сохраняется; DB содержит только HMAC-SHA-256;
- TTL 7 суток, max uses 5, atomic `FOR UPDATE`, expiry/revoke/exhaustion/idempotency guards;
- invite table: RLS enabled, policies 0, direct public/anon/authenticated/service-role table grants 0;
- privileged RPC: owner postgres, `SECURITY DEFINER`, fixed `search_path`, execute only service_role;
- Edge requires real anonymous JWT and returns only generic safe errors;
- legacy code Edge returns 410, legacy join RPC недоступен service_role после migration.

## Preserved contracts

Shared state, existing memberships, manual/Cian objects, Storage RLS, CAS/PT409, parser, map and listing-provider code are unchanged. Browserless/direct Cian/refresh/hydrate/import were not called during this local candidate work.
