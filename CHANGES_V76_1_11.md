# SLOGI v76.1.11 — Cian reliable-recent partial listing hotfix

Base: exact released v76.1.10 target
`1695900d720f8ad192e55f51bd49eed783500b36`.

## Исправление

Переданный production evidence классифицирует 132 nonterminal queue rows и
повторяющийся `partial_listing` в 5 из 8 hydration runs. До v76.1.11 hydration
отклонял неполную карточку до проверки freshness, поэтому объявление с надёжной
датой в пределах 30 суток и отсутствующими area/rent/address не сохранялось.

v76.1.11 реализует продуктовый контракт «все объявления с надёжной датой за
последние 30 суток, без выдумывания пропущенных значений»:

- removed/404 обрабатывается первым и остаётся terminal;
- freshness проверяется до completeness;
- old, включая partial, остаётся `discarded_old`;
- missing/ambiguous/future freshness не считается recent, использует прежний
  bounded date retry и затем terminal `discarded_unknown_date`;
- reliable inclusive `<=30d` partial listing передаётся в `persistRecent` один
  раз с `null` для отсутствующих address/area/rent и без изменения
  `parseWarnings`/`parseCompleteness`;
- queue завершается `completed` с безопасным diagnostic code
  `partial_listing_persisted`, без retry;
- run metrics учитывают такую карточку как `parsed=1`, `partial=1`, сохраняя
  точные inserted/updated counters;
- complete recent path не изменён.

Semantic parsing/validation не ослаблены, отсутствующие значения не выводятся и
не подменяются synthetic defaults.

## Не изменено

- Cian provider, Browserless client/policy/budgets и import/discovery;
- scheduler и activation/rollback manifests;
- database migrations и server store;
- password-gate, password/KDF/grant/rate/RLS/Storage/CAS;
- frontend, map/clusters и geocoder.

Production Edge/Cian/Supabase, secrets, database и schedules этим release flow
не изменяются и не deploy’ятся.
