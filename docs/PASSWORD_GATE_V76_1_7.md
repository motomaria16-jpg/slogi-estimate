# SLOGI v76.1.7 password gate

## Цель и неизменяемые свойства

Один общий пароль открывает одно существующее каноническое рабочее пространство. Anonymous Supabase Auth используется только как стабильный технический идентификатор устройства; пользовательских аккаунтов, разных кабинетов и выбора workspace нет.

Gate не меняет структуру shared state, memberships, attachments, Cian/manual objects, Storage paths или CAS/PT409. Миграция forward-only добавляет enforcement и не удаляет данные прежнего механизма доступа.

## Минимальная архитектура

1. Ранний `<head>` bootstrap ставит `data-slogi-access="pending"`; product UI остаётся невидимым и неинтерактивным.
2. Браузер создаёт или восстанавливает anonymous Auth session.
3. Сохранённый grant всегда проверяется HTTPS-запросом `password-gate/status`. Локальная дата expiry не считается server authorization.
4. Если grant отсутствует или недействителен, не закрываемый Escape диалог запрашивает пароль. Сначала Edge выдаёт одноразовый challenge, затем принимает ровно один `unlock` request.
5. Edge аутентифицирует anonymous JWT, атомарно потребляет challenge и rate-limit attempt, выполняет PBKDF2-HMAC-SHA-256 для candidate и server-only password, сравнивает proofs через constant-time WebCrypto `verify`.
6. При успехе Edge подписывает HMAC device grant с `grantId`, `auth.uid`, canonical workspace, version, issued-at, expiry и nonce. PostgreSQL хранит только SHA-256 token digest и metadata.
7. Server RPC атомарно отзывает прежний активный grant этого `auth.uid`, создаёт новый и добавляет отсутствующий membership только в canonical workspace. Конфликт с membership другого workspace отклоняется.
8. Браузер хранит envelope в `localStorage` и передаёт opaque grant в `x-slogi-device-grant` для REST, CAS, Storage и защищённых user-facing Edge calls.
9. RLS/Storage/CAS повторно вычисляют digest request header и проверяют user, workspace, expiry, revoke, global `revoked_before` и current version. UI или сохранённый anonymous JWT сами по себе доступа не дают.

## Server-only состояние

- `slogi_password_gate_config`: ровно одна строка с canonical workspace, enabled, grant version, TTL и emergency revoke boundary;
- `slogi_password_gate_grants`: digest и lifecycle каждого signed grant;
- `slogi_password_gate_challenges`: один короткоживущий одноразовый digest challenge на anonymous user;
- `slogi_password_gate_rate_limits`: HMAC scopes user и network, sliding window и exponential cooldown.

У этих таблиц включён RLS, нет client policies и отозваны прямые grants, включая `service_role`. Edge обращается только к узким `SECURITY DEFINER` RPC с фиксированным `search_path`.

## Threat model

| Угроза | Контроль | Остаточный риск |
|---|---|---|
| Чтение публичных GitHub Pages assets | В assets нет password/verifier; данные выдаются только через server gate + RLS | HTML/CSS/JS остаются публичными по определению |
| Frontend bypass или прямой PostgREST/Storage/CAS | Одинаковая active-grant проверка в RLS, Storage и CAS | Ошибка в platform header propagation должна выявляться production smoke |
| Подбор пароля | PBKDF2, user+network HMAC scopes, 5 attempts/window, cooldown до 15 минут | Распределённый ботнет требует platform/WAF monitoring; network header должен быть sanitized gateway |
| Timing oracle | Оба значения проходят одинаковый KDF; proof проверяет WebCrypto constant-time primitive; ответ generic | Общая latency инфраструктуры остаётся наблюдаемой, но не содержит раннего password compare |
| Повтор password submit | Challenge хранится как digest, короткоживущий и атомарно помечается used до KDF | Новый challenge можно запросить снова, поэтому rate limit остаётся обязательным |
| Подмена signed grant | HMAC signature + exact digest DB lookup + structured claim validation | Утечка одновременно grant и anonymous tokens действует до revoke/expiry |
| Копирование grant на другое устройство/auth user | Signed `userId` и DB row привязаны к anonymous `auth.uid()` | Полное копирование профиля браузера переносит также anonymous credentials и считается локальным компромиссом |
| Grant после revoke/expiry/version bump | Проверка выполняется на каждом server data request | Уже скачанный plaintext cache нельзя сделать нечитаемым задним числом |
| XSS/extension | CSP/no third-party scripts должны снижать риск; пароль сразу очищается из input/request object; секреты не интерполируются | Same-origin XSS или privileged extension может украсть bearer tokens и локальный cache |
| Старый join path | Active Edge sources удалены; privileged RPC execute отозван; старые rows forward-revoked, но сохранены | Уже развёрнутые production functions надо отдельно удалить при разрешённой активации |
| Разные workspace вместо singleton | server config имеет boolean PK + unique canonical workspace; issue RPC отклоняет conflicting membership | Canonical workspace должен выбрать владелец read-only проверкой перед activation |

## Local-storage/XSS модель

Persistent grant необходим для однократного ввода на устройстве. Он хранится рядом с существующими anonymous access/refresh tokens. Workspace cache также остаётся plaintext для сохранения нынешнего offline поведения.

Поэтому gate защищает server data от удалённого неавторизованного клиента, но не является DRM для уже доверенного браузерного профиля. При server denial frontend убирает grant и снова блокирует приложение, однако не уничтожает пользовательский cache автоматически: это сохраняет данные при временной ошибке и не подменяет требуемый owner-approved purge. Если требуется криптографически скрывать уже скачанные данные после revoke, нужна отдельная архитектура шифрования cache и управления device keys.

Production frontend должен иметь строгий CSP, не добавлять third-party scripts, исключить unsafe HTML interpolation и считать любой same-origin XSS критическим incident с global `grant_version` bump или `revoked_before`.

## Endpoint contract

`POST password-gate` принимает только exact JSON shape:

- `{action:"challenge"}` → opaque challenge и expiry;
- `{action:"unlock",challenge,password}` → grant либо generic denial/cooldown;
- `{action:"status"}` + grant header → current expiry/version;
- `{action:"revoke"}` + grant header → отзыв текущего device grant.

HTTPS обязателен, исключение сделано только для `localhost/127.0.0.1`. Ответы имеют `no-store`, password никогда не логируется и очищается до обработки результата. CORS явно разрешает grant header. `search-listings` и `import-listing` вызывают общий validator до существующей бизнес-логики.

## Revocation operations

- отдельное устройство: `revoke` или `revoked_at` конкретной строки;
- все старые grants: увеличить `grant_version`;
- аварийная граница: установить `revoked_before = statement_timestamp()`;
- полная остановка: `enabled=false`, оставить frontend fail-closed.

Удаление workspace, memberships, state, attachments или исторических строк для rollback не требуется и запрещено этим изменением.
