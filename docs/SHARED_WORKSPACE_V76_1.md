# Shared Workspace v76.1.0

## Пользовательская модель

В интерфейсе нет личного кабинета, email/password login, регистрации, восстановления пароля, профиля, настроек аккаунта или logout. На новом браузере создаётся техническая anonymous Supabase Auth session.

Действующий участник входит автоматически по сохранённой anonymous Auth session и membership. Новый пользователь открывает защищённую ссылку-приглашение: token читается из URL fragment, fragment немедленно удаляется через `history.replaceState`, а join выполняется автоматически. Без membership и ссылки интерфейс показывает спокойное состояние «Нужна ссылка-приглашение» без ручного поля.

## Данные и границы доступа

- `slogi_shared_workspaces` сохраняет исторический code hash только для совместимости существующего workspace; публичного code-join пути больше нет;
- `slogi_shared_workspace_invites` хранит только HMAC-SHA-256 token digest, TTL, лимит использований и revoke metadata;
- `slogi_shared_workspace_members` связывает `workspace_id` с anonymous `auth.uid()`;
- `slogi_shared_workspace_state` хранит JSON state, revision и `updated_at`;
- `slogi_shared_workspace_attachments` описывает файлы `workspace/<uuid>/...`;
- `anon` не получает прямых table grants;
- authenticated RLS разрешает чтение/изменение только участникам;
- create/revoke/join выполняют JWT-protected Edge Functions с service-role только внутри функции;
- privileged RPC имеют `SECURITY DEFINER` и фиксированный `search_path = pg_catalog, public`.

Недействительная, просроченная, отозванная или исчерпанная ссылка всегда возвращает одинаковый `invite_not_available` и не раскрывает существование пространства. Raw token не хранится в local/session storage, Git, логах, analytics или БД; ссылка показывается только один раз и копируется только по явному клику.

## Синхронизация и конфликты

Supabase — источник истины; LocalStorage остаётся cache/offline fallback. Синхронизируются locations (объекты, статусы, заметки и рабочие поля) и professional state, включая saved listings, filters и последнее рабочее состояние.

Запись выполняется compare-and-swap по revision. Устаревшая ревизия отклоняется; локальный вариант сохраняется как conflict draft, загружается актуальная remote-версия и пользователь получает видимое уведомление. Автоматическое полевое слияние не выполняется, потому что существующая JSON-модель не содержит надёжных per-field clocks.

### v76.1.2 forward-only CAS hotfix

Production evidence showed that SQLSTATE `40001` is unsafe for an expected stale-revision result: infrastructure treated the serialization failure as retriable and emitted a large error burst before returning. The immutable v76.1.1 migration is not edited. Forward migration `20260824_7612_workspace_cas_conflict.sql` returns the same `workspace_revision_conflict` as explicit PostgREST HTTP `409` (`PT409`). The browser conflict workflow already recognizes status `409`; workspace data, RLS and product behavior are unchanged.

### v76.1.3 permanent purge hotfix

Обычное удаление остаётся recoverable soft-delete: объект получает `deletedAt` и помещается в `workspace.trash.projects`. Permanent purge разрешён только для ID, уже находящегося в корзине. Он удаляет этот ID одновременно из `workspace.trash.projects` и `locations`; обе записи объединяются существующим debounce и сохраняются одним shared-workspace CAS snapshot.

Активный объект, отсутствующий в корзине, purge удалить не может. При `PT409` проигравший snapshot сохраняется как conflict draft, загружается победившее remote-состояние и автоматический retry не выполняется. После успешного purge remote state становится источником истины для reload и второго браузера, поэтому удалённая запись не воскресает.

Hotfix не добавляет migration, RPC, grants или Edge Function. Production Supabase, Auth, Vault и cron этим релизом не изменяются.

### v76.1.4 initialization reconciliation hotfix

После `PT409` проигравшая вкладка загружает remote winner и сохраняет локальный вариант как conflict draft. Если сразу после этого страница перезагружалась, UI мог стать интерактивным по локальному cache до завершения начального REST-чтения. Soft-delete, выполненный в этом окне, ставил отложенную синхронизацию, но прежний `initialize()` затем безусловно применял remote snapshot и терял локальную мутацию до CAS-запроса.

Hotfix ведёт локальную версию мутаций во время initialization и сравнивает прочитанный remote snapshot с cache/base:

- если revision и base совпадают с remote, локальная мутация сохраняется ровно одним CAS после завершения чтения;
- если remote уже изменился, он остаётся победителем, а локальный вариант сохраняется в conflict draft;
- автоматического retry после `PT409` нет;
- ошибочное начальное чтение не откатывает уже выполненную локальную мутацию к старому cache.

Изменяется только browser sync orchestration в `shared-workspace.js`. Схема данных, migrations, RPC, RLS, Storage, Auth/JWT, Edge Functions, parser, Browserless и Cian transport не изменяются.

### v76.1.5 invite-link hotfix

- opaque token содержит 256 бит энтропии; в БД попадает только HMAC-SHA-256 с отдельным `SLOGI_WORKSPACE_INVITE_PEPPER`;
- срок по умолчанию — 7 суток, максимум — 5 успешных новых membership;
- принятие ссылки блокирует invite row `FOR UPDATE`, проверяет anonymous Auth user, expiry, revoke и use count и создаёт membership транзакционно;
- повторное принятие тем же уже подключённым пользователем идемпотентно и не расходует use count;
- создать invite может любой текущий member, а отозвать — его создатель, пока он остаётся member;
- raw token исчезает из DOM/памяти после закрытия dialog; восстановить закрытую ссылку нельзя;
- legacy `join-workspace` возвращает HTTP 410, а privileged legacy RPC теряет `service_role EXECUTE` в forward migration;
- существующие memberships, shared state, CAS/PT409, Storage, manual/Cian objects не мигрируются и не меняются.

В текущей схеме нет ролей owner/admin. Поэтому member-authorized invite creation — минимальный совместимый контракт, а выделение роли invite-manager остаётся техническим долгом.
