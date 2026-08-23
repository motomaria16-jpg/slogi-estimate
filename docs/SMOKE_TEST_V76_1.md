# Smoke test v76.1.0

Дата offline/local gate: 2026-08-23. Статус релиза: `candidate`.

Одноразовая среда: `C:\Users\User\AppData\Local\Temp\slogi-v761-cian-release-audit-1787502032302`. Production Supabase, project link, production credentials и production writes не использовались.

## Database

- PostgreSQL 17.6 / Supabase local;
- initial clean apply: PASS;
- `db reset --local` с нуля: PASS;
- migration history: `20260814`, `20260821`, `20260823`;
- SLOGI catalogs: 12 tables, 128 columns, 49 constraints, 33 indexes;
- owners: `postgres`;
- RLS: enabled, not forced, на 12 SLOGI tables;
- public policies: 18; market policies: 0; Storage policies: 8;
- SLOGI SECURITY DEFINER functions: 7, все с `search_path = pg_catalog, public`;
- identity sequences: 4;
- bucket `slogi-files`: private, limit 52,428,800 bytes;
- `anon` grants на семь новых tables: 0;
- frozen migration не отличается от `v76.0.1`.

Existing v76.0.1 metadata хранит pre-tag working-tree SHA-256 `a4ab1622…`. Фактический canonical Git blob tagged migration имеет SHA-256 `0830bc91…`; текущий CRLF checkout — `10132242…`. Различие переносов строк не менялось v76.1 и отдельно зафиксировано, frozen SQL не редактировался.

## Automated tests

| Проверка | Результат |
|---|---:|
| Cian unit/fixture/security tests | 30 PASS / 0 FAIL |
| Frontend JavaScript parse | 24 PASS |
| Edge runtime loading | 6/6 PASS |
| `git diff --check` | PASS |
| HTML/Markdown local references | PASS после исключения HTML parser fixtures из site-link scope |

## Local Cian end-to-end

Browserless был заменён localhost fixture-server внутри одноразового Edge container; external Browserless calls: 0.

| Сценарий | Факт | Результат |
|---|---|---:|
| discovery | 2 sequential fixture calls, 2 canonical URLs | PASS |
| duplicate discovery slot | 0 calls | PASS |
| hydration | 2 calls: 1 recent persisted, 1 old discarded | PASS |
| duplicate hydration slot | 0 calls | PASS |
| unknown date import | partial, freshness null, DB count unchanged | PASS |
| scan runs/state | discovery/hydration terminal `ok`, error codes null | PASS |
| price history | 1 row, no duplicate | PASS |
| search with JWT | only recent Cian row | PASS |
| search without JWT | HTTP 401 | PASS |
| direct authenticated market REST | HTTP 403 | PASS |
| old/unknown/removed/future filters | all excluded | PASS |
| search triggers Browserless | fixture counter unchanged | PASS |

Всего localhost fixture Browserless calls: 5 (2 discovery, 2 hydration, 1 explicit unknown-date import).

## Shared Workspace, Auth and Storage

- three technical anonymous sessions created in API smoke;
- invalid code: generic HTTP 404;
- two members joined one synthetic workspace;
- outsider membership/state rows: 0;
- revision 0→1→2; stale revision rejected with non-2xx;
- first context created object/status/note, second isolated origin saw them;
- saved Cian listing persisted in shared professional state;
- member Storage upload and second-member download: PASS;
- outsider Storage read: rejected;
- attachment metadata cross-device: PASS; outsider rows: 0;
- test object/file cleanup: PASS.

Synthetic workspace code был создан только локально, hash хранился в БД, исходное значение не выводилось и будет удалено вместе с временной средой.

## Browser and accessibility

- top-level desktop UI console errors: 0;
- second isolated origin context console errors: 0;
- account/login/register/reset/profile/logout UI: 0 matches;
- map/controls/tiles: loaded;
- 3 synthetic points: actual Yandex cluster node present;
- filters, empty state, reset, card dialog, saved listing and reload: PASS;
- dialog focus trap, Escape and focus return: PASS;
- 1440×900, 1024×768, 768×1024, 390×844: actual browser iframe viewports, cards rendered, horizontal overflow false;
- main Cian controls: minimum measured height 46 px;
- contrast checked: 5.93–9.48:1; accent control 6.66:1;
- reduced-motion rule present; map `touch-action: pan-y`;
- mobile navigation expands; 390 px horizontal scroll absent.

The in-app browser viewport override did not resize its top-level surface, so exact breakpoints were rendered in same-origin fixed-size test iframes. Yandex JS emits one harness-only MutationObserver error when embedded; non-embedded product tabs remained at zero console errors. This artifact is N/A for deployed top-level routing, not hidden as a product PASS.

## Security/static scope

- tracked: 262 files; untracked at scan time: 34; ignored: 0;
- scanned text files: tracked 252, untracked 34, ignored 0;
- secret findings: 0;
- forbidden Avito/Apify/Inpars release files: 0;
- production project reference in runtime files: 0;
- direct literal fetch to Cian/Avito: 0;
- Ozon runtime: 0 (only negative assertions in tests mention the word);
- personal account UI matches: 0;
- inactive schedule template contains no inline secret; local `cron` schema was absent and no job was activated.

## Authorized Cian live gate

Перед authenticated smoke выполнен бесплатный network preflight к `production-sfo.browserless.io`: Windows TCP 443 прошёл, curl/Schannel и Node 24.19.0 получили HTTP 401 без token. Browserless authenticated executions и credits на этом preflight: 0.

Владелец отдельно разрешил bounded live smoke. Фактически выполнены ровно два последовательных Browserless `smart-scrape` запроса, concurrency 1, retries 0: один discovery и одна карточка. Прямых подключений локального процесса к `cian.ru`, production Supabase writes и production credentials не было.

| Live-проверка | Факт | Результат |
|---|---|---:|
| Browserless transport | 2 calls, 2 HTTP 200 responses | PASS |
| discovery | 28 canonical commercial URLs; allowlist/canonicalization accepted | PASS |
| selected card | `https://www.cian.ru/rent/commercial/326369393` / externalId `326369393` | PASS |
| normalized identity | title `Сдается офис (А)`; non-empty Moscow address | PASS |
| commercial values | area 2,186 m²; rent 9,111,976 ₽/month; 4,168.33 ₽/m² | PASS |
| semantic validation | completeness 0.73; linked unit selected; annual m² rate safely converted | PASS |
| freshness | explicit update `2026-08-23T09:11:00.000Z`; `recent`; active | PASS |
| local persistence | market row 1; price-history row 1 | PASS |
| authenticated search | HTTP 200, exactly externalId `326369393` | PASS |
| unauthenticated search | HTTP 401 | PASS |
| UI read | one live card rendered; map one point; console errors 0 | PASS |

Одноразовая live-среда, local keys, logs, контейнеры и listeners удалены после проверки. Browserless token, HTML, cookies, response body, headers, IP и secrets не записывались в evidence.

**OFFLINE/LOCAL GATE: PASS. CIAN LIVE GATE: PASS. RELEASE GATE: PASS FOR GITHUB CANDIDATE PUBLICATION.**
