# SLOGI v76.1.7 — compact search design audit

База: `7f41e95a0d154bfe96cc6de61afb15fbb7ff131d`.

Ветка: `design/v76-1-7-compact-search`.

Изменения ограничены общим shell, финальным CSS-слоем, cache keys девяти рабочих страниц, регрессионным тестом и этим визуальным аудитом. Парсер, ЦИАН-контракт, карта, Auth, password gate, Supabase и production не изменялись.

## Численные изменения

| Метрика | Desktop до | Desktop после | Mobile до | Mobile после |
| --- | ---: | ---: | ---: | ---: |
| H1 «Поиск помещений» | 56 px | 48 px | 34 px | 32 px |
| Высота hero | 222.7 px | 188.4 px | 320.6 px | 284.5 px |
| Padding hero | 38 px | 28 × 32 px | 20 px | 18 px |
| Gap hero | 28 px | 20 px | 28 px | 16 px |
| Названия ЦИАН/Авито | 28 px | 19 px | 25 px | 19 px |
| Первая карточка результата | 362.9 px | 303.5 px | 539.5 px | 383.2 px |
| Заголовок результата | 22 px | 18 px | 20 px | 18 px |
| Адрес результата | 16 px | 14 px | 16 px | 14 px |

Список результатов теперь использует общий panel с разделёнными строками, фоном `#fffdf9`, спокойной границей, без отдельных «плавающих» карточек. Функции фильтрации, карты, пагинации и добавления объекта сохранены.

## Visual gate

- Девять пользовательских страниц и оба состояния workspace (`Смета и КП`, `Ремонт`) проверены на `1440×900`, `768×1024`, `390×844`: `30/30 PASS`.
- Горизонтальный overflow: `0/30`.
- Console errors/warnings: `0/0`.
- Шапка: `76 px` desktop, `62 px` tablet/mobile.
- Body: `16 px`, `Ubuntu Sans`.
- Минимальная высота видимых `button/input/select/textarea`: `44 px`, `30/30 PASS`.
- Mobile menu проверено на `768×1024` и `390×844`: открытие `aria-expanded=true`, пять видимых целей, первая ссылка получает фокус; `Escape` закрывает меню и возвращает фокус на trigger, `2/2 PASS`.
- Mobile menu trigger: `44×44 px`; минимальная высота цели внутри меню: `46 px`.
- Статический и runtime-поиск удалённой подписи: `0` совпадений.

## Автоматические проверки

- JavaScript parse: `22/22 PASS`.
- Локальный regression suite: `30/30 PASS`.
- В suite входят ссылки/assets, отсутствие удалённых Tools-only страниц, invite-flow unit fixtures, CAS/PT409, soft delete/trash/purge и дизайн assertions.
- Сетевой `workspace-invites-local-e2e.mjs` не запускался как gate: в локальном окружении не задан `apiUrl`; продуктовый код и конфигурация для этого не изменялись.
- `git diff --check`: PASS.
- Secret scan по diff: PASS, совпадений `0`.

## Скриншоты

В каталогах `before/` и `after/` лежат по четыре viewport-снимка:

- `search-desktop-1440x900.jpg`
- `search-mobile-390x844.jpg`
- `my-premises-desktop-1440x900.jpg`
- `my-premises-mobile-390x844.jpg`

After-снимок поиска на desktop сделан после закрытия информационного dialog и показывает чистое состояние страницы.
