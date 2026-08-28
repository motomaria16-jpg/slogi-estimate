# SLOGI v76.1.6 — School SLOGI and Complete Cian Feed

Released hotfix на базе immutable/public `v76.1.5`: единый School SLOGI shell и полная пагинируемая выдача сохранённых объявлений ЦИАН за rolling window 30 суток. Production activation, scheduler replacement и проверка полноты ingestion остаются отдельными owner-authorized gates.

## Что входит в релиз

- только серверный сбор и отображение предложений ЦИАН;
- bounded discovery с durable backfill cursor и отдельная durable hydration queue;
- последовательная догрузка всех страниц сохранённой 30-дневной выдачи без общего UI-лимита;
- выдача только из сохранённой Supabase-базы, без внешнего запроса при фильтрации;
- техническая anonymous Auth session без формы аккаунта;
- общее защищённое workspace-состояние с одноразовыми invite links без ручного workspace code;
- revision-based защита от незаметной перезаписи между компьютерами;
- единый School SLOGI shell для desktop/mobile;
- навигация в порядке «Поиск помещений» → «Мои помещения» → «Смета и КП» → «Ремонт»;
- канонический фильтр кластеров и 58 polygon overlays из `clusters.geojson`;
- добавление сохранённого объявления ЦИАН в существующую доменную модель «Моих помещений» без повторного парсинга;
- дедупликация по `source + externalId` и canonical URL;
- cross-device workspace sync с явной обработкой PostgreSQL revision conflict.
- permanent purge физически удаляет только уже помещённые в корзину объекты из общего `locations` state и не допускает их восстановления после reload.
- локальная мутация, сделанная во время начального чтения workspace после reconciliation, не теряется: при неизменившейся remote-базе выполняется один CAS, а при новом remote winner сохраняется conflict draft без автоматической перезаписи.

Авито в runtime v76.1.0 отсутствует. В интерфейсе есть только неактивная информационная карточка «Авито — подключение готовится», без кнопки, URL и сетевого вызова. Ozon, Apify и Inpars не входят в релиз.

## Безопасность

- Browserless token хранится только в Edge secrets или ignored `.env.local`;
- браузер и Edge Functions не выполняют прямой `fetch` к `cian.ru`;
- пользовательская выдача не запускает Browserless;
- invite token создаётся только сервером, передаётся в URL fragment и хранится в БД только как HMAC; ручного workspace-code join в UI нет;
- `anon` не получает прямой доступ к workspace-таблицам;
- service-role key никогда не попадает в браузер;
- публичный runtime содержит только production Supabase URL и publishable/anon-class key; service-role и остальные секреты отсутствуют.

## Локальная проверка

Используйте одноразовый Supabase stack на PostgreSQL 17. Применяются последовательно:

1. `20260814_7601_baseline.sql` — frozen baseline, не редактировать;
2. `20260821_7610_listing_refresh.sql` — Cian queue и refresh state;
3. `20260823_7611_shared_workspace.sql` — shared workspace, membership RLS и исходный CAS snapshot;
4. `20260824_7612_workspace_cas_conflict.sql` — explicit HTTP 409 для stale revision без serialization retry-flood;
5. `20260827_7615_workspace_invites.sql` — hash-only invite links и отключение legacy code join.

Внешний Cian live smoke не запускается автоматически. После offline/local gate требуется отдельное разрешение владельца на ограниченный Browserless smoke.

## Документация

- [Парсер ЦИАН](docs/LISTING_PARSER_V76_1.md)
- [Daily refresh и очередь](docs/LISTING_REFRESH_V76_1.md)
- [Общее рабочее пространство](docs/SHARED_WORKSPACE_V76_1.md)
- [Дизайн-система](docs/DESIGN_SYSTEM_V76_1.md)
- [Smoke test v76.1.1](docs/SMOKE_TEST_V76_1_1.md)
- [CAS hotfix smoke v76.1.2](docs/SMOKE_TEST_V76_1_2.md)
- [Shared purge hotfix smoke v76.1.3](docs/SMOKE_TEST_V76_1_3.md)
- [Soft-delete after CAS smoke v76.1.4](docs/SMOKE_TEST_V76_1_4.md)
- [Invite links smoke v76.1.5](docs/SMOKE_TEST_V76_1_5.md)
- [School SLOGI + Cian pagination smoke v76.1.6](docs/SMOKE_TEST_V76_1_6.md)
- [Deployment](docs/DEPLOYMENT_V76_1.md)

Публикация файлов на GitHub не применяет миграции, не развёртывает Edge Functions, не включает anonymous Auth и не активирует cron. Все production-действия требуют отдельного разрешения владельца.
