# Listing parser v76.1.0

## Release contract

v76.1.0 работает только с источником `cian`. Avito перенесён в отдельный будущий релиз; Ozon, Apify и Inpars в runtime отсутствуют.

```text
daily scheduler
  → refresh-listings discovery
  → durable queue
  → hydrate-listings
  → CianListingProvider
  → semantic/freshness validation
  → slogi_market_listings / slogi_market_price_history
  → search-listings
  → UI
```

Внешняя страница ЦИАН передаётся только Browserless `smart-scrape`. Browserless-клиент принимает только HTTPS URL на `cian.ru` и поддомены, удаляет небезопасные варианты и не логирует token, HTML, cookies, headers, IP, response body или stack trace. Прямой browser/Edge `fetch` к ЦИАН запрещён.

## Нормализация

Обязательные поля live gate: canonical URL, `externalId`, надёжная дата, title, address, area и `rentMonthly`. Парсер не выдумывает отсутствующие значения.

Semantic validation отделяет помещения друг от друга и отбрасывает инженерные единицы (`Вт/м²`), проценты, годовые ставки и иные показатели, которые не являются площадью или месячной арендой. `pricePerSquareMeter` вычисляется только при валидных area и rent.

## Freshness

- приоритет: publication date, затем явная update date;
- `firstSeenAt` и `lastSeenAt` не являются публикацией;
- ровно 30 суток включается;
- старше 30 суток, unknown/future date и `removed` исключаются из выдачи;
- сомнительная дата не становится fresh;
- сортировка — новые сначала.

Старые строки допускаются только как история. Hydration не сохраняет old/unknown карточку в актуальную market table.

## Manual import

`import-listing` принимает только canonical Cian URL и выполняет ровно один `smart-scrape` без retry и unblock. Endpoint защищён JWT. Ручной import не является скрытым fallback планового daily path.
