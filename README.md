# SLOGI v76.1.0 — Cian Shared Workspace

Кандидат feature-релиза профессионального пространства для специалистов по коммерческой недвижимости.

## Что входит в релиз

- только серверный сбор и отображение предложений ЦИАН;
- daily discovery и отдельная durable hydration queue;
- выдача только из сохранённой Supabase-базы, без внешнего запроса при фильтрации;
- техническая anonymous Auth session без формы аккаунта;
- общее защищённое workspace-состояние по длинному high-entropy коду;
- revision-based защита от незаметной перезаписи между компьютерами;
- тёплый SLOGI shell, карточки, фильтры, карта и кластеры.

Авито в runtime v76.1.0 отсутствует. В интерфейсе есть только неактивная информационная карточка «Авито — подключение готовится», без кнопки, URL и сетевого вызова. Ozon, Apify и Inpars не входят в релиз.

## Безопасность

- Browserless token хранится только в Edge secrets или ignored `.env.local`;
- браузер и Edge Functions не выполняют прямой `fetch` к `cian.ru`;
- пользовательская выдача не запускает Browserless;
- workspace code не хранится в Git, HTML, JavaScript, URL, логах или открытом виде в БД;
- `anon` не получает прямой доступ к workspace-таблицам;
- service-role key никогда не попадает в браузер;
- release candidate не содержит production Supabase endpoint по умолчанию: deployment-specific runtime config включается отдельным шагом.

## Локальная проверка

Используйте одноразовый Supabase stack на PostgreSQL 17. Применяются последовательно:

1. `20260814_7601_baseline.sql` — frozen baseline, не редактировать;
2. `20260821_7610_listing_refresh.sql` — Cian queue и refresh state;
3. `20260823_7611_shared_workspace.sql` — shared workspace, membership RLS и CAS.

Внешний Cian live smoke не запускается автоматически. После offline/local gate требуется отдельное разрешение владельца на ограниченный Browserless smoke.

## Документация

- [Парсер ЦИАН](docs/LISTING_PARSER_V76_1.md)
- [Daily refresh и очередь](docs/LISTING_REFRESH_V76_1.md)
- [Общее рабочее пространство](docs/SHARED_WORKSPACE_V76_1.md)
- [Дизайн-система](docs/DESIGN_SYSTEM_V76_1.md)
- [Smoke test](docs/SMOKE_TEST_V76_1.md)
- [Deployment](docs/DEPLOYMENT_V76_1.md)

Публикация файлов на GitHub не применяет миграции, не развёртывает Edge Functions, не включает anonymous Auth и не активирует cron. Все production-действия требуют отдельного разрешения владельца.
