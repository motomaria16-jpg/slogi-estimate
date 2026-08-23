# Design system v76.1.0

Интерфейс продолжает визуальный язык SLOGI и предназначен для специалистов по коммерческой недвижимости. Код и маркетинговые материалы референсного сайта не копировались; используются существующие SLOGI assets.

## Tokens

- background `#F2EDE8`;
- navigation `#FCF5EB`;
- navigation border `#ECDCC5`;
- text `#3C3C3C`;
- accent `#E39B2F` с тёмным текстом;
- Ubuntu Sans, Arial, sans-serif;
- крупные радиусы, спокойная типографика, округлые карточки и свободное пространство.

Общие tokens находятся в `design-system-v76-1.css`; Cian-компоненты используют их из `cian-workspace.css`.

## Accessibility

- видимый `:focus-visible`;
- labels/ARIA regions и `aria-live`;
- touch targets основных controls не менее 44 px;
- dialog focus trap, Escape и возврат фокуса;
- `prefers-reduced-motion` отключает motion;
- карта использует `touch-action: pan-y`, scroll zoom выключен;
- контраст проверенных основных пар: 5.93–9.48:1, accent button 6.66:1;
- нет горизонтального scroll на 390 px.

Фактические browser breakpoints: 1440×900, 1024×768, 768×1024 и 390×844.
