# SLOGI v76.1.9 — Password gate project-host transport hotfix

Base: exact released v76.1.8 target `562c01c0678956eaf083bc57f9ec40d632d4f6ed`.

## Исправление

Развёрнутый v76.1.8 `password-gate` version 2 с exact source SHA-256
`b8ac82ea647c0b2dced7ac14fe5ea6f54800de562ad35eac84a2fb315dd917ae`
по production evidence по-прежнему возвращал `400 secure_transport_required` до чтения password.
Hosted runtime представлял внутренний HTTP request с публичным project host вида
`<project-ref>.supabase.co`, тогда как v76.1.8 разрешал только
`edge-runtime.supabase.com`.

v76.1.9 получает expected project host только из server-only `SUPABASE_URL` и
принимает внутренний HTTP hop как внешний HTTPS только если одновременно:

- `SUPABASE_URL` — чистый HTTPS origin с одним project subdomain `*.supabase.co`;
- request URL host, `host` и `x-forwarded-host` совпадают без port или неоднозначных значений;
- совпавший host равен exact configured project host либо документированному hosted
  variant `edge-runtime.supabase.com`;
- `x-forwarded-proto` содержит один token `https`;
- `x-forwarded-port` содержит одно значение `443`.

Missing/malformed environment, другой project subdomain, произвольный Supabase host,
unknown/spoofed или mismatched hosts, multiple/comma proto/port и direct plain HTTP
отклоняются. Direct HTTPS остаётся авторитетным; прежнее loopback-исключение для
`localhost`/`127.0.0.1` сохранено только для локальной разработки.

## Не изменено

- password, PBKDF2/KDF parameters и constant-time proof;
- challenge, signed grant, expiry/revoke/version и replay binding;
- rate-limit/cooldown;
- RLS, Storage и CAS enforcement;
- database migrations;
- Cian/Browserless/provider budgets, imports, schedules и activation manifests;
- frontend gate, map/clusters и compact design.

Production Supabase, Edge, Auth, secrets, Vault, database и schedules этим release
flow не изменяются.
