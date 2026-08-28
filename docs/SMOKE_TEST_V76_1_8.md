# SLOGI v76.1.8 secure transport hotfix — local evidence

Date: 2026-08-28. Scope: isolated manual worktree only. Production Supabase, Edge, Auth, secrets, Vault, schedules and external providers were not called.

## Reproduction

The exact v76.1.7 handler received a synthetic Supabase-style request with an internal HTTP URL, trusted external Supabase host and `x-forwarded-proto: https`.

- response: `400 secure_transport_required`;
- environment/password reads before rejection: 0;
- auth/DB/provider calls before rejection: 0.

## Regression contract

- direct HTTPS: PASS;
- internal proxy URL + exact configured `*.supabase.co` host + single HTTPS forwarding token: PASS;
- forwarded HTTPS on an untrusted host: FAIL closed;
- forwarded host for another Supabase project: FAIL closed;
- direct plain HTTP: FAIL closed;
- malformed, empty or multiple proto values: FAIL closed;
- conflicting/malformed forwarded host: FAIL closed;
- localhost/127.0.0.1 development exception: preserved.

The handler-level regression proves that the trusted proxy request advances to normal request validation while reading only `SUPABASE_URL`; auth, password/KDF and database work remain untouched at that point.

## Full relevant gate

- frontend/password/Cian/map/navigation/shared workspace/CAS: 51/51 PASS;
- Edge/listings/geocoder: 44/44 PASS;
- total deterministic tests: 95 PASS, 0 FAIL;
- local password browser fixture: PASS;
- root application JavaScript parse: 25/25 PASS;
- old migrations, shared password/grant implementation, frontend and CAS/RLS sources: unchanged;
- external Browserless/provider/production calls: 0.

Secret inventory and canonical source hashes are recorded in release metadata after the final local content commit.
