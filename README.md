# SLOGI v76.1.7 — Shared Password Gate candidate

Candidate на exact released base `v76.1.6` (`06ee1659f7caf234df85de662424fe1d1159bb03`). Сайт использует одно общее каноническое рабочее пространство и открывает его на новом устройстве только после ввода общего пароля. Форм личного кабинета, регистрации, профиля и управления доступом в интерфейсе нет.

Пароль проверяется только в Supabase Edge по HTTPS. Браузер получает подписанное разрешение устройства с expiry/version/revocation и хранит его рядом с технической anonymous Auth session. Сам пароль, его производные и `service_role` в frontend, Git и PostgreSQL не попадают.

## Граница безопасности

- до действующего device grant frontend остаётся закрытым и не запрашивает workspace data;
- RLS, Storage policy и CAS RPC независимо проверяют grant header, anonymous `auth.uid()`, expiry, revoke, version и канонический workspace;
- `search-listings` и `import-listing` выполняют ту же server-side проверку до своей существующей логики;
- однократный challenge, rate limits и cooldown защищают ввод пароля от replay и перебора;
- выдача grant автоматически создаёт только membership единственного канонического workspace;
- прежние membership/state/files/CAS и данные manual/Cian сохраняются без преобразования;
- устаревший механизм ссылок выключен forward-only: история строк остаётся, активные строки отозваны, privileged RPC больше не исполняются.

Grant и anonymous Auth tokens — bearer credentials. Same-origin XSS, вредоносное расширение или локальный доступ к уже разблокированному профилю браузера могут украсть их и прочитать локальный plaintext cache. Принятая модель и ограничения подробно описаны в [архитектуре gate](docs/PASSWORD_GATE_V76_1_7.md).

## Локальная проверка

Миграции применяются последовательно на чистом PostgreSQL 17:

1. `20260814_7601_baseline.sql` — frozen baseline;
2. `20260821_7610_listing_refresh.sql` — существующая Cian queue;
3. `20260823_7611_shared_workspace.sql` — shared state, membership, Storage и исходный CAS;
4. `20260824_7612_workspace_cas_conflict.sql` — явный `PT409`;
5. `20260827_7615_workspace_invites.sql` — историческая миграция, не редактируется;
6. `20260828_7617_password_gate.sql` — forward-only password gate и enforcement.

Пустые имена server-only secrets находятся в `.env.example`. Для тестов используется только генерируемый во время запуска синтетический пароль; значение владельца не требуется.

## Документация

- [Threat model и архитектура](docs/PASSWORD_GATE_V76_1_7.md)
- [Production activation и rollback](docs/DEPLOYMENT_PASSWORD_GATE_V76_1_7.md)
- [Проверки candidate](docs/SMOKE_TEST_V76_1_7.md)
- [Shared workspace и CAS](docs/SHARED_WORKSPACE_V76_1.md)
- [Cian parser](docs/LISTING_PARSER_V76_1.md)
- [Cian refresh](docs/LISTING_REFRESH_V76_1.md)
- [Design system](docs/DESIGN_SYSTEM_V76_1.md)

Публикация, push, PR, merge, tag, release, Pages, production migrations, secrets и Edge deploy этим candidate не выполняются. Каждый production-шаг требует отдельного разрешения владельца.
