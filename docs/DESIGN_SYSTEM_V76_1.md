# Design system v76.1.1

Интерфейс продолжает визуальный язык SLOGI и предназначен для специалистов по коммерческой недвижимости. Код и маркетинговые материалы референсного сайта не копировались; используются существующие SLOGI assets.

## Tokens

- background `#F2EDE8`;
- navigation `#FCF5EB`;
- navigation border `#ECDCC5`;
- text `#3C3C3C`;
- accent `#E39B2F` с тёмным текстом;
- Ubuntu Sans, Arial, sans-serif;
- крупные радиусы, спокойная типографика, округлые карточки и свободное пространство.

Общие tokens находятся в `design-system-v76-1.css` и централизованном hotfix layer `layout-v76-1-1.css`; Cian-компоненты используют их из `cian-workspace.css`.

## Compact application shell

- один `professional-shell.js` формирует header и desktop/mobile navigation на всех активных страницах;
- порядок разделов: «Поиск помещений», «Мои помещения», «Смета и КП», «Ремонт»;
- desktop 1440/1920: 72 px; tablet 768 и mobile 390: 60 px;
- desktop navigation остаётся одной строкой, page-specific fixed-header offsets нейтрализованы;
- mobile menu удерживает focus, закрывается Escape и возвращает focus на trigger;
- active route отмечен тонкой бирюзовой линией;
- `layout-fixed-header.css` сохранён как compatibility layer без второго ряда и старого body spacer.

## Shared components

Карточки, forms, dialogs, table surfaces, empty states, buttons, inputs и notifications используют единые radius, border, spacing и focus tokens. «Добавить объект» и «Конкурентный анализ» рендерятся как части общего shell; их бизнес-логика и расчёты не изменялись.

## Accessibility

- видимый `:focus-visible`;
- labels/ARIA regions и `aria-live`;
- touch targets основных controls не менее 44 px;
- dialog focus trap, Escape и возврат фокуса;
- `prefers-reduced-motion` отключает motion;
- карта использует `touch-action: pan-y`, scroll zoom выключен;
- контраст проверенных основных пар: 5.93–9.48:1, accent button 6.66:1;
- нет горизонтального scroll на 390 px.

Фактические browser breakpoints hotfix gate: 1440×900, 1920×1080, 768×1024 и 390×844. На всех четырёх viewport минимальный измеренный touch target компонентов SLOGI — 44 px, horizontal overflow отсутствует.
