# SLOGI v76.1.7 — production activation and rollback

Этот runbook не разрешает production-действия. Он выполняется владельцем только после отдельного approval. Candidate сам не меняет Supabase, Pages, secrets, Auth, scheduler или DNS.

## Preconditions

1. Зафиксировать backup и read-only каталог существующих `slogi_shared_workspaces`, memberships, state, attachments и Storage objects.
2. Выбрать ID уже существующего общего workspace. Не создавать новый, не переносить state и не удалять другие строки. Если реальный canonical workspace неоднозначен, activation остановить.
3. Подтвердить anonymous Auth, текущие RLS/CAS/Storage smoke, отсутствие `service_role` в опубликованных assets и отсутствие сторонних scripts/CSP regressions.
4. Пройти clean PostgreSQL 17 apply/reset, Edge load, catalog E2E, unit и desktop/mobile browser tests из `SMOKE_TEST_V76_1_7.md`.
5. Получить отдельное maintenance window: переход намеренно fail-closed и может кратко заблокировать всех пользователей.

Read-only выбор canonical workspace:

```sql
select w.id,
       count(distinct m.user_id) as members,
       count(distinct s.workspace_id) as state_rows,
       w.disabled_at
from public.slogi_shared_workspaces w
left join public.slogi_shared_workspace_members m on m.workspace_id=w.id
left join public.slogi_shared_workspace_state s on s.workspace_id=w.id
group by w.id, w.disabled_at
order by members desc, w.id;
```

## Secrets

Пустой template находится в `.env.example`:

- `SLOGI_GATE_PASSWORD` — значение владельца;
- `SLOGI_GATE_KDF_SALT` — независимые random bytes в base64url;
- `SLOGI_GATE_SIGNING_KEY` — независимый signing key в base64url;
- `SLOGI_GATE_RATE_LIMIT_KEY` — независимый HMAC key в base64url.

Значения устанавливаются через защищённый Supabase secret manager/dashboard из password manager. Их запрещено передавать в CLI arguments, terminal history, chat, GitHub Actions logs, screenshots или tracked/untracked repo files. Нельзя переиспользовать один key в нескольких назначениях. Supabase server variables остаются platform-managed.

Owner-password scan запускается только в защищённом runner с уже инъецированной переменной окружения; значение не печатается:

```text
node tests/owner-secret-absence-scan.mjs
```

Успешный единственный допустимый результат: `owner-secret exact byte scan: 0 findings`. Без injected secret этот тест обязан завершиться ошибкой, а не создавать ложное доказательство.

## Staged fail-closed activation

Каждый шаг имеет отдельный go/no-go checkpoint.

1. Установить четыре secrets и deploy `password-gate`, а также gate-wrapped `search-listings`/`import-listing`. До schema activation новые проверки должны возвращать unavailable/denied и не раскрывать данные.
2. Опубликовать candidate frontend в maintenance window. До готовности backend он показывает только закрытый gate, поэтому старый membership-only клиент больше не получает данные.
3. Применить только forward migration `20260828_7617_password_gate.sql`. Не редактировать пять прежних migrations. С этого момента RLS/Storage/CAS fail closed, пока config не активирован.
4. В короткой owner-controlled transaction вставить единственную config row с выбранным существующим workspace:

```sql
insert into public.slogi_password_gate_config (
  singleton, canonical_workspace_id, enabled, grant_version, grant_ttl_seconds
) values (true, :'canonical_workspace_id'::uuid, true, 1, 15552000);
```

5. Read-only проверить ровно одну config row, current version, отсутствие прямых table grants и наличие active-grant predicate во всех shared/legacy/Storage policies и CAS.
6. Удалить из production deployment устаревшие Edge routes доступа. Миграция уже отозвала privileged RPC и активные исторические rows; таблицу и данные не удалять.
7. Выполнить двумя чистыми browser contexts: wrong/right, reload, new device, одинаковый workspace/state, tamper/cross-auth replay, direct REST/Storage/CAS denial, desktop/mobile overflow/focus, отсутствие запрещённого UI.
8. Проверить rate limit: первые пять consumed attempts в окне, шестой cooldown, `Retry-After`, правильный пароль также заблокирован в активном cooldown, concurrent attempts сериализуются.
9. Только после зелёного smoke снять maintenance. Scheduler/Cian live smoke остаются отдельными gates и этим deployment не меняются.

## Emergency revocation

Отдельный device grant отзывается Edge action `revoke` или адресным `revoked_at`. Для немедленного отзыва всех ранее выданных grants применяется одна из операций:

```sql
update public.slogi_password_gate_config
set grant_version=grant_version+1, revoked_before=statement_timestamp(), updated_at=statement_timestamp()
where singleton;
```

Для полной остановки дополнительно установить `enabled=false`. Frontend должен остаться fail-closed.

## Rollback / forward recovery

Database downgrade и удаление gate tables/policies запрещены: это потеряет enforcement и может повредить существующие данные. Безопасный rollback — только операционный fail-closed:

1. вернуть maintenance/gate-only frontend;
2. `enabled=false`, version bump и `revoked_before=now()`;
3. отозвать/rotate повреждённые signing/rate secrets;
4. оставить migration, workspace, memberships, state, attachments и Storage objects на месте;
5. подготовить новую forward-only migration/Edge/frontend fix и повторить clean gate;
6. не возвращать v76.1.6 membership-only frontend: после инцидента это было бы сознательным обходом server gate.

Если ошибка только в frontend, backend остаётся закрытым. Если ошибка в Edge, RLS/Storage/CAS всё равно отказывают без active grant. Если миграция не применилась полностью, не публиковать открытый старый frontend и не пытаться имитировать gate в JavaScript.
