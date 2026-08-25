# SLOGI v76.1.4 — Soft-Delete after CAS Smoke

Status: RELEASE GATE PASS. Production, Browserless, Cian/Avito endpoints, Edge deployment, Auth settings, secrets, Vault and cron were not accessed or changed.

## Root cause and regression proof

После одного stale CAS (`PT409`) клиент корректно применял remote winner. При последующем reload UI мог отрисовать cached object до завершения начального workspace REST-read. Если пользователь выполнял soft-delete в этом окне, patched `Storage.setItem` ставил `pendingPush`, но прежний `initialize()` затем применял remote snapshot при `ready=false`, перезаписывал локальные `locations + trash` и не выполнял CAS.

Новый regression test использует Promise barriers: remote state-read намеренно удерживается, soft-delete выполняется наблюдаемым доменным API, затем чтение освобождается. До исправления тест завершался `rpcCalls: 0`, то есть доказывал отсутствие CAS. После исправления выполняется один CAS с ожидаемой revision; состояние содержит один `deletedAt` object и один trash item.

Отдельный test доказывает, что при отличающемся remote winner автоматическая перезапись запрещена: CAS не выполняется, winner применяется, локальное удаление сохраняется в conflict draft.

## Clean local Supabase 17

- environment: `isolated-local-supabase-postgresql-17`;
- Supabase CLI: `2.115.0` stable;
- PostgreSQL: `17.6`;
- initial clean start: PASS;
- first `db reset --local`: PASS;
- second `db reset --local`: PASS;
- applied history: `20260814`, `20260821`, `20260823`, `20260824` exactly once each;
- catalog: 12 SLOGI tables, 128 columns, 49 constraints, 33 indexes, 18 public SLOGI policies, RLS enabled on 12 tables;
- CAS function: owner `postgres`, `SECURITY DEFINER`, `search_path = pg_catalog, public`, `PT409` present, `40001` absent, EXECUTE ACL only `postgres` and `authenticated`;
- Storage: private `slogi-files`, 50 MiB limit;
- temporary containers, project directory and listeners: removed.

No migration was added or edited for v76.1.4.

## Automated tests

| Check | Result |
|---|---:|
| Cian/release + workspace test suite | 43 PASS / 0 FAIL |
| New initialization-race tests | 2 PASS / 0 FAIL |
| Frontend JavaScript parse | 24/24 PASS |
| Edge TypeScript loading | 6/6 PASS |
| Root HTML + CSS local references | 233 checked / 0 missing |
| `git diff --check` | PASS |
| Secret scan tracked/untracked/ignored | 302/0/0 files, 0 findings |
| Direct literal fetch to Cian/Avito | 0 |
| Avito runtime | 0 |
| Ozon runtime | 0 |

## Two-context browser integration

The browser harness used two independent temporary Chromium contexts: desktop `1440×900` and mobile `390×844`. All traffic was restricted to localhost. The map transport was a local deterministic API mock; canonical product geometry and UI handlers were unchanged.

| Checkpoint | Result |
|---|---:|
| authA / authB distinct anonymous sessions | PASS |
| outsider RLS for workspace state/attachments | PASS |
| joinA / joinB with synthetic local workspace code | PASS |
| one recent synthetic Cian fixture row | PASS |
| canonical map polygons / markers | 58 / 1 |
| add object and remote CAS | PASS |
| controlled stale writer | exactly one HTTP 409 / `PT409` |
| retry flood | absent |
| cross-device visibility | PASS |
| exact object drawer + `Принять решение` | PASS |
| soft-delete remote state | locations/deleted/trash = 1/1/1 |
| reload/no resurrection before purge | PASS |
| address-specific permanent purge | locations/deleted/trash = 0/0/0 |
| final reload in both contexts | PASS |
| unexpected console errors / warnings | 0 / 0 |
| missing assets / horizontal overflow | 0 / 0 px |
| Browserless/direct Cian/refresh/hydrate/import calls | 0 |
| cleanup fallback | not used |

The expected stale CAS response was classified by route and HTTP status; it is not counted as an unexpected application error.

## Integrity hashes

- frozen baseline canonical-LF SHA-256: `0830bc91a01ac002bb461fbc7a243a1c946247c987e1b10a46906aa5b07e44c7`;
- listing migration: `efdeb03e49eb8ae93b19ab4fdf0000f2d2b47e45368e68a1f1cdf227fd820f25`;
- shared workspace migration: `c4097cd4ae74b138d62d7858fcee7efb991ca83406ef843d187ce00fff7b5eda`;
- PT409 migration: `f7d0a5b5fc2eccc448245039e989f693e4e537375ef18c308aca9c89f674cfe3`;
- `shared-workspace.js`: `788bc398472c2ab74b204d5125295095812dd02a9ebaeb2cdd55006b1a515614`;
- `tests/shared-workspace-purge.test.mjs`: `9fadeff538c51937faddfdd29ddb8e3b6a9bbf0ea4f92ac14c3ec44eb432222b`.

## Release boundary

All local checks listed above were executed before release. GitHub publication does not change production Supabase. Any new production E2E, Edge deployment, Auth/secrets, Vault or cron operation requires explicit later approval.
