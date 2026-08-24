# SLOGI v76.1.3 — Shared Workspace Purge Hotfix

Candidate hotfix на базе released `v76.1.2`. Существующие migrations, Edge Functions и production Supabase contract не изменяются.

## Что входит в релиз

- только серверный сбор и отображение предложений ЦИАН;
- daily discovery и отдельная durable hydration queue;
- выдача только из сохранённой Supabase-базы, без внешнего запроса при фильтрации;
- техническая anonymous Auth session без формы аккаунта;
- общее защищённое workspace-состояние по длинному high-entropy коду;
- revision-based защита от незаметной перезаписи между компьютерами;
- единый компактный shell высотой 72 px на desktop и 60 px на tablet/mobile;
- навигация в порядке «Поиск помещений» → «Мои помещения» → «Смета и КП» → «Ремонт»;
- канонический фильтр кластеров и 58 polygon overlays из `clusters.geojson`;
- добавление сохранённого объявления ЦИАН в существующую доменную модель «Моих помещений» без повторного парсинга;
- дедупликация по `source + externalId` и canonical URL;
- cross-device workspace sync с явной обработкой PostgreSQL revision conflict.
- permanent purge физически удаляет только уже помещённые в корзину объекты из общего `locations` state и не допускает их восстановления после reload.

Авито в runtime v76.1.0 отсутствует. В интерфейсе есть только неактивная информационная карточка «Авито — подключение готовится», без кнопки, URL и сетевого вызова. Ozon, Apify и Inpars не входят в релиз.

## Безопасность

- Browserless token хранится только в Edge secrets или ignored `.env.local`;
- браузер и Edge Functions не выполняют прямой `fetch` к `cian.ru`;
- пользовательская выдача не запускает Browserless;
- workspace code не хранится в Git, HTML, JavaScript, URL, логах или открытом виде в БД;
- `anon` не получает прямой доступ к workspace-таблицам;
- service-role key никогда не попадает в браузер;
- публичный runtime содержит только production Supabase URL и publishable/anon-class key; service-role и остальные секреты отсутствуют.

## Локальная проверка

Используйте одноразовый Supabase stack на PostgreSQL 17. Применяются последовательно:

1. `20260814_7601_baseline.sql` — frozen baseline, не редактировать;
2. `20260821_7610_listing_refresh.sql` — Cian queue и refresh state;
3. `20260823_7611_shared_workspace.sql` — shared workspace, membership RLS и исходный CAS snapshot;
4. `20260824_7612_workspace_cas_conflict.sql` — explicit HTTP 409 для stale revision без serialization retry-flood.

Внешний Cian live smoke не запускается автоматически. После offline/local gate требуется отдельное разрешение владельца на ограниченный Browserless smoke.

## Документация

- [Парсер ЦИАН](docs/LISTING_PARSER_V76_1.md)
- [Daily refresh и очередь](docs/LISTING_REFRESH_V76_1.md)
- [Общее рабочее пространство](docs/SHARED_WORKSPACE_V76_1.md)
- [Дизайн-система](docs/DESIGN_SYSTEM_V76_1.md)
- [Smoke test v76.1.1](docs/SMOKE_TEST_V76_1_1.md)
- [CAS hotfix smoke v76.1.2](docs/SMOKE_TEST_V76_1_2.md)
- [Shared purge hotfix smoke v76.1.3](docs/SMOKE_TEST_V76_1_3.md)
- [Deployment](docs/DEPLOYMENT_V76_1.md)

Публикация файлов на GitHub не применяет миграции, не развёртывает Edge Functions, не включает anonymous Auth и не активирует cron. Все production-действия требуют отдельного разрешения владельца.
