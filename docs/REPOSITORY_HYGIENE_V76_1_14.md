# SLOGI v76.1.14 repository hygiene inventory

Дата проверки: 2026-08-29.

Authoritative base: released tag `v76.1.13`, exact target
`a2b4a8a024ee5dd984fc58d5207dfb07ff5a5e7b`.

Ветка: `chore/v76-1-14-legacy-cleanup`.

## Решение

Удалены только четыре файла общим размером 65 572 байта (64.04 KiB). Для
каждого файла подтверждены отсутствие входящих runtime-ссылок и отсутствие
активного маршрута/загрузчика. Все неоднозначные dev-, audit-, release- и
compatibility-материалы оставлены.

После добавления этого отчёта и усиления anti-regression теста итоговое дерево
содержит 360 файлов и 12 574 912 байт: net reduction против release tree —
56 148 байт (54.83 KiB).

Ни один HTML-маршрут, загружаемый JS/CSS, Supabase-файл, миграция, schedule,
runtime data set, шаблон, security document или linked design evidence не
изменён.

## Authoritative inventory до очистки

| Область | Файлов | Размер, байт | Назначение |
| --- | ---: | ---: | --- |
| root | 112 | 8 324 159 | 12 HTML routes, 14 CSS, 25 JS, runtime data, icons и document templates |
| `.agents/` | 146 | 2 505 754 | project-local agent/developer tooling; не runtime |
| `docs/` | 53 | 1 309 190 | architecture, smoke, deployment и linked visual evidence |
| `supabase/` | 38 | 362 323 | config, 7 frozen/forward migrations, 7 function entrypoints, 2 schedules, shared code/tests |
| `tests/` | 14 | 129 634 | deterministic, browser и DB regression harnesses |
| **Итого** | **363** | **12 631 060** | released `v76.1.13` tree |

Активные product routes закреплены кодом и тестами:

- `available-spaces.html`, `index.html`, `workspace.html`, `passport.html`;
- `source-specification.html`, `specification.html`, `proposal.html`;
- `team.html`, `settings.html`.

Compatibility routes `all-locations.html`, `measure-index.html` и
`measure-passport.html` являются прямыми redirect routes и сохранены, даже
когда два из них byte-identical.

Reference inventory включал:

- `href`/`src` всех root HTML и CSS `url()`/`@import`;
- dynamic routes в `professional-shell.js`, `passport-v4.js`,
  `phase0-app.js`, `stage-workspace.js` и workflow scripts;
- Cian list/map/feed, 30-day window, 58 cluster polygons и add-object path;
- `VERSION.json`, README, changelog/smoke/deployment/audit links;
- Supabase config, functions, shared code, migrations, schedules и SQL/Node
  tests;
- local Markdown links и GitHub Pages direct-route behavior.

## Удалённые файлы и точное доказательство

| Файл | Байт | Входящие ссылки до удаления | Route/runtime proof | Recoverability |
| --- | ---: | --- | --- | --- |
| `portfolio-map.css` | 5 914 | Exact-name search вне самого файла: 0 | Ни один из 12 HTML routes не загружает файл; нет CSS import или dynamic loader | История сохранена в Git, включая baseline commit `308c7ee` |
| `portfolio-map.js` | 8 727 | Единственное вхождение вне файла было в `tests/navigation-theme-v76-1-5.test.mjs`; HTML/runtime вхождений: 0 | Нет HTML route с `portfolio-map` markup и нет script loader; бывшие Tools routes уже удалены | История сохранена в Git, включая baseline commit `308c7ee` |
| `ux-audit-search-desktop-1440x900.png` | 22 478 | Exact filename во всём tracked tree: 0 | Не является `src`, CSS asset, manifest/icon или test fixture | История сохранена в Git, baseline commit `308c7ee` |
| `ux-audit-search-mobile-390x844.png` | 28 453 | Exact filename во всём tracked tree: 0 | Не является `src`, CSS asset, manifest/icon или test fixture | История сохранена в Git, baseline commit `308c7ee` |

Тест `navigation-theme-v76-1-5.test.mjs` теперь прямо закрепляет отсутствие
`portfolio-map.js` и `portfolio-map.css` вместе с уже удалёнными Tools assets.
Из списка active sources удалена только ложная ссылка на orphan JS; сам тест
сохранён и продолжает проверять все active routes.

## Сохранённые кандидаты

