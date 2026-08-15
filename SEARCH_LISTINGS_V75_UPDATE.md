# Обновление search-listings до v75

1. Откройте Supabase → Edge Functions → `search-listings` → Code/Edit.
2. Откройте в архиве v75 файл `supabase/functions/search-listings/index.ts`.
3. Скопируйте его целиком.
4. В Supabase удалите старый код функции и вставьте новый.
5. Нажмите Deploy / Save and deploy.
6. Не запускайте `SUPABASE_MARKET_ANALYSIS_V72.sql` повторно — структура базы не менялась.
7. Убедитесь, что `BROWSERLESS_TOKEN` по-прежнему находится в Edge Functions → Secrets.
8. Сохраните прежнюю настройку Verify JWT, при которой страница уже перестала получать HTTP 401.
9. Откройте сайт v75 → Анализ доступных помещений → Найти объявления.
10. Если данные карточек не распознаются, откройте Edge Functions → search-listings → Logs. Теперь там будут строки `[CIAN]`, `[AVITO]` и `SUMMARY`, по которым можно точно определить причину.
