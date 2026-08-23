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
- создать production workspace code безопасным каналом;
- добавить runtime config для production frontend;
- применить inactive cron template и отдельно активировать его.

GitHub publication сама по себе не применяет migration, не deploy-ит Edge Functions, не меняет Auth и не активирует cron.

## Secrets

`.env.example` содержит только пустые имена переменных. Browserless token, workspace code, service-role и provider secrets запрещено помещать в Git, HTML, JavaScript, URL, chat или отчёт.

## Rollback

Frozen `20260814_7601_baseline.sql` не редактируется. Database rollback выполняется только новой forward-only migration после анализа данных. Отключение scheduler и frontend runtime config — отдельные обратимые operational steps.
