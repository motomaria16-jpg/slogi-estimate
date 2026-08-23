# Cian daily refresh v76.1.0

## Разделение этапов

Discovery материализует canonical URL в `slogi_listing_fetch_queue`; hydration забирает due rows через `FOR UPDATE SKIP LOCKED`, парсит карточки и завершает каждую строку терминальным либо retry-состоянием.

Daily slot уникален по `(source, phase, run_slot)`. Повтор того же slot завершается как `duplicate` до создания Browserless-клиента, поэтому не расходует внешний запрос.

## Жёсткие лимиты

- источник: только `cian`;
- discovery: 2 последовательных Browserless calls, concurrency 1;
- hydration claim: максимум 2 карточки за один daily run, concurrency 1;
- карточка: 1 `smart-scrape`, retries 0 внутри вызова;
- runtime budget: 90 секунд hard cap для каждой фазы;
- transient queue retry ограничен счётчиком; semantic access denied не маскируется как обычная transient ошибка.

Очередь durable и idempotent: canonical URL уникален на источник, stale lock возвращается в retry, завершение требует совпадения worker id. Цена записывается в history только при первой записи или фактическом изменении.

## Расписание

Шаблон `supabase/schedules/cian-listings-daily.sql.example` полностью неактивен. Он использует Vault для project URL, service-role и cron secret; секрет не находится в `cron.command`.

Активация production cron, добавление Vault secrets, deployment функций и применение миграций требуют отдельного production-разрешения. GitHub publication не активирует scheduler.
