# SLOGI v76.1.8 secure transport hotfix — local evidence

Date: 2026-08-28. Scope: isolated manual worktree plus read-only production log classification. Production Supabase/Edge/Auth/secrets/Vault/schedules were not changed; external providers were not called.

## Reproduction

The exact v76.1.7 handler received a synthetic hosted Supabase request with an internal HTTP URL and the full proxy header set.

- response: `400 secure_transport_required`;
- environment/password reads before rejection: 0;
- auth/DB/provider calls before rejection: 0.

## Regression contract

- direct HTTPS: PASS;
- internal proxy URL + exact `edge-runtime.supabase.com` host/forwarded-host + port `443` + single HTTPS forwarding token: PASS;
- forwarded HTTPS on an untrusted host: FAIL closed;
- mismatched host/forwarded-host: FAIL closed;
- direct plain HTTP: FAIL closed;
- malformed, empty or multiple proto values: FAIL closed;
- malformed/multiple port and host values: FAIL closed;
- localhost/127.0.0.1 development exception: preserved.

The handler-level regression proves that the trusted proxy request advances to normal request validation without environment, auth, password/KDF or database reads. Browser fixtures additionally assert that the configured public password endpoint is invoked directly over HTTPS.

Production log classification (no bodies, tokens, PII or secret values) recorded one relevant invocation:

- external URL/protocol: `https://<project>.supabase.co/functions/v1/password-gate`, `https:`;
- external host and forwarded proto: exact project host, `https`;
- Deno origin: `https://edge-runtime.supabase.com`;
- response: `400` from the v76.1.7 transport guard.

The hosted handler header contract is documented by Supabase: `host` and `x-forwarded-host` are `edge-runtime.supabase.com`, with `x-forwarded-port: 443` and `x-forwarded-proto: https`.

## Full relevant gate

- frontend/password/Cian/map/navigation/shared workspace/CAS: 51/51 PASS;
- Edge/listings/geocoder: 45/45 PASS;
- total deterministic tests: 96 PASS, 0 FAIL;
- local password browser fixture on desktop/tablet/mobile: PASS;
- root application JavaScript parse: 25/25 PASS;
- old migrations, shared password/grant implementation, frontend and CAS/RLS sources: unchanged;
- external Browserless/provider/production calls: 0.

## Scope and secret review

- `git diff --check`: PASS;
- populated sensitive assignment scan: 349 tracked files, 0 findings;
- untracked files: 0; ignored files: 0; findings: 0;
- changed migrations: 0;
- shared password/grant module changes: 0;
- password/KDF/grant/rate-limit/RLS/Storage/CAS logic changes: 0.

Canonical source hashes are recorded in release metadata after the final local content commit.
