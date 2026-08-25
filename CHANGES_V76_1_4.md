# SLOGI v76.1.4 candidate — Shared Workspace Soft-Delete CAS Hotfix

- Исправлена потеря soft-delete, выполненного во время начального workspace-read после одного `PT409` reconciliation.
- При совпадающих cached base/revision и remote snapshot локальная мутация отправляется ровно одним CAS после initialization.
- При новом remote winner локальная версия не rebased поверх него: она остаётся conflict draft, remote state применяется как источник истины.
- Ожидаемый `PT409` не повторяется автоматически и не создаёт retry flood.
- Добавлены детерминированные Promise-barrier regression tests без sleep-based предположений.
- Локальный two-context browser smoke доказал последовательность: add → один stale `PT409` → cross-device → soft-delete → reload → permanent purge → no resurrection.
- Migrations, Edge Functions, Auth/JWT, RLS, Storage, Cian parser/transport, Browserless, Avito/Ozon, Vault и cron не изменялись.
- Production Supabase и опубликованный GitHub Pages в ходе подготовки candidate не опрашивались и не изменялись.

Candidate не разрешает merge, tag, GitHub Release, Pages publish или новый production E2E.
