# SLOGI v76.1.14 — UI layout refresh

Base: exact released `v76.1.13` commit `a2b4a8a024ee5dd984fc58d5207dfb07ff5a5e7b`.

Scope: layout, composition, sizing, spacing, typography density, shared responsive rules and presentation-only UI hooks. Brand colors, logo, product data, Cian feed/map behavior, password gate, Supabase interaction, storage/CAS/trash and workflow transitions are unchanged.

The public School SLOGI site was used only to analyze spacing rhythm and shell consistency. No reference text or assets were copied.

## Visual result

| Page | Before 1440×900 | After 1440×900 | Before 390×844 | After 390×844 |
| --- | --- | --- | --- | --- |
| Search | [before](before/search-1440x900.jpg) | [after](after/search-1440x900.jpg) | [before](before/search-390x844.jpg) | [after](after/search-390x844.jpg) |
| My Premises | [before](before/my-premises-1440x900.jpg) | [after](after/my-premises-1440x900.jpg) | [before](before/my-premises-390x844.jpg) | [after](after/my-premises-390x844.jpg) |
| Estimate and Proposal | [before](before/estimate-and-proposal-1440x900.jpg) | [after](after/estimate-and-proposal-1440x900.jpg) | [before](before/estimate-and-proposal-390x844.jpg) | [after](after/estimate-and-proposal-390x844.jpg) |
| Repair | [before](before/repair-1440x900.jpg) | [after](after/repair-1440x900.jpg) | [before](before/repair-390x844.jpg) | [after](after/repair-390x844.jpg) |
| Add-object modal | [before](before/add-object-1440x900.jpg) | [after](after/add-object-1440x900.jpg) | [before](before/add-object-390x844.jpg) | [after](after/add-object-390x844.jpg) |

The after directory also contains tablet `768×1024` screenshots for all four pages and the add-object modal.

## Deterministic browser QA

The local fixture intercepts all configured Supabase and Edge requests. It never contacts production. Counts, timestamps, statuses, readiness and source state shown in the screenshots are rendered from the fixture response or fixture workspace state rather than hard-coded into product markup.

- responsive matrix: `1440×900`, `1536×960`, `1280×800`, `1024×768`, `768×1024`, `390×844`;
- four active product sections, identical header geometry at each breakpoint;
- no body horizontal overflow in `24/24` page/viewport combinations;
- visible buttons, fields, selects, textareas and summaries meet the `44 px` target in the after matrix;
- Search: full two-page cursor drain, `53` unique cards, `51` markers, `58` polygons, honest missing counters, filters, independent list scroll, visible map and marker/card sync;
- My Premises: search, status filter, reset, table rhythm, grouped economy, map expansion with `aria-expanded`, Add object, modal scroll, save and preservation of pre-existing fixture objects;
- Estimate/Repair: readiness values from the existing seven checks, concise real missing-field summary, transition to the existing estimate route, repair object rendering;
- mobile menu: keyboard open/Escape close and `aria-expanded` state;
- password gate: fail-closed wrong-password, replay, tamper, revoke, expiry and cooldown fixtures;
- browser console/page errors: `0`.

## Contrast audit

No palette values were changed. Measured common pairs:

| Pair | Contrast |
| --- | ---: |
| Body text `#3c3c3c` / cream `#fcf5eb` | `10.19:1` |
| Secondary text `#716d67` / cream `#fcf5eb` | `4.75:1` |
| White / existing application teal `#08777b` | `5.34:1` |
| White / existing stage teal `#4b6e73` | `5.56:1` |
| Dark text `#2f2b26` / mustard `#e39b2f` | `6.02:1` |

The white / brand teal `#4f8580` pair is `4.20:1`; in the touched UI it is limited to the large bold logo mark (large-text threshold) and non-text progress fills, not normal body copy. This existing brand value was intentionally preserved.
