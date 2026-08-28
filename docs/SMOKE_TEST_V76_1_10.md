# SLOGI v76.1.10 proxy tuple transport hotfix — local evidence

Date: 2026-08-28. Base: exact v76.1.9 target
`06e2280a9ad9e89d6fa8bac89dba3597b409e758`. Scope: isolated manual worktree.
Production evidence was supplied before this task; no production Supabase,
Edge, Auth, secrets, Vault, database or schedules were called or changed.

## Production evidence classification

- deployed function version: 3;
- deployed v76.1.9 source SHA-256:
  `f0deec0f61341cdd1b0d72d777e8b67d79947ccd1dc34bf15765d371d8090ca8`;
- two POST responses: `400 secure_transport_required`;
- cleanup: PASS;
- allowed fingerprints unchanged: 11/11.

No project identifier, password or secret value is recorded in repository
evidence.

## Regression contract

- direct HTTPS without environment dependency: PASS;
- localhost and `127.0.0.1` development HTTP exception: PASS;
- real-form mixed configured-project / edge-runtime tuple: PASS;
- configured project and edge-runtime same-host tuples: PASS;
- missing `X-Forwarded-Port`: PASS;
- present single `X-Forwarded-Port: 443`: PASS;
- port `80`, empty, malformed or multiple/comma: FAIL closed;
- missing, HTTP, credentialed, port-bearing, path/query/fragment or non-project
  `SUPABASE_URL`: FAIL closed;
- missing or untrusted URL host: FAIL closed;
- every present `Host` and `X-Forwarded-Host` independently outside the strict
  two-host allowlist: FAIL closed;
- empty, multiple/comma or malformed host surface: FAIL closed;
- missing, plain HTTP, malformed or multiple/comma forwarded proto: FAIL closed.

The handler-level fixture proves the accepted mixed tuple reaches normal request
shape validation after reading only `SUPABASE_URL`; missing environment still
returns `secure_transport_required` before auth, password/KDF, database or
provider work.

## Full relevant gate

- frontend/password/Cian/map/navigation/shared workspace/CAS: 51/51 PASS;
- Edge/listings/geocoder: 45/45 PASS;
- total deterministic tests: 96 PASS, 0 FAIL;
- local browser fixture at desktop 1440×900, tablet 768×1024 and mobile
  390×844: PASS;
- root application JavaScript parse: 25/25 PASS;
- old migrations, shared password/grant implementation, frontend, Cian and
  CAS/RLS sources: unchanged;
- external Browserless/provider/production calls: 0.

## Scope, secrets and hashes

- `git diff --check`: PASS;
- tracked/untracked/ignored inventory: 353/0/0;
- high-confidence secret findings: 0;
- changed migrations: 0;
- canonical-LF `password-gate` source SHA-256:
  `2b370d2179b1b72390c5428904fbd302ba3e87233874f67aa0a9fb2f8a2de89a`.
