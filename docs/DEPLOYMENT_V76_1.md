# Deployment v76.1.0

Этот документ не является разрешением на production deployment.

## До production

1. Завершить offline/local gate.
2. Получить отдельное разрешение на ограниченный Cian Browserless live smoke.
3. Получить реальную recent Cian-карточку и прочитать её через UI.
4. После content/metadata commits создать PR и дождаться GitHub checks.
5. Перед merge, Pages, tag и GitHub Release получить отдельное подтверждение владельца.

## Отдельно разрешаемые production-шаги

- применить forward migrations, не редактируя frozen baseline;
- включить anonymous Auth;
- задать Edge secrets (`BROWSERLESS_TOKEN`, workspace pepper, cron secret и Supabase server secrets);
- deploy release Edge Functions;
- для v76.1.5 создать новый `SLOGI_WORKSPACE_INVITE_PEPPER` (не менее 32 случайных байт) через защищённый secrets channel, без chat/log/file exposure;
- добавить runtime config для production frontend;
- применить inactive cron template и отдельно активировать его.

GitHub publication сама по себе не применяет migration, не deploy-ит Edge Functions, не меняет Auth и не активирует cron.

## Secrets

`.env.example` содержит только пустые имена переменных. Browserless token, workspace code, service-role и provider secrets запрещено помещать в Git, HTML, JavaScript, URL, chat или отчёт.

## v76.1.5 staged invite-link activation

Каждый production этап требует отдельного разрешения владельца. Candidate сам ничего не развёртывает.

1. Установить новый `SLOGI_WORKSPACE_INVITE_PEPPER` для Edge runtime. Значение не переиспользовать как workspace code и не выводить.
2. Развернуть новые JWT-protected `workspace-invites` и `join-workspace-invite`; до migration они должны fail closed.
3. Применить только forward migration `20260827_7615_workspace_invites.sql`. Она создаёт server-only invite catalog/RPC и отключает `service_role EXECUTE` у legacy code-join RPC; существующие memberships/state не меняются.
4. Выполнить read-only catalog/RLS/ACL check и локально эквивалентный Auth/Edge smoke.
5. Опубликовать candidate frontend с fragment scrub и invite UI.
6. Последним развернуть legacy `join-workspace` HTTP 410 implementation и подтвердить отсутствие manual-code поля/маршрута.
7. Провести отдельно разрешённый one-shot production E2E invite A→B и адресную cleanup только созданных тестовых данных.

Если любой этап не проходит, не публиковать следующий. До шага 5 новые invitations пользователям не выдавать; существующие members продолжают входить по сохранённой anonymous session.

## Rollback

Frozen `20260814_7601_baseline.sql` не редактируется. Database rollback выполняется только новой forward-only migration после анализа данных. Отключение scheduler и frontend runtime config — отдельные обратимые operational steps.
