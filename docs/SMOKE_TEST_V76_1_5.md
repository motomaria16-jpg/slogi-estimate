# SLOGI v76.1.5 local gate

Date: 2026-08-27. Status: candidate, local/offline only.

## Evidence

- exact base: immutable/public v76.1.4 target `971ecfe9aa5706a053745700ab0c263d831ab9a1`;
- focused Node/static suite: 17 passed, 0 failed;
- clean PostgreSQL 17/Supabase migration apply plus repeated resets: PASS;
- invite catalog: owner postgres, RLS on, policies 0, client/service table grants 0;
- three invite RPC: SECURITY DEFINER, fixed `pg_catalog, public` search_path, service-role execute only;
- local Edge/Auth/browser scenario: 22/22 checkpoints PASS;
- create, fragment scrub, anonymous B join, idempotency, creator-only revoke, expired/revoked/exhausted rejection and cross-device state: PASS;
- desktop 1440×900 and mobile 390×844 invite UI, keyboard/Escape, shell, horizontal overflow 0: PASS;
- console errors/warnings: 0/0;
- raw token persistence/leakage checks: PASS;
- legacy manual-code UI/path: absent/HTTP 410;
- Browserless/direct Cian/provider calls and production calls: 0;
- old migrations changed: 0.

Production secret setup, migration, Edge deploy, Pages publication and production E2E remain separate owner-authorized activation gates.