| Класс | Решение | Причина |
| --- | --- | --- |
| `.agents/` (146 файлов, 2 505 754 байта) | KEEP | Runtime-ссылок нет, но каталог может auto-discover проектные skills; obsolete status не доказан |
| `CHANGES_*`, smoke/deployment/audit docs | KEEP | Release/audit evidence и policy context; отсутствие runtime-ссылки недостаточно для удаления |
| `docs/design-v76-1-5/**` и `docs/design-v76-1-7-compact-search/**` | KEEP | Linked README evidence; наличие и JPEG signatures закреплены active test |
| `all-locations.html`, `measure-index.html`, `measure-passport.html` | KEEP | Публичные compatibility redirects, документированы в historical rebuild audit |
| `settings.html`, `team.html`, `workspace.html` | KEEP | Active direct routes в shell/tests/password gate, не orphan account UI |
| `apple-touch-icon.png`, `favicon-32.png`, `favicon.svg` | KEEP | Текущие browser/icon assets; возможна implicit browser discovery |
| `clusters.geojson`, `clusters-data.js`, `cluster-geometry.js` | KEEP | Canonical 58 polygons, browser copy и geometry runtime/tests |
| `Specification_template.xlsx`, `KP_Slogi_template.docx`, proposal assets | KEEP | Active download/generation links и workflow dependencies |
| все 7 migrations | KEEP byte-for-byte | Frozen history и current forward schema; rewrite/delete запрещены |
| Supabase functions/config/schedules | KEEP byte-for-byte | Password gate, Cian queue/parser/30d, shared workspace и server policies |

Правило применялось консервативно: если auto-discovery, audit policy, public
direct route или implicit browser loading нельзя было исключить, файл оставался.

## Behavior fingerprint

Protected behavior set содержит 102 файла и 8 507 564 байта:

- root HTML/CSS/JS/JSON/GeoJSON/images/templates;
- `.env.example` и `.nojekyll`;
- весь `supabase/` scope;
- с явным исключением только четырёх доказанных deletion candidates.

Aggregate SHA-256 списка `path + file SHA-256`:

`efc6dd23ab5ebc0e8800e963dc942abd3e8459905b04e5d4abe043f753dbd424`

`git diff` protected set против exact `v76.1.13` target: **0 files**. То есть
fingerprint очищенной ветки равен authoritative base byte-for-byte.

## Проверки после очистки

| Gate | Результат |
| --- | --- |
| Deterministic Node/Edge suite | 110 PASS, 0 FAIL до очистки; 110 PASS, 0 FAIL после |
| JS/MJS/TS parse | 56/56 до; 55/55 после удаления orphan JS |
| Local HTML/CSS/Markdown links/assets | 0 missing |
| High-confidence secret scan | 0 findings |
| `git diff --check` | PASS |
| Cian canonical polygons | 58 unique polygons; browser data identical to GeoJSON |
| Cian fixture desktop 1440×900 | 53 cards, `51 из 53` markers, 4 product routes, overflow 0, console warn/error 0 |
| Cian fixture mobile 390×844 | 53 cards, `51 из 53` markers, 4 product routes, overflow 0, console warn/error 0 |
| Add-object | Browser action reached canonical `Добавлено` state; deterministic domain/dedup regression PASS after cleanup |
| Password gate mobile direct route | fail-closed `pending`, gate dialog present, legacy account/invite UI absent, overflow 0, console warn/error 0 |
| Fresh PostgreSQL 17 migrations | 7/7 applied sequentially in a dedicated temporary container |
| Cian queue SQL e2e | PASS |
| Cian concurrent claim e2e | PASS: `2 + 0`, 2 unique rows |
| Password-gate catalog/RLS e2e | `password_gate_catalog_e2e_ok` |

Для DB e2e использован отдельный temporary container из уже установленного
Supabase PostgreSQL 17 image. Минимальный Auth/Storage catalog fixture добавил
только объекты, которые полный Supabase stack создаёт до project migrations.
Контейнер был остановлен и auto-removed после тестов. Существующий
`supabase_db_slogi-crm` и связанные контейнеры не изменялись.

## Scope protection

Не выполнялись production/Pages writes, deploy, merge, tag, release, Supabase
provider calls, secrets/Vault/Auth mutations или изменения design branch.
Единственные remote-действия этой задачи — push отдельной hygiene-ветки и
создание отдельного PR; merge не входит в scope.
