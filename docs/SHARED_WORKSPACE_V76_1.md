# Shared workspace v76.1.7

## Пользовательская модель

SLOGI использует одно общее каноническое рабочее пространство. На новом устройстве пользователь один раз вводит общий пароль; после server verification устройство получает persistent signed grant. В интерфейсе нет login, регистрации, восстановления, профиля, выбора workspace или управления приглашениями. Anonymous Supabase Auth — только техническая привязка grant к устройству.

## Данные и доступ

- `slogi_shared_workspaces` и существующий canonical row не изменяются;
- `slogi_shared_workspace_members` сохраняет техническую связь `auth.uid()` с canonical workspace;
- `slogi_shared_workspace_state` хранит общий JSON snapshot и revision;
- `slogi_shared_workspace_attachments` и Storage path `workspace/<uuid>/...` сохраняются;
- password-gate metadata находится в отдельных server-only tables;
- authenticated RLS, Storage policies и CAS требуют одновременно membership и active device grant;
- direct table access к gate metadata отсутствует;
- privileged grant lifecycle выполняют только узкие Edge→RPC calls;
- прежний link-based join forward-deprecated: active history revoked, RPC execute revoked, строки не удалены.

Без grant нельзя прочитать membership/state/attachments, вызвать CAS или получить shared Storage object. После успешного unlock Edge атомарно добавляет отсутствующий membership ровно в configured canonical workspace. Если anonymous user уже связан с другим workspace, выдача отклоняется и данные не перемещаются.

## Синхронизация и CAS

Supabase остаётся источником истины. `localStorage` — существующий cache/offline fallback и bearer grant storage в рамках явно принятой XSS-модели.

Запись выполняется compare-and-swap по revision. Устаревшая ревизия возвращает явный PostgREST `PT409`; локальная версия сохраняется как conflict draft, загружается remote winner, автоматического retry flood нет. Gate добавляет authorization predicate до прежней CAS логики, не меняя revision contract.

Permanent purge по-прежнему удаляет только объект, уже помещённый в корзину, одновременно из `locations` и `workspace.trash.projects`. Инициализационная reconciliation сохраняет локальную мутацию одним CAS только при совпадающем base; при divergent remote winner сохраняется draft.

## Device lifecycle

- reload на том же устройстве всегда проверяет сохранённый grant server-side и затем открывает тот же workspace;
- новое устройство создаёт отдельную anonymous session, снова запрашивает пароль и получает собственный grant;
- grant нельзя перенести под другой anonymous `auth.uid()`;
- expiry, row revoke, `revoked_before` или version bump немедленно закрывают дальнейшие REST/Storage/CAS requests;
- локально уже скачанный plaintext cache не уничтожается автоматически и не считается server authorization.

Полный threat model и XSS boundary: `PASSWORD_GATE_V76_1_7.md`.
