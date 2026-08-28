# SLOGI v76.1.9 project-host transport hotfix — local evidence

Date: 2026-08-28. Base: exact v76.1.8 target
`562c01c0678956eaf083bc57f9ec40d632d4f6ed`. Scope: isolated manual worktree.
Production evidence was supplied before this task; the release gate did not call or
change production Supabase, Edge, Auth, secrets, Vault, database or schedules.

## Production-contract reproduction

- deployed function version: 2;
- deployed v76.1.8 source SHA-256:
  `b8ac82ea647c0b2dced7ac14fe5ea6f54800de562ad35eac84a2fb315dd917ae`;
- hosted request host: the public configured project host;
- v76.1.8 result: `400 secure_transport_required` before password processing.

Supabase documents `SUPABASE_URL` as the project API gateway available to hosted Edge
Functions. Its hosted request-header example records the second supported upstream
variant: `host`/`x-forwarded-host: edge-runtime.supabase.com`,
`x-forwarded-port: 443`, `x-forwarded-proto: https`.

## Regression contract

- direct HTTPS, independent of environment parsing: PASS;
- exact configured public project host proxy contract: PASS;
- exact documented `edge-runtime.supabase.com` proxy contract with valid project
  environment: PASS;
- missing, HTTP, credentialed, port-bearing, path/query/fragment or non-project
  `SUPABASE_URL`: FAIL closed;
- another project subdomain or arbitrary/unknown host: FAIL closed;
- URL host / `host` / `x-forwarded-host` mismatch: FAIL closed;
- malformed, empty or multiple proto/port/host values: FAIL closed;
- direct plain non-loopback HTTP: FAIL closed;
- localhost/127.0.0.1 development exception: preserved.

The handler-level regression proves that the accepted configured project-host request
reaches normal shape validation after reading only `SUPABASE_URL`. A missing project
environment returns `secure_transport_required` before auth, password/KDF, database or
provider work.

## Full relevant gate

- frontend/password/Cian/map/navigation/shared workspace/CAS: 51/51 PASS;
- Edge/listings/geocoder: 45/45 PASS;
- total deterministic tests: 96 PASS, 0 FAIL;
- local password browser fixture on desktop 1440×900, tablet 768×1024 and mobile
  390×844: PASS;
- root application JavaScript parse: 25/25 PASS;
- old migrations, shared password/grant implementation, frontend and CAS/RLS sources:
  unchanged;
- external Browserless/provider/production calls: 0.

## Scope, secrets and hashes

- `git diff --check`: PASS;
- populated sensitive assignment scan before final documentation commit: 349 tracked
  files, 0 untracked, 0 ignored, 0 findings;
- changed migrations: 0;
- shared password/grant, password/KDF/grant/rate-limit/RLS/Storage/CAS logic changes: 0;
- canonical-LF `password-gate` source SHA-256:
  `f0deec0f61341cdd1b0d72d777e8b67d79947ccd1dc34bf15765d371d8090ca8`.

Final tracked-file inventory and all canonical hashes are rechecked in release metadata
after the content commit.
