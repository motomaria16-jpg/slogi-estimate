# SLOGI v76.1.7 — Password Gate, compact design и карта ЦИАН

Base: exact released v76.1.6 commit `06ee1659f7caf234df85de662424fe1d1159bb03`.

## Данные карты

- `search-listings` остаётся read-only источником сохранённой 30-дневной выдачи ЦИАН.
- Клиент читает все страницы одного серверного snapshot и дедуплицирует объявления по канонической identity `source + externalId` (с fallback на очищенный URL).
- Таймаут применяется к каждой странице отдельно; отменённый или устаревший запрос не может восстановить старый набор данных.
- Адреса без сохранённых координат проходят только через серверный `geocode-address`. Browserless, refresh, hydrate и DB writes из read-пути не вызываются.

## Канонические кластеры

- Единственный набор геометрии — 58 полигонов из `clusters.geojson` / его браузерной копии `clusters-data.js`.
- `clusterId` — канонический `properties.id`, `properties.clusterId` или, для текущего набора, уникальное неизменённое имя полигона; `clusterName` — `properties.name`.
- Point-in-polygon учитывает внешнее кольцо и отверстия. Точка на любой границе принадлежит полигону. Если граница общая, выигрывает первый полигон в каноническом порядке.
- Состояние `outside` выставляется только после валидных координат и полного прохода по всем 58 полигонам. Ошибка геокодирования остаётся `not_computed`.

## Геокодирование и UI

- Одинаковый нормализованный адрес геокодируется один раз, но разные объявления сохраняют отдельные маркеры.
- Клиентский reload-cache ограничен 500 адресами; успешные ответы живут 30 дней, ошибки — 15 минут.
- Серверный geocoder использует in-memory cache, дедупликацию одновременных запросов, rate limit, межзапросный интервал, timeout и ограниченный exponential backoff.
- Карта отдельно показывает количество объектов на карте, без координат, не прошедших геокодирование и ожидающих геокодирования.

## Схема и контракты

- Старые migrations не изменены; password gate добавлен отдельной forward-only migration `20260828_7617_password_gate.sql`.
- Cian discovery/transport/hydration contracts не изменены.
- `geocode-address` сохраняет прежний POST-вход и `results`; ответ дополнен безопасным полем `diagnostic`.

## Password gate

- добавлен server-verified общий пароль и signed persistent device grant;
- active grant enforced в shared/legacy RLS, Storage и CAS;
- unlock автоматически подключает anonymous device только к configured canonical workspace;
- добавлены one-time challenge, PBKDF2/constant-time verification, tamper/replay binding, rate limits, cooldown, expiry/revoke/version;
- удалены link-based UI, frontend fragment handling и active Edge routes; database history retained forward-only;
- ранний fail-closed bootstrap добавлен на все реальные product pages;
- `search-listings` и `import-listing` требуют тот же grant до существующей логики;
- обновлены docs, empty secret template, activation/rollback runbook и deterministic test matrix.

## Границы password-обёртки

Password wrapper не изменяет shared workspace/state layout, CAS revision contract, manual/Cian data model, Cian provider/discovery/hydration budget, канонические кластеры или Avito/Ozon behavior. Candidate объединяет его с compact School SLOGI design и картой/кластерами этого релиза.

## Локальный integration gate

- 93/93 deterministic Node/Edge assertions: PASS;
- PostgreSQL 17 clean start + два полных reset и catalog/RLS/ACL/Storage/CAS/password lifecycle: PASS;
- все шесть Edge functions загрузились локально; scheduler handlers отказали anonymous caller до provider logic;
- browser fixture на 1440×900, 768×1024 и 390×844: password lifecycle, 53 объявления на двух страницах, 51 маркер, 58 полигонов, marker/card sync, 0 legacy UI, 0 overflow, 0 console errors;
- tracked/untracked/ignored secret assignment scan: 0 findings; exact owner-secret scanner готов и fail-closed без защищённой инъекции.

Production deployment/publication не выполнялись.
