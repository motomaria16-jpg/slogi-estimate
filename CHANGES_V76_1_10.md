# SLOGI v76.1.10 — Password gate proxy tuple transport hotfix

Base: exact released v76.1.9 target
`06e2280a9ad9e89d6fa8bac89dba3597b409e758`.

## Исправление

Переданный production evidence для `password-gate` version 3 с exact source
SHA-256 `f0deec0f61341cdd1b0d72d777e8b67d79947ccd1dc34bf15765d371d8090ca8`
содержит два POST результата `400 secure_transport_required`. Cleanup завершён
успешно, а 11/11 разрешённых fingerprints остались неизменными. Release flow не
повторяет production-запросы и не раскрывает project identifiers, password или
secret values.

v76.1.10 сохраняет строгую привязку внутреннего HTTP proxy hop к валидному
server-only `SUPABASE_URL`. Request URL host обязателен. Каждый присутствующий
host surface — URL host, `Host`, `X-Forwarded-Host` — проверяется независимо по
одному allowlist:

- exact configured project host из `SUPABASE_URL`;
- exact documented hosted variant `edge-runtime.supabase.com`.

Разрешённые surfaces не обязаны совпадать между собой, поэтому hosted mixed
project/proxy tuple принимается. Пустой, multiple/comma, malformed, другой
project или произвольный host отклоняется.

`X-Forwarded-Proto` остаётся обязательным single HTTPS signal.
`X-Forwarded-Port` теперь optional; если он присутствует, допустимо только одно
точное значение `443`. Значения `80`, multiple/comma, empty и malformed
отклоняются. Direct HTTPS и отдельное loopback development exception сохранены.

## Не изменено

- password, PBKDF2/KDF и constant-time verification;
- challenge/grant, expiry/revoke/version/replay binding и rate limits;
- RLS, Storage, CAS и database migrations;
- Cian, Browserless, imports, provider budgets и schedules;
- frontend password flow, workspace, map/clusters и design.

Production Supabase, Edge, Auth, secrets, Vault, database и schedules этим
release flow не изменяются.
