# Smoke test v76.1.1

Дата local gate: 2026-08-23. Статус: `candidate`.

Одноразовая среда: `C:\Users\User\AppData\Local\Temp\slogi-v7611-layout-a9a47bace98946a69e61662c076904ba`. Использовались только localhost/127.0.0.1, synthetic users/workspace и synthetic market rows. Production Supabase, Browserless, Cian, cron, deploy и production credentials не использовались.

## Database and API

- Docker 29.7.2; Supabase CLI 2.115.0; PostgreSQL 17.6; Edge runtime compatible with Deno 2.1.4;
- clean start и два `db reset --local`: PASS;
- migrations: `20260814`, `20260821`, `20260823`; существующие SQL files unchanged;
- 12 public SLOGI tables, 128 columns, 49 constraints, 33 indexes;
- owners `postgres`; RLS enabled/not forced на 12 tables; market policies 0;
- 7 SECURITY DEFINER functions, все с `search_path = pg_catalog, public`;
- bucket `slogi-files`: private, 52,428,800 bytes; Storage policies: 8;
- anonymous Auth sessions: 3; invalid workspace code: generic HTTP 404;
- два members подключены к одному workspace; outsider rows: 0;
- revisions 0→1→2; stale revision rejected; winner state preserved;
- authenticated `search-listings`: exactly one recent row; old/unknown/removed excluded; unauthenticated request: HTTP 401.

## UI and browser evidence

| Проверка | Результат |
|---|---:|
| Navigation order and rename audit | PASS |
| Same compact header on 16 active pages | PASS |
| Header 1440×900 / 1920×1080 | 72 / 72 px |
| Header 768×1024 / 390×844 | 60 / 60 px |
| Horizontal overflow on four viewports | 0 |
| Canonical cluster options | 58 + all/unassigned states |
| Actual map polygon overlays | 58 |
| Cluster filter/list/map synchronization | PASS |
| Add Cian listing | one object, button becomes `Добавлено` |
| Duplicate protection | PASS |
| Reload persistence | PASS |
| Second isolated browser origin | object visible |
| Concurrent status update | conflict announced; winner loaded |
| Add-object / competitive-analysis responsive dialogs | PASS |
| Mobile focus, Escape and focus return | PASS |
| SLOGI touch targets | minimum 44 px |
| WCAG contrast | 9.48 / 10.19 / 4.73:1 |
| Reduced motion | PASS |
| Console errors/warnings | 0 / 0 |
| Direct requests to Cian/Avito/Ozon | 0 |

Before/after evidence is stored outside the repository in the local audit artifact directory. No synthetic workspace code, local Auth key, HTML response or secret was written into tracked files.

## Automated/static gate

- Cian/unit/security/hotfix tests: 34 PASS / 0 FAIL;
- frontend JavaScript parse: 24 PASS / 0 FAIL;
- Edge TypeScript load/parse: 6/6 PASS in local runtime and Node import harness;
- HTML/Markdown references: 238 checked / 0 missing;
- `git diff --check`: PASS;
- secret scan: 293 tracked + 3 untracked + 0 ignored, 295 text files scanned, 0 findings;
- frozen migration and both v76.1.0 forward migrations: unchanged.

The final rows above are updated only from executed checks before the release metadata commit.
