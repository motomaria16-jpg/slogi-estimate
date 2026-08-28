# Cian rolling 30-day refresh v76.1.6

## Разделение этапов

Discovery материализует canonical URL в `slogi_listing_fetch_queue`; hydration забирает due rows через `FOR UPDATE SKIP LOCKED`, парсит карточки и завершает каждую строку терминальным либо retry-состоянием.

Slot уникален по `(source, phase, run_slot)`: discovery использует шестичасовой slot, hydration — часовой. Повтор того же slot завершается как `duplicate` до создания Browserless-клиента, поэтому не расходует внешний запрос.

Discovery на каждом запуске читает hot page 1 и ровно одну страницу durable backfill cursor. Cursor не имеет искусственного page cap: он продвигается до фактически пустой страницы или страницы, где все обнаруженные карточки старше rolling window, затем начинает новый цикл с page 2. Поэтому сбой или budget boundary не теряет позицию между запусками.

## Жёсткие лимиты

- источник: только `cian`;
- discovery: 2 последовательных Browserless calls, concurrency 1;
- backfill: ровно 1 cursor page за один discovery run;
- hydration claim: максимум 2 карточки за один hourly run, concurrency 1;
- карточка: 1 `smart-scrape`, retries 0 внутри вызова;
- runtime budget: 90 секунд hard cap для каждой фазы;
- transient queue retry ограничен счётчиком; semantic access denied не маскируется как обычная transient ошибка.

Очередь durable и idempotent: canonical URL уникален на источник, stale lock возвращается в retry, завершение требует совпадения worker id. Цена записывается в history только при первой записи или фактическом изменении.

## Чтение и пагинация

`search-listings` читает только сохранённые строки, не запускает provider и не пишет в БД. Одна страница ограничена 100 строками, но frontend последовательно догружает все страницы одного snapshot. Порядок стабилен: freshness desc, затем source/external ID/canonical URL. При изменении snapshot/total или ошибке последующей страницы UI показывает явное partial-состояние, а не выдаёт неполный результат за полный.

Rolling window включает точную границу 30 суток; unknown-date, future и `removed` исключаются. После загрузки применяются существующие фильтры кластера, площади, месячной аренды и цены за м². Dedupe использует source + external ID, с canonical URL fallback.

## Расписание и критерий полноты

Шаблон `supabase/schedules/cian-listings-daily.sql.example` полностью неактивен. Предлагаемый bounded cadence: discovery в `00:10/06:10/12:10/18:10 UTC`, hydration каждый час в `:25`. Максимальный внешний бюджет — 8 discovery + 48 hydration calls в сутки; фактическая hydration не обращается к provider без due queue item. Шаблон использует Vault для project URL, service-role и cron secret; секрет не находится в `cron.command`.

Полнота 30-дневного набора считается доказанной только после production read-only verification: cursor дошёл до empty/old boundary, due/retry hydration backlog исчерпан, и агрегированный recent count стабилен. Само снятие UI-лимита не является доказательством полноты ingestion.

Активация production cron, добавление Vault secrets, deployment функций и применение миграций требуют отдельного production-разрешения. GitHub publication не активирует scheduler.
