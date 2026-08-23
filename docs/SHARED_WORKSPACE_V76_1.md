# Shared Workspace v76.1.0

## Пользовательская модель

В интерфейсе нет личного кабинета, email/password login, регистрации, восстановления пароля, профиля, настроек аккаунта или logout. На новом браузере создаётся техническая anonymous Supabase Auth session.

Первое подключение показывает брендированный dialog. Пользователь вводит длинный high-entropy workspace code; второй компьютер с тем же кодом получает ту же историю. Сессия и membership сохраняются локально, поэтому повторный ввод на этом браузере не нужен.

## Данные и границы доступа

- `slogi_shared_workspaces` хранит только SHA-256 hash с server-side pepper;
- `slogi_shared_workspace_members` связывает `workspace_id` с anonymous `auth.uid()`;
- `slogi_shared_workspace_state` хранит JSON state, revision и `updated_at`;
- `slogi_shared_workspace_attachments` описывает файлы `workspace/<uuid>/...`;
- `anon` не получает прямых table grants;
- authenticated RLS разрешает чтение/изменение только участникам;
- join выполняет JWT-protected Edge Function с service-role внутри функции;
- privileged RPC имеют `SECURITY DEFINER` и фиксированный `search_path = pg_catalog, public`.

Неверный код всегда возвращает одинаковый `workspace_not_available` и не раскрывает существование пространства. Исходный код workspace не хранится в Git, HTML, JavaScript, URL, логах или БД.

## Синхронизация и конфликты

Supabase — источник истины; LocalStorage остаётся cache/offline fallback. Синхронизируются locations (объекты, статусы, заметки и рабочие поля) и professional state, включая saved listings, filters и последнее рабочее состояние.

Запись выполняется compare-and-swap по revision. Устаревшая ревизия отклоняется; локальный вариант сохраняется как conflict draft, загружается актуальная remote-версия и пользователь получает видимое уведомление. Автоматическое полевое слияние не выполняется, потому что существующая JSON-модель не содержит надёжных per-field clocks.

Production workspace code создаётся и передаётся только отдельным безопасным шагом после разрешения владельца.
