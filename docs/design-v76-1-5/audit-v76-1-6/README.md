# SLOGI v76.1.6 — compact search alignment

This audit compares the shared design branch before and after the compact search update. The isolated local visual fixture supplies representative premises and Cian listings without changing production data or making external listing requests.

## Measured geometry

| Surface | Desktop before | Desktop after | Mobile before | Mobile after |
| --- | ---: | ---: | ---: | ---: |
| Search H1 | 56 px | 48 px | 34 px | 32 px |
| Search hero height | 223 px | 188 px | 321 px | 285 px |
| Header height | 76 px | 76 px | 62 px | 62 px |
| Source title | 28 px | 19 px | 25 px | 19 px |
| Source card height | 197 px | 105 px | 178 px | 143 px |
| Listing row height | 338 px | 251 px | 440 px | 340 px |
| Search outer gap | 24 px | 14 px | 24 px | 14 px |

The My Premises reference remains unchanged: its hero is 154 px on desktop and 279 px on mobile, with H1 at 56 px and 34 px respectively. The Search mobile hero now follows the same density while retaining its longer explanatory copy and refresh action.

## Screenshots

- `before/`: Search and My Premises JPEGs at 1440×900 and 390×844 before the update.
- `after/`: the same four states after the update.

## Browser audit

The nine working pages were checked at 1440×900, 768×1024, and 390×844. Across 27 page/viewport combinations: shared header height matched, horizontal overflow was zero, visible controls were at least 44 px high, body text was 16 px, and console errors/warnings were zero. Mobile navigation opened with focus moved to its first route. Reduced-motion behavior is retained by the shared final theme.
