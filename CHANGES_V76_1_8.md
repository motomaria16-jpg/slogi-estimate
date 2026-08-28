# SLOGI v76.1.8 — Password gate secure transport hotfix

Base: exact released v76.1.7 target `234053ef96bae917bb40372b9d4cc1d41eec78a3`.

## Исправление

Production HTTPS request к опубликованному `password-gate` мог быть представлен Edge runtime как внутренний HTTP URL за Supabase reverse proxy. Проверка v76.1.7 смотрела только на protocol внутреннего URL и возвращала `secure_transport_required` до чтения password body.

v76.1.8 сохраняет direct HTTPS авторитетным и принимает внутренний HTTP URL только при полном trusted proxy contract:

- `x-forwarded-proto` содержит ровно один token `https`;
- внешний host совпадает с hostname platform-managed `SUPABASE_URL`;
- hostname — одиночный project subdomain `*.supabase.co`;
- malformed, conflicting, multiple или чужие forwarded values отклоняются;
- прямой plain HTTP остаётся запрещён, кроме прежнего localhost/127.0.0.1 test path.

## Не изменено

- password, PBKDF2/KDF parameters и constant-time proof;
- challenge, signed grant, expiry/revoke/version и replay binding;
- rate-limit/cooldown;
- RLS, Storage и CAS enforcement;
- database migrations;
- Cian/Browserless/provider budgets, imports, schedules и activation manifests;
- frontend gate, map/clusters и compact design.

Production Supabase, Edge, Auth, secrets, Vault и schedules этим релизным flow не изменяются.
