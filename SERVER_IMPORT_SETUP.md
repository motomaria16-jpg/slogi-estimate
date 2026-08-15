# Серверный импорт ЦИАН / Авито

Браузерный JavaScript не может надёжно читать страницы ЦИАН и Авито из-за CORS и anti-bot. В v58 клиент сначала обращается к Supabase Edge Function `import-listing`.

## Что уже добавлено

- `supabase/functions/import-listing/index.ts` — серверный импорт;
- `supabase/config.toml` — публичный вызов функции без JWT;
- `phase0-config.js` — URL функции текущего Supabase-проекта;
- прямой server-side fetch как первый способ;
- Browserless Smart Scrape как устойчивый fallback для защищённых страниц.

## Один раз развернуть функцию

```powershell
supabase login
supabase link --project-ref badyvlegwumldciibxfe
supabase functions deploy import-listing --no-verify-jwt
```

Для ЦИАН/Авито прямой server-side fetch может блокироваться. Для стабильной работы нужен Browserless API token. Его нельзя хранить в браузерном JS. Сохраните его только как secret Supabase:

```powershell
supabase secrets set BROWSERLESS_TOKEN=ВАШ_ТОКЕН
```

После этого повторно открывать/пересобирать сайт не нужно: кнопка `Получить данные` уже обращается к Edge Function.

## Важно

Не размещайте `BROWSERLESS_TOKEN` в `phase0-config.js`, GitHub или HTML. Он должен храниться только в Supabase Secrets.
