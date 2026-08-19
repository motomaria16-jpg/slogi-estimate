# Обновление `search-listings` до v76

Повторно выполнять `SUPABASE_MARKET_ANALYSIS_V72.sql` не требуется.

1. Откройте Supabase → Edge Functions → `search-listings` → Code.
2. Полностью удалите старый код.
3. Вставьте содержимое `supabase/functions/search-listings/index.ts` из этого архива.
4. Сохраните/Deploy функцию.
5. `Verify JWT` должен соответствовать текущей настройке сайта; в используемой локальной схеме функция вызывается без пользовательского JWT, поэтому ранее использовался режим без обязательной JWT-проверки.
6. Убедитесь, что в Edge Functions → Secrets существует `BROWSERLESS_TOKEN`.
7. Если residential proxy недоступен по тарифу Browserless, v76 покажет это в диагностике и попробует fallback без residential proxy / stealth BQL.
8. Обновите файлы сайта и откройте `available-spaces.html`.
9. Нажмите «Найти объявления» и при необходимости смотрите Edge Functions → `search-listings` → Logs. В логах ищите `[CIAN]`, `[AVITO]` и `SUMMARY`.
