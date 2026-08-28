# Deployment v76.1

Этот документ не является разрешением на production deployment.

Текущий security runbook находится в `DEPLOYMENT_PASSWORD_GATE_V76_1_7.md`. Устаревшая процедура link-based доступа больше не применима и не должна использоваться для новых устройств.

## Независимые owner-authorized gates

- production backup и read-only canonical workspace selection;
- установка password-gate secrets через защищённый secret manager;
- deploy Edge Functions;
- применение только forward migrations;
- публикация frontend/Pages;
- production Auth/RLS/Storage/CAS smoke;
- Cian Browserless live smoke и scheduler activation;
- PR, merge, tag и release.

Публикация GitHub Pages сама не применяет migration, не deploy-ит Edge, не меняет Auth и не активирует scheduler. Возврат к membership-only frontend после password-gate migration запрещён, потому что создал бы неполный или неработающий security boundary.

`.env.example` содержит только пустые имена. Password, signing/rate keys, Browserless token, `service_role` и provider secrets запрещено помещать в Git, HTML, JavaScript, URL, chat, terminal history, тестовые screenshots или отчёты.
