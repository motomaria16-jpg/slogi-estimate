import {
  authenticateAnonymous,
  decodeBase64Url,
  hmacHex,
  passwordMatches,
  randomOpaqueToken,
  readGateEnvironment,
  readJsonObject,
  runtimeEnvironment,
  serviceRpc,
  sha256Hex,
  signGrant,
  uuid,
  verifyGrant,
  type EnvironmentReader,
  type GateEnvironment,
} from '../_shared/password-gate.ts';

interface Dependencies {
  environment?: EnvironmentReader;
  fetch?: typeof fetch;
  now?: () => number;
  randomToken?: () => string;
  randomUuid?: () => string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-slogi-device-grant',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
};

function response(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, ...headers } });
}

function exactKeys(body: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(body).sort();
  const keys = [...expected].sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function secureTransport(request: Request): boolean {
  try {
    const url = new URL(request.url);
    return url.protocol === 'https:' || (url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost'));
  } catch {
    return false;
  }
}

function networkIdentity(request: Request): string {
  const forwarded = String(request.headers.get('x-forwarded-for') || '').split(',')[0].trim();
  return String(request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') || forwarded || 'unavailable').slice(0, 200);
}

async function rateScopes(gate: GateEnvironment, userId: string, request: Request): Promise<string[]> {
  return Promise.all([
    hmacHex(gate.rateLimitKey, 'user\u0000' + userId),
    hmacHex(gate.rateLimitKey, 'network\u0000' + networkIdentity(request)),
  ]);
}

async function context(gate: GateEnvironment, fetchImpl: typeof fetch): Promise<{
  workspaceId: string;
  version: number;
  ttlSeconds: number;
} | null> {
  const result = await serviceRpc(gate, 'slogi_password_gate_context', {}, fetchImpl);
  if (!result.ok) return null;
  const rows = await result.json().catch(() => null) as unknown;
  const row = Array.isArray(rows) ? rows[0] as Record<string, unknown> | undefined : null;
  const workspaceId = uuid(row?.workspace_id);
  const version = Number(row?.grant_version);
  const ttlSeconds = Number(row?.grant_ttl_seconds);
  return workspaceId && Number.isSafeInteger(version) && version > 0
    && Number.isSafeInteger(ttlSeconds) && ttlSeconds >= 86400
    ? { workspaceId, version, ttlSeconds }
    : null;
}

export function createPasswordGateHandler(dependencies: Dependencies = {}): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (request.method !== 'POST') return response({ status: 'invalid_request' }, 405);
    if (!secureTransport(request)) return response({ status: 'secure_transport_required' }, 400);

    const body = await readJsonObject(request);
    const action = body?.action;
    if (!body || (action !== 'challenge' && action !== 'unlock' && action !== 'status' && action !== 'revoke')) {
      return response({ status: 'invalid_request' }, 400);
    }
    if (action === 'challenge' && !exactKeys(body, ['action'])) return response({ status: 'invalid_request' }, 400);
    if (action === 'unlock' && (!exactKeys(body, ['action', 'challenge', 'password'])
        || typeof body.challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.challenge)
        || typeof body.password !== 'string')) {
      return response({ status: 'access_denied' }, 401);
    }
    if ((action === 'status' || action === 'revoke') && !exactKeys(body, ['action'])) {
      return response({ status: 'invalid_request' }, 400);
    }

    const environment = dependencies.environment || runtimeEnvironment();
    let gate: GateEnvironment;
    try { gate = readGateEnvironment(environment); } catch { return response({ status: 'unavailable' }, 503); }
    const fetchImpl = dependencies.fetch || fetch;
    const now = (dependencies.now || Date.now)();
    const userId = await authenticateAnonymous(request, gate, fetchImpl).catch(() => null);
    if (!userId) return response({ status: 'access_denied' }, 401);

    try {
      if (action === 'challenge') {
        const challenge = (dependencies.randomToken || randomOpaqueToken)();
        if (!/^[A-Za-z0-9_-]{43}$/.test(challenge)) return response({ status: 'unavailable' }, 503);
        const expiresAt = new Date(now + 5 * 60_000).toISOString();
        const created = await serviceRpc(gate, 'slogi_create_password_gate_challenge', {
          p_user_id: userId,
          p_challenge_hash: await sha256Hex(challenge),
          p_expires_at: expiresAt,
        }, fetchImpl);
        if (!created.ok || await created.json().catch(() => null) !== true) return response({ status: 'unavailable' }, 503);
        return response({ status: 'challenge', challenge, expiresAt });
      }

      const grant = String(request.headers.get('x-slogi-device-grant') || '');
      if (action === 'status' || action === 'revoke') {
        const claims = await verifyGrant(grant, gate.signingKey, now);
        if (!claims || claims.userId !== userId) return response({ status: 'access_denied' }, 401);
        const tokenHash = await sha256Hex(grant);
        const rpcName = action === 'status'
          ? 'slogi_validate_password_gate_grant'
          : 'slogi_revoke_password_gate_grant';
        const checked = await serviceRpc(gate, rpcName, {
          p_user_id: userId,
          p_grant_id: claims.grantId,
          p_token_hash: tokenHash,
        }, fetchImpl);
        if (!checked.ok) return response({ status: 'access_denied' }, 401);
        if (action === 'revoke') {
          if (await checked.json().catch(() => null) !== true) return response({ status: 'access_denied' }, 401);
          return response({ status: 'revoked' });
        }
        const rows = await checked.json().catch(() => null) as unknown;
        const row = Array.isArray(rows) ? rows[0] as Record<string, unknown> | undefined : null;
        if (!row || uuid(row.workspace_id) !== claims.workspaceId
            || Number(row.grant_version) !== claims.version) {
          return response({ status: 'access_denied' }, 401);
        }
        return response({ status: 'granted', expiresAt: row.expires_at, version: claims.version });
      }

      const challengeHash = await sha256Hex(String(body.challenge));
      const scopes = await rateScopes(gate, userId, request);
      const began = await serviceRpc(gate, 'slogi_begin_password_gate_attempt', {
        p_user_id: userId,
        p_challenge_hash: challengeHash,
        p_scope_hashes: scopes,
      }, fetchImpl);
      if (!began.ok) return response({ status: 'access_denied' }, 401);
      const retryAfter = Number(await began.json().catch(() => null));
      if (!Number.isSafeInteger(retryAfter) || retryAfter < 0) return response({ status: 'unavailable' }, 503);
      if (retryAfter > 0) {
        return response({ status: 'cooldown', retryAfter }, 429, { 'Retry-After': String(retryAfter) });
      }

      const configuredPassword = environment.get('SLOGI_GATE_PASSWORD');
      const saltRaw = String(environment.get('SLOGI_GATE_KDF_SALT') || '').trim();
      let salt: Uint8Array;
      try { salt = decodeBase64Url(saltRaw); } catch { return response({ status: 'unavailable' }, 503); }
      if (!configuredPassword || salt.byteLength < 32) return response({ status: 'unavailable' }, 503);
      const accepted = await passwordMatches(String(body.password), configuredPassword, salt);
      body.password = '';
      if (!accepted) return response({ status: 'access_denied' }, 401);

      const gateContext = await context(gate, fetchImpl);
      if (!gateContext) return response({ status: 'unavailable' }, 503);
      const issuedAt = Math.floor(now / 1000);
      const expiresAt = issuedAt + gateContext.ttlSeconds;
      const grantId = uuid(dependencies.randomUuid ? dependencies.randomUuid() : crypto.randomUUID());
      const nonce = (dependencies.randomToken || randomOpaqueToken)();
      if (!grantId) return response({ status: 'unavailable' }, 503);
      const signedGrant = await signGrant({
        grantId,
        userId,
        workspaceId: gateContext.workspaceId,
        version: gateContext.version,
        issuedAt,
        expiresAt,
        nonce,
      }, gate.signingKey);
      const issued = await serviceRpc(gate, 'slogi_issue_password_gate_grant', {
        p_user_id: userId,
        p_grant_id: grantId,
        p_token_hash: await sha256Hex(signedGrant),
        p_expires_at: new Date(expiresAt * 1000).toISOString(),
        p_grant_version: gateContext.version,
      }, fetchImpl);
      if (!issued.ok || uuid(await issued.json().catch(() => null)) !== gateContext.workspaceId) {
        return response({ status: 'unavailable' }, 503);
      }
      await serviceRpc(gate, 'slogi_clear_password_gate_limits', { p_scope_hashes: scopes }, fetchImpl);
      return response({
        status: 'granted',
        grant: signedGrant,
        expiresAt: new Date(expiresAt * 1000).toISOString(),
        version: gateContext.version,
      });
    } catch {
      if (body && Object.hasOwn(body, 'password')) body.password = '';
      return response({ status: 'unavailable' }, 503);
    }
  };
}

if (typeof Deno !== 'undefined' && import.meta.main) {
  Deno.serve(createPasswordGateHandler());
}
