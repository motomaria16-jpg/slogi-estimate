# SLOGI v76.1.5 — визуальная унификация

Финальный слой `schoolslogi-theme-v76-1-5.css` проверен на рабочих страницах:

- `available-spaces.html`
- `index.html`
- `workspace.html?section=estimate`
- `workspace.html?section=repair`
- `passport.html`
- `source-specification.html`
- `specification.html`
- `proposal.html`
- `team.html`
- `settings.html`

## Матрица проверки

| Размер | Шапка | Page overflow | Touch targets | Рабочий текст < 13 px | Console warnings/errors |
|---|---:|---:|---:|---:|---:|
| 1440×900 | PASS | 0 | PASS | 0 | 0 |
| 768×1024 | PASS | 0 | PASS | 0 | 0 |
| 390×844 | PASS | 0 | PASS | 0 | 0 |

Мобильное меню дополнительно проверено на открытие, четыре продуктовых ссылки, высоту ссылок 48 px, закрытие по Escape и возврат фокуса на кнопку меню.

## Скриншоты

В каталоге `after/` находятся отдельные desktop- и mobile-кадры:

- Поиск помещений
- Мои помещения
- Смета и КП
- Ремонт
- Добавить объект
- Конкурентный анализ

Снимки сделаны локально на существующих демонстрационных данных. Операции Auth, workspace, Supabase и production-конфигурация не изменялись.
